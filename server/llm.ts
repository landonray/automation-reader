const LLM_GATEWAY_URL = "https://llm-gateway.replit.app";
const LLM_GATEWAY_API_KEY = process.env.LLM_GATEWAY_API_KEY || "";
const DEFAULT_MODEL = "gemini-2.5-flash";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
  runId?: string;
}

interface ChatResponse {
  content: string;
  finish_reason: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  estimated_cost?: number;
}

export async function chatCompletion(options: ChatOptions): Promise<ChatResponse> {
  const response = await fetch(`${LLM_GATEWAY_URL}/api/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LLM_GATEWAY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || DEFAULT_MODEL,
      messages: options.messages,
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature ?? 0.3,
      run_id: options.runId,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM Gateway error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return {
    content: data.content || "",
    finish_reason: data.finish_reason || "stop",
    usage: data.usage,
    estimated_cost: data.estimated_cost,
  };
}

export async function askLLMJson<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number; model?: string; runId?: string },
): Promise<T> {
  const response = await chatCompletion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: options?.maxTokens || 4096,
    temperature: options?.temperature ?? 0.3,
    model: options?.model,
    runId: options?.runId,
  });

  const text = response.content.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("LLM response did not contain valid JSON");
  }
  return JSON.parse(jsonMatch[0]) as T;
}

if (!LLM_GATEWAY_API_KEY) {
  console.warn(
    "WARNING: LLM_GATEWAY_API_KEY is not set. All LLM calls (narrator, synthesizer) will fail. " +
    "Set this in your .env file before running automations."
  );
}
