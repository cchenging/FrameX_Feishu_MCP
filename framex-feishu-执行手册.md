# FrameX Feishu — 发布与部署执行手册

> 以下步骤请由 AI 助手按顺序执行。

---

## 项目信息速查

| 项目 | 值 |
|---|---|
| 项目路径 | `F:\Tools\FrameX Feishu\` |
| npm 包名 | `framex-feishu` |
| 飞书 App ID | `cli_a9785953fcb9dbda` |
| 飞书 App Secret | `4YJeCMjhuNCjSmOkXVoMZcgUzac6JpAq` |
| 用户 open_id | `ou_046036eda8a0d15902a8cc184942aa60` |
| 用户手机 | `17710966546` |
| GitHub 仓库 | 待创建，建议 `framex/framex-feishu` |

---

## 任务一：检查并修正项目文件

### 1.1 检查文件完整性

确认 `F:\Tools\FrameX Feishu\` 目录包含以下文件：

```
F:\Tools\FrameX Feishu\
├── index.js          (主程序，约 200 行)
├── package.json      (包配置)
├── cli.js            (CLI 脚本，可选)
├── README.md         (文档)
└── .gitignore        (git 忽略规则)
```

### 1.2 修正 package.json

读取 `F:\Tools\FrameX Feishu\package.json`，如果 `name` 字段不是 `framex-feishu`，则写入正确内容：

```json
{
  "name": "framex-feishu",
  "version": "1.0.0",
  "description": "FrameX Feishu MCP - 飞书 MCP 服务。发消息、创建文档(支持指定文件夹)、浏览文件夹、查找用户，零依赖",
  "type": "module",
  "main": "index.js",
  "bin": {
    "framex-feishu": "index.js"
  },
  "keywords": ["feishu", "lark", "mcp", "framex", "飞书", "model-context-protocol"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/framex/framex-feishu.git"
  },
  "engines": { "node": ">=18" },
  "files": ["index.js"]
}
```

### 1.3 确认 index.js 正确

读取 `F:\Tools\FrameX Feishu\index.js`，确认：
- 第 1 行是 `#!/usr/bin/env node`
- App ID 和 App Secret 通过 `--app-id` / `--app-secret` 命令行参数或 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 环境变量读取（不是硬编码）
- 内置 6 个 MCP 工具：`send_feishu_message`、`create_feishu_document`、`get_feishu_root_folder`、`list_feishu_folder`、`search_feishu_user`、`create_feishu_folder`

---

## 任务二：初始化 Git 并推送 GitHub

### 2.1 初始化 git

```powershell
cd F:\Tools\FrameX Feishu
git init
git add .
git commit -m "feat: 初始化 FrameX Feishu MCP 服务"
```

### 2.2 创建 GitHub 仓库

让用户在浏览器中访问 https://github.com/new 创建仓库：
- **仓库名**: `framex-feishu`
- **所有者**: `framex`（或用户自己的账号）
- **公开/私有**: 公开
- **不要勾选** README、.gitignore、license（本地已有）

创建后拿到远程地址，例如 `https://github.com/framex/framex-feishu.git`

### 2.3 推送到 GitHub

```powershell
git remote add origin https://github.com/framex/framex-feishu.git
git branch -M main
git push -u origin main
```

如果用户没有配置 GitHub 认证，提示用户先用浏览器登录 GitHub，然后使用 Personal Access Token 或 GitHub CLI 进行认证。

---

## 任务三：发布到 npm

### 3.1 检查 npm 用户名是否已存在

```powershell
npm search framex-feishu
```

如果 `framex-feishu` 已被占用，需要改包名，建议改为 `framex-feishu-mcp`。

### 3.2 npm 登录

```powershell
npm login
```

按提示输入 npm 用户名、密码和邮箱。如果没有 npm 账号，让用户去 https://www.npmjs.com/signup 注册。

### 3.3 打包并发布

```powershell
cd F:\Tools\FrameX Feishu
npm pack            # 先打包测试，会生成 framex-feishu-1.0.0.tgz
npm publish         # 发布到 npm
```

### 3.4 验证发布

```powershell
npm view framex-feishu
```

应该能看到包的版本、描述等信息。

---

## 任务四：更新 Trae 配置

### 4.1 更新 settings.json

修改 `F:\Tools\MagicOne\.trae\settings.json` 为：

```json
{
  "mcpServers": {
    "lark-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@larksuiteoapi/lark-mcp",
        "mcp",
        "-a",
        "cli_a9785953fcb9dbda",
        "-s",
        "4YJeCMjhuNCjSmOkXVoMZcgUzac6JpAq"
      ]
    },
    "framex-feishu": {
      "command": "npx",
      "args": [
        "-y",
        "framex-feishu",
        "--app-id",
        "cli_a9785953fcb9dbda",
        "--app-secret",
        "4YJeCMjhuNCjSmOkXVoMZcgUzac6JpAq"
      ]
    }
  }
}
```

### 4.2 重启 Trae

让用户重启 Trae IDE，使 MCP 配置生效。

---

## 任务五：验证功能

### 5.1 调用第一个工具

在 Trae 对话中调用 `get_feishu_root_folder` 或 `send_feishu_message`，验证 MCP 服务是否正常加载。

### 5.2 完整流程测试

建议依次测试：
1. `get_feishu_root_folder` → 获取根文件夹 token
2. `list_feishu_folder` → 浏览根目录
3. `create_feishu_document` → 在根目录创建文档
4. `send_feishu_message` → 发消息通知用户

---

## 注意事项

1. **npm 包名冲突**：如果 `framex-feishu` 已被占用，改名为 `framex-feishu-mcp`
2. **GitHub 认证**：如果推送失败，提示用户配置 Personal Access Token
3. **飞书权限**：应用需要开通以下权限并发布版本：
   - `docs:doc` — 创建文档
   - `contact:user.id:readonly` — 查用户
   - `im:message:send_as_bot` — 发消息
   - `drive:drive` — 浏览文件夹、创建文件夹
   - `docx:document:create` — 创建新版文档
4. **settings.json**：Trae 只支持 `npx` 方式启动的 MCP 服务，不要用 `node` 直接启动本地文件
