# 后台编辑器 · AI 辅助

## 与 Cursor 会员的关系

**Cursor 订阅（Pro/Business 等）是 Cursor 应用内的额度，没有面向第三方网站的官方 HTTP API**，也无法在服务器上「自动读取你的 Cursor 账号」来替博客调模型。若要在自建站点（如本项目的后台 Markdown 编辑器）里使用 AI，需要自行提供 **OpenAI 兼容** 的接口与密钥。

## 配置方式

在 **Vercel 环境变量** 或本地 `.env.local` 中设置：

| 变量 | 必选 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | 是 | 供应商提供的 API Key |
| `OPENAI_BASE_URL` | 否 | 默认 `https://api.openai.com/v1`；兼容接口填供应商给出的 base（一般含 `/v1` 结尾，代码会自动处理 slash） |
| `AI_MODEL` | 否 | 默认 `gpt-4o-mini`；按供应商文档填写模型名 |

调用路径：`POST /v1/chat/completions`（标准 OpenAI 兼容）。

## 使用

1. 使用**管理员账号**登录后台并打开新建/编辑文章页。  
2. 可选：在正文中**选中一段**，否则 AI 产出会插入到**当前光标处**（或结合全文节选）。  
3. 点击 **AI**，输入指令（或点快捷建议），再点 **生成**。  

## 安全说明

- 仅 **已登录管理员** 可调用 `POST /api/ai/assist`。  
- Key 只保存在服务端环境变量，**不要**写进前端代码或提交到 Git。
