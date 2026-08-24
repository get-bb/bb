/**
 * The bb extension pi loads with `--extension`: the in-process half of the
 * RPC bridge. It runs where pi's SDK is installed and gives the bridge two
 * things RPC mode has no command for:
 *
 * - **dynamic tools**: the bb tools the runtime injects (`dynamicTools` on a
 *   session construction) are registered with `pi.registerTool`, kept active
 *   across `session_start`, and every `execute` is forwarded to the bridge
 *   over a private pipe (fd 3 child → bridge, fd 4 bridge → child), where the
 *   bridge's pending-tool-call tracker turns it into `item/tool/call`;
 * - **session forks**: `SessionManager.forkFrom` (full) and
 *   `SessionManager.open(...).createBranchedSession(leafId)` (checkpoint)
 *   on request, so a checkpoint fork needs neither an upstream pi change nor
 *   a copy of the on-disk format.
 *
 * The source is embedded in the bridge (`BB_PI_EXTENSION_SOURCE`) and written
 * to the bridge's temp dir at start: a plugin host artifact is one bundled
 * file, and pi's loader resolves `@earendil-works/*` and `typebox` from its
 * own install for any extension path. Plain JavaScript: pi compiles `.ts`
 * extensions with jiti on every load, and this one needs neither the cost nor
 * the TypeScript-version coupling.
 *
 * Wire (LF-delimited JSON, one message per line; `\n` is the only
 * terminator — U+2028/U+2029 appear raw inside pi's JSON strings) —
 * child → bridge on fd 3:
 *   { kind: "ready" }
 *   { kind: "tool-call", id, toolName, arguments }
 *   { kind: "agent-end-leaf", leafId }   in-process, before pi's own
 *                                        `agent_end` reaches stdout
 *   { kind: "reply", id, result } | { kind: "reply", id, error }
 * bridge → child on fd 4:
 *   { kind: "tool-result", id, content, isError }
 *   { kind: "request", id, method: "fork", sourceFile, targetFile, cwd,
 *     sessionDir, checkpointId? }
 *   { kind: "request", id, method: "leaf" }
 *
 * fd 4 is read through a `net.Socket` (non-blocking, libuv-polled): a
 * `fs.createReadStream` read(2) on a threadpool thread would keep pi's
 * `process.exit` from ever finishing. The bridge ends the fd-4 writer on
 * every close path so the reader sees EOF.
 */
export const BB_PI_EXTENSION_SOURCE = String.raw`
import { readFileSync, renameSync, writeSync } from "node:fs";
import { Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const CHILD_TO_BRIDGE_FD = 3;
const BRIDGE_TO_CHILD_FD = 4;

function writeLine(fd, message) {
  const line = JSON.stringify(message) + "\n";
  try {
    // Synchronous: tool results and fork replies must never interleave.
    writeSyncAll(fd, line);
  } catch {
    // The bridge is gone; nothing to report to.
  }
}

function writeSyncAll(fd, text) {
  const buffer = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < buffer.length) {
    offset += writeSync(fd, buffer, offset, buffer.length - offset);
  }
}

/** Newline-only line reader (never readline: it splits on U+2028/U+2029). */
function readLines(input, onLine) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  input.on("data", (chunk) => {
    const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
    let start = 0;
    for (;;) {
      const index = text.indexOf("\n", start);
      if (index === -1) {
        pending += text.slice(start);
        return;
      }
      const line = pending + text.slice(start, index);
      pending = "";
      start = index + 1;
      onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  });
}

// ---- JSON Schema → TypeBox (the bb tool definitions carry JSON Schema) ----

function toJsonSchemaObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * Annotations and constraints TypeBox carries through to the schema the
 * model sees: descriptions, defaults, and the numeric/string keywords.
 */
const CARRIED_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
];
function annotations(schema) {
  const out = {};
  if (typeof schema.description === "string") out.description = schema.description;
  if (typeof schema.title === "string") out.title = schema.title;
  if (schema.default !== undefined) out.default = schema.default;
  if (Array.isArray(schema.examples)) out.examples = schema.examples;
  for (const keyword of CARRIED_KEYWORDS) {
    if (schema[keyword] !== undefined) out[keyword] = schema[keyword];
  }
  return out;
}

function toLiteral(value) {
  return ["string", "number", "boolean"].includes(typeof value) ? Type.Literal(value) : null;
}

function toEnumSchema(schema) {
  if (!Array.isArray(schema.enum) || schema.enum.length === 0) return null;
  const literals = schema.enum.map(toLiteral).filter(Boolean);
  if (literals.length === 0) return null;
  return literals.length === 1
    ? Type.Unsafe({ ...literals[0], ...annotations(schema) })
    : Type.Union(literals, annotations(schema));
}

function toObjectSchema(schema) {
  const properties = toJsonSchemaObject(schema.properties) ?? {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const shape = {};
  for (const [key, value] of Object.entries(properties)) {
    const property = toJsonSchemaObject(value);
    if (!property) continue;
    const propertySchema = toTypeBoxSchema(property);
    shape[key] = required.has(key) ? propertySchema : Type.Optional(propertySchema);
  }
  const options = annotations(schema);
  if (schema.additionalProperties === false) options.additionalProperties = false;
  return Type.Object(shape, options);
}

function toTypedSchema(type, schema) {
  const options = annotations(schema);
  switch (type) {
    case "object":
      return toObjectSchema(schema);
    case "array": {
      const items = toJsonSchemaObject(schema.items);
      return Type.Array(items ? toTypeBoxSchema(items) : Type.Unknown(), options);
    }
    case "string":
      return Type.String(options);
    case "number":
      return Type.Number(options);
    case "integer":
      return Type.Integer(options);
    case "boolean":
      return Type.Boolean(options);
    case "null":
      return Type.Null(options);
    default:
      // JSON Schema is provider-owned here; unsupported shapes degrade.
      return Type.Unknown(options);
  }
}

function toTypeBoxSchema(schema) {
  const enumSchema = toEnumSchema(schema);
  if (enumSchema) return enumSchema;
  if (schema.const !== undefined) {
    const literal = toLiteral(schema.const);
    if (literal) return Type.Unsafe({ ...literal, ...annotations(schema) });
  }
  for (const key of ["anyOf", "oneOf"]) {
    if (Array.isArray(schema[key]) && schema[key].length > 0) {
      const variants = schema[key].map(toJsonSchemaObject).filter(Boolean).map(toTypeBoxSchema);
      if (variants.length > 0) return Type.Union(variants, annotations(schema));
    }
  }
  if (Array.isArray(schema.type)) {
    const variants = schema.type.map((type) => toTypedSchema(type, { ...schema, description: undefined }));
    return variants.length === 1 ? toTypedSchema(schema.type[0], schema) : Type.Union(variants, annotations(schema));
  }
  if (schema.type === undefined) {
    return schema.properties ? toObjectSchema(schema) : Type.Unknown(annotations(schema));
  }
  return toTypedSchema(schema.type, schema);
}

function buildParameters(inputSchema) {
  const schema = toJsonSchemaObject(inputSchema);
  return schema ? toTypeBoxSchema(schema) : Type.Object({});
}

// ---- the extension ----

export default function bbExtension(pi) {
  const toolsFile = process.env.PI_BB_TOOLS_FILE;
  const tools = toolsFile ? JSON.parse(readFileSync(toolsFile, "utf8")) : [];
  const pendingToolCalls = new Map();
  let nextId = 0;
  let sessionContext = null;

  // Non-blocking: libuv polls the pipe, so pi's process.exit is never held
  // up by an outstanding read; EOF (the bridge ended its writer) closes it.
  const bridgeIn = new Socket({ fd: BRIDGE_TO_CHILD_FD, readable: true, writable: false });
  bridgeIn.on("error", () => undefined);
  bridgeIn.unref();
  readLines(bridgeIn, (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (message.kind === "tool-result") {
      const pending = pendingToolCalls.get(message.id);
      if (!pending) return;
      pendingToolCalls.delete(message.id);
      if (message.isError) {
        pending.reject(new Error(toolErrorText(message.content) || "Tool call failed"));
      } else {
        pending.resolve({ content: message.content, details: {} });
      }
      return;
    }
    if (message.kind === "request") {
      void handleBridgeRequest(message);
    }
  });

  async function handleBridgeRequest(message) {
    try {
      const result = await runBridgeRequest(message);
      writeLine(CHILD_TO_BRIDGE_FD, { kind: "reply", id: message.id, result });
    } catch (error) {
      writeLine(CHILD_TO_BRIDGE_FD, {
        kind: "reply",
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function runBridgeRequest(message) {
    switch (message.method) {
      case "fork": {
        // Documented SessionManager API (docs/sdk.md, docs/session-format.md):
        // a full fork copies the source history, a checkpoint fork branches
        // at an entry. Both pick their own file name; the bridge names the
        // target, so the file is moved onto it. Both read the source file
        // and write only the new one.
        const forkedFile =
          message.checkpointId === undefined
            ? SessionManager.forkFrom(
                message.sourceFile,
                message.cwd,
                message.sessionDir,
              ).getSessionFile()
            : SessionManager.open(
                message.sourceFile,
                message.sessionDir,
                message.cwd,
              ).createBranchedSession(message.checkpointId);
        if (!forkedFile) {
          throw new Error("forked pi session was not persisted");
        }
        if (forkedFile !== message.targetFile) {
          renameSync(forkedFile, message.targetFile);
        }
        return { sessionFile: message.targetFile };
      }
      case "leaf":
        return { leafId: currentLeafId() };
      default:
        throw new Error("unknown bridge request " + String(message.method));
    }
  }

  function currentLeafId() {
    return sessionContext?.sessionManager?.getLeafId?.() ?? null;
  }

  for (const tool of tools) {
    pi.registerTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: buildParameters(tool.inputSchema),
      async execute(_toolCallId, params, signal) {
        nextId += 1;
        const id = "tc-" + String(nextId);
        const result = new Promise((resolve, reject) => {
          pendingToolCalls.set(id, { resolve, reject });
        });
        if (signal) {
          signal.addEventListener(
            "abort",
            () => {
              const pending = pendingToolCalls.get(id);
              if (!pending) return;
              pendingToolCalls.delete(id);
              pending.reject(new Error("Tool call aborted"));
            },
            { once: true },
          );
        }
        writeLine(CHILD_TO_BRIDGE_FD, {
          kind: "tool-call",
          id,
          toolName: tool.name,
          arguments: params ?? {},
        });
        return result;
      },
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    sessionContext = ctx;
    // Pi's active-tool set is session state; a resumed or forked session can
    // predate the bb tools, so make sure every injected tool is active.
    if (tools.length > 0 && typeof pi.setActiveTools === "function") {
      const active = new Set(pi.getActiveTools?.() ?? []);
      let missing = false;
      for (const tool of tools) {
        if (!active.has(tool.name)) {
          active.add(tool.name);
          missing = true;
        }
      }
      if (missing) pi.setActiveTools([...active]);
    }
    writeLine(CHILD_TO_BRIDGE_FD, { kind: "ready" });
  });

  // The run's checkpoint, read in-process the moment the run ends: pi emits
  // this to extensions before it writes its own agent_end to stdout, and
  // before any continuation or compaction can move the leaf.
  pi.on("agent_end", async (_event, ctx) => {
    sessionContext = ctx ?? sessionContext;
    writeLine(CHILD_TO_BRIDGE_FD, { kind: "agent-end-leaf", leafId: currentLeafId() });
  });
}

function toolErrorText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}
`;
