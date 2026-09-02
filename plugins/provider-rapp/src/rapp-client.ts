import { z } from "zod";
import type { AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import {
  RAPP_BRAINSTEM_SECRET_ENV,
  RAPP_BRAINSTEM_URL_ENV,
  RAPP_BRAINSTEM_MODEL,
  RAPP_BUSINESS_MODEL,
  RAPP_BUSINESS_URL_ENV,
  RAPP_ENDPOINT_URL_REQUIREMENTS,
  RAPP_FUNCTION_KEY_ENV,
  RAPP_USER_GUID_ENV,
  rappCatalogOptionsSchema,
  type RappCatalogOptions,
  type RappGrail,
} from "./vocabulary.js";
import type { RappTranscriptEntry } from "./rapp1.js";

const canonicalResponseSchema = z
  .object({
    response: z.string().refine((value) => value.trim() !== ""),
    agent_logs: z.array(z.string()),
    session_id: z.string().min(1),
  })
  .strict();

const consumerResponseSchema = z
  .object({
    response: z.string().refine((value) => value.trim() !== ""),
    agent_logs: z.union([z.string(), z.array(z.string())]),
    session_id: z.string().min(1),
    model: z.string().optional(),
    requested_model: z.string().optional(),
  })
  .passthrough();

const businessResponseSchema = z
  .object({
    assistant_response: z.string().refine((value) => value.trim() !== ""),
    voice_response: z.string().optional(),
    agent_logs: z.union([z.string(), z.array(z.string())]),
    user_guid: z.string().optional(),
  })
  .passthrough();

const nestedErrorSchema = z.object({
  error: z.union([
    z.string(),
    z.object({
      code: z.string(),
      step: z.string().nullable().optional(),
    }),
  ]),
  details: z.string().optional(),
});

const consumerModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    available: z.boolean().optional(),
  })
  .passthrough();

const consumerModelListSchema = z
  .object({
    models: z.array(consumerModelSchema),
    current: z.string().min(1),
  })
  .passthrough();

const modelSetResponseSchema = z
  .object({
    model: z.string().min(1),
  })
  .passthrough();

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export interface RappClientConfig {
  grail: RappGrail;
  endpoint: URL;
  modelListEndpoint: URL | null;
  modelSetEndpoint: URL | null;
  displayEndpoint: string;
  headers: Readonly<Record<string, string>>;
  userGuid: string | null;
  timeoutMs: number;
}

export interface RappChatRequest {
  userInput: string;
  sessionId: string | null;
  idempotencyKey: string;
  conversationHistory: readonly RappTranscriptEntry[];
}

export interface RappChatResponse {
  response: string;
  agentLogs: string[];
  sessionId: string | null;
  requestedModel: string | null;
  actualModel: string | null;
}

export interface RappModelList {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}

export class RappClientError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "configuration"
      | "connection"
      | "timeout"
      | "unauthorized"
      | "rate-limit"
      | "response",
    readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = "RappClientError";
  }
}

function normalizedHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizedHostname(hostname);
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function normalizeEndpoint(raw: string, grail: RappGrail): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new RappClientError(`Invalid RAPP endpoint: ${raw}`, "configuration");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new RappClientError(
      "RAPP endpoint must use HTTP or HTTPS",
      "configuration",
    );
  }
  if (
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new RappClientError(
      RAPP_ENDPOINT_URL_REQUIREMENTS,
      "configuration",
    );
  }
  const path = endpoint.pathname.replace(/\/+$/u, "");
  if (grail === "consumer") {
    endpoint.pathname =
      path === "" ? "/chat" : path.endsWith("/chat") ? path : `${path}/chat`;
  } else {
    endpoint.pathname =
      path === ""
        ? "/api/businessinsightbot_function"
        : path.endsWith("/api")
          ? `${path}/businessinsightbot_function`
          : path;
  }
  return endpoint;
}

function displayEndpoint(endpoint: URL): string {
  const display = new URL(endpoint);
  display.username = "";
  display.password = "";
  display.search = "";
  display.hash = "";
  return display.toString();
}

function consumerSiblingEndpoint(endpoint: URL, path: string): URL {
  const sibling = new URL(endpoint);
  sibling.pathname = `${sibling.pathname.slice(0, -"/chat".length)}${path}`;
  return sibling;
}

export function resolveRappClientConfig(
  rawOptions: RappCatalogOptions,
  env: NodeJS.ProcessEnv = process.env,
): RappClientConfig {
  const options = rappCatalogOptionsSchema.parse(rawOptions);
  const override = options.endpoint.trim();
  const rawEndpoint =
    options.grail === "consumer"
      ? override ||
        env[RAPP_BRAINSTEM_URL_ENV]?.trim() ||
        "http://127.0.0.1:7071"
      : override || env[RAPP_BUSINESS_URL_ENV]?.trim();
  if (!rawEndpoint) {
    throw new RappClientError(
      `Configure the Business Grail endpoint with bb plugin config provider-rapp set endpoint <url> or ${RAPP_BUSINESS_URL_ENV}`,
      "configuration",
    );
  }
  const endpoint = normalizeEndpoint(rawEndpoint, options.grail);
  const modelListEndpoint =
    options.grail === "consumer"
      ? consumerSiblingEndpoint(endpoint, "/models")
      : null;
  const modelSetEndpoint =
    options.grail === "consumer"
      ? consumerSiblingEndpoint(endpoint, "/models/set")
      : null;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const brainstemSecret = env[RAPP_BRAINSTEM_SECRET_ENV]?.trim();
  if (options.grail === "consumer" && brainstemSecret) {
    headers["x-brainstem-secret"] = brainstemSecret;
  }
  const functionKey = env[RAPP_FUNCTION_KEY_ENV]?.trim();
  if (options.grail === "business" && functionKey) {
    headers["x-functions-key"] = functionKey;
  }
  if (
    endpoint.protocol === "http:" &&
    !isLoopbackHostname(endpoint.hostname) &&
    (brainstemSecret || functionKey)
  ) {
    throw new RappClientError(
      "RAPP credentials require HTTPS outside the local machine",
      "configuration",
    );
  }
  return {
    grail: options.grail,
    endpoint,
    modelListEndpoint,
    modelSetEndpoint,
    displayEndpoint: displayEndpoint(endpoint),
    headers,
    userGuid:
      options.grail === "business"
        ? (env[RAPP_USER_GUID_ENV]?.trim() ?? null)
        : null,
    timeoutMs: options.grail === "business" ? 230_000 : 120_000,
  };
}

function normalizeAgentLogs(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return [];
  }
  let possibleArray: unknown = null;
  if (trimmed.startsWith("[")) {
    try {
      possibleArray = JSON.parse(trimmed);
    } catch {
      possibleArray = null;
    }
  }
  const parsed = z.array(z.string()).safeParse(possibleArray);
  if (parsed.success) {
    return parsed.data.map((entry) => entry.trim()).filter(Boolean);
  }
  return trimmed
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function responseErrorMessage(value: unknown, status: number): string {
  const parsed = nestedErrorSchema.safeParse(value);
  if (!parsed.success) {
    return `RAPP endpoint returned HTTP ${status}`;
  }
  if (typeof parsed.data.error === "string") {
    return parsed.data.details
      ? `${parsed.data.error}: ${parsed.data.details}`
      : parsed.data.error;
  }
  const step =
    parsed.data.error.step === undefined || parsed.data.error.step === null
      ? ""
      : ` at verification step ${parsed.data.error.step}`;
  return `RAPP refusal ${parsed.data.error.code}${step}`;
}

function errorKind(status: number): RappClientError["kind"] {
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 429) {
    return "rate-limit";
  }
  return "response";
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number.parseInt(declaredLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_RESPONSE_BYTES) {
      throw new RappClientError(
        `RAPP response exceeds ${MAX_RESPONSE_BYTES} bytes`,
        "response",
        response.status,
      );
    }
  }
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RappClientError(
          `RAPP response exceeds ${MAX_RESPONSE_BYTES} bytes`,
          "response",
          response.status,
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(
    chunks.map((chunk) =>
      Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
    ),
    totalBytes,
  );
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RappClientError(
      "RAPP endpoint returned non-UTF-8 response bytes",
      "response",
      response.status,
    );
  }
}

async function requestRappJson(args: {
  config: RappClientConfig;
  endpoint: URL;
  method: "GET" | "POST";
  body?: unknown;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<{ payload: unknown; status: number }> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (args.signal.aborted) {
    controller.abort();
  } else {
    args.signal.addEventListener("abort", abort, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, args.timeoutMs);

  let response: Response;
  let text: string;
  try {
    response = await fetch(args.endpoint, {
      method: args.method,
      headers: args.config.headers,
      ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
      signal: controller.signal,
      redirect: "error",
    });
    text = await readBoundedResponseText(response);
  } catch (error) {
    if (error instanceof RappClientError) {
      throw error;
    }
    if (timedOut) {
      throw new RappClientError(
        `RAPP request timed out after ${Math.round(args.timeoutMs / 1000)} seconds`,
        "timeout",
      );
    }
    if (args.signal.aborted) {
      throw error;
    }
    throw new RappClientError(
      `Could not reach RAPP at ${displayEndpoint(args.endpoint)}: ${error instanceof Error ? error.message : String(error)}`,
      "connection",
    );
  } finally {
    clearTimeout(timeout);
    args.signal.removeEventListener("abort", abort);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new RappClientError(
        text.trim() || `RAPP endpoint returned HTTP ${response.status}`,
        errorKind(response.status),
        response.status,
      );
    }
    throw new RappClientError(
      "RAPP endpoint returned a non-JSON success response",
      "response",
      response.status,
    );
  }
  if (!response.ok) {
    throw new RappClientError(
      responseErrorMessage(payload, response.status),
      errorKind(response.status),
      response.status,
    );
  }
  return { payload, status: response.status };
}

function availableModel(
  model: typeof RAPP_BRAINSTEM_MODEL | typeof RAPP_BUSINESS_MODEL,
  isDefault: boolean,
): AvailableModel {
  return {
    ...model,
    model: model.id,
    isDefault,
    supportedReasoningEfforts: model.supportedReasoningEfforts.map(
      (effort) => ({ ...effort }),
    ),
  };
}

export function fixedBusinessModelList(): RappModelList {
  return {
    models: [availableModel(RAPP_BUSINESS_MODEL, true)],
    selectedOnlyModels: [],
  };
}

export async function listRappModels(
  config: RappClientConfig,
  signal: AbortSignal,
): Promise<RappModelList> {
  if (config.grail !== "consumer" || config.modelListEndpoint === null) {
    return fixedBusinessModelList();
  }
  const { payload, status } = await requestRappJson({
    config,
    endpoint: config.modelListEndpoint,
    method: "GET",
    signal,
    timeoutMs: 15_000,
  });
  const parsed = consumerModelListSchema.safeParse(payload);
  if (!parsed.success) {
    throw new RappClientError(
      "RAPP Brainstem returned an unsupported model catalog",
      "response",
      status,
    );
  }
  const seen = new Set<string>();
  const sourceModels = parsed.data.models.filter((model) => {
    if (model.available !== true || seen.has(model.id)) {
      return false;
    }
    seen.add(model.id);
    return true;
  });
  if (sourceModels.length === 0) {
    throw new RappClientError(
      "RAPP Brainstem returned no verified GitHub Copilot models",
      "response",
      status,
    );
  }
  const defaultId = sourceModels.some(
    (model) => model.id === parsed.data.current,
  )
    ? parsed.data.current
    : sourceModels[0].id;
  return {
    models: sourceModels.map((model) => ({
      id: model.id,
      model: model.id,
      displayName: model.name,
      description: "GitHub Copilot model supplied by RAPP Brainstem",
      supportedReasoningEfforts: [
        {
          reasoningEffort: "none",
          description:
            "RAPP Brainstem owns GitHub Copilot reasoning and execution.",
        },
      ],
      defaultReasoningEffort: "none",
      isDefault: model.id === defaultId,
    })),
    selectedOnlyModels: [availableModel(RAPP_BRAINSTEM_MODEL, false)],
  };
}

export async function setRappModel(
  config: RappClientConfig,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  if (config.grail !== "consumer" || config.modelSetEndpoint === null) {
    throw new RappClientError(
      "Only the Consumer Grail supports selectable Brainstem models",
      "configuration",
    );
  }
  const { payload, status } = await requestRappJson({
    config,
    endpoint: config.modelSetEndpoint,
    method: "POST",
    body: { model },
    signal,
    timeoutMs: 15_000,
  });
  const parsed = modelSetResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.model !== model) {
    throw new RappClientError(
      `RAPP Brainstem did not select requested model ${model}`,
      "response",
      status,
    );
  }
  return parsed.data.model;
}

export async function callRapp(
  config: RappClientConfig,
  request: RappChatRequest,
  signal: AbortSignal,
): Promise<RappChatResponse> {
  const body = {
    user_input: request.userInput,
    idempotency_key: request.idempotencyKey,
    conversation_history: request.conversationHistory,
    ...(request.sessionId === null ? {} : { session_id: request.sessionId }),
    ...(config.userGuid === null ? {} : { user_guid: config.userGuid }),
  };
  const { payload, status } = await requestRappJson({
    config,
    endpoint: config.endpoint,
    method: "POST",
    body,
    signal,
    timeoutMs: config.timeoutMs,
  });

  const canonical = canonicalResponseSchema.safeParse(payload);
  if (canonical.success) {
    return {
      response: canonical.data.response,
      agentLogs: canonical.data.agent_logs,
      sessionId: canonical.data.session_id,
      requestedModel: null,
      actualModel: null,
    };
  }
  const consumer = consumerResponseSchema.safeParse(payload);
  if (consumer.success) {
    return {
      response: consumer.data.response,
      agentLogs: normalizeAgentLogs(consumer.data.agent_logs),
      sessionId: consumer.data.session_id,
      requestedModel: consumer.data.requested_model ?? null,
      actualModel: consumer.data.model ?? null,
    };
  }
  const business = businessResponseSchema.safeParse(payload);
  if (business.success) {
    return {
      response: business.data.assistant_response,
      agentLogs: normalizeAgentLogs(business.data.agent_logs),
      sessionId: request.sessionId,
      requestedModel: null,
      actualModel: null,
    };
  }
  throw new RappClientError(
    "RAPP endpoint returned an unsupported success envelope",
    "response",
    status,
  );
}
