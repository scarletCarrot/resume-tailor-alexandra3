import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_TIMEOUT_MS = 180_000;

/** Strip OpenRouter routing suffixes so we don't double-append. */
function stripRoutingSuffix(model: string) {
  return model.replace(/:(nitro|floor)$/i, "");
}

export function getLlmModelBase() {
  return stripRoutingSuffix(process.env.OPENROUTER_MODEL || DEFAULT_MODEL);
}

/**
 * Same base model with OpenRouter :nitro routing (fastest throughput provider).
 * Disable via OPENROUTER_NITRO=false.
 */
export function getLlmModel() {
  const base = getLlmModelBase();
  const useNitro = process.env.OPENROUTER_NITRO !== "false";
  return useNitro ? `${base}:nitro` : base;
}

/** Per-request OpenRouter timeout (default 180s per call; same model for resume + cover letter). */
export function getLlmTimeoutMs() {
  const raw = process.env.OPENROUTER_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function getLlmClient() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to your .env.local file.",
    );
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer":
        process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_APP_NAME || "Resume Tailor",
    },
  });
}

export function isAbortError(err: unknown) {
  return (
    err instanceof Error &&
    (err.name === "AbortError" ||
      err.message.includes("aborted") ||
      err.message.includes("timeout"))
  );
}

type OpenRouterCompletionBody = ChatCompletionCreateParamsNonStreaming & {
  provider?: { sort: "throughput" | "latency" | "price" };
};

/** OpenRouter chat completion with :nitro / throughput routing. */
export async function createOpenRouterCompletion(
  client: OpenAI,
  params: {
    messages: ChatCompletionMessageParam[];
    temperature?: number;
    response_format?: ChatCompletionCreateParamsNonStreaming["response_format"];
    model?: string;
  },
  options?: { signal?: AbortSignal },
) {
  const body: OpenRouterCompletionBody = {
    model: params.model ?? getLlmModel(),
    messages: params.messages,
    temperature: params.temperature,
    response_format: params.response_format,
    provider: { sort: "throughput" },
  };

  return client.chat.completions.create(body, options);
}
