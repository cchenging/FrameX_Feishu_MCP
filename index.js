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
    process.stdout.write(`FrameX Feishu MCP v2.1.0

Usage:
  framex-feishu [options]         鍚姩 MCP 鏈嶅姟
  framex-feishu --help            鏄剧ず甯姪

Options:
  --app-id <id>                   椋炰功 App ID (env: FEISHU_APP_ID)
  --app-secret <secret>           椋炰功 App Secret (env: FEISHU_APP_SECRET)
  --user-id <open_id>             鐢ㄦ埛 open_id锛岃嚜鍔ㄦ巿鏉冪敤 (env: FEISHU_USER_ID)
  --domain <url>                  椋炰功鍩熷悕锛岄粯璁?https://open.feishu.cn (env: FEISHU_URL)
  --debug                         鍚敤璋冭瘯鏃ュ織 (env: FEISHU_DEBUG)

宸ュ叿绫诲埆: message, document, drive, contact, calendar, bitable, task, sheets, wiki, vc
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
    throw new Error(`Token鑾峰彇澶辫触: ${res.msg || JSON.stringify(res)}`);
  }
  cachedToken = res.tenant_access_token;
  tokenExpiresAt = Date.now() + (res.expire - 60) * 1000;
  return cachedToken;
}

async function api(path, opts = {}) {
  const token = await getToken();
  return apiFetch(path, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
}

async function grantAccess(token, fileType) {
  if (!FEISHU_USER_ID) return;
  const validTypes = ['doc', 'sheet', 'file', 'wiki', 'bitable', 'docx', 'mindnote', 'minutes', 'slides'];
  const type = validTypes.includes(fileType) ? fileType : null;
  if (!type) {
    process.stderr.write(`[鎻愮ず] ${fileType} 涓嶆敮鎸佹潈闄愭搷浣滐紝璺宠繃鎺堟潈\n`);
    return;
  }
  try {
    const res = await api(`/open-apis/drive/v1/permissions/${token}/members/transfer_owner?type=${type}&need_notification=false`, {
      method: 'POST',
      body: { member_type: 'openid', member_id: FEISHU_USER_ID },
    });
    if (res.code !== 0) {
      process.stderr.write(`[鎺堟潈澶辫触] ${token} (${res.code}): ${res.msg}\n`);
    }
  } catch (e) {
    process.stderr.write(`[鎺堟潈寮傚父] ${token}: ${e.message}\n`);
  }
}

function t(name, description, props, required, handler) {
  return { name, description, inputSchema: { type: 'object', properties: props, required }, handler };
}

function str(desc) { return { type: 'string', description: desc }; }
function strEnum(desc, items) { return { type: 'string', description: desc, enum: items }; }
function timestamp() {
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0');
}
const CLIENT = process.env.TERM_PROGRAM || 'unknown';
const OS_NAME = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
const BOT_SIGNATURE = `\n\n— 来自 framex-feishu MCP 智能助手\n  客户端：${CLIENT} ｜ 系统：${OS_NAME} ｜`;

const tools = [
  // ==================== 娑堟伅 (IM) ====================
  t('send_feishu_message', '鍙戦€佹枃鏈秷鎭埌椋炰功', {
    receive_id: str('鎺ユ敹鑰匢D锛宱pen_id(涓汉)鎴朿hat_id(缇よ亰)'),
    text: str('娑堟伅鍐呭'),
    receive_id_type: strEnum('ID绫诲瀷', ['open_id', 'chat_id', 'user_id']),
    '娣诲姞鏃堕棿': str('鏄惁鑷姩娣诲姞鏃堕棿鎴筹紝鍙€?true/false锛岄粯璁alse'),
    '娣诲姞绛惧悕': str('鏄惁鑷姩娣诲姞鏉ユ簮绛惧悕锛堝鎴风銆佺郴缁熴佸伐鍏峰悕锛?锛屽彲閫?true/false锛岄粯璁alse'),
  }, ['receive_id', 'text'], async (a) => {
    let text = a.text;
    if (a['娣诲姞鏃堕棿'] === 'true') text = '[' + timestamp() + ']\n' + text;
    if (a['娣诲姞绛惧悕'] === 'true') text = text + BOT_SIGNATURE + timestamp();
    const res = await api('/open-apis/im/v1/messages?' + new URLSearchParams({ receive_id_type: a.receive_id_type || 'open_id' }), {
      method: 'POST',
      body: { receive_id: a.receive_id, msg_type: 'text', content: JSON.stringify({ text }) },
    });
    if (res.code !== 0) throw new Error(`鍙戦€佹秷鎭け璐?(${res.code}): ${res.msg}`);
    return { 娑堟伅ID: res.data.message_id, 鍙戦€佹椂闂? timestamp() };
  }),

  t('send_feishu_card_message', '鍙戦€佸崱鐗囨秷鎭埌椋炰功', {
    receive_id: str('鎺ユ敹鑰匢D'),
    card: str('鍗＄墖鍐呭 JSON 瀛楃涓?),
    receive_id_type: strEnum('ID绫诲瀷', ['open_id', 'chat_id', 'user_id']),
    '娣诲姞鏃堕棿': str('鏄惁鑷姩娣诲姞鏃堕棿鎴筹紝鍙€?true/false锛岄粯璁alse'),
  }, ['receive_id', 'card'], async (a) => {
    let cardContent = typeof a.card === 'string' ? a.card : JSON.stringify(a.card);
    if (a['娣诲姞鏃堕棿'] === 'true') {
      const cardObj = typeof a.card === 'string' ? JSON.parse(a.card) : a.card;
      if (cardObj.header) cardObj.header.title = '[' + timestamp() + '] ' + (cardObj.header.title || '');
      cardContent = JSON.stringify(cardObj);
    }
    const res = await api('/open-apis/im/v1/messages?' + new URLSearchParams({ receive_id_type: a.receive_id_type || 'open_id' }), {
      method: 'POST',
      body: { receive_id: a.receive_id, msg_type: 'interactive', content: cardContent },
    });
    if (res.code !== 0) throw new Error(`鍙戦€佸崱鐗囨秷鎭け璐?(${res.code}): ${res.msg}`);
    return { 娑堟伅ID: res.data.message_id, 鍙戦€佹椂闂? timestamp() };
  }),

  t('send_feishu_rich_text', '鍙戦€佸瘜鏂囨湰(Post)娑堟伅鍒伴涔?, {
    receive_id: str('鎺ユ敹鑰匢D'),
    content: str('瀵屾枃鏈唴瀹?JSON 瀛楃涓诧紝鏍煎紡鍙傝€冮涔?Post 娑堟伅'),
    receive_id_type: strEnum('ID绫诲瀷', ['open_id', 'chat_id', 'user_id']),
  }, ['receive_id', 'content'], async (a) => {
    const res = await api('/open-apis/im/v1/messages?' + new URLSearchParams({ receive_id_type: a.receive_id_type || 'open_id' }), {
      method: 'POST',
      body: { receive_id: a.receive_id, msg_type: 'post', content: typeof a.content === 'string' ? a.content : JSON.stringify(a.content) },
    });
    if (res.code !== 0) throw new Error(`鍙戦€佸瘜鏂囨湰娑堟伅澶辫触 (${res.code}): ${res.msg}`);
    return { 娑堟伅ID: res.data.message_id, 鍙戦€佹椂闂? timestamp() };
  }),

  t('get_feishu_message', '鑾峰彇娑堟伅璇︽儏', {
    message_id: str('娑堟伅ID'),
  }, ['message_id'], async (a) => {
    const res = await api(`/open-apis/im/v1/messages/${a.message_id}`);
    if (res.code !== 0) throw new Error(`鑾峰彇娑堟伅澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_messages', '鑾峰彇鑱婂ぉ璁板綍鍒楄〃', {
    container_id_type: strEnum('瀹瑰櫒绫诲瀷', ['chat', 'email']),
    container_id: str('瀹瑰櫒ID锛岀兢ID鎴栭偖绠?),
    page_size: str('鍒嗛〉澶у皬锛屾渶澶?0锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
    sort_type: strEnum('鎺掑簭', ['ByCreateTimeAsc', 'ByCreateTimeDesc']),
  }, ['container_id_type', 'container_id'], async (a) => {
    const query = new URLSearchParams({ container_id_type: a.container_id_type, container_id: a.container_id });
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    if (a.sort_type) query.set('sort_type', a.sort_type);
    const res = await api(`/open-apis/im/v1/messages?${query}`);
    if (res.code !== 0) throw new Error(`鑾峰彇娑堟伅鍒楄〃澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('reply_feishu_message', '鍥炲娑堟伅', {
    message_id: str('瑕佸洖澶嶇殑娑堟伅ID'),
    text: str('鍥炲鍐呭'),
  }, ['message_id', 'text'], async (a) => {
    const res = await api(`/open-apis/im/v1/messages/${a.message_id}/reply`, {
      method: 'POST',
      body: { msg_type: 'text', content: JSON.stringify({ text: a.text }) },
    });
    if (res.code !== 0) throw new Error(`鍥炲娑堟伅澶辫触 (${res.code}): ${res.msg}`);
    return { message_id: res.data.message_id };
  }),

  t('delete_feishu_message', '鎾ゅ洖娑堟伅', {
    message_id: str('瑕佹挙鍥炵殑娑堟伅ID'),
  }, ['message_id'], async (a) => {
    const res = await api(`/open-apis/im/v1/messages/${a.message_id}`, { method: 'DELETE' });
    if (res.code !== 0) throw new Error(`鎾ゅ洖娑堟伅澶辫触 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  // ==================== 缇よ亰 (Chat) ====================
  t('create_feishu_chat', '鍒涘缓缇よ亰', {
    name: str('缇ゅ悕绉?),
    description: str('缇ゆ弿杩帮紙鍙€夛級'),
    open_ids: str('鍒涘缓鑰?open_id锛堝彲閫夛級'),
  }, ['name'], async (a) => {
    const body = { name: a.name };
    if (a.description) body.description = a.description;
    if (a.open_ids) body.owner_id = a.open_ids;
    const res = await api('/open-apis/im/v1/chats', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`鍒涘缓缇よ亰澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_chat', '鑾峰彇缇よ亰淇℃伅', {
    chat_id: str('缇よ亰ID'),
  }, ['chat_id'], async (a) => {
    const res = await api(`/open-apis/im/v1/chats/${a.chat_id}`);
    if (res.code !== 0) throw new Error(`鑾峰彇缇よ亰澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_chats', '鑾峰彇缇よ亰鍒楄〃', {
    page_size: str('鍒嗛〉澶у皬锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/im/v1/chats?${query}`);
    if (res.code !== 0) throw new Error(`鑾峰彇缇よ亰鍒楄〃澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('update_feishu_chat', '鏇存柊缇よ亰淇℃伅', {
    chat_id: str('缇よ亰ID'),
    name: str('鏂扮兢鍚嶇О锛堝彲閫夛級'),
    description: str('鏂扮兢鎻忚堪锛堝彲閫夛級'),
  }, ['chat_id'], async (a) => {
    const body = {};
    if (a.name) body.name = a.name;
    if (a.description) body.description = a.description;
    const res = await api(`/open-apis/im/v1/chats/${a.chat_id}`, { method: 'PATCH', body });
    if (res.code !== 0) throw new Error(`鏇存柊缇よ亰澶辫触 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  t('add_chat_members', '娣诲姞缇ゆ垚鍛?, {
    chat_id: str('缇よ亰ID'),
    open_ids: str('瑕佹坊鍔犵殑鎴愬憳 open_id锛屽涓敤閫楀彿鍒嗛殧'),
  }, ['chat_id', 'open_ids'], async (a) => {
    const res = await api(`/open-apis/im/v1/chats/${a.chat_id}/members`, {
      method: 'POST',
      body: { id_list: a.open_ids.split(',').map(s => s.trim()) },
    });
    if (res.code !== 0) throw new Error(`娣诲姞缇ゆ垚鍛樺け璐?(${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('remove_chat_members', '绉婚櫎缇ゆ垚鍛?, {
    chat_id: str('缇よ亰ID'),
    open_ids: str('瑕佺Щ闄ょ殑鎴愬憳 open_id锛屽涓敤閫楀彿鍒嗛殧'),
  }, ['chat_id', 'open_ids'], async (a) => {
    const res = await api(`/open-apis/im/v1/chats/${a.chat_id}/members`, {
      method: 'DELETE',
      body: { id_list: a.open_ids.split(',').map(s => s.trim()) },
    });
    if (res.code !== 0) throw new Error(`绉婚櫎缇ゆ垚鍛樺け璐?(${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_chat_members', '鑾峰彇缇ゆ垚鍛樺垪琛?, {
    chat_id: str('缇よ亰ID'),
    page_size: str('鍒嗛〉澶у皬锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
  }, ['chat_id'], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/im/v1/chats/${a.chat_id}/members?${query}`);
    if (res.code !== 0) throw new Error(`鑾峰彇缇ゆ垚鍛樺け璐?(${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 鏂囨。 (Document) ====================
  t('create_feishu_document', '鍒涘缓椋炰功鏂囨。', {
    title: str('鏂囨。鏍囬'),
    folderToken: str('鐩爣鏂囦欢澶箃oken锛堝彲閫夛紝涓嶄紶鍒欐牴鐩綍锛?),
  }, ['title'], async (a) => {
    const body = { title: a.title };
    if (a.folderToken) body.folder_token = a.folderToken;
    const res = await api('/open-apis/docx/v1/documents', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`鍒涘缓鏂囨。澶辫触 (${res.code}): ${res.msg}`);
    const doc = res.data.document;
    await grantAccess(doc.document_id, 'docx');
    const result = {
      鏂囨。ID: doc.document_id,
      鏍囬: doc.title,
      鍒涘缓鏃堕棿: timestamp(),
      閾炬帴: `https://ecnaqezi6ak9.feishu.cn/docx/${doc.document_id}`,
      鎵€鍦ㄦ枃浠跺す: a.folderToken ? `https://ecnaqezi6ak9.feishu.cn/drive/folder/${a.folderToken}` : '鏍圭洰褰?,
    };
    return result;
  }),

  t('get_feishu_document', '鑾峰彇鏂囨。淇℃伅', {
    document_id: str('鏂囨。ID'),
  }, ['document_id'], async (a) => {
    const res = await api(`/open-apis/docx/v1/documents/${a.document_id}`);
    if (res.code !== 0) throw new Error(`鑾峰彇鏂囨。澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_document_content', '鑾峰彇鏂囨。绾枃鏈唴瀹?, {
    document_id: str('鏂囨。ID'),
  }, ['document_id'], async (a) => {
    const res = await api(`/open-apis/docx/v1/documents/${a.document_id}/raw_content`);
    if (res.code !== 0) throw new Error(`鑾峰彇鏂囨。鍐呭澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('update_feishu_document_title', '鏇存柊鏂囨。鏍囬', {
    document_id: str('鏂囨。ID'),
    title: str('鏂版爣棰?),
  }, ['document_id', 'title'], async (a) => {
    const res = await api(`/open-apis/docx/v1/documents/${a.document_id}/title`, {
      method: 'PATCH',
      body: { title: a.title },
    });
    if (res.code !== 0) throw new Error(`鏇存柊鏂囨。鏍囬澶辫触 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  t('search_feishu_documents', '鎼滅储椋炰功鏂囨。', {
    query: str('鎼滅储鍏抽敭璇?),
    page_size: str('杩斿洖鏁伴噺锛屾渶澶?0锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
  }, ['query'], async (a) => {
    const query = new URLSearchParams({ query: a.query });
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/wiki/v2/search?${query}`);
    if (res.code !== 0) throw new Error(`鎼滅储鏂囨。澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 浜戠洏 (Drive) ====================
  t('get_feishu_root_folder', '鑾峰彇椋炰功浜戠洏鏍规枃浠跺す淇℃伅', {}, [], async () => {
    const res = await api('/open-apis/drive/explorer/v2/root_folder/meta');
    if (res.code !== 0) throw new Error(`鑾峰彇鏍规枃浠跺す澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_folder', '娴忚椋炰功鏂囦欢澶瑰唴瀹?, {
    folderToken: str('鏂囦欢澶箃oken'),
    page_size: str('鍒嗛〉澶у皬锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
  }, ['folderToken'], async (a) => {
    const query = new URLSearchParams({ folder_token: a.folderToken });
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/drive/v1/files?${query}`);
    if (res.code !== 0) throw new Error(`娴忚鏂囦欢澶瑰け璐?(${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('create_feishu_folder', '鍦ㄩ涔︿簯鐩樹腑鍒涘缓鏂版枃浠跺す', {
    name: str('鏂囦欢澶瑰悕绉?),
    folderToken: str('鐖舵枃浠跺すtoken锛堝彲閫夛紝涓嶄紶鍒欐牴鐩綍锛?),
  }, ['name'], async (a) => {
    let folderToken = a.folderToken;
    if (!folderToken) {
      const rootRes = await api('/open-apis/drive/explorer/v2/root_folder/meta');
      if (rootRes.code !== 0) throw new Error(`鑾峰彇鏍规枃浠跺す澶辫触: ${rootRes.msg}`);
      folderToken = rootRes.data.token;
    }
    const res = await api('/open-apis/drive/v1/files/create_folder', {
      method: 'POST',
      body: { name: a.name, folder_token: folderToken },
    });
    if (res.code !== 0) throw new Error(`鍒涘缓鏂囦欢澶瑰け璐?(${res.code}): ${res.msg}`);
    return {
      鏂囦欢澶筎oken: res.data.token,
      鍚嶇О: a.name,
      鍒涘缓鏃堕棿: timestamp(),
      閾炬帴: res.data.url,
      鎵€鍦ㄤ綅缃? folderToken === 'nodcnR7ORVbNUE0cESM0KybzXDL' ? '鏍圭洰褰? : `https://ecnaqezi6ak9.feishu.cn/drive/folder/${folderToken}`,
    };
  }),

  t('get_feishu_file_metadata', '鑾峰彇鏂囦欢/鏂囦欢澶瑰厓淇℃伅', {
    file_token: str('鏂囦欢鎴栨枃浠跺すtoken'),
  }, ['file_token'], async (a) => {
    const res = await api(`/open-apis/drive/v1/files/${a.file_token}`);
    if (res.code !== 0) throw new Error(`鑾峰彇鏂囦欢淇℃伅澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('delete_feishu_file', '鍒犻櫎鏂囦欢鎴栨枃浠跺す', {
    file_token: str('鏂囦欢鎴栨枃浠跺すtoken'),
    type: strEnum('鏂囦欢绫诲瀷', ['file', 'docx', 'sheet', 'bitable', 'folder']),
  }, ['file_token', 'type'], async (a) => {
    const res = await api(`/open-apis/drive/v1/files/${a.file_token}?type=${a.type}`, { method: 'DELETE' });
    if (res.code !== 0) throw new Error(`鍒犻櫎鏂囦欢澶辫触 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  // ==================== 閫氳褰?(Contact) ====================
  t('search_feishu_user', '閫氳繃鎵嬫満鍙锋垨閭鏌ユ壘椋炰功鐢ㄦ埛', {
    mobile: str('鎵嬫満鍙凤紙涓?email 浜岄€変竴锛?),
    email: str('閭锛堜笌 mobile 浜岄€変竴锛?),
  }, [], async (a) => {
    const payload = {};
    if (a.mobile) payload.mobiles = [a.mobile];
    if (a.email) payload.emails = [a.email];
    const res = await api('/open-apis/contact/v3/users/batch_get_id', { method: 'POST', body: payload });
    if (res.code !== 0) throw new Error(`鏌ユ壘鐢ㄦ埛澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_user', '鑾峰彇鐢ㄦ埛璇︾粏淇℃伅', {
    user_id: str('鐢ㄦ埛ID锛坥pen_id锛?),
  }, ['user_id'], async (a) => {
    const res = await api(`/open-apis/contact/v3/users/${a.user_id}`);
    if (res.code !== 0) throw new Error(`鑾峰彇鐢ㄦ埛淇℃伅澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_users', '鑾峰彇閮ㄩ棬鐢ㄦ埛鍒楄〃', {
    department_id: str('閮ㄩ棬ID锛堝彲閫夛紝涓嶄紶鍒欐煡鏍归儴闂級'),
    page_size: str('鍒嗛〉澶у皬锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.department_id) query.set('department_id', a.department_id);
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/contact/v3/users?${query}`);
    if (res.code !== 0) throw new Error(`鑾峰彇鐢ㄦ埛鍒楄〃澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_departments', '鑾峰彇閮ㄩ棬鍒楄〃', {
    page_size: str('鍒嗛〉澶у皬锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/contact/v3/departments?${query}`);
    if (res.code !== 0) throw new Error(`鑾峰彇閮ㄩ棬鍒楄〃澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 鏃ュ巻 (Calendar) ====================
  t('create_feishu_event', '鍒涘缓鏃ュ巻浜嬩欢', {
    calendar_id: str('鏃ュ巻ID'),
    summary: str('浜嬩欢鏍囬'),
    description: str('浜嬩欢鎻忚堪锛堝彲閫夛級'),
    start_time: str('寮€濮嬫椂闂达紝鏍煎紡: "2024-01-01T10:00:00+08:00"'),
    end_time: str('缁撴潫鏃堕棿锛屾牸寮? "2024-01-01T11:00:00+08:00"'),
    need_notification: str('鏄惁鍙戦€侀€氱煡 true/false锛堝彲閫夛紝榛樿false锛?),
  }, ['calendar_id', 'summary', 'start_time', 'end_time'], async (a) => {
    const body = {
      summary: a.summary,
      start: { date: null, timestamp: null, timezone: 'Asia/Shanghai', ...(a.start_time ? { datetime: a.start_time } : {}) },
      end: { date: null, timestamp: null, timezone: 'Asia/Shanghai', ...(a.end_time ? { datetime: a.end_time } : {}) },
    };
    if (a.description) body.description = a.description;
    const query = a.need_notification === 'true' ? '?need_notification=true' : '';
    const res = await api(`/open-apis/calendar/v4/calendars/${a.calendar_id}/events${query}`, { method: 'POST', body });
    if (res.code !== 0) throw new Error(`鍒涘缓浜嬩欢澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_events', '鑾峰彇鏃ュ巻浜嬩欢鍒楄〃', {
    calendar_id: str('鏃ュ巻ID'),
    page_size: str('鍒嗛〉澶у皬锛屾渶澶?0锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
    start_time: str('寮€濮嬫椂闂存埑(绉?锛堝彲閫夛級'),
    end_time: str('缁撴潫鏃堕棿鎴?绉?锛堝彲閫夛級'),
  }, ['calendar_id'], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    if (a.start_time) query.set('start_time', a.start_time);
    if (a.end_time) query.set('end_time', a.end_time);
    query.set('anchor_time', Math.floor(Date.now() / 1000).toString());
    const res = await api(`/open-apis/calendar/v4/calendars/${a.calendar_id}/events?${query}`);
    if (res.code !== 0) throw new Error(`鑾峰彇浜嬩欢鍒楄〃澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_event', '鑾峰彇鏃ュ巻浜嬩欢璇︽儏', {
    calendar_id: str('鏃ュ巻ID'),
    event_id: str('浜嬩欢ID'),
  }, ['calendar_id', 'event_id'], async (a) => {
    const res = await api(`/open-apis/calendar/v4/calendars/${a.calendar_id}/events/${a.event_id}`);
    if (res.code !== 0) throw new Error(`鑾峰彇浜嬩欢澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('delete_feishu_event', '鍒犻櫎鏃ュ巻浜嬩欢', {
    calendar_id: str('鏃ュ巻ID'),
    event_id: str('浜嬩欢ID'),
  }, ['calendar_id', 'event_id'], async (a) => {
    const res = await api(`/open-apis/calendar/v4/calendars/${a.calendar_id}/events/${a.event_id}`, { method: 'DELETE' });
    if (res.code !== 0) throw new Error(`鍒犻櫎浜嬩欢澶辫触 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  t('get_feishu_calendars', '鑾峰彇鏃ュ巻鍒楄〃', {
    page_size: str('鍒嗛〉澶у皬锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/calendar/v4/calendars?${query}`);
    if (res.code !== 0) throw new Error(`鑾峰彇鏃ュ巻鍒楄〃澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 澶氱淮琛ㄦ牸 (Bitable) ====================
  t('create_bitable_record', '鍒涘缓澶氱淮琛ㄦ牸璁板綍', {
    app_token: str('澶氱淮琛ㄦ牸 App Token'),
    table_id: str('鏁版嵁琛?ID'),
    fields: str('璁板綍瀛楁锛孞SON瀵硅薄瀛楃涓诧紝濡? {"瀛楁鍚?:"鍊?}'),
  }, ['app_token', 'table_id', 'fields'], async (a) => {
    const res = await api(`/open-apis/bitable/v1/apps/${a.app_token}/tables/${a.table_id}/records`, {
      method: 'POST',
      body: { fields: typeof a.fields === 'string' ? JSON.parse(a.fields) : a.fields },
    });
    if (res.code !== 0) throw new Error(`鍒涘缓璁板綍澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_bitable_records', '鍒楀嚭澶氱淮琛ㄦ牸璁板綍', {
    app_token: str('澶氱淮琛ㄦ牸 App Token'),
    table_id: str('鏁版嵁琛?ID'),
    page_size: str('鍒嗛〉澶у皬锛屾渶澶?00锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
    field_names: str('瑕佽繑鍥炵殑瀛楁锛岄€楀彿鍒嗛殧锛堝彲閫夛級'),
  }, ['app_token', 'table_id'], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    if (a.field_names) query.set('field_names', a.field_names);
    const res = await api(`/open-apis/bitable/v1/apps/${a.app_token}/tables/${a.table_id}/records?${query}`);
    if (res.code !== 0) throw new Error(`鍒楀嚭璁板綍澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('update_bitable_record', '鏇存柊澶氱淮琛ㄦ牸璁板綍', {
    app_token: str('澶氱淮琛ㄦ牸 App Token'),
    table_id: str('鏁版嵁琛?ID'),
    record_id: str('璁板綍 ID'),
    fields: str('鏇存柊鐨勫瓧娈碉紝JSON瀵硅薄瀛楃涓?),
  }, ['app_token', 'table_id', 'record_id', 'fields'], async (a) => {
    const res = await api(`/open-apis/bitable/v1/apps/${a.app_token}/tables/${a.table_id}/records/${a.record_id}`, {
      method: 'PUT',
      body: { fields: typeof a.fields === 'string' ? JSON.parse(a.fields) : a.fields },
    });
    if (res.code !== 0) throw new Error(`鏇存柊璁板綍澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('delete_bitable_record', '鍒犻櫎澶氱淮琛ㄦ牸璁板綍', {
    app_token: str('澶氱淮琛ㄦ牸 App Token'),
    table_id: str('鏁版嵁琛?ID'),
    record_id: str('璁板綍 ID'),
  }, ['app_token', 'table_id', 'record_id'], async (a) => {
    const res = await api(`/open-apis/bitable/v1/apps/${a.app_token}/tables/${a.table_id}/records/${a.record_id}`, { method: 'DELETE' });
    if (res.code !== 0) throw new Error(`鍒犻櫎璁板綍澶辫触 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  t('list_bitable_tables', '鍒楀嚭澶氱淮琛ㄦ牸鎵€鏈夋暟鎹〃', {
    app_token: str('澶氱淮琛ㄦ牸 App Token'),
    page_size: str('鍒嗛〉澶у皬锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
  }, ['app_token'], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/bitable/v1/apps/${a.app_token}/tables?${query}`);
    if (res.code !== 0) throw new Error(`鍒楀嚭鏁版嵁琛ㄥけ璐?(${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 浠诲姟 (Task) ====================
  t('create_feishu_task', '鍒涘缓浠诲姟', {
    summary: str('浠诲姟鏍囬'),
    description: str('浠诲姟鎻忚堪锛堝彲閫夛級'),
    due_at: str('鎴鏃堕棿鎴?姣)锛堝彲閫夛級'),
    collaborators: str('鍗忎綔鑰?open_id锛岄€楀彿鍒嗛殧锛堝彲閫夛級'),
  }, ['summary'], async (a) => {
    const body = { summary: a.summary };
    if (a.description) body.description = a.description;
    if (a.due_at) body.due = { timestamp: a.due_at };
    if (a.collaborators) body.collaborators = a.collaborators.split(',').map(s => ({ id: s.trim(), id_type: 'open_id' }));
    const res = await api('/open-apis/task/v2/tasks', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`鍒涘缓浠诲姟澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_tasks', '鑾峰彇浠诲姟鍒楄〃', {
    page_size: str('鍒嗛〉澶у皬锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/task/v2/tasks?${query}`);
    if (res.code !== 0) throw new Error(`鑾峰彇浠诲姟鍒楄〃澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_task', '鑾峰彇浠诲姟璇︽儏', {
    task_id: str('浠诲姟ID'),
  }, ['task_id'], async (a) => {
    const res = await api(`/open-apis/task/v2/tasks/${a.task_id}`);
    if (res.code !== 0) throw new Error(`鑾峰彇浠诲姟澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('update_feishu_task', '鏇存柊浠诲姟', {
    task_id: str('浠诲姟ID'),
    summary: str('鏂版爣棰橈紙鍙€夛級'),
    description: str('鏂版弿杩帮紙鍙€夛級'),
    completed: str('鏄惁瀹屾垚 true/false锛堝彲閫夛級'),
  }, ['task_id'], async (a) => {
    const body = {};
    if (a.summary) body.summary = a.summary;
    if (a.description) body.description = a.description;
    if (a.completed) body.completed_at = a.completed === 'true' ? Date.now().toString() : null;
    const res = await api(`/open-apis/task/v2/tasks/${a.task_id}`, { method: 'PATCH', body });
    if (res.code !== 0) throw new Error(`鏇存柊浠诲姟澶辫触 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  t('delete_feishu_task', '鍒犻櫎浠诲姟', {
    task_id: str('浠诲姟ID'),
  }, ['task_id'], async (a) => {
    const res = await api(`/open-apis/task/v2/tasks/${a.task_id}`, { method: 'DELETE' });
    if (res.code !== 0) throw new Error(`鍒犻櫎浠诲姟澶辫触 (${res.code}): ${res.msg}`);
    return { success: true };
  }),

  // ==================== 鐢靛瓙琛ㄦ牸 (Sheets) ====================
  t('create_feishu_spreadsheet', '鍒涘缓鐢靛瓙琛ㄦ牸', {
    title: str('琛ㄦ牸鏍囬'),
    folderToken: str('鐩爣鏂囦欢澶箃oken锛堝彲閫夛級'),
  }, ['title'], async (a) => {
    const body = { title: a.title };
    if (a.folderToken) body.folder_token = a.folderToken;
    const res = await api('/open-apis/sheets/v3/spreadsheets', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`鍒涘缓鐢靛瓙琛ㄦ牸澶辫触 (${res.code}): ${res.msg}`);
    await grantAccess(res.data.spreadsheet.spreadsheet_token, 'sheet');
    return res.data;
  }),

  t('get_feishu_sheet_values', '璇诲彇鐢靛瓙琛ㄦ牸鍗曞厓鏍?, {
    spreadsheet_token: str('鐢靛瓙琛ㄦ牸 Token'),
    range: str('璇诲彇鑼冨洿锛屽: 0b0c12!A1:C10'),
  }, ['spreadsheet_token', 'range'], async (a) => {
    const res = await api(`/open-apis/sheets/v2/spreadsheets/${a.spreadsheet_token}/values/${a.range}`);
    if (res.code !== 0) throw new Error(`璇诲彇鍗曞厓鏍煎け璐?(${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('update_feishu_sheet_values', '鍐欏叆鐢靛瓙琛ㄦ牸鍗曞厓鏍?, {
    spreadsheet_token: str('鐢靛瓙琛ㄦ牸 Token'),
    range: str('鍐欏叆鑼冨洿锛屽: 0b0c12!A1:C10'),
    values: str('鏁版嵁锛屼簩缁存暟缁?JSON 瀛楃涓诧紝濡? [["鏍囬1","鏍囬2"],["鍊?","鍊?"]]'),
  }, ['spreadsheet_token', 'range', 'values'], async (a) => {
    const res = await api(`/open-apis/sheets/v2/spreadsheets/${a.spreadsheet_token}/values`, {
      method: 'PUT',
      body: { value_range: { range: a.range, values: JSON.parse(a.values) } },
    });
    if (res.code !== 0) throw new Error(`鍐欏叆鍗曞厓鏍煎け璐?(${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 鐭ヨ瘑搴?(Wiki) ====================
  t('list_feishu_wiki_spaces', '鑾峰彇鐭ヨ瘑搴撶┖闂村垪琛?, {
    page_size: str('鍒嗛〉澶у皬锛堝彲閫夛級'),
    page_token: str('鍒嗛〉token锛堝彲閫夛級'),
  }, [], async (a) => {
    const query = new URLSearchParams();
    if (a.page_size) query.set('page_size', a.page_size);
    if (a.page_token) query.set('page_token', a.page_token);
    const res = await api(`/open-apis/wiki/v2/spaces?${query}`);
    if (res.code !== 0) throw new Error(`鑾峰彇鐭ヨ瘑搴撳垪琛ㄥけ璐?(${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_wiki_node', '鑾峰彇鐭ヨ瘑搴撹妭鐐逛俊鎭?, {
    token: str('鑺傜偣token鎴栨枃妗oken'),
    obj_type: strEnum('瀵硅薄绫诲瀷', ['doc', 'docx', 'sheet', 'bitable', 'wiki']),
  }, ['token'], async (a) => {
    const query = new URLSearchParams({ token: a.token });
    if (a.obj_type) query.set('obj_type', a.obj_type);
    const res = await api(`/open-apis/wiki/v2/spaces/get_node?${query}`);
    if (res.code !== 0) throw new Error(`鑾峰彇鑺傜偣淇℃伅澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_wiki_nodes', '鑾峰彇鐭ヨ瘑搴撹妭鐐逛笅瀛愯妭鐐瑰垪琛?, {
    space_id: str('鐭ヨ瘑搴撶┖闂碔D'),
    page_token: str('鐖惰妭鐐箃oken锛堝彲閫夛紝涓嶄紶鍒欐牴鑺傜偣锛?),
    page_size: str('鍒嗛〉澶у皬锛堝彲閫夛級'),
  }, ['space_id'], async (a) => {
    const query = new URLSearchParams({ space_id: a.space_id });
    if (a.page_token) query.set('page_token', a.page_token);
    if (a.page_size) query.set('page_size', a.page_size);
    const res = await api(`/open-apis/wiki/v2/spaces/${a.space_id}/nodes?${query}`);
    if (res.code !== 0) throw new Error(`鑾峰彇瀛愯妭鐐瑰垪琛ㄥけ璐?(${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 瑙嗛浼氳 (VC) ====================
  t('create_feishu_meeting', '鍒涘缓瑙嗛浼氳', {
    topic: str('浼氳涓婚锛堝彲閫夛級'),
    start_time: str('寮€濮嬫椂闂存埑(绉?锛堝彲閫夛級'),
    duration: str('浼氳鏃堕暱(绉?锛岄粯璁?600锛堝彲閫夛級'),
    password: str('浼氳瀵嗙爜锛堝彲閫夛級'),
  }, [], async (a) => {
    const body = {};
    if (a.topic) body.topic = a.topic;
    if (a.start_time) body.start_time = a.start_time;
    if (a.duration) body.duration = parseInt(a.duration);
    if (a.password) body.password = a.password;
    const res = await api('/open-apis/vc/v1/meetings', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`鍒涘缓浼氳澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('get_feishu_meeting', '鑾峰彇浼氳璇︽儏', {
    meeting_id: str('浼氳ID'),
  }, ['meeting_id'], async (a) => {
    const res = await api(`/open-apis/vc/v1/meetings/${a.meeting_id}`);
    if (res.code !== 0) throw new Error(`鑾峰彇浼氳澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  t('list_feishu_meeting_recordings', '鑾峰彇浼氳褰曞埗鍒楄〃', {
    meeting_id: str('浼氳ID'),
  }, ['meeting_id'], async (a) => {
    const res = await api(`/open-apis/vc/v1/meetings/${a.meeting_id}/recording`);
    if (res.code !== 0) throw new Error(`鑾峰彇褰曞埗澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 瀹℃壒 (Approval) ====================
  t('create_feishu_approval_instance', '鍒涘缓瀹℃壒瀹炰緥', {
    approval_code: str('瀹℃壒瀹氫箟缂栫爜'),
    form: str('琛ㄥ崟鏁版嵁 JSON 瀛楃涓?),
    user_id: str('鍙戣捣浜虹敤鎴稩D'),
  }, ['approval_code', 'form', 'user_id'], async (a) => {
    const res = await api('/open-apis/approval/v4/instances', {
      method: 'POST',
      body: {
        approval_code: a.approval_code,
        form: typeof a.form === 'string' ? JSON.parse(a.form) : a.form,
        user_id: a.user_id,
      },
    });
    if (res.code !== 0) throw new Error(`鍒涘缓瀹℃壒瀹炰緥澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 缈昏瘧 (Translation) ====================
  t('translate_feishu_text', '缈昏瘧鏂囨湰', {
    text: str('瑕佺炕璇戠殑鏂囨湰'),
    source_language: str('婧愯瑷€浠ｇ爜锛屽: zh, en锛堝彲閫夛紝鑷姩妫€娴嬶級'),
    target_language: str('鐩爣璇█浠ｇ爜锛屽: en, ja'),
  }, ['text', 'target_language'], async (a) => {
    const body = { text: a.text, target_language: a.target_language };
    if (a.source_language) body.source_language = a.source_language;
    const res = await api('/open-apis/translation/v1/translate', { method: 'POST', body });
    if (res.code !== 0) throw new Error(`缈昏瘧澶辫触 (${res.code}): ${res.msg}`);
    return res.data;
  }),

  // ==================== 濡欒 (Minutes) ====================
  t('get_feishu_minutes', '鑾峰彇濡欒(浼氳绾)淇℃伅', {
    minutes_token: str('濡欒 Token'),
  }, ['minutes_token'], async (a) => {
    const res = await api(`/open-apis/minutes/v1/minutes/${a.minutes_token}`);
    if (res.code !== 0) throw new Error(`鑾峰彇濡欒澶辫触 (${res.code}): ${res.msg}`);
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
      serverInfo: { name: 'framex-feishu', version: '2.1.0' },
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

