#!/usr/bin/env node
import https from 'node:https';

function parseArgs() {
  const args = {};
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (v.startsWith('--')) {
      const eqIdx = v.indexOf('=');
      if (eqIdx !== -1) {
        args[v.slice(2, eqIdx)] = v.slice(eqIdx + 1);
      } else if (i + 1 < raw.length && !raw[i + 1].startsWith('--')) {
        args[v.slice(2)] = raw[++i];
      } else {
        args[v.slice(2)] = true;
      }
    }
  }
  if (args.help) {
    process.stdout.write(`FrameX Feishu MCP v1.1.0

Usage:
  framex-feishu mcp [options]     Start MCP server (default)
  framex-feishu --help            Show this help

MCP Options:
  --app-id <id>                   飞书 App ID (env: FEISHU_APP_ID)
  --app-secret <secret>           飞书 App Secret (env: FEISHU_APP_SECRET)
  --user-id <open_id>             用户 open_id，用于自动授权 (env: FEISHU_USER_ID)
  --domain <url>                  飞书域名，默认 https://open.feishu.cn (env: FEISHU_URL)
  --debug                         启用调试日志
`);
    process.exit(0);
  }
  return args;
}

const args = parseArgs();
const APP_ID = args['app-id'] || process.env.FEISHU_APP_ID;
const APP_SECRET = args['app-secret'] || process.env.FEISHU_APP_SECRET;
const FEISHU_URL = process.env.FEISHU_URL || 'https://open.feishu.cn';
const FEISHU_USER_ID = args['user-id'] || process.env.FEISHU_USER_ID;
const DEBUG = args.debug || process.env.FEISHU_DEBUG;

if (!APP_ID || !APP_SECRET) {
  process.stderr.write('Error: Missing FEISHU_APP_ID and FEISHU_APP_SECRET\n');
  process.stderr.write('Usage: framex-feishu --app-id <id> --app-secret <secret>\n');
  process.exit(1);
}

let cachedToken = null;
let tokenExpiresAt = 0;

function apiFetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(FEISHU_URL + path);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
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
  if (!res.tenant_access_token) {
    throw new Error(`Token获取失败: ${res.msg || JSON.stringify(res)}`);
  }
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
  try {
    await api(`/open-apis/drive/v1/permissions/${token}/members?type=${type}&need_notification=false`, {
      method: 'POST',
      body: { member_type: 'openid', member_id: FEISHU_USER_ID, perm: 'full_access' },
    });
  } catch (e) {
    if (DEBUG) process.stderr.write(`[授权] ${token} 失败: ${e.message}\n`);
  }
}

const tools = [
  {
    name: 'send_feishu_message',
    description: '发送文本消息到飞书。支持个人(open_id)或群聊(chat_id)',
    inputSchema: {
      type: 'object',
      properties: {
        receive_id: { type: 'string', description: '接收者ID，open_id(个人)或chat_id(群聊)' },
        text: { type: 'string', description: '消息内容' },
        receive_id_type: {
          type: 'string', description: 'ID类型', enum: ['open_id', 'chat_id', 'user_id'],
        },
      },
      required: ['receive_id', 'text'],
    },
    async handler(args) {
      const res = await api('/open-apis/im/v1/messages?' + new URLSearchParams({ receive_id_type: args.receive_id_type || 'open_id' }), {
        method: 'POST',
        body: { receive_id: args.receive_id, msg_type: 'text', content: JSON.stringify({ text: args.text }) },
      });
      if (res.code !== 0) throw new Error(`发送消息失败 (${res.code}): ${res.msg}`);
      return { message_id: res.data.message_id };
    },
  },
  {
    name: 'create_feishu_document',
    description: '创建飞书文档。folderToken 指定存放文件夹（不传则根目录）',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '文档标题' },
        folderToken: { type: 'string', description: '目标文件夹token（可选，不传则根目录）' },
      },
      required: ['title'],
    },
    async handler(args) {
      const body = { title: args.title };
      if (args.folderToken) body.folder_token = args.folderToken;
      const res = await api('/open-apis/docx/v1/documents', { method: 'POST', body });
      if (res.code !== 0) throw new Error(`创建文档失败 (${res.code}): ${res.msg}`);
      const doc = res.data.document;
      await addPermission(doc.document_id, 'docx');
      return {
        document_id: doc.document_id,
        title: doc.title,
        url: `https://ecnaqezi6ak9.feishu.cn/docx/${doc.document_id}`,
      };
    },
  },
  {
    name: 'get_feishu_root_folder',
    description: '获取飞书云盘根文件夹信息',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const res = await api('/open-apis/drive/explorer/v2/root_folder/meta');
      if (res.code !== 0) throw new Error(`获取根文件夹失败 (${res.code}): ${res.msg}`);
      return res.data;
    },
  },
  {
    name: 'list_feishu_folder',
    description: '浏览飞书文件夹内容',
    inputSchema: {
      type: 'object',
      properties: {
        folderToken: { type: 'string', description: '文件夹token' },
      },
      required: ['folderToken'],
    },
    async handler(args) {
      const res = await api(`/open-apis/drive/v1/files?folder_token=${args.folderToken}&page_size=50&order_by=EditedTime&direction=DESC`);
      if (res.code !== 0) throw new Error(`浏览文件夹失败 (${res.code}): ${res.msg}`);
      return res.data;
    },
  },
  {
    name: 'search_feishu_user',
    description: '通过手机号或邮箱查找飞书用户，返回 open_id',
    inputSchema: {
      type: 'object',
      properties: {
        mobile: { type: 'string', description: '手机号（与 email 二选一）' },
        email: { type: 'string', description: '邮箱（与 mobile 二选一）' },
      },
    },
    async handler(args) {
      const payload = {};
      if (args.mobile) payload.mobiles = [args.mobile];
      if (args.email) payload.emails = [args.email];
      const res = await api('/open-apis/contact/v3/users/batch_get_id', { method: 'POST', body: payload });
      if (res.code !== 0) throw new Error(`查找用户失败 (${res.code}): ${res.msg}`);
      return res.data;
    },
  },
  {
    name: 'create_feishu_folder',
    description: '在飞书云盘中创建新文件夹。不传 folderToken 则在根目录创建',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '文件夹名称' },
        folderToken: { type: 'string', description: '父文件夹token（可选，不传则根目录创建）' },
      },
      required: ['name'],
    },
    async handler(args) {
      let folderToken = args.folderToken;
      if (!folderToken) {
        const rootRes = await api('/open-apis/drive/explorer/v2/root_folder/meta');
        if (rootRes.code !== 0) throw new Error(`获取根文件夹失败: ${rootRes.msg}`);
        folderToken = rootRes.data.token;
      }
      const res = await api('/open-apis/drive/v1/files/create_folder', {
        method: 'POST',
        body: { name: args.name, folder_token: folderToken },
      });
      if (res.code !== 0) throw new Error(`创建文件夹失败 (${res.code}): ${res.msg}`);
      await addPermission(res.data.token, 'folder');
      return res.data;
    },
  },
];

const toolMap = Object.fromEntries(tools.map(t => [t.name, t]));

let buffer = '';
let pending = 0;

function sendJson(obj) {
  const line = JSON.stringify(obj) + '\n';
  process.stdout.write(line);
}

function decPending() {
  if (--pending <= 0) process.exit(0);
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    sendJson({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'framex-feishu', version: '1.1.0' },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') return;
  if (method === 'ping') {
    sendJson({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'tools/list') {
    sendJson({
      jsonrpc: '2.0', id,
      result: { tools: tools.map(({ handler, ...rest }) => rest) },
    });
    return;
  }

  if (method === 'tools/call') {
    pending++;
    const { name, arguments: a } = params;
    try {
      const tool = toolMap[name];
      if (!tool) {
        sendJson({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` } });
        return;
      }
      const result = await tool.handler(a || {});
      sendJson({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      });
    } catch (err) {
      sendJson({ jsonrpc: '2.0', id, error: { code: -1, message: err.message } });
    } finally {
      decPending();
    }
    return;
  }

  sendJson({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
}

process.stdin.on('data', chunk => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      handleMessage(msg).catch(e => {
        if (DEBUG) process.stderr.write(`[Error] ${e.message}\n`);
      });
    } catch (err) {
      if (DEBUG) process.stderr.write(`[ParseError] ${err.message}\n`);
    }
  }
});

process.stdin.on('end', () => {
  if (pending <= 0) process.exit(0);
});
