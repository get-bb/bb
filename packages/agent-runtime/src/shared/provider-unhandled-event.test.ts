import { describe, expect, it } from "vitest";
import { createUnhandledProviderEvent } from "./provider-unhandled-event.js";

describe("provider unhandled events", () => {
  it("does not throw when raw event params are not JSON-serializable", () => {
    const event = createUnhandledProviderEvent({
      providerId: "test-provider",
      rawType: "sdk/custom",
      rawEvent: {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "thread-1",
          nested: {
            unsupported: undefined,
          },
        },
      },
    });

    expect(event).toMatchObject({
      type: "provider/unhandled",
      threadId: "thread-1",
      providerId: "test-provider",
      rawType: "sdk/custom",
      rawEvent: {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          serializationError:
            "Provider raw event params were not JSON-serializable.",
        },
      },
    });
  });

  it("scopes to the turn the caller supplies", () => {
    const event = createUnhandledProviderEvent({
      providerId: "codex",
      rawType: "sdk/custom",
      turnId: "turn_bb_owned",
      rawEvent: {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: { threadId: "thread-1" },
      },
    });

    expect(event.scope).toEqual({ kind: "turn", turnId: "turn_bb_owned" });
  });

  it("ignores a provider-supplied turn id the caller did not vouch for", () => {
    // Codex labels its automatic-compaction traffic with a `turnId` of its own
    // making ("auto-compact-1"). bb never started that turn, so scoping to it
    // produces an event the server can never store: it rejects the whole batch
    // with 409 MissingStoredTurnStartedError, and the daemon then retries that
    // same batch forever, wedging every thread on the host.
    const event = createUnhandledProviderEvent({
      providerId: "codex",
      rawType: "sdk/custom",
      rawEvent: {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: { threadId: "thread-1", turnId: "auto-compact-1" },
      },
    });

    expect(event.scope).toEqual({ kind: "thread" });
  });
});
