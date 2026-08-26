import OpenAI from "openai";

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_TIMEOUT_MS = 180_000;

export function getLlmModel() {
  return process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
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
