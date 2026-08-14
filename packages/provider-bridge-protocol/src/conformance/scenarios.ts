import type { PromptInput, ThreadEvent } from "@bb/domain";
import {
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_REQUEST_METHODS,
  initializeResultSchema,
  threadEventNotificationSchema,
  threadIdentityResultSchema,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
} from "../index.js";
import {
  ConformanceClient,
  nextConformanceClientRequestId,
  type JsonRpcWireMessage,
} from "./client.js";
import type { ConformanceCheckResult } from "./types.js";

export interface ConformanceSessionFixture {
  /** Workspace directory for the session under test. */
  cwd: string;
  /** Prompt expected to elicit at least one assistant-message item. */
  promptInput: PromptInput[];
  /** Execution options for the session; the kit defaults to full mode. */
  options?: Record<string, unknown>;
}

interface ScenarioContext {
  client: ConformanceClient;
  fixture: ConformanceSessionFixture;
  /** Set by session/start-identity for later scenarios. */
  providerThreadId?: string;
}

function pass(id: string, title: string): ConformanceCheckResult {
  return { id, title, status: "pass", detail: "" };
}

function fail(id: string, title: string, detail: string): ConformanceCheckResult {
  return { id, title, status: "fail", detail };
}

function skipped(
  id: string,
  title: string,
  detail: string,
): ConformanceCheckResult {
  return { id, title, status: "skipped", detail };
}

function defaultOptions(
  fixture: ConformanceSessionFixture,
): Record<string, unknown> {
  return (
    fixture.options ?? {
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: "ask",
    }
  );
}

function threadEvents(context: ScenarioContext, threadId: string): ThreadEvent[] {
  context.client.drainIntoLog();
  const events: ThreadEvent[] = [];
  for (const message of context.client.notifications("thread/event")) {
    const parsed = threadEventNotificationSchema.safeParse(message.params);
    if (parsed.success && parsed.data.threadId === threadId) {
      events.push(parsed.data.event);
    }
  }
  return events;
}

function errorCode(message: JsonRpcWireMessage | null): number | undefined {
  const code = message?.error?.code;
  return typeof code === "number" ? code : undefined;
}

// ---------------------------------------------------------------------------
// Scenarios. Order matters: hygiene first (no session), then handshake, then
// one shared session lifecycle. A lifecycle scenario whose prerequisite
// failed reports "skipped" with the reason rather than cascading failures.
// ---------------------------------------------------------------------------

export async function runRpcHygieneScenarios(
  client: ConformanceClient,
): Promise<ConformanceCheckResult[]> {
  const results: ConformanceCheckResult[] = [];

  // Whether unknown methods are answered decides how the remaining hygiene
  // probes can work: the aliveness probe is an unknown method, so on a bridge
  // that drops unknowns (the pre-migration state) aliveness is indeterminate
  // and dependent checks report skipped rather than false failures.
  let unknownMethodsAnswered = false;
  {
    const id = client.request("bb/conformance/definitely-unknown-method", {});
    const response = await client.waitForResponse(id);
    const title = "unknown method answers METHOD_NOT_FOUND";
    if (response === null) {
      results.push(
        fail("rpc/unknown-method", title, "request was silently dropped"),
      );
    } else if (errorCode(response) === BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND) {
      unknownMethodsAnswered = true;
      results.push(pass("rpc/unknown-method", title));
    } else {
      unknownMethodsAnswered = true;
      results.push(
        fail(
          "rpc/unknown-method",
          title,
          `answered with ${JSON.stringify(response.error ?? response.result)}`,
        ),
      );
    }
  }

  {
    const id = client.request(BRIDGE_REQUEST_METHODS.threadStop, {});
    const response = await client.waitForResponse(id);
    const title = "schema-invalid params answer INVALID_PARAMS, never dropped";
    if (response === null) {
      results.push(
        fail("rpc/invalid-params", title, "request was silently dropped"),
      );
    } else if (errorCode(response) === BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS) {
      results.push(pass("rpc/invalid-params", title));
    } else {
      results.push(
        fail(
          "rpc/invalid-params",
          title,
          `answered with ${JSON.stringify(response.error ?? response.result)}`,
        ),
      );
    }
  }

  {
    const title = "a non-JSON line is ignored and the bridge stays alive";
    if (!unknownMethodsAnswered) {
      results.push(
        skipped(
          "rpc/non-json-ignored",
          title,
          "aliveness probe unavailable: bridge drops unknown methods",
        ),
      );
    } else {
      client.sendRaw("this is { not json");
      const probe = client.request("bb/conformance/alive-probe", {});
      const response = await client.waitForResponse(probe);
      results.push(
        response === null
          ? fail("rpc/non-json-ignored", title, "bridge stopped answering")
          : pass("rpc/non-json-ignored", title),
      );
    }
  }

  {
    const title = "a response-shaped line is not treated as a request";
    if (!unknownMethodsAnswered) {
      results.push(
        skipped(
          "rpc/response-not-request",
          title,
          "aliveness probe unavailable: bridge drops unknown methods",
        ),
      );
    } else {
      client.sendRaw(
        JSON.stringify({ jsonrpc: "2.0", id: 999_999, result: {} }),
      );
      const probe = client.request("bb/conformance/alive-probe", {});
      const response = await client.waitForResponse(probe);
      const echoed = client
        .responsesFor(999_999)
        .some((message) => message.error !== undefined);
      if (response === null) {
        results.push(
          fail("rpc/response-not-request", title, "bridge stopped answering"),
        );
      } else if (echoed) {
        results.push(
          fail(
            "rpc/response-not-request",
            title,
            "bridge answered an unsolicited response with an error",
          ),
        );
      } else {
        results.push(pass("rpc/response-not-request", title));
      }
    }
  }

  return results;
}

export async function runHandshakeScenario(
  client: ConformanceClient,
): Promise<ConformanceCheckResult[]> {
  const id = client.request(BRIDGE_REQUEST_METHODS.initialize, {
    protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
    client: { name: "bb-conformance", version: "0.0.1" },
  });
  const response = await client.waitForResponse(id);
  const title = "initialize answers a versioned handshake with capabilities";
  if (response === null) {
    return [fail("handshake/initialize", title, "no response")];
  }
  const parsed = initializeResultSchema.safeParse(response.result);
  if (!parsed.success) {
    return [
      fail(
        "handshake/initialize",
        title,
        `result did not parse: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")} (got ${JSON.stringify(response.result ?? response.error)})`,
      ),
    ];
  }
  return [pass("handshake/initialize", title)];
}

export async function runSessionLifecycleScenarios(
  context: ScenarioContext,
): Promise<ConformanceCheckResult[]> {
  const { client, fixture } = context;
  const results: ConformanceCheckResult[] = [];
  const threadId = "thr_conformance_1";

  // session/start-identity
  {
    const id = client.request(BRIDGE_REQUEST_METHODS.threadStart, {
      threadId,
      cwd: fixture.cwd,
      options: defaultOptions(fixture),
      instructionMode: "append",
    });
    const response = await client.waitForResponse(id);
    const title = "thread/start returns a provider thread identity";
    if (response === null) {
      results.push(fail("session/start-identity", title, "no response"));
    } else if (response.error !== undefined) {
      results.push(
        fail(
          "session/start-identity",
          title,
          `error: ${JSON.stringify(response.error)}`,
        ),
      );
    } else {
      const parsed = threadIdentityResultSchema.safeParse(response.result);
      if (!parsed.success) {
        results.push(
          fail(
            "session/start-identity",
            title,
            `result did not parse: ${JSON.stringify(response.result)}`,
          ),
        );
      } else {
        context.providerThreadId = parsed.data.providerThreadId;
        results.push(pass("session/start-identity", title));
      }
    }
  }

  const startSkipDetail = "prerequisite session/start-identity failed";

  // turn/lifecycle + events/schema-valid + item/opens-before-delta
  if (context.providerThreadId === undefined) {
    results.push(
      skipped("turn/lifecycle", "an accepted turn starts and settles", startSkipDetail),
      skipped(
        "events/schema-valid",
        "every thread/event payload is a valid ThreadEvent",
        startSkipDetail,
      ),
      skipped(
        "item/opens-before-delta",
        "every item's first event is item/started",
        startSkipDetail,
      ),
    );
  } else {
    const id = client.request(BRIDGE_REQUEST_METHODS.turnStart, {
      threadId,
      providerThreadId: context.providerThreadId,
      input: fixture.promptInput,
      clientRequestId: nextConformanceClientRequestId(),
      options: defaultOptions(fixture),
    });

    const started = await client.waitFor(() =>
      threadEvents(context, threadId).find(
        (event) => event.type === "turn/started",
      ),
    );
    const completed = await client.waitFor(() =>
      threadEvents(context, threadId).find(
        (event) => event.type === "turn/completed",
      ),
    );
    await client.waitForResponse(id);

    const title = "an accepted turn starts and settles";
    if (started === undefined || started === null) {
      results.push(
        fail("turn/lifecycle", title, "no turn/started thread/event arrived"),
      );
    } else if (completed === undefined || completed === null) {
      results.push(
        fail("turn/lifecycle", title, "turn never settled (no turn/completed)"),
      );
    } else {
      results.push(pass("turn/lifecycle", title));
    }

    // events/schema-valid: every thread/event notification for this thread
    // must parse; count the ones that did not.
    {
      client.drainIntoLog();
      const raw = client.notifications("thread/event");
      const invalid = raw.filter(
        (message) => !threadEventNotificationSchema.safeParse(message.params).success,
      );
      const title2 = "every thread/event payload is a valid ThreadEvent";
      results.push(
        invalid.length === 0
          ? pass("events/schema-valid", title2)
          : fail(
              "events/schema-valid",
              title2,
              `${invalid.length} thread/event notification(s) failed validation; first: ${JSON.stringify(invalid[0]?.params).slice(0, 400)}`,
            ),
      );
    }

    // item/opens-before-delta
    {
      const events = threadEvents(context, threadId);
      const openedItemIds = new Set<string>();
      let violation: string | undefined;
      for (const event of events) {
        if (event.type === "item/started") {
          openedItemIds.add(event.item.id);
        } else if (
          "itemId" in event &&
          typeof event.itemId === "string" &&
          event.type.startsWith("item/") &&
          event.type.endsWith("/delta")
        ) {
          if (!openedItemIds.has(event.itemId)) {
            violation = `${event.type} for item ${event.itemId} arrived before item/started`;
            break;
          }
        }
      }
      const title3 = "every item's first event is item/started";
      if (violation !== undefined) {
        results.push(fail("item/opens-before-delta", title3, violation));
      } else if (events.length === 0) {
        results.push(
          skipped("item/opens-before-delta", title3, "no events to inspect"),
        );
      } else {
        results.push(pass("item/opens-before-delta", title3));
      }
    }
  }

  // stop/release-not-interrupted
  if (context.providerThreadId === undefined) {
    results.push(
      skipped(
        "stop/release-not-interrupted",
        "a release stop never fabricates an interruption",
        startSkipDetail,
      ),
    );
  } else {
    const before = threadEvents(context, threadId).length;
    const id = client.request(BRIDGE_REQUEST_METHODS.threadStop, {
      threadId,
      providerThreadId: context.providerThreadId,
      intent: "release",
      activeTurnId: null,
    });
    const response = await client.waitForResponse(id);
    await client.settle(150);
    const after = threadEvents(context, threadId).slice(before);
    const fabricated = after.find(
      (event) =>
        event.type === "system/thread/interrupted" ||
        (event.type === "turn/completed" && event.status === "interrupted"),
    );
    const title = "a release stop never fabricates an interruption";
    if (response === null) {
      results.push(
        fail("stop/release-not-interrupted", title, "no response to thread/stop"),
      );
    } else if (response.error !== undefined) {
      results.push(
        fail(
          "stop/release-not-interrupted",
          title,
          `error: ${JSON.stringify(response.error)}`,
        ),
      );
    } else if (fabricated !== undefined) {
      results.push(
        fail(
          "stop/release-not-interrupted",
          title,
          `release emitted ${fabricated.type}`,
        ),
      );
    } else {
      results.push(pass("stop/release-not-interrupted", title));
    }
  }

  // session/resume-id-uniqueness
  if (context.providerThreadId === undefined) {
    results.push(
      skipped(
        "session/resume-id-uniqueness",
        "turn and item ids never repeat across a resume",
        startSkipDetail,
      ),
    );
  } else {
    const resumeId = client.request(BRIDGE_REQUEST_METHODS.threadResume, {
      threadId,
      cwd: fixture.cwd,
      providerThreadId: context.providerThreadId,
      options: defaultOptions(fixture),
      instructionMode: "append",
    });
    const resumeResponse = await client.waitForResponse(resumeId);
    const title = "turn and item ids never repeat across a resume";
    if (resumeResponse === null || resumeResponse.error !== undefined) {
      results.push(
        skipped(
          "session/resume-id-uniqueness",
          title,
          resumeResponse === null
            ? "thread/resume was not answered"
            : `thread/resume failed: ${JSON.stringify(resumeResponse.error)}`,
        ),
      );
    } else {
      const turnId = client.request(BRIDGE_REQUEST_METHODS.turnStart, {
        threadId,
        providerThreadId: context.providerThreadId,
        input: fixture.promptInput,
        clientRequestId: nextConformanceClientRequestId(),
        options: defaultOptions(fixture),
      });
      const secondCompleted = await client.waitFor(() => {
        const completions = threadEvents(context, threadId).filter(
          (event) => event.type === "turn/completed",
        );
        return completions.length >= 2 ? completions[1] : undefined;
      });
      await client.waitForResponse(turnId);

      if (secondCompleted === null) {
        results.push(
          fail(
            "session/resume-id-uniqueness",
            title,
            "the post-resume turn never settled",
          ),
        );
      } else {
        const events = threadEvents(context, threadId);
        const turnIds: string[] = [];
        const itemIds: string[] = [];
        for (const event of events) {
          if (event.type === "turn/started" && event.scope.kind === "turn") {
            turnIds.push(event.scope.turnId);
          }
          if (event.type === "item/started") {
            itemIds.push(event.item.id);
          }
        }
        const duplicateTurn = turnIds.find(
          (value, index) => turnIds.indexOf(value) !== index,
        );
        const duplicateItem = itemIds.find(
          (value, index) => itemIds.indexOf(value) !== index,
        );
        if (duplicateTurn !== undefined || duplicateItem !== undefined) {
          results.push(
            fail(
              "session/resume-id-uniqueness",
              title,
              duplicateTurn !== undefined
                ? `turn id reused across resume: ${duplicateTurn}`
                : `item id reused across resume: ${String(duplicateItem)}`,
            ),
          );
        } else if (turnIds.length < 2) {
          results.push(
            fail(
              "session/resume-id-uniqueness",
              title,
              `expected two turns, saw ${turnIds.length}`,
            ),
          );
        } else {
          results.push(pass("session/resume-id-uniqueness", title));
        }
      }
    }
  }
  return results;
}
