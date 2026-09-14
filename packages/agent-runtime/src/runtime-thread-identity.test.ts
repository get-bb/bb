import type { ThreadEvent } from "@bb/domain";
import { turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  RuntimeThreadIdentityRegistry,
  stampThreadEventScope,
} from "./runtime-thread-identity.js";

describe("RuntimeThreadIdentityRegistry", () => {
  it("records provider ownership and resolves provider thread identities", () => {
    const registry = new RuntimeThreadIdentityRegistry();
    const providerState = registry.createProviderState({ providerId: "codex" });

    registry.registerThreadProvider({
      providerId: "codex",
      providerState,
      threadId: "thread-1",
    });
    registry.recordProviderThreadIdentity({
      providerState,
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
    });

    expect(registry.resolveProviderForThread("thread-1")).toBe("codex");
    expect(registry.getProviderThreadId("thread-1")).toBe("provider-thread-1");
    expect(
      registry.resolveBbThreadIdForProviderThread({
        providerState,
        providerThreadId: "provider-thread-1",
      }),
    ).toBe("thread-1");
  });

  it("resolves provider events by source, event thread id, provider-thread mapping, and single-thread fallback", () => {
    const registry = new RuntimeThreadIdentityRegistry();
    const providerState = registry.createProviderState({ providerId: "codex" });
    registry.registerThreadProvider({
      providerId: "codex",
      providerState,
      threadId: "thread-1",
    });
    registry.registerThreadProvider({
      providerId: "codex",
      providerState,
      threadId: "thread-2",
    });
    registry.recordProviderThreadIdentity({
      providerState,
      threadId: "thread-2",
      providerThreadId: "provider-thread-2",
    });

    expect(
      registry.resolveProviderEventThreadId({
        providerState,
        sourceThreadId: "thread-1",
        eventThreadId: "provider-thread-2",
      }),
    ).toBe("thread-1");
    expect(
      registry.resolveProviderEventThreadId({
        providerState,
        sourceThreadId: undefined,
        eventThreadId: "thread-2",
      }),
    ).toBe("thread-2");
    expect(
      registry.resolveProviderEventThreadId({
        providerState,
        sourceThreadId: "provider-thread-2",
        eventThreadId: undefined,
      }),
    ).toBe("thread-2");
    expect(
      registry.resolveProviderEventThreadId({
        providerState,
        sourceThreadId: undefined,
        eventThreadId: "unknown-provider-thread",
      }),
    ).toBeUndefined();

    const singleThreadState = registry.createProviderState({
      providerId: "claude-code",
    });
    registry.registerThreadProvider({
      providerId: "claude-code",
      providerState: singleThreadState,
      threadId: "thread-3",
    });
    expect(
      registry.resolveProviderEventThreadId({
        providerState: singleThreadState,
        sourceThreadId: undefined,
        eventThreadId: "unknown-provider-thread",
      }),
    ).toBe("thread-3");

    expect(
      registry.resolveProviderEventThreadId({
        providerState: singleThreadState,
        sourceThreadId: undefined,
        eventThreadId: "thread-1",
      }),
    ).toBeUndefined();
  });

  it("stamps projected events with the resolved bb thread id", () => {
    const event: ThreadEvent = {
      type: "turn/started",
      threadId: "provider-thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
    };

    expect(
      stampThreadEventScope({
        event,
        threadId: "thread-1",
        providerThreadId: "provider-thread-1",
      }),
    ).toEqual({
      type: "turn/started",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
    });
  });

  it("preserves an explicit checkpoint/session pair when the current session differs", () => {
    const event: ThreadEvent = {
      type: "turn/completed",
      threadId: "provider-source",
      providerThreadId: "provider-source",
      providerCheckpointId: "source-checkpoint",
      status: "completed",
      scope: turnScope("source-turn"),
    };
    expect(
      stampThreadEventScope({
        event,
        threadId: "source",
        providerThreadId: "provider-fork",
      }),
    ).toEqual({ ...event, threadId: "source" });
    expect(
      stampThreadEventScope({
        event: { ...event, providerThreadId: "" },
        threadId: "source",
        providerThreadId: "provider-source",
      }),
    ).toEqual({ ...event, threadId: "source" });
  });

  it("requires explicit ownership for identities even with one unresolved thread", () => {
    const registry = new RuntimeThreadIdentityRegistry();
    const providerState = registry.createProviderState({ providerId: "codex" });
    registry.registerThreadProvider({
      providerId: "codex",
      providerState,
      threadId: "source",
    });
    expect(
      registry.resolveProviderIdentityThreadId({
        providerState,
        eventThreadId: "unknown",
        sourceThreadId: undefined,
      }),
    ).toBeUndefined();
    expect(
      registry.resolveProviderIdentityThreadId({
        providerState,
        eventThreadId: "unstamped",
        sourceThreadId: "source",
      }),
    ).toBe("source");
    registry.recordProviderThreadIdentity({
      providerState,
      threadId: "source",
      providerThreadId: "provider-source",
    });
    expect(
      registry.resolveProviderIdentityThreadId({
        providerState,
        eventThreadId: "provider-source",
        sourceThreadId: undefined,
      }),
    ).toBe("source");
    registry.forgetThread({ providerState, threadId: "source" });
    registry.registerThreadProvider({
      providerId: "codex",
      providerState,
      threadId: "fork",
    });
    expect(
      registry.resolveProviderIdentityThreadId({
        providerState,
        eventThreadId: "provider-source",
        sourceThreadId: "source",
      }),
    ).toBeUndefined();
    expect(() =>
      registry.recordProviderThreadIdentity({
        providerState,
        threadId: "source",
        providerThreadId: "provider-source",
      }),
    ).toThrow("No provider associated");
  });
});
