import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { chatCompletionText } from "@/lib/ai-openai-compatible";
import { guardApiRequest, withAntiScrapeHeaders } from "@/lib/request-guard";
import { rejectCrossSiteWrite } from "@/lib/same-origin";

const MAX_DRAFT = 12_000;
const MAX_SELECTION = 8_000;
const MAX_INSTRUCTION = 2_000;

export async function POST(req: Request) {
  const cross = rejectCrossSiteWrite(req);
  if (cross) return cross;

  const blocked = await guardApiRequest(req, {
    scope: "ai:assist",
    limit: 30,
    windowMs: 60_000,
    blockSuspiciousUa: false,
  });
  if (blocked) return blocked;

  if (!(await isAdmin())) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "未授权" }, { status: 401 })
    );
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return withAntiScrapeHeaders(
      NextResponse.json(
        {
          error:
            "未配置大模型接口。Cursor 会员仅能在 Cursor 应用内使用，无法自动接入本站；请在环境变量中设置 OPENAI_API_KEY（及可选 OPENAI_BASE_URL / AI_MODEL），详见 docs/ai-assistant.md。",
        },
        { status: 503 }
      )
    );
  }

  let body: { instruction?: string; selection?: string; draft?: string };
  try {
    body = await req.json();
  } catch {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "请求体无效" }, { status: 400 })
    );
  }

  const instruction = (body.instruction ?? "").trim().slice(0, MAX_INSTRUCTION);
  if (!instruction) {
    return withAntiScrapeHeaders(
      NextResponse.json({ error: "请填写 AI 指令" }, { status: 400 })
    );
  }

  const selection = (body.selection ?? "").slice(0, MAX_SELECTION);
  const draft = (body.draft ?? "").slice(0, MAX_DRAFT);

  const system =
    "你是博客正文编辑助手，用户正在写 Markdown。只输出应插入编辑器的 Markdown 正文片段，不要解释、不要代码围栏、不要问候。保持与用户语气相近，适度使用标题、列表等 Markdown。";

  const userParts = [
    selection
      ? `【当前选中】\n${selection}`
      : "【当前选中】（无，光标位置插入或仅根据全文推断）",
    `【全文草稿（节选）】\n${draft || "（空）"}`,
    `【用户指令】\n${instruction}`,
  ].join("\n\n");

  try {
    const text = await chatCompletionText(
      [
        { role: "system", content: system },
        { role: "user", content: userParts },
      ],
      { maxTokens: 2048, temperature: 0.65 }
    );
    return withAntiScrapeHeaders(NextResponse.json({ text }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "生成失败";
    return withAntiScrapeHeaders(
      NextResponse.json({ error: message }, { status: 502 })
    );
  }
}
