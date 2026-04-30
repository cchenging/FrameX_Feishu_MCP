#!/usr/bin/env node
import https from 'node:https';

const args = Object.fromEntries(process.argv.slice(2).flatMap((v, i, a) =>
  v.startsWith('--') ? [[v.slice(2), a[i + 1]]] : []
));
const APP_ID = args['app-id'] || process.env.FEISHU_APP_ID;
const APP_SECRET = args['app-secret'] || process.env.FEISHU_APP_SECRET;
const FEISHU_URL = process.env.FEISHU_URL || 'https://open.feishu.cn';
const DOMAIN = FEISHU_URL === 'https://open.larksuite.com' ? 'larksuite' : 'feishu';
const FEISHU_USER_ID = args['user-id'] || process.env.FEISHU_USER_ID;

if (!APP_ID || !APP_SECRET) {
  process.stderr.write('Missing FEISHU_APP_ID and FEISHU_APP_SECRET\n');
  process.exit(1);
}

let cachedToken = null, tokenExpiresAt = 0;

function apiFetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(FEISHU_URL + path);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

async function getToken() {
  if (Date.now() < tokenExpiresAt && cachedToken) return cachedToken;
  const res = await apiFetch('/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    body: { app_id: APP_ID, app_secret: APP_SECRET },
  });
  cachedToken = res.tenant_access_token;
  tokenExpiresAt = Date.now() + (res.expire - 60) * 1000;
  return cachedToken;
}

async function api(path, opts = {}) {
  const token = await getToken();
  return apiFetch(path, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
}

async function addPermission(token, type) {
  if (!FEISHU_USER_ID) return;
  await api(`/open-apis/drive/v1/permissions/${token}/members?type=${type}&need_notification=false`, {
    method: 'POST',
    body: { member_type: 'openid', member_id: FEISHU_USER_ID, perm: 'full_access' },
  }).catch(() => {});
}

let buffer = '';
let pending = 0;
function send(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function sendError(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }
function decPending() { if (--pending <= 0) process.exit(0); }

async function handleMessage(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      send(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'framex-feishu', version: '1.0.0' } });
      return;
    }
    if (method === 'notifications/initialized') return;
    if (method === 'tools/list') {
      send(id, { tools: [
        {
          name: 'send_feishu_message',
          description: '发送文本消息到飞书。支持发送给个人(open_id)或群聊(chat_id)',
          inputSchema: {
            type: 'object', properties: {
              receive_id: { type: 'string', description: '接收者ID，可以是 open_id 或 chat_id' },
              text: { type: 'string', description: '消息内容' },
              receive_id_type: { type: 'string', description: 'ID类型: open_id / chat_id / user_id', enum: ['open_id', 'chat_id', 'user_id'] },
            }, required: ['receive_id', 'text'],
          },
        },
        {
          name: 'create_feishu_document',
          description: '创建飞书文档。可选参数 folderToken 可指定文档放在哪个文件夹下，不传则放在根目录',
          inputSchema: {
            type: 'object', properties: {
              title: { type: 'string', description: '文档标题' },
              folderToken: { type: 'string', description: '目标文件夹token（可选，不传则根目录）' },
            }, required: ['title'],
          },
        },
        {
          name: 'get_feishu_root_folder',
          description: '获取飞书云盘根文件夹信息，返回根文件夹的 token 和 id',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'list_feishu_folder',
          description: '浏览飞书文件夹内容。传入文件夹 token 查看该文件夹下的所有文件和子文件夹',
          inputSchema: {
            type: 'object', properties: {
              folderToken: { type: 'string', description: '文件夹token' },
            }, required: ['folderToken'],
          },
        },
        {
          name: 'search_feishu_user',
          description: '通过手机号或邮箱查找飞书用户信息，返回用户的 open_id',
          inputSchema: {
            type: 'object', properties: {
              mobile: { type: 'string', description: '手机号（与 email 二选一）' },
              email: { type: 'string', description: '邮箱（与 mobile 二选一）' },
            },
          },
        },
        {
          name: 'create_feishu_folder',
          description: '在飞书云盘中创建新文件夹',
          inputSchema: {
            type: 'object', properties: {
              name: { type: 'string', description: '文件夹名称' },
              folderToken: { type: 'string', description: '父文件夹token（可选，不传则在根目录创建）' },
            }, required: ['name'],
          },
        },
      ]});
      return;
    }
    if (method === 'tools/call') {
      pending++;
      const { name, arguments: a } = params;
      try {
        switch (name) {
          case 'send_feishu_message': {
            const r1 = await api('/open-apis/im/v1/messages?' + new URLSearchParams({ receive_id_type: a.receive_id_type || 'open_id' }), {
              method: 'POST',
              body: { receive_id: a.receive_id, msg_type: 'text', content: JSON.stringify({ text: a.text }) },
            });
            if (r1.code !== 0) return sendError(id, r1.code, `发送消息失败: ${r1.msg}`);
            send(id, { content: [{ type: 'text', text: JSON.stringify({ message_id: r1.data.message_id }, null, 2) }] });
            return;
          }
          case 'create_feishu_document': {
            const body = { title: a.title };
            if (a.folderToken) body.folder_token = a.folderToken;
            const r2 = await api('/open-apis/docx/v1/documents', { method: 'POST', body });
            if (r2.code !== 0) return sendError(id, r2.code, `创建文档失败: ${r2.msg}`);
            const doc = r2.data.document;
            await addPermission(doc.document_id, 'docx');
            send(id, { content: [{ type: 'text', text: JSON.stringify({
              document_id: doc.document_id, title: doc.title,
              url: `https://ecnaqezi6ak9.feishu.cn/docx/${doc.document_id}`,
            }, null, 2) }] });
            return;
          }
          case 'get_feishu_root_folder': {
            const r3 = await api('/open-apis/drive/explorer/v2/root_folder/meta');
            if (r3.code !== 0) return sendError(id, r3.code, `获取根文件夹失败: ${r3.msg}`);
            send(id, { content: [{ type: 'text', text: JSON.stringify(r3.data, null, 2) }] });
            return;
          }
          case 'list_feishu_folder': {
            const r4 = await api(`/open-apis/drive/v1/files?folder_token=${a.folderToken}&page_size=50&order_by=EditedTime&direction=DESC`);
            if (r4.code !== 0) return sendError(id, r4.code, `浏览文件夹失败: ${r4.msg}`);
            send(id, { content: [{ type: 'text', text: JSON.stringify(r4.data, null, 2) }] });
            return;
          }
          case 'search_feishu_user': {
            const payload = {};
            if (a.mobile) payload.mobiles = [a.mobile];
            if (a.email) payload.emails = [a.email];
            const r5 = await api('/open-apis/contact/v3/users/batch_get_id', { method: 'POST', body: payload });
            if (r5.code !== 0) return sendError(id, r5.code, `查找用户失败: ${r5.msg}`);
            send(id, { content: [{ type: 'text', text: JSON.stringify(r5.data, null, 2) }] });
            return;
          }
          case 'create_feishu_folder': {
            let folderToken = a.folderToken;
            if (!folderToken) {
              const rootRes = await api('/open-apis/drive/explorer/v2/root_folder/meta');
              if (rootRes.code !== 0) return sendError(id, rootRes.code, `获取根文件夹失败: ${rootRes.msg}`);
              folderToken = rootRes.data.token;
            }
            const r6 = await api('/open-apis/drive/v1/files/create_folder', { method: 'POST', body: { name: a.name, folder_token: folderToken } });
            if (r6.code !== 0) return sendError(id, r6.code, `创建文件夹失败: ${r6.msg}`);
            await addPermission(r6.data.token, 'folder');
            send(id, { content: [{ type: 'text', text: JSON.stringify(r6.data, null, 2) }] });
            return;
          }
          default: return sendError(id, -32601, `未知工具: ${name}`);
        }
      } finally {
        decPending();
      }
    }
    sendError(id, -32601, `未知方法: ${method}`);
  } catch (err) { sendError(id, -1, err.message); }
}

process.stdin.on('data', chunk => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try { handleMessage(JSON.parse(line)).catch(e => {}); } catch (err) { process.stderr.write('Parse error: ' + err.message + '\n'); }
  }
});
process.stdin.on('end', () => { if (pending <= 0) process.exit(0); });
