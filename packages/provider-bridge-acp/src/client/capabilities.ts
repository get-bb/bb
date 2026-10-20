import { isJsonObject, readMeta, readString } from "../session/decode.js";
import type { AcpJsonObject } from "../session/session-types.js";

export const ACP_CLIENT_PROTOCOL_VERSION = 1;

export interface AcpAuthMethod {
  id: string;
  name: string;
  description?: string;
  type: string;
  args: string[];
  env: Record<string, string>;
}

export interface AcpAgentImplementation {
  name?: string;
  title?: string;
  version?: string;
}

export interface AcpAgentCapabilities {
  protocolVersion: number;
  agentInfo: AcpAgentImplementation | null;
  prompt: { image: boolean; audio: boolean; embeddedContext: boolean };
  mcp: { http: boolean; sse: boolean };
  session: {
    load: boolean;
    resume: boolean;
    list: boolean;
    close: boolean;
    delete: boolean;
    fork: boolean;
    additionalDirectories: boolean;
  };
  logout: boolean;
  authMethods: AcpAuthMethod[];
  meta: AcpJsonObject;
}

export class AcpUnsupportedProtocolVersionError extends Error {
  readonly agentProtocolVersion: number | null;

  constructor(agentProtocolVersion: number | null) {
    super(
      agentProtocolVersion === null
        ? "The ACP agent did not report a protocol version."
        : `The ACP agent speaks protocol version ${agentProtocolVersion}; bb speaks version ${ACP_CLIENT_PROTOCOL_VERSION}.`,
    );
    this.name = "AcpUnsupportedProtocolVersionError";
    this.agentProtocolVersion = agentProtocolVersion;
  }
}

function objectAt(source: AcpJsonObject, key: string): AcpJsonObject {
  const value = source[key];
  return isJsonObject(value) ? value : {};
}

function isTrue(source: AcpJsonObject, key: string): boolean {
  return source[key] === true;
}

function isPresent(source: AcpJsonObject, key: string): boolean {
  const value = source[key];
  return value !== undefined && value !== null && value !== false;
}

function decodeAuthMethods(value: unknown): AcpAuthMethod[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const methods: AcpAuthMethod[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry)) {
      continue;
    }
    const id = readString(entry, "id") ?? readString(entry, "methodId");
    if (id === undefined) {
      continue;
    }
    const description = readString(entry, "description");
    const rawArgs = entry["args"];
    const rawEnv = entry["env"];
    const env: Record<string, string> = {};
    if (isJsonObject(rawEnv)) {
      for (const [name, envValue] of Object.entries(rawEnv)) {
        if (typeof envValue === "string") {
          env[name] = envValue;
        }
      }
    }
    methods.push({
      id,
      name: readString(entry, "name") ?? id,
      ...(description !== undefined ? { description } : {}),
      type: readString(entry, "type") ?? "agent",
      args: Array.isArray(rawArgs)
        ? rawArgs.filter((arg): arg is string => typeof arg === "string")
        : [],
      env,
    });
  }
  return methods;
}

function decodeImplementation(value: unknown): AcpAgentImplementation | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const implementation: AcpAgentImplementation = {};
  for (const field of ["name", "title", "version"] as const) {
    const fieldValue = readString(value, field);
    if (fieldValue !== undefined) {
      implementation[field] = fieldValue;
    }
  }
  return implementation;
}

export function readAcpAgentCapabilities(
  initializeResult: unknown,
): AcpAgentCapabilities {
  if (!isJsonObject(initializeResult)) {
    throw new AcpUnsupportedProtocolVersionError(null);
  }
  const protocolVersion = initializeResult["protocolVersion"];
  if (typeof protocolVersion !== "number") {
    throw new AcpUnsupportedProtocolVersionError(null);
  }
  const answersInAnotherGeneration =
    isJsonObject(initializeResult["capabilities"]) &&
    !("agentCapabilities" in initializeResult);
  if (
    protocolVersion !== ACP_CLIENT_PROTOCOL_VERSION &&
    answersInAnotherGeneration
  ) {
    throw new AcpUnsupportedProtocolVersionError(protocolVersion);
  }
  const agent = objectAt(initializeResult, "agentCapabilities");
  const prompt = objectAt(agent, "promptCapabilities");
  const mcp = objectAt(agent, "mcpCapabilities");
  const session = objectAt(agent, "sessionCapabilities");
  const auth = objectAt(agent, "auth");
  return {
    protocolVersion,
    agentInfo: decodeImplementation(initializeResult["agentInfo"]),
    prompt: {
      image: isTrue(prompt, "image"),
      audio: isTrue(prompt, "audio"),
      embeddedContext: isTrue(prompt, "embeddedContext"),
    },
    mcp: { http: isTrue(mcp, "http"), sse: isTrue(mcp, "sse") },
    session: {
      load: isTrue(agent, "loadSession"),
      resume: isPresent(session, "resume"),
      list: isPresent(session, "list"),
      close: isPresent(session, "close"),
      delete: isPresent(session, "delete"),
      fork: isPresent(session, "fork"),
      additionalDirectories: isPresent(session, "additionalDirectories"),
    },
    logout: isPresent(auth, "logout"),
    authMethods: decodeAuthMethods(initializeResult["authMethods"]),
    meta: readMeta(agent) ?? {},
  };
}
