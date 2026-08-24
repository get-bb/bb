import type { PendingInteraction } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { buildChildThreadBlockerSummary } from "../../src/internal/interactive-requests.js";

function interaction(
  payload: PendingInteraction["payload"],
  origin?: PendingInteraction["origin"],
): PendingInteraction {
  const base = {
    id: "pint_1",
    threadId: "thr_child",
    status: "pending" as const,
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
  };
  switch (payload.kind) {
    case "plugin":
      if (origin === undefined || origin.kind !== "plugin") {
        throw new Error("a plugin payload takes a plugin origin");
      }
      return { ...base, turnId: null, origin, payload, resolution: null };
    case "approval":
    case "user_question":
    default: {
      const provider = {
        ...base,
        turnId: "turn_1",
        providerId: "acp-cursor",
        providerThreadId: "pt_1",
        providerRequestId: "req_1",
        resolution: null,
      };
      return payload.kind === "approval"
        ? { ...provider, payload }
        : payload.kind === "user_question"
          ? { ...provider, payload }
          : { ...provider, payload };
    }
  }
}

describe("child-thread blocker summary", () => {
  it("names a provider's plugin-defined request by its plugin, with the title as the detail", () => {
    expect(
      buildChildThreadBlockerSummary(
        interaction({
          kind: "secrets/secret-request",
          title: "Add a token",
          data: { fields: ["TOKEN"] },
        }),
      ),
    ).toBe("Blocked on secrets request:\nAdd a token");
  });

  it("names a plugin's own request the same way", () => {
    expect(
      buildChildThreadBlockerSummary(
        interaction(
          { kind: "plugin", title: "Add secrets", data: { fields: ["KEY"] } },
          { kind: "plugin", pluginId: "secrets", rendererId: "secret-request" },
        ),
      ),
    ).toBe("Blocked on plugin request:\nAdd secrets");
  });

  it("keeps the approval detail lines as the summary body", () => {
    expect(
      buildChildThreadBlockerSummary(
        interaction({
          kind: "approval",
          reason: null,
          availableDecisions: ["allow_once", "deny"],
          subject: {
            kind: "command",
            itemId: "item_1",
            command: "git push",
            cwd: "/tmp/project",
            actions: [],
            sessionGrant: null,
          },
        }),
      ),
    ).toBe(
      "Blocked on command approval:\nCommand: git push\nCwd: /tmp/project",
    );
  });
});
