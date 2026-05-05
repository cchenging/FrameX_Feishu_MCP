# FrameX Feishu MCP

> **FrameX Feishu** — 零依赖的飞书 MCP 服务，50+ 工具覆盖 14 个功能类别。  
> 在 Trae / Cursor / Claude 等 AI 工具中，直接调用飞书 API。

---

## 功能一览

### 💬 消息与群聊
| 工具 | 说明 |
|---|---|
| `send_feishu_message` | 发送文本消息（个人或群聊） |
| `send_feishu_card_message` | 发送卡片消息 |
| `send_feishu_rich_text` | 发送富文本(Post)消息 |
| `get_feishu_message` | 获取消息详情 |
| `list_feishu_messages` | 获取聊天记录列表 |
| `reply_feishu_message` | 回复消息 |
| `delete_feishu_message` | 撤回消息 |
| `create_feishu_chat` | 创建群聊 |
| `get_feishu_chat` | 获取群聊信息 |
| `list_feishu_chats` | 获取群聊列表 |
| `update_feishu_chat` | 更新群聊信息 |
| `add_chat_members` | 添加群成员 |
| `remove_chat_members` | 移除群成员 |
| `get_chat_members` | 获取群成员列表 |

### 📝 文档与云盘
| 工具 | 说明 |
|---|---|
| `create_feishu_document` | 创建文档（可指定文件夹） |
| `get_feishu_document` | 获取文档信息 |
| `get_feishu_document_content` | 获取文档纯文本内容 |
| `update_feishu_document_title` | 更新文档标题 |
| `search_feishu_documents` | 搜索飞书文档 |
| `get_feishu_root_folder` | 获取云盘根文件夹 |
| `list_feishu_folder` | 浏览文件夹内容 |
| `create_feishu_folder` | 创建新文件夹 |
| `get_feishu_file_metadata` | 获取文件/文件夹元信息 |
| `delete_feishu_file` | 删除文件或文件夹 |

### 👤 通讯录
| 工具 | 说明 |
|---|---|
| `search_feishu_user` | 通过手机号/邮箱查找用户 |
| `get_feishu_user` | 获取用户详细信息 |
| `list_feishu_users` | 获取部门用户列表 |
| `list_feishu_departments` | 获取部门列表 |

### 📅 日历
| 工具 | 说明 |
|---|---|
| `create_feishu_event` | 创建日历事件 |
| `list_feishu_events` | 获取日历事件列表 |
| `get_feishu_event` | 获取事件详情 |
| `delete_feishu_event` | 删除日历事件 |
| `get_feishu_calendars` | 获取日历列表 |

### 📊 多维表格
| 工具 | 说明 |
|---|---|
| `create_bitable_record` | 创建多维表格记录 |
| `list_bitable_records` | 列出多维表格记录 |
| `update_bitable_record` | 更新多维表格记录 |
| `delete_bitable_record` | 删除多维表格记录 |
| `list_bitable_tables` | 列出所有数据表 |

### ✅ 任务
| 工具 | 说明 |
|---|---|
| `create_feishu_task` | 创建任务 |
| `list_feishu_tasks` | 获取任务列表 |
| `get_feishu_task` | 获取任务详情 |
| `update_feishu_task` | 更新任务 |
| `delete_feishu_task` | 删除任务 |

### 📈 更多工具
| 类别 | 工具 |
|---|---|
| 电子表格 | `create_feishu_spreadsheet`、`get_feishu_sheet_values`、`update_feishu_sheet_values` |
| 知识库 | `list_feishu_wiki_spaces`、`get_feishu_wiki_node`、`list_feishu_wiki_nodes` |
| 视频会议 | `create_feishu_meeting`、`get_feishu_meeting`、`list_feishu_meeting_recordings` |
| 审批 | `create_feishu_approval_instance` |
| 翻译 | `translate_feishu_text` |
| 妙记 | `get_feishu_minutes` |

---

## 快速开始

### 1. 创建飞书应用

[飞书开放平台](https://open.feishu.cn/app) → 创建企业自建应用 → **权限管理**开通：

```
im:message, docs:doc, docx:document, drive:drive, contact:user,
calendar:calendar, bitable:app, task:task, sheets:sheet,
wiki:wiki, vc:vc, approval:approval, translation:translate, minutes:minutes
```

→ **版本管理与发布** → 发布应用

### 2. MCP 配置

在 Trae / Cursor 项目中创建 `.trae/settings.json`：

```json
{
  "mcpServers": {
    "framex-feishu": {
      "command": "npx",
      "args": [
        "-y",
        "framex-feishu@latest",
        "--app-id",
        "cli_你的AppID",
        "--app-secret",
        "你的AppSecret",
        "--user-id",
        "你的open_id（可选，用于自动授权）"
      ]
    }
  }
}
```

### 3. 重启使用

重启 IDE，即可在对话中调用所有飞书工具。

---

## 自动授权

指定 `--user-id` 参数后，创建文档、文件夹、电子表格时会自动为你授权 `full_access`（完全访问权限），可直接编辑和删除，且不会触发飞书转移通知。

---

## 技术特性

- **零依赖** — 纯 Node.js 内置模块，无需安装任何第三方包
- **自动刷新 Token** — 内置 tenant_access_token 自动缓存与刷新
- **MCP 标准协议** — 完全兼容 Model Context Protocol
- **实用优先** — 一切为 AI 对话场景设计，参数简洁直观

## License

MIT © FrameX
