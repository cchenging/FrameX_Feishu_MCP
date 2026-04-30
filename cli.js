import https from 'node:https';

const APP_ID = 'cli_a9785953fcb9dbda';
const APP_SECRET = '4YJeCMjhuNCjSmOkXVoMZcgUzac6JpAq';
const MY_OPEN_ID = 'ou_046036eda8a0d15902a8cc184942aa60';

let _token = null, _expires = 0;

async function token() {
  if (Date.now() < _expires) return _token;
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', body: { app_id: APP_ID, app_secret: APP_SECRET }
  });
  _token = r.tenant_access_token;
  _expires = Date.now() + (r.expire - 60) * 1000;
  return _token;
}

async function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
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

async function api(path, opts = {}) {
  const t = await token();
  return fetch(`https://open.feishu.cn${path}`, {
    ...opts, headers: { Authorization: `Bearer ${t}`, ...opts.headers }
  });
}

async function sendMsg(text) {
  const r = await api('/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    body: { receive_id: MY_OPEN_ID, msg_type: 'text', content: JSON.stringify({ text }) }
  });
  return r;
}

async function createDoc(title, folderToken) {
  const body = { title };
  if (folderToken) body.folder_token = folderToken;
  const r = await api('/open-apis/docx/v1/documents', { method: 'POST', body });
  return r;
}

async function rootFolder() {
  return api('/open-apis/drive/explorer/v2/root_folder/meta');
}

async function listFolder(folderToken) {
  return api(`/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=50&order_by=EditedTime&direction=DESC`);
}

const cmd = process.argv[2];
const args = process.argv.slice(3);

switch (cmd) {
  case 'root': {
    const r = await rootFolder();
    console.log(JSON.stringify(r.data || r, null, 2));
    break;
  }
  case 'ls': {
    const r = await listFolder(args[0]);
    console.log(JSON.stringify(r.data || r, null, 2));
    break;
  }
  case 'doc': {
    const [title, folderToken] = args;
    const r = await createDoc(title, folderToken);
    if (r.code === 0) {
      const { document_id, title: t } = r.data.document;
      console.log(`✅ 文档已创建`);
      console.log(`标题: ${t}`);
      console.log(`链接: https://ecnaqezi6ak9.feishu.cn/docx/${document_id}`);
      if (folderToken) console.log(`文件夹: ${folderToken}`);
    } else {
      console.log(`❌ 创建失败: ${r.msg} (code=${r.code})`);
    }
    break;
  }
  case 'msg': {
    const text = args.join(' ');
    const r = await sendMsg(text);
    if (r.code === 0) console.log('✅ 消息已发送');
    else console.log(`❌ 发送失败: ${r.msg} (code=${r.code})`);
    break;
  }
  default:
    console.log('用法: node cli.js <命令> [参数]');
    console.log('  root              - 查根文件夹');
    console.log('  ls <folderToken>  - 查看文件夹内容');
    console.log('  doc <标题> [文件夹] - 创建文档');
    console.log('  msg <文本>         - 发消息给你');
}
