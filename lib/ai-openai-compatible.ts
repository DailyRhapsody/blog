type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * 调用 OpenAI 兼容的 Chat Completions（/v1/chat/completions）。
 * 通过 OPENAI_BASE_URL 可对接自建代理或非 OpenAI 供应商。
 */
export async function chatCompletionText(
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("未配置 OPENAI_API_KEY");
  }
  const baseRaw = process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  const base = baseRaw.replace(/\/$/, "");
  const model = process.env.AI_MODEL?.trim() || "gpt-4o-mini";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: opts?.maxTokens ?? 2048,
      temperature: opts?.temperature ?? 0.65,
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      detail = errJson?.error?.message ?? "";
    } catch {
      detail = (await res.text()).slice(0, 240);
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("模型返回为空");
  return text;
}
