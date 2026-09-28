import { readClaudeAuthCredentials } from "./claude-auth.js";
import { AiServiceFailure } from "./failure.js";
import type { ClaudeAiCompleteInput } from "./host-contract.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const OAUTH_BETA = "oauth-2025-04-20";
const ERROR_TEXT_MAX_BYTES = 4 * 1024;

async function readLimitedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const body = await response.text();
  return body.length > maxBytes ? body.slice(0, maxBytes) : body;
}

async function createHttpError(
  response: Response,
): Promise<AiServiceFailure> {
  const text = await readLimitedText(response, ERROR_TEXT_MAX_BYTES);
  if (response.status === 401) {
    return new AiServiceFailure(
      "auth_required",
      "claude_auth_expired",
      "Claude Code session expired. Run `claude` on this machine to sign in again.",
    );
  }
  if (response.status === 429) {
    return new AiServiceFailure(
      "rate_limited",
      "claude_rate_limited",
      "Claude is rate limited right now.",
    );
  }
  if (response.status >= 500) {
    return new AiServiceFailure(
      "service_unavailable",
      "claude_service_unavailable",
      "Claude's service is unavailable right now.",
    );
  }
  return new AiServiceFailure(
    "request_failed",
    "claude_request_failed",
    `Claude request failed with status ${response.status}: ${text}`,
  );
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessagesResponse {
  content?: AnthropicContentBlock[];
}

function extractText(payload: AnthropicMessagesResponse): string {
  const text = payload.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  if (!text) {
    throw new AiServiceFailure(
      "invalid_response",
      "claude_response_invalid",
      "Claude's response did not include any text.",
    );
  }
  return text;
}

export async function completeClaudeInference(
  command: ClaudeAiCompleteInput,
  signal: AbortSignal,
): Promise<string> {
  const auth = await readClaudeAuthCredentials();
  const timeoutSignal = AbortSignal.timeout(command.timeoutMs);
  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": OAUTH_BETA,
      "content-type": "application/json",
      "user-agent": "bb-host-daemon",
    },
    body: JSON.stringify({
      model: command.model,
      max_tokens: 1024,
      messages: [{ role: "user", content: command.prompt }],
    }),
    signal: AbortSignal.any([signal, timeoutSignal]),
  });

  if (!response.ok) {
    throw await createHttpError(response);
  }

  const payload = (await response.json()) as AnthropicMessagesResponse;
  return extractText(payload);
}
