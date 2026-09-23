export interface Env {
  DB: D1Database;
  AI_RATE_LIMITER: RateLimit;
  AI_DAILY_BUDGET_MICROS: string;
  AI_MODELS: string;
  AI_UPSTREAM_BASE_URL: string;
  OPENROUTER_API_KEY?: string;
}

export interface GatewayConfig {
  dailyBudgetMicros: number;
  models: string[];
  upstreamBaseUrl: string;
  apiKey: string | null;
}

function parseMicros(name: string, raw: string | undefined): number {
  const value = Number(raw?.trim());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function parseModels(raw: string | undefined): string[] {
  const models = (raw ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model !== "");
  if (models.length === 0) throw new Error("AI_MODELS must list a model");
  return models;
}

function parseBaseUrl(raw: string | undefined): string {
  const url = new URL(raw?.trim() ?? "");
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("AI_UPSTREAM_BASE_URL must be an HTTP(S) URL");
  }
  return url.toString().replace(/\/+$/u, "");
}

export function parseGatewayConfig(
  env: Omit<Env, "DB" | "AI_RATE_LIMITER">,
): GatewayConfig {
  const apiKey = env.OPENROUTER_API_KEY?.trim() ?? "";
  return {
    dailyBudgetMicros: parseMicros(
      "AI_DAILY_BUDGET_MICROS",
      env.AI_DAILY_BUDGET_MICROS,
    ),
    models: parseModels(env.AI_MODELS),
    upstreamBaseUrl: parseBaseUrl(env.AI_UPSTREAM_BASE_URL),
    apiKey: apiKey === "" ? null : apiKey,
  };
}
