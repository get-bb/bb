import { describe, expect, it, vi } from "vitest";
import { handleCockpitMcpRequest } from "../../commands/cockpit-mcp.js";
import { encodeCockpitOwnerRef } from "@bb/domain";
import type { BbSdk } from "@bb/sdk";

function fakeSdk(overrides?: {
  discover?: () => Promise<unknown>;
  act?: () => Promise<unknown>;
}): BbSdk {
  return {
    cockpit: {
      discover: overrides?.discover ?? (async () => ({ hostId: null, agents: [], sessions: [], attentionItems: [] })),
      act: overrides?.act ?? (async () => ({})),
    },
  } as unknown as BbSdk;
}

describe("bb cockpit mcp", () => {
  it("lists cockpit_discover and cockpit_act", async () => {
    const response = await handleCockpitMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      fakeSdk(),
    );
    expect(response).toMatchObject({
      result: {
        tools: [
          { name: "cockpit_discover" },
          { name: "cockpit_act" },
        ],
      },
    });
  });

  it("executes cockpit_act through the shared SDK contract", async () => {
    const ownerRef = encodeCockpitOwnerRef({
      t: "session",
      i: "thr_running",
      h: "host-a",
    });
    const act = vi.fn(async () => ({
      receiptId: "receipt-1",
      ownerRef,
      hostId: "host-a",
      action: { kind: "pause" },
      outcome: "accepted",
      effectClass: "reversible_write",
      confirmationClass: "none",
      recoveryOwner: "bb-server",
      idempotencyKey: "pause-1",
      createdAt: 1,
      error: null,
    }));
    const response = await handleCockpitMcpRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "cockpit_act",
          arguments: {
            ownerRef,
            action: { kind: "pause" },
            idempotencyKey: "pause-1",
            hostId: "host-a",
            confirmation: "none",
          },
        },
      },
      fakeSdk({ act }),
    );
    expect(act).toHaveBeenCalledWith({
      ownerRef,
      action: { kind: "pause" },
      idempotencyKey: "pause-1",
      hostId: "host-a",
      confirmation: "none",
    });
    expect(response).toMatchObject({
      id: 2,
      result: {
        content: [{ type: "text" }],
      },
    });
  });
});
