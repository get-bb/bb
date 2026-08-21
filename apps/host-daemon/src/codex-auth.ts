import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCodexHome } from "@bb/config/codex-home";
import { jsonValueSchema, type JsonObject, type JsonValue } from "@bb/domain";
import { ExpectedCommandDispatchError } from "./command-dispatch-support.js";

const CODEX_AUTH_FILE_NAME = "auth.json";
const CHATGPT_AUTH_CLAIM_PATH = "https://api.openai.com/auth";

interface CodexAuthJson {
  authMode: string | null;
  openAiApiKey: string | null;
  tokens: JsonObject | null;
  accessToken: string | null;
}

interface ResolveCodexTokenArgs {
  accessToken: string;
  tokens: JsonObject;
}

export interface CodexChatGptAuthCredentials {
  type: "chatgpt";
  accessToken: string;
  accountId: string;
  accountEmail: string | null;
  isFedrampAccount: boolean;
}

export interface CodexOpenAiApiKeyCredentials {
  type: "apiKey";
  apiKey: string;
}

export type CodexAuthCredentials =
  | CodexChatGptAuthCredentials
  | CodexOpenAiApiKeyCredentials;

function codexAuthPath(): string {
  return path.join(resolveCodexHome(os.homedir()), CODEX_AUTH_FILE_NAME);
}

function toJsonObject(value: JsonValue): JsonObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function optionalString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalBoolean(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function parseJsonValue(raw: string): JsonValue {
  return jsonValueSchema.parse(JSON.parse(raw));
}

function parseCodexAuthFile(raw: string, authPath: string): JsonObject {
  try {
    const parsed = toJsonObject(parseJsonValue(raw));
    if (parsed) {
      return parsed;
    }
  } catch {
    // handled below
  }
  throw new ExpectedCommandDispatchError(
    "codex_auth_invalid",
    `Codex auth file at ${authPath} is not valid JSON. Run codex login on this host.`,
  );
}

function decodeJwtPayload(token: string): JsonObject | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }
  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf8");
    return toJsonObject(parseJsonValue(decoded));
  } catch {
    return null;
  }
}

function getChatGptAuthClaims(token: string): JsonObject | null {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return null;
  }
  const auth = payload[CHATGPT_AUTH_CLAIM_PATH];
  return auth ? toJsonObject(auth) : null;
}

function getAccountIdFromToken(token: string): string | null {
  const auth = getChatGptAuthClaims(token);
  return auth ? optionalString(auth.chatgpt_account_id) : null;
}

function getAccountEmailFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return null;
  }
  const profile = toJsonObject(payload["https://api.openai.com/profile"]);
  return optionalString(payload.email) ?? optionalString(profile?.email);
}

function isFedrampToken(token: string): boolean {
  const auth = getChatGptAuthClaims(token);
  return auth
    ? optionalBoolean(auth.chatgpt_account_is_fedramp) === true
    : false;
}

function getAccountIdFromIdToken(value: JsonValue | undefined): string | null {
  if (typeof value === "string") {
    return getAccountIdFromToken(value);
  }
  if (value === undefined) {
    return null;
  }
  const idToken = toJsonObject(value);
  if (!idToken) {
    return null;
  }
  return optionalString(idToken.chatgpt_account_id);
}

function isFedrampIdToken(value: JsonValue | undefined): boolean {
  if (typeof value === "string") {
    return isFedrampToken(value);
  }
  if (value === undefined) {
    return false;
  }
  const idToken = toJsonObject(value);
  if (!idToken) {
    return false;
  }
  return optionalBoolean(idToken.chatgpt_account_is_fedramp) === true;
}

async function readCodexAuthJson(): Promise<CodexAuthJson> {
  const authPath = codexAuthPath();
  let raw: string;
  try {
    raw = await fs.readFile(authPath, "utf8");
  } catch {
    throw new ExpectedCommandDispatchError(
      "codex_auth_missing",
      `Codex auth file not found at ${authPath}. Run codex login on this host.`,
    );
  }

  const parsed = parseCodexAuthFile(raw, authPath);
  const tokens = toJsonObject(parsed.tokens);
  const accessToken = tokens ? optionalString(tokens.access_token) : null;

  return {
    authMode: optionalString(parsed.auth_mode),
    openAiApiKey: optionalString(parsed.OPENAI_API_KEY),
    tokens,
    accessToken,
  };
}

function resolveAccountId(args: ResolveCodexTokenArgs): string {
  const accountId =
    optionalString(args.tokens.account_id) ??
    getAccountIdFromToken(args.accessToken) ??
    getAccountIdFromIdToken(args.tokens.id_token);

  if (!accountId) {
    throw new ExpectedCommandDispatchError(
      "codex_auth_invalid",
      "Codex auth tokens do not include a ChatGPT account id. Run codex login on this host.",
    );
  }

  return accountId;
}

function resolveFedrampAccount(args: ResolveCodexTokenArgs): boolean {
  return (
    isFedrampToken(args.accessToken) || isFedrampIdToken(args.tokens.id_token)
  );
}

function shouldUseOpenAiApiKeyAuth(auth: CodexAuthJson): boolean {
  return (
    auth.authMode === "apikey" ||
    auth.authMode === "apiKey" ||
    (auth.authMode === null && auth.openAiApiKey !== null)
  );
}

function buildOpenAiApiKeyCredentials(
  auth: CodexAuthJson,
): CodexOpenAiApiKeyCredentials {
  const authPath = codexAuthPath();
  if (!auth.openAiApiKey) {
    throw new ExpectedCommandDispatchError(
      "codex_auth_invalid",
      `Codex auth file at ${authPath} does not contain a usable API key. Run codex login on this host.`,
    );
  }
  return {
    type: "apiKey",
    apiKey: auth.openAiApiKey,
  };
}

function buildChatGptCredentials(
  auth: CodexAuthJson,
): CodexChatGptAuthCredentials {
  const authPath = codexAuthPath();
  if (!auth.tokens || !auth.accessToken) {
    throw new ExpectedCommandDispatchError(
      "codex_auth_invalid",
      `Codex auth file at ${authPath} does not contain a usable access token. Run codex login on this host.`,
    );
  }
  return {
    type: "chatgpt",
    accessToken: auth.accessToken,
    accountId: resolveAccountId({
      accessToken: auth.accessToken,
      tokens: auth.tokens,
    }),
    accountEmail:
      getAccountEmailFromToken(auth.accessToken) ??
      (typeof auth.tokens.id_token === "string"
        ? getAccountEmailFromToken(auth.tokens.id_token)
        : null),
    isFedrampAccount: resolveFedrampAccount({
      accessToken: auth.accessToken,
      tokens: auth.tokens,
    }),
  };
}

export async function readCodexAuthCredentials(): Promise<CodexAuthCredentials> {
  const auth = await readCodexAuthJson();
  if (shouldUseOpenAiApiKeyAuth(auth)) {
    return buildOpenAiApiKeyCredentials(auth);
  }
  return buildChatGptCredentials(auth);
}
