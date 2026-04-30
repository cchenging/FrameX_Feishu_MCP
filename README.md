# FrameX Feishu MCP 🚀

> **FrameX Feishu** — 零依赖的飞书 MCP 服务。  
> 在 Trae / Cursor / Claude 等 AI 工具中，直接发消息、创建文档（支持指定文件夹）、浏览文件夹、查找用户。

---

## 功能一览

| 工具 | 说明 |
|---|---|
| `send_feishu_message` | 发送文本消息到飞书（个人或群聊） |
| `create_feishu_document` | 创建文档，可选 `folderToken` 指定文件夹 |
| `get_feishu_root_folder` | 获取云盘根文件夹信息 |
| `list_feishu_folder` | 浏览文件夹内容 |
| `search_feishu_user` | 通过手机号/邮箱查找用户 |
| `create_feishu_folder` | 创建新文件夹 |

---

## 快速开始

### 1. 创建飞书应用

[飞书开放平台](https://open.feishu.cn/app) → 创建企业自建应用 → **权限管理**开通：

```
docs:doc, contact:user.id:readonly, im:message:send_as_bot,
drive:drive, docx:document:create
```

→ **版本管理与发布** → 发布应用

### 2. MCP 配置

```json
{
  "mcpServers": {
    "framex-feishu": {
      "command": "npx",
      "args": ["-y", "framex-feishu", "--app-id", "cli_xxx", "--app-secret", "xxx"]
    }
  }
}
```

### 3. 重启使用

---

## CLI 模式

```bash
npx framex-feishu root              # 查根文件夹
npx framex-feishu ls <folderToken>  # 浏览文件夹
npx framex-feishu doc "标题" [token] # 创建文档
npx framex-feishu msg "内容"         # 发消息
npx framex-feishu user --mobile 手机号  # 查用户
```

---

## 技术特性

- ✅ **零依赖** — 纯 Node.js 内置模块
- ✅ **自动刷新 Token**
- ✅ **MCP 标准协议**

## License

MIT © FrameX
