import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ASSEMBLER_GRAMMAR_VERSIONS } from "../src/assembler/delta-assembler.js";
import { runBridgeConformance } from "../src/conformance/index.js";
import type {
  BridgeConformanceTransport,
  ConformanceReport,
} from "../src/conformance/index.js";
import {
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
} from "../src/index.js";

const requestLineSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    method: z.string(),
    params: z
      .object({
        threadId: z.string().optional(),
        providerThreadId: z.string().optional(),
        clientRequestId: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/**
 * A bridge that is protocol-clean everywhere except on thread/start, which
 * it answers with the bb thread id instead of a provider identity. The
 * runtime adopts no session from such an answer (the result schema requires
 * `providerThreadId`), so the kit must name the missing field in its
 * verdict rather than report an opaque parse failure.
 */
function startWithoutIdentityTransport(): BridgeConformanceTransport {
  const emitted: unknown[] = [];
  const reply = (id: string | number, body: Record<string, unknown>): void => {
    emitted.push({ jsonrpc: "2.0", id, ...body });
  };
  return {
    send(line) {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        return;
      }
      const request = requestLineSchema.safeParse(raw);
      if (!request.success) {
        return;
      }
      const message = request.data;
      switch (message.method) {
        case BRIDGE_REQUEST_METHODS.initialize:
          reply(message.id, {
            result: {
              protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
              capabilities: { grammarVersions: ASSEMBLER_GRAMMAR_VERSIONS },
            },
          });
          return;
        case BRIDGE_REQUEST_METHODS.threadStop:
          reply(message.id, {
            error: {
              code: BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
              message: "Invalid params for thread/stop",
            },
          });
          return;
        case BRIDGE_REQUEST_METHODS.threadStart:
          reply(message.id, {
            result: { threadId: message.params?.threadId },
          });
          return;
        default:
          reply(message.id, {
            error: {
              code: BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
              message: `Method not found: ${message.method}`,
            },
          });
      }
    },
    takeMessages() {
      return emitted.splice(0, emitted.length);
    },
  };
}

interface StubBridgeOptions {
  /** What the handshake declares for `fork`. */
  fork: "none" | "tip";
  /** Answer thread/resume with a bare `{}` instead of an identity. */
  blankResume?: boolean;
  /** Answer thread/fork with a bare `{}` instead of an identity. */
  blankFork?: boolean;
}

interface StubBridge {
  transport: BridgeConformanceTransport;
  /** Every thread/fork request the kit sent, by params. */
  forks: { threadId?: string; providerThreadId?: string }[];
  /** Every thread/stop request the kit sent, by params. */
  stops: { threadId?: string; providerThreadId?: string; intent?: unknown }[];
}

/**
 * A conformant bridge (echo-shaped v3 deltas, a fresh identity per session
 * construction) whose resume and fork answers can be blanked, so the rules
 * that pin those identities have something to fail on. `thread/fork` is
 * answered only when the handshake declared fork, like a real bridge.
 */
function stubBridge(options: StubBridgeOptions): StubBridge {
  const emitted: unknown[] = [];
  const forks: StubBridge["forks"] = [];
  const stops: StubBridge["stops"] = [];
  let serial = 0;
  let sessions = 0;
  const reply = (id: string | number, body: Record<string, unknown>): void => {
    emitted.push({ jsonrpc: "2.0", id, ...body });
  };
  const delta = (threadId: string, deltas: unknown[]): void => {
    emitted.push({
      jsonrpc: "2.0",
      method: "thread/delta",
      params: { threadId, deltas },
    });
  };
  const identity = (): { providerThreadId: string } => {
    sessions += 1;
    return { providerThreadId: `prov-${sessions}` };
  };
  return {
    forks,
    stops,
    transport: {
      send(line) {
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          return;
        }
        const request = requestLineSchema.safeParse(raw);
        if (!request.success) {
          return;
        }
        const message = request.data;
        const params = message.params ?? {};
        switch (message.method) {
          case BRIDGE_REQUEST_METHODS.initialize:
            reply(message.id, {
              result: {
                protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
                capabilities: {
                  grammarVersions: ASSEMBLER_GRAMMAR_VERSIONS,
                  fork: options.fork,
                },
              },
            });
            return;
          case BRIDGE_REQUEST_METHODS.threadStart:
            reply(message.id, { result: identity() });
            return;
          case BRIDGE_REQUEST_METHODS.threadResume:
            reply(message.id, {
              result: options.blankResume === true ? {} : identity(),
            });
            return;
          case BRIDGE_REQUEST_METHODS.threadFork:
            forks.push(params);
            if (options.fork === "none") {
              reply(message.id, {
                error: {
                  code: BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
                  message: "Method not found: thread/fork",
                },
              });
              return;
            }
            reply(message.id, {
              result: options.blankFork === true ? {} : identity(),
            });
            return;
          case BRIDGE_REQUEST_METHODS.threadStop:
            if (typeof params.threadId !== "string") {
              reply(message.id, {
                error: {
                  code: BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
                  message: "Invalid params for thread/stop",
                },
              });
              return;
            }
            stops.push(params);
            reply(message.id, { result: {} });
            return;
          case BRIDGE_REQUEST_METHODS.turnStart: {
            serial += 1;
            const key = { providerItemId: `stub-msg-${serial}` };
            delta(params.threadId ?? "", [
              {
                kind: "input.accepted",
                clientRequestId: params.clientRequestId,
              },
              { kind: "turn.open" },
              {
                kind: "item.open",
                key,
                item: { type: "agentMessage", text: "" },
              },
              {
                kind: "item.textDelta",
                key,
                channel: "agentMessage",
                text: "hi",
              },
              {
                kind: "item.textClose",
                key,
                channel: "agentMessage",
                text: "hi",
              },
              { kind: "turn.boundary", status: "completed" },
            ]);
            reply(message.id, { result: { threadId: params.threadId } });
            return;
          }
          default:
            reply(message.id, {
              error: {
                code: BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
                message: `Method not found: ${message.method}`,
              },
            });
        }
      },
      takeMessages() {
        return emitted.splice(0, emitted.length);
      },
    },
  };
}

async function runStub(
  options: StubBridgeOptions,
): Promise<{ report: ConformanceReport; bridge: StubBridge }> {
  const bridge = stubBridge(options);
  const report = await runBridgeConformance({
    transport: bridge.transport,
    providerId: "stub",
    session: {
      cwd: "/tmp/bb-conformance-identity",
      promptInput: [{ type: "text", text: "hello", mentions: [] }],
    },
    timeoutMs: 500,
  });
  return { report, bridge };
}

function byId(report: ConformanceReport) {
  return new Map(report.results.map((result) => [result.id, result]));
}

function failedIds(report: ConformanceReport): string[] {
  return report.results
    .filter((result) => result.status === "fail")
    .map((result) => result.id);
}

describe("conformance session/start-identity", () => {
  it("names the missing providerThreadId when thread/start answers without one", async () => {
    const report = await runBridgeConformance({
      transport: startWithoutIdentityTransport(),
      providerId: "stub",
      session: {
        cwd: "/tmp/bb-conformance-identity",
        promptInput: [{ type: "text", text: "hello", mentions: [] }],
        interruptiblePromptInput: [
          { type: "text", text: "hold", mentions: [] },
        ],
      },
      timeoutMs: 250,
    });

    const results = byId(report);
    expect(results.get("session/start-identity")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("providerThreadId"),
    });
    expect(results.get("session/start-identity")?.detail).toContain(
      '{"threadId":"thr_conformance_1"}',
    );
    // One clear verdict, not a cascade: everything that needs the session
    // is skipped with the prerequisite named.
    expect(failedIds(report)).toEqual(["session/start-identity"]);
    expect(
      report.results
        .filter((result) => result.status === "skipped")
        .map((result) => result.detail),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("prerequisite session/start-identity failed"),
      ]),
    );
    expect(report.passed).toBe(false);
  });
});

describe("conformance session/resume-identity", () => {
  it("names the missing providerThreadId when thread/resume answers without one", async () => {
    // The runtime parses a resume result like a start result and forgets
    // the thread without the field, so a kit-green bridge that answers
    // thread/resume with `{}` would fail on its first real resume.
    const { report } = await runStub({ fork: "none", blankResume: true });
    const results = byId(report);
    expect(results.get("session/start-identity")?.status).toBe("pass");
    expect(results.get("session/resume-identity")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("providerThreadId"),
    });
    expect(results.get("session/resume-identity")?.detail).toContain(
      "(got {})",
    );
    expect(results.get("session/resume-id-uniqueness")).toMatchObject({
      status: "skipped",
      detail: "prerequisite session/resume-identity failed",
    });
    expect(failedIds(report)).toEqual(["session/resume-identity"]);
    expect(report.passed).toBe(false);
  });

  it("adopts the identity the resume returned for every later request", async () => {
    const { report, bridge } = await runStub({ fork: "none" });
    expect(failedIds(report)).toEqual([]);
    expect(report.passed).toBe(true);
    // thread/start minted prov-1, thread/resume minted prov-2: the closing
    // release names the resumed session, as the runtime would.
    expect(bridge.stops.at(-1)).toMatchObject({
      threadId: "thr_conformance_1",
      providerThreadId: "prov-2",
      intent: "release",
    });
  });
});

describe("conformance session/fork-identity", () => {
  it("sends no thread/fork to a bridge whose handshake declares fork: none", async () => {
    // The runtime never sends thread/fork to such a bridge, so there is
    // nothing to judge and no result for the rule.
    const { report, bridge } = await runStub({ fork: "none" });
    expect(bridge.forks).toEqual([]);
    expect(byId(report).has("session/fork-identity")).toBe(false);
    expect(report.passed).toBe(true);
  });

  it("forks the lifecycle session at its tip and releases the fork when fork is declared", async () => {
    const { report, bridge } = await runStub({ fork: "tip" });
    expect(byId(report).get("session/fork-identity")?.status).toBe("pass");
    expect(report.passed).toBe(true);
    expect(bridge.forks).toEqual([
      expect.objectContaining({
        threadId: "thr_conformance_1_fork",
        // The resumed session is the source, not the one thread/start minted.
        sourceProviderThreadId: "prov-2",
        instructionMode: "append",
      }),
    ]);
    expect(bridge.stops).toContainEqual(
      expect.objectContaining({
        threadId: "thr_conformance_1_fork",
        providerThreadId: "prov-3",
        intent: "release",
      }),
    );
  });

  it("names the missing providerThreadId when thread/fork answers without one", async () => {
    const { report, bridge } = await runStub({ fork: "tip", blankFork: true });
    const results = byId(report);
    expect(results.get("session/fork-identity")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("providerThreadId"),
    });
    expect(failedIds(report)).toEqual(["session/fork-identity"]);
    expect(report.passed).toBe(false);
    // Nothing to release: the bridge produced no session the kit could name.
    expect(
      bridge.stops.filter((stop) => stop.threadId === "thr_conformance_1_fork"),
    ).toEqual([]);
  });
});
