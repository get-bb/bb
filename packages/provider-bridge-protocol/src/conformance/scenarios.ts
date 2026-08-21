import type { PromptInput, ThreadEvent } from "@bb/domain";
import { threadEventSchema } from "@bb/domain";
import { z } from "zod";
import {
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_REQUEST_METHODS,
  initializeResultSchema,
  negotiateGrammarVersion,
  threadIdentityResultSchema,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  ThreadEventGrammar,
  THREAD_EVENT_GRAMMAR_RULES,
} from "../index.js";
import { ASSEMBLER_GRAMMAR_VERSIONS } from "../assembler/delta-assembler.js";
import {
  ConformanceClient,
  nextConformanceClientRequestId,
  type JsonRpcWireMessage,
} from "./client.js";
import { CONFORMANCE_ASSEMBLED_EVENT_METHOD } from "./types.js";
import type { ConformanceCheckResult } from "./types.js";

/** Params of the kit-internal assembled-event lane (see types.ts). */
const assembledEventNotificationSchema = z
  .object({ threadId: z.string().min(1), event: threadEventSchema })
  .passthrough();

export interface ConformanceSessionFixture {
  /** Workspace directory for the session under test. */
  cwd: string;
  /** Prompt expected to elicit at least one assistant-message item. */
  promptInput: PromptInput[];
  /**
   * A prompt this provider accepts and completes locally, without producing
   * any of the activity that opens a bb turn — Claude Code's `/clear` is the
   * canonical example (#1431). Opting in enables
   * `turn/settles-without-activity`.
   *
   * The kit cannot elicit this shape generically: only the bridge knows what
   * its provider handles as zero work. A fixture that omits it produces no
   * result for that rule rather than a skip, so bridges that have not opted in
   * keep a fully green report.
   */
  zeroWorkPromptInput?: PromptInput[];
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

function fail(
  id: string,
  title: string,
  detail: string,
): ConformanceCheckResult {
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
      permissionEscalation: null,
    }
  );
}

function threadEvents(
  context: ScenarioContext,
  threadId: string,
): ThreadEvent[] {
  context.client.drainIntoLog();
  const events: ThreadEvent[] = [];
  for (const message of context.client.notifications(
    CONFORMANCE_ASSEMBLED_EVENT_METHOD,
  )) {
    const parsed = assembledEventNotificationSchema.safeParse(message.params);
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

const ITEM_OPENS_BEFORE_DELTA_TITLE =
  "every item's first event is item/started";

/**
 * item/opens-before-delta: no event may stream into an item id that no
 * item/started has opened yet. Pure over an event log so it is unit-testable
 * without a live bridge — the streaming grammar machine the host runs live,
 * fed a recording and filtered to this one rule.
 */
export function checkItemOpensBeforeDelta(
  events: ThreadEvent[],
): ConformanceCheckResult {
  const grammar = new ThreadEventGrammar();
  for (const event of events) {
    const result = grammar.observe(event);
    if (
      result.kind === "violation" &&
      result.rule === THREAD_EVENT_GRAMMAR_RULES.itemOpensBeforeDelta
    ) {
      return fail(
        THREAD_EVENT_GRAMMAR_RULES.itemOpensBeforeDelta,
        ITEM_OPENS_BEFORE_DELTA_TITLE,
        result.reason,
      );
    }
  }
  if (events.length === 0) {
    return skipped(
      "item/opens-before-delta",
      ITEM_OPENS_BEFORE_DELTA_TITLE,
      "no events to inspect",
    );
  }
  return pass("item/opens-before-delta", ITEM_OPENS_BEFORE_DELTA_TITLE);
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
    } else if (
      errorCode(response) === BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND
    ) {
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
    grammarVersions: ASSEMBLER_GRAMMAR_VERSIONS,
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
          .join(
            "; ",
          )} (got ${JSON.stringify(response.result ?? response.error)})`,
      ),
    ];
  }
  // The runtime rejects a mismatched handshake at spawn (the version gates
  // the timeline dialect), so a bridge that answers with another version
  // would never get real traffic — surface that here, before a live run.
  if (parsed.data.protocolVersion !== PROVIDER_BRIDGE_PROTOCOL_VERSION) {
    return [
      fail(
        "handshake/initialize",
        title,
        `bridge answered protocol version ${parsed.data.protocolVersion}; this kit (and the runtime) require ${PROVIDER_BRIDGE_PROTOCOL_VERSION}`,
      ),
    ];
  }
  // The same gate for the delta grammar: the runtime refuses a bridge whose
  // range shares no version with its assembler's, and a bridge that omits
  // the field reads as the grammar its protocol version shipped with.
  const [bridgeMin, bridgeMax] = parsed.data.capabilities.grammarVersions;
  if (
    negotiateGrammarVersion(
      ASSEMBLER_GRAMMAR_VERSIONS,
      parsed.data.capabilities.grammarVersions,
    ) === null
  ) {
    const [runtimeMin, runtimeMax] = ASSEMBLER_GRAMMAR_VERSIONS;
    return [
      fail(
        "handshake/initialize",
        title,
        `bridge reported grammarVersions [${bridgeMin}, ${bridgeMax}]; the runtime's assembler speaks [${runtimeMin}, ${runtimeMax}], so the handshake would be refused`,
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
      skipped(
        "turn/lifecycle",
        "an accepted turn starts and settles",
        startSkipDetail,
      ),
      skipped(
        "events/schema-valid",
        "every assembled event is a valid ThreadEvent",
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
        fail("turn/lifecycle", title, "no turn/started event arrived"),
      );
    } else if (completed === undefined || completed === null) {
      results.push(
        fail("turn/lifecycle", title, "turn never settled (no turn/completed)"),
      );
    } else {
      results.push(pass("turn/lifecycle", title));
    }

    // events/schema-valid: every assembled-event notification for this
    // thread must parse; count the ones that did not.
    {
      client.drainIntoLog();
      const raw = client.notifications(CONFORMANCE_ASSEMBLED_EVENT_METHOD);
      const invalid = raw.filter(
        (message) =>
          !assembledEventNotificationSchema.safeParse(message.params).success,
      );
      const title2 = "every assembled event is a valid ThreadEvent";
      results.push(
        invalid.length === 0
          ? pass("events/schema-valid", title2)
          : fail(
              "events/schema-valid",
              title2,
              `${invalid.length} assembled event notification(s) failed validation; first: ${JSON.stringify(invalid[0]?.params).slice(0, 400)}`,
            ),
      );
    }

    // item/opens-before-delta
    results.push(checkItemOpensBeforeDelta(threadEvents(context, threadId)));
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
        fail(
          "stop/release-not-interrupted",
          title,
          "no response to thread/stop",
        ),
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

  results.push(...(await runZeroWorkTurnScenario(context, threadId)));

  return results;
}

const SETTLES_WITHOUT_ACTIVITY_ID = "turn/settles-without-activity";
const SETTLES_WITHOUT_ACTIVITY_TITLE =
  "a turn the provider completes without activity still settles";

/**
 * turn/settles-without-activity: a provider may accept a prompt and finish it
 * without emitting any of the ordinary activity that opens a bb turn — Claude
 * Code answers `/clear` locally with a bare success result (#1431). The turn
 * must still reach a terminal `turn/completed`. Without one the thread stays
 * active forever: `bb thread wait --status idle` hangs and accepted input
 * queued behind the abandoned turn never drains.
 *
 * Runs last so the turn it adds cannot perturb the ordinal expectations of the
 * lifecycle scenarios, and only when the fixture names a zero-work prompt.
 */
async function runZeroWorkTurnScenario(
  context: ScenarioContext,
  threadId: string,
): Promise<ConformanceCheckResult[]> {
  const { client, fixture } = context;
  const zeroWorkPromptInput = fixture.zeroWorkPromptInput;
  if (zeroWorkPromptInput === undefined) {
    return [];
  }
  if (context.providerThreadId === undefined) {
    return [
      skipped(
        SETTLES_WITHOUT_ACTIVITY_ID,
        SETTLES_WITHOUT_ACTIVITY_TITLE,
        "prerequisite session/start-identity failed",
      ),
    ];
  }

  const before = threadEvents(context, threadId).filter(
    (event) => event.type === "turn/completed",
  ).length;
  const id = client.request(BRIDGE_REQUEST_METHODS.turnStart, {
    threadId,
    providerThreadId: context.providerThreadId,
    input: zeroWorkPromptInput,
    clientRequestId: nextConformanceClientRequestId(),
    options: defaultOptions(fixture),
  });
  const settled = await client.waitFor(() => {
    const completions = threadEvents(context, threadId).filter(
      (event) => event.type === "turn/completed",
    );
    return completions.length > before ? completions[before] : undefined;
  });
  const response = await client.waitForResponse(id);

  if (response !== null && response.error !== undefined) {
    // A bridge is free to reject the prompt outright; what it may not do is
    // accept it and then never settle.
    return [
      skipped(
        SETTLES_WITHOUT_ACTIVITY_ID,
        SETTLES_WITHOUT_ACTIVITY_TITLE,
        `the zero-work prompt was rejected: ${JSON.stringify(response.error)}`,
      ),
    ];
  }
  if (settled === null) {
    return [
      fail(
        SETTLES_WITHOUT_ACTIVITY_ID,
        SETTLES_WITHOUT_ACTIVITY_TITLE,
        "the accepted zero-work turn never emitted a terminal turn/completed",
      ),
    ];
  }
  return [pass(SETTLES_WITHOUT_ACTIVITY_ID, SETTLES_WITHOUT_ACTIVITY_TITLE)];
}
