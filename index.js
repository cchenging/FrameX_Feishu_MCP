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
    process.stdout.write(`FrameX Feishu MCP v2.0.3

Usage:
  framex-feishu [options]         启动 MCP 服务
  framex-feishu --help            显示帮助

Options:
  --app-id <id>                   飞书 App ID (env: FEISHU_APP_ID)
  --app-secret <secret>           飞书 App Secret (env: FEISHU_APP_SECRET)
  --user-id <open_id>             用户 open_id，自动授权用 (env: FEISHU_USER_ID)
  --domain <url>                  飞书域名，默认 https://open.feishu.cn (env: FEISHU_URL)
  --debug                         启用调试日志 (env: FEISHU_DEBUG)

工具类别: message, document, drive, contact, calendar, bitable, task, sheets, wiki, vc
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
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...opts.headers },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body), 'utf8');
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

async function grantAccess(token, type) {
  if (!FEISHU_USER_ID) return;
  try {
    const res = await api(`/open-apis/drive/v1/permissions/${token}/members?type=${type}&need_notification=false`, {
      method: 'POST',
      body: { member_type: 'openid', member_id: FEISHU_USER_ID, perm: 'full_access' },
    });
    if (res.code !== 0 && DEBUG) {
      process.stderr.write(`[授权] ${token} 失败 (${res.code}): ${res.msg}\n`);
    }
  } catch (e) {
    if (DEBUG) process.stderr.write(`[授权] ${token} 异常: ${e.message}\n`);
  }
}

function t(name, description, props, required, handler) {
  return { name, description, inputSchema: { type: 'object', properties: props, required }, handler };
}

function str(desc) { return { type: 'string', description: desc }; }
function strEnum(desc, items) { return { type: 'string', description: desc, enum: items }; }

const tools = [
  // ==================== 消息 (IM) ====================
  t('send_feishu_message', '发送文本消息到飞书', {
    receive_id: str('接收者ID，open_id(个人)或chat_id(群聊)'),
    text: str('消息内容'),
    receive_id_type: strEnum('ID类型', ['open_id', 'chat_id', 'user_id']),
  }, ['receive_id', 'text'], async (a) => {
    const res = await api('/open-apis/im/v1/messages?' + new URLSearchParams({ receive_id_type: a.receive_id_type || 'open_id' }), {
      method: 'POST',
      body: { receive_id: a.receive_id, msg_type: 'text', content: JSON.stringify({ text: a.text }) },
    });
    if (res.code !== 0) throw new Error(`发送消息失败 (${res.code}): ${res.msg}`);
    return { message_id: res.data.message_id };
  }),

  t('send_feishu_card_message', '发送卡片消息到飞书', {
    receive_id: str('接收者ID'),
    card: str('卡片内容 JSON 字符串'),
    receive_id_type: strEnum('ID类型', ['open_id', 'chat_id', 'user_id']),
  }, ['receive_id', 'card'], async (a) => {
    const res = await api('/open-apis/im/v1/messages?' + new URLSearchParams({ receive_id_type: a.receive_id_type || 'open_id' }), {
      method: 'POST',
      body: { receive_id: a.receive_id, msg_type: 'interactive', content: typeof a.card === 'string' ? a.card : JSON.stringify(a.card) },
    });
    if (res.code !== 0) throw new Error(`发送卡片消息失败 (${res.code}): ${res.msg}`);
    return { message_id: res.data.message_id };
  }),

  t('send_feishu_rich_text', '发送富文本(Post)消息到飞书', {
    receive_id: str('接收者ID'),
    content: str('富文本内容 JSON 字符串，格式参考飞书 Post 消息'),
    receive_id_type: strEnum('ID类型', ['open_id', 'chat_id', 'user_id']),
  }, ['receive_id', 'content'], async (a) => {
    const res = await api('/open-apis/im/v1/messages?' + new URLSearchParams({ receive_id_type: a.receive_id_type || 'open_id' }), {
      method: 'POST',
      body: { receive_id: a.receive_id, msg_type: 'post', content: typeof a.content === 'string' ? a.content : JSON.stringify(a.content) },
    });
    if (res.code !== 0) throw new Error(`发送富文本消息失败 (${res.code}): ${res.msg}`);
    return { message_id: res.data.message_id };
  }),

  t('get_feishu_message', '获取消息详情', {
    message_id: str('消息ID'),
  }, ['message_id'], async (a) => {
    const res = await api(`/open-apis/im/v1/messages/${a.message_id}`);
    if (res.code !== 0) throw new Error(`获取消息失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_messages', '获取聊天记录列表', {
    container_id_type: strEnum('容器类型', ['chat', 'email']),
    container_id: str('容器ID，群ID或邮箱'),
    page_size: str('分页大小，最大50（可选）'),
    page_token: str('分页token（可选）'),
    sort_type: strEnum('排序', ['ByCreateTimeAsc', 'ByCreateTimeDesc']),
  }, ['container_id_type', 'container_id'], async (a) => {
    const query = new URLSearchParams({ container_id_type: a.container_id_type, container_id: a.container_id });
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    if (a.sort_type) query.set('sort_type', a.sort_type);
    const res = await api(`/open-apis/im/v1/messages?${query}`);
    if (res.code !== 0) throw new Error(`获取消息列表失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('reply_feishu_message', '回复消息', {
    message_id: str('要回复的消息ID'),
    text: str('回复内容'),
  }, ['message_id', 'text'], async (a) => {
    const res = await api(`/open-apis/im/v1/messages/${a.message_id}/reply`, {
      method: 'POST',
      body: { msg_type: 'text', content: JSON.stringify({ text: a.text }) },
    });
    if (res.code !== 0) throw new Error(`回复消息失败 (${res.code}): ${res.msg}`);
    return { message_id: res.data.message_id };
  }),

  t('delete_feishu_message', '撤回消息', {
    message_id: str('要撤回的消息ID'),
  }, ['message_id'], async (a) => {
    const res = await api(`/open-apis/im/v1/messages/${a.message_id}`, { method: 'DELETE' });
    if (res.code !== 0) throw new Error(`撤回消息失败 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  // ==================== 群聊 (Chat) ====================
  t('create_feishu_chat', '创建群聊', {
    name: str('群名称'),
    description: str('群描述（可选）'),
    open_ids: str('创建者 open_id（可选）'),
  }, ['name'], async (a) => {
    const body = { name: a.name };
    if (a.description) body.description = a.description;
    if (a.open_ids) body.owner_id = a.open_ids;
    const res = await api('/open-apis/im/v1/chats', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`创建群聊失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_chat', '获取群聊信息', {
    chat_id: str('群聊ID'),
  }, ['chat_id'], async (a) => {
    const res = await api(`/open-apis/im/v1/chats/${a.chat_id}`);
    if (res.code !== 0) throw new Error(`获取群聊失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_chats', '获取群聊列表', {
    page_size: str('分页大小（可选）'),
    page_token: str('分页token（可选）'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/im/v1/chats?${query}`);
    if (res.code !== 0) throw new Error(`获取群聊列表失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('update_feishu_chat', '更新群聊信息', {
    chat_id: str('群聊ID'),
    name: str('新群名称（可选）'),
    description: str('新群描述（可选）'),
  }, ['chat_id'], async (a) => {
    const body = {};
    if (a.name) body.name = a.name;
    if (a.description) body.description = a.description;
    const res = await api(`/open-apis/im/v1/chats/${a.chat_id}`, { method: 'PATCH', body });
    if (res.code !== 0) throw new Error(`更新群聊失败 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  t('add_chat_members', '添加群成员', {
    chat_id: str('群聊ID'),
    open_ids: str('要添加的成员 open_id，多个用逗号分隔'),
  }, ['chat_id', 'open_ids'], async (a) => {
    const res = await api(`/open-apis/im/v1/chats/${a.chat_id}/members`, {
      method: 'POST',
      body: { id_list: a.open_ids.split(',').map(s => s.trim()) },
    });
    if (res.code !== 0) throw new Error(`添加群成员失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('remove_chat_members', '移除群成员', {
    chat_id: str('群聊ID'),
    open_ids: str('要移除的成员 open_id，多个用逗号分隔'),
  }, ['chat_id', 'open_ids'], async (a) => {
    const res = await api(`/open-apis/im/v1/chats/${a.chat_id}/members`, {
      method: 'DELETE',
      body: { id_list: a.open_ids.split(',').map(s => s.trim()) },
    });
    if (res.code !== 0) throw new Error(`移除群成员失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_chat_members', '获取群成员列表', {
    chat_id: str('群聊ID'),
    page_size: str('分页大小（可选）'),
    page_token: str('分页token（可选）'),
  }, ['chat_id'], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/im/v1/chats/${a.chat_id}/members?${query}`);
    if (res.code !== 0) throw new Error(`获取群成员失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 文档 (Document) ====================
  t('create_feishu_document', '创建飞书文档', {
    title: str('文档标题'),
    folderToken: str('目标文件夹token（可选，不传则根目录）'),
  }, ['title'], async (a) => {
    const body = { title: a.title };
    if (a.folderToken) body.folder_token = a.folderToken;
    const res = await api('/open-apis/docx/v1/documents', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`创建文档失败 (${res.code}): ${res.msg}`);
    const doc = res.data.document;
    await grantAccess(doc.document_id, 'docx');
    return { document_id: doc.document_id, title: doc.title, url: `https://ecnaqezi6ak9.feishu.cn/docx/${doc.document_id}` };
  }),

  t('get_feishu_document', '获取文档信息', {
    document_id: str('文档ID'),
  }, ['document_id'], async (a) => {
    const res = await api(`/open-apis/docx/v1/documents/${a.document_id}`);
    if (res.code !== 0) throw new Error(`获取文档失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_document_content', '获取文档纯文本内容', {
    document_id: str('文档ID'),
  }, ['document_id'], async (a) => {
    const res = await api(`/open-apis/docx/v1/documents/${a.document_id}/raw_content`);
    if (res.code !== 0) throw new Error(`获取文档内容失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('update_feishu_document_title', '更新文档标题', {
    document_id: str('文档ID'),
    title: str('新标题'),
  }, ['document_id', 'title'], async (a) => {
    const res = await api(`/open-apis/docx/v1/documents/${a.document_id}/title`, {
      method: 'PATCH',
      body: { title: a.title },
    });
    if (res.code !== 0) throw new Error(`更新文档标题失败 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  t('search_feishu_documents', '搜索飞书文档', {
    query: str('搜索关键词'),
    page_size: str('返回数量，最大50（可选）'),
    page_token: str('分页token（可选）'),
  }, ['query'], async (a) => {
    const query = new URLSearchParams({ query: a.query });
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/wiki/v2/search?${query}`);
    if (res.code !== 0) throw new Error(`搜索文档失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 云盘 (Drive) ====================
  t('get_feishu_root_folder', '获取飞书云盘根文件夹信息', {}, [], async () => {
    const res = await api('/open-apis/drive/explorer/v2/root_folder/meta');
    if (res.code !== 0) throw new Error(`获取根文件夹失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_folder', '浏览飞书文件夹内容', {
    folderToken: str('文件夹token'),
    page_size: str('分页大小（可选）'),
    page_token: str('分页token（可选）'),
  }, ['folderToken'], async (a) => {
    const query = new URLSearchParams({ folder_token: a.folderToken });
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/drive/v1/files?${query}`);
    if (res.code !== 0) throw new Error(`浏览文件夹失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('create_feishu_folder', '在飞书云盘中创建新文件夹', {
    name: str('文件夹名称'),
    folderToken: str('父文件夹token（可选，不传则根目录）'),
  }, ['name'], async (a) => {
    let folderToken = a.folderToken;
    if (!folderToken) {
      const rootRes = await api('/open-apis/drive/explorer/v2/root_folder/meta');
      if (rootRes.code !== 0) throw new Error(`获取根文件夹失败: ${rootRes.msg}`);
      folderToken = rootRes.data.token;
    }
    const res = await api('/open-apis/drive/v1/files/create_folder', {
      method: 'POST',
      body: { name: a.name, folder_token: folderToken },
    });
    if (res.code !== 0) throw new Error(`创建文件夹失败 (${res.code}): ${res.msg}`);
    await grantAccess(res.data.token, 'folder');
    return res.data;
  }),

  t('get_feishu_file_metadata', '获取文件/文件夹元信息', {
    file_token: str('文件或文件夹token'),
  }, ['file_token'], async (a) => {
    const res = await api(`/open-apis/drive/v1/files/${a.file_token}`);
    if (res.code !== 0) throw new Error(`获取文件信息失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('delete_feishu_file', '删除文件或文件夹', {
    file_token: str('文件或文件夹token'),
    type: strEnum('文件类型', ['file', 'docx', 'sheet', 'bitable', 'folder']),
  }, ['file_token', 'type'], async (a) => {
    const res = await api(`/open-apis/drive/v1/files/${a.file_token}?type=${a.type}`, { method: 'DELETE' });
    if (res.code !== 0) throw new Error(`删除文件失败 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  // ==================== 通讯录 (Contact) ====================
  t('search_feishu_user', '通过手机号或邮箱查找飞书用户', {
    mobile: str('手机号（与 email 二选一）'),
    email: str('邮箱（与 mobile 二选一）'),
  }, [], async (a) => {
    const payload = {};
    if (a.mobile) payload.mobiles = [a.mobile];
    if (a.email) payload.emails = [a.email];
    const res = await api('/open-apis/contact/v3/users/batch_get_id', { method: 'POST', body: payload });
    if (res.code !== 0) throw new Error(`查找用户失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_user', '获取用户详细信息', {
    user_id: str('用户ID（open_id）'),
  }, ['user_id'], async (a) => {
    const res = await api(`/open-apis/contact/v3/users/${a.user_id}`);
    if (res.code !== 0) throw new Error(`获取用户信息失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_users', '获取部门用户列表', {
    department_id: str('部门ID（可选，不传则查根部门）'),
    page_size: str('分页大小（可选）'),
    page_token: str('分页token（可选）'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.department_id) query.set('department_id', a.department_id);
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/contact/v3/users?${query}`);
    if (res.code !== 0) throw new Error(`获取用户列表失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_departments', '获取部门列表', {
    page_size: str('分页大小（可选）'),
    page_token: str('分页token（可选）'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/contact/v3/departments?${query}`);
    if (res.code !== 0) throw new Error(`获取部门列表失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 日历 (Calendar) ====================
  t('create_feishu_event', '创建日历事件', {
    calendar_id: str('日历ID'),
    summary: str('事件标题'),
    description: str('事件描述（可选）'),
    start_time: str('开始时间，格式: "2024-01-01T10:00:00+08:00"'),
    end_time: str('结束时间，格式: "2024-01-01T11:00:00+08:00"'),
    need_notification: str('是否发送通知 true/false（可选，默认false）'),
  }, ['calendar_id', 'summary', 'start_time', 'end_time'], async (a) => {
    const body = {
      summary: a.summary,
      start: { date: null, timestamp: null, timezone: 'Asia/Shanghai', ...(a.start_time ? { datetime: a.start_time } : {}) },
      end: { date: null, timestamp: null, timezone: 'Asia/Shanghai', ...(a.end_time ? { datetime: a.end_time } : {}) },
    };
    if (a.description) body.description = a.description;
    const query = a.need_notification === 'true' ? '?need_notification=true' : '';
    const res = await api(`/open-apis/calendar/v4/calendars/${a.calendar_id}/events${query}`, { method: 'POST', body });
    if (res.code !== 0) throw new Error(`创建事件失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_events', '获取日历事件列表', {
    calendar_id: str('日历ID'),
    page_size: str('分页大小，最大50（可选）'),
    page_token: str('分页token（可选）'),
    start_time: str('开始时间戳(秒)（可选）'),
    end_time: str('结束时间戳(秒)（可选）'),
  }, ['calendar_id'], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    if (a.start_time) query.set('start_time', a.start_time);
    if (a.end_time) query.set('end_time', a.end_time);
    query.set('anchor_time', Math.floor(Date.now() / 1000).toString());
    const res = await api(`/open-apis/calendar/v4/calendars/${a.calendar_id}/events?${query}`);
    if (res.code !== 0) throw new Error(`获取事件列表失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_event', '获取日历事件详情', {
    calendar_id: str('日历ID'),
    event_id: str('事件ID'),
  }, ['calendar_id', 'event_id'], async (a) => {
    const res = await api(`/open-apis/calendar/v4/calendars/${a.calendar_id}/events/${a.event_id}`);
    if (res.code !== 0) throw new Error(`获取事件失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('delete_feishu_event', '删除日历事件', {
    calendar_id: str('日历ID'),
    event_id: str('事件ID'),
  }, ['calendar_id', 'event_id'], async (a) => {
    const res = await api(`/open-apis/calendar/v4/calendars/${a.calendar_id}/events/${a.event_id}`, { method: 'DELETE' });
    if (res.code !== 0) throw new Error(`删除事件失败 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  t('get_feishu_calendars', '获取日历列表', {
    page_size: str('分页大小（可选）'),
    page_token: str('分页token（可选）'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/calendar/v4/calendars?${query}`);
    if (res.code !== 0) throw new Error(`获取日历列表失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 多维表格 (Bitable) ====================
  t('create_bitable_record', '创建多维表格记录', {
    app_token: str('多维表格 App Token'),
    table_id: str('数据表 ID'),
    fields: str('记录字段，JSON对象字符串，如: {"字段名":"值"}'),
  }, ['app_token', 'table_id', 'fields'], async (a) => {
    const res = await api(`/open-apis/bitable/v1/apps/${a.app_token}/tables/${a.table_id}/records`, {
      method: 'POST',
      body: { fields: typeof a.fields === 'string' ? JSON.parse(a.fields) : a.fields },
    });
    if (res.code !== 0) throw new Error(`创建记录失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_bitable_records', '列出多维表格记录', {
    app_token: str('多维表格 App Token'),
    table_id: str('数据表 ID'),
    page_size: str('分页大小，最大500（可选）'),
    page_token: str('分页token（可选）'),
    field_names: str('要返回的字段，逗号分隔（可选）'),
  }, ['app_token', 'table_id'], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    if (a.field_names) query.set('field_names', a.field_names);
    const res = await api(`/open-apis/bitable/v1/apps/${a.app_token}/tables/${a.table_id}/records?${query}`);
    if (res.code !== 0) throw new Error(`列出记录失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('update_bitable_record', '更新多维表格记录', {
    app_token: str('多维表格 App Token'),
    table_id: str('数据表 ID'),
    record_id: str('记录 ID'),
    fields: str('更新的字段，JSON对象字符串'),
  }, ['app_token', 'table_id', 'record_id', 'fields'], async (a) => {
    const res = await api(`/open-apis/bitable/v1/apps/${a.app_token}/tables/${a.table_id}/records/${a.record_id}`, {
      method: 'PUT',
      body: { fields: typeof a.fields === 'string' ? JSON.parse(a.fields) : a.fields },
    });
    if (res.code !== 0) throw new Error(`更新记录失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('delete_bitable_record', '删除多维表格记录', {
    app_token: str('多维表格 App Token'),
    table_id: str('数据表 ID'),
    record_id: str('记录 ID'),
  }, ['app_token', 'table_id', 'record_id'], async (a) => {
    const res = await api(`/open-apis/bitable/v1/apps/${a.app_token}/tables/${a.table_id}/records/${a.record_id}`, { method: 'DELETE' });
    if (res.code !== 0) throw new Error(`删除记录失败 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  t('list_bitable_tables', '列出多维表格所有数据表', {
    app_token: str('多维表格 App Token'),
    page_size: str('分页大小（可选）'),
    page_token: str('分页token（可选）'),
  }, ['app_token'], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/bitable/v1/apps/${a.app_token}/tables?${query}`);
    if (res.code !== 0) throw new Error(`列出数据表失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 任务 (Task) ====================
  t('create_feishu_task', '创建任务', {
    summary: str('任务标题'),
    description: str('任务描述（可选）'),
    due_at: str('截止时间戳(毫秒)（可选）'),
    collaborators: str('协作者 open_id，逗号分隔（可选）'),
  }, ['summary'], async (a) => {
    const body = { summary: a.summary };
    if (a.description) body.description = a.description;
    if (a.due_at) body.due = { timestamp: a.due_at };
    if (a.collaborators) body.collaborators = a.collaborators.split(',').map(s => ({ id: s.trim(), id_type: 'open_id' }));
    const res = await api('/open-apis/task/v2/tasks', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`创建任务失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_tasks', '获取任务列表', {
    page_size: str('分页大小（可选）'),
    page_token: str('分页token（可选）'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/task/v2/tasks?${query}`);
    if (res.code !== 0) throw new Error(`获取任务列表失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_task', '获取任务详情', {
    task_id: str('任务ID'),
  }, ['task_id'], async (a) => {
    const res = await api(`/open-apis/task/v2/tasks/${a.task_id}`);
    if (res.code !== 0) throw new Error(`获取任务失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('update_feishu_task', '更新任务', {
    task_id: str('任务ID'),
    summary: str('新标题（可选）'),
    description: str('新描述（可选）'),
    completed: str('是否完成 true/false（可选）'),
  }, ['task_id'], async (a) => {
    const body = {};
    if (a.summary) body.summary = a.summary;
    if (a.description) body.description = a.description;
    if (a.completed) body.completed_at = a.completed === 'true' ? Date.now().toString() : null;
    const res = await api(`/open-apis/task/v2/tasks/${a.task_id}`, { method: 'PATCH', body });
    if (res.code !== 0) throw new Error(`更新任务失败 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  t('delete_feishu_task', '删除任务', {
    task_id: str('任务ID'),
  }, ['task_id'], async (a) => {
    const res = await api(`/open-apis/task/v2/tasks/${a.task_id}`, { method: 'DELETE' });
    if (res.code !== 0) throw new Error(`删除任务失败 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  // ==================== 电子表格 (Sheets) ====================
  t('create_feishu_spreadsheet', '创建电子表格', {
    title: str('表格标题'),
    folderToken: str('目标文件夹token（可选）'),
  }, ['title'], async (a) => {
    const body = { title: a.title };
    if (a.folderToken) body.folder_token = a.folderToken;
    const res = await api('/open-apis/sheets/v3/spreadsheets', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`创建电子表格失败 (${res.code}): ${res.msg}`);
    await grantAccess(res.data.spreadsheet.spreadsheet_token, 'sheet');
    return res.data;
  }),

  t('get_feishu_sheet_values', '读取电子表格单元格', {
    spreadsheet_token: str('电子表格 Token'),
    range: str('读取范围，如: 0b0c12!A1:C10'),
  }, ['spreadsheet_token', 'range'], async (a) => {
    const res = await api(`/open-apis/sheets/v2/spreadsheets/${a.spreadsheet_token}/values/${a.range}`);
    if (res.code !== 0) throw new Error(`读取单元格失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('update_feishu_sheet_values', '写入电子表格单元格', {
    spreadsheet_token: str('电子表格 Token'),
    range: str('写入范围，如: 0b0c12!A1:C10'),
    values: str('数据，二维数组 JSON 字符串，如: [["标题1","标题2"],["值1","值2"]]'),
  }, ['spreadsheet_token', 'range', 'values'], async (a) => {
    const res = await api(`/open-apis/sheets/v2/spreadsheets/${a.spreadsheet_token}/values`, {
      method: 'PUT',
      body: { value_range: { range: a.range, values: JSON.parse(a.values) } },
    });
    if (res.code !== 0) throw new Error(`写入单元格失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 知识库 (Wiki) ====================
  t('list_feishu_wiki_spaces', '获取知识库空间列表', {
    page_size: str('分页大小（可选）'),
    page_token: str('分页token（可选）'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/wiki/v2/spaces?${query}`);
    if (res.code !== 0) throw new Error(`获取知识库列表失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_wiki_node', '获取知识库节点信息', {
    token: str('节点token或文档token'),
    obj_type: strEnum('对象类型', ['doc', 'docx', 'sheet', 'bitable', 'wiki']),
  }, ['token'], async (a) => {
    const query = new URLSearchParams({ token: a.token });
    if (a.obj_type) query.set('obj_type', a.obj_type);
    const res = await api(`/open-apis/wiki/v2/spaces/get_node?${query}`);
    if (res.code !== 0) throw new Error(`获取节点信息失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_wiki_nodes', '获取知识库节点下子节点列表', {
    space_id: str('知识库空间ID'),
    page_token: str('父节点token（可选，不传则根节点）'),
    page_size: str('分页大小（可选）'),
  }, ['space_id'], async (a) => {
    const query = new URLSearchParams({ space_id: a.space_id });
    if (a.page_token) query.set('page_token', a.page_token);
    if (a.page_size) query.set('page_size', a.page_size);
    const res = await api(`/open-apis/wiki/v2/spaces/${a.space_id}/nodes?${query}`);
    if (res.code !== 0) throw new Error(`获取子节点列表失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 视频会议 (VC) ====================
  t('create_feishu_meeting', '创建视频会议', {
    topic: str('会议主题（可选）'),
    start_time: str('开始时间戳(秒)（可选）'),
    duration: str('会议时长(秒)，默认3600（可选）'),
    password: str('会议密码（可选）'),
  }, [], async (a) => {
    const body = {};
    if (a.topic) body.topic = a.topic;
    if (a.start_time) body.start_time = a.start_time;
    if (a.duration) body.duration = parseInt(a.duration);
    if (a.password) body.password = a.password;
    const res = await api('/open-apis/vc/v1/meetings', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`创建会议失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_meeting', '获取会议详情', {
    meeting_id: str('会议ID'),
  }, ['meeting_id'], async (a) => {
    const res = await api(`/open-apis/vc/v1/meetings/${a.meeting_id}`);
    if (res.code !== 0) throw new Error(`获取会议失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_meeting_recordings', '获取会议录制列表', {
    meeting_id: str('会议ID'),
  }, ['meeting_id'], async (a) => {
    const res = await api(`/open-apis/vc/v1/meetings/${a.meeting_id}/recording`);
    if (res.code !== 0) throw new Error(`获取录制失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 审批 (Approval) ====================
  t('create_feishu_approval_instance', '创建审批实例', {
    approval_code: str('审批定义编码'),
    form: str('表单数据 JSON 字符串'),
    user_id: str('发起人用户ID'),
  }, ['approval_code', 'form', 'user_id'], async (a) => {
    const res = await api('/open-apis/approval/v4/instances', {
      method: 'POST',
      body: {
        approval_code: a.approval_code,
        form: typeof a.form === 'string' ? JSON.parse(a.form) : a.form,
        user_id: a.user_id,
      },
    });
    if (res.code !== 0) throw new Error(`创建审批实例失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 翻译 (Translation) ====================
  t('translate_feishu_text', '翻译文本', {
    text: str('要翻译的文本'),
    source_language: str('源语言代码，如: zh, en（可选，自动检测）'),
    target_language: str('目标语言代码，如: en, ja'),
  }, ['text', 'target_language'], async (a) => {
    const body = { text: a.text, target_language: a.target_language };
    if (a.source_language) body.source_language = a.source_language;
    const res = await api('/open-apis/translation/v1/translate', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`翻译失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 妙记 (Minutes) ====================
  t('get_feishu_minutes', '获取妙记(会议纪要)信息', {
    minutes_token: str('妙记 Token'),
  }, ['minutes_token'], async (a) => {
    const res = await api(`/open-apis/minutes/v1/minutes/${a.minutes_token}`);
    if (res.code !== 0) throw new Error(`获取妙记失败 (${res.code}): ${res.msg}`);
    return res.data;
  }),
];

const toolMap = Object.fromEntries(tools.map(t => [t.name, t]));

let buffer = '';
let pending = 0;
let stdinEnded = false;

function sendJson(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function decPending() {
  if (--pending <= 0 && stdinEnded) process.exit(0);
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    sendJson({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'framex-feishu', version: '2.0.3' },
    }});
    return;
  }

  if (method === 'notifications/initialized') return;
  if (method === 'ping') { sendJson({ jsonrpc: '2.0', id, result: {} }); return; }

  if (method === 'tools/list') {
    sendJson({ jsonrpc: '2.0', id, result: { tools: tools.map(({ handler, ...rest }) => rest) } });
    return;
  }

  if (method === 'tools/call') {
    pending++;
    const { name, arguments: a } = params;
    try {
      const tool = toolMap[name];
      if (!tool) { sendJson({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` } }); return; }
      const result = await tool.handler(a || {});
      sendJson({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
    } catch (err) {
      sendJson({ jsonrpc: '2.0', id, error: { code: -1, message: err.message } });
    } finally { decPending(); }
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
    try { handleMessage(JSON.parse(line)).catch(e => { if (DEBUG) process.stderr.write(`[Error] ${e.message}\n`); }); } catch (err) { if (DEBUG) process.stderr.write(`[ParseError] ${err.message}\n`); }
  }
});

process.stdin.on('end', () => {
  stdinEnded = true;
  if (pending <= 0) process.exit(0);
});

