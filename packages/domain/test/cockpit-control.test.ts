import { describe, expect, it } from "vitest";
import {
  cockpitActionRequestSchema,
  cockpitDiscoverySchema,
  cockpitReceiptSchema,
  createCockpitControl,
  createMemoryCockpitReceiptStore,
  encodeCockpitOwnerRef,
  type CockpitActionRequest,
  type CockpitControlPorts,
  type CockpitInventory,
  type CockpitInventoryAttention,
  type CockpitInventorySession,
  type CockpitUserAnswer,
} from "../src/index.js";

function session(overrides?: Partial<CockpitInventorySession>): CockpitInventorySession {
  return {
    id: "thr_running",
    hostId: "host-a",
    displayName: "Running agent",
    providerId: "codex",
    status: "running",
    ...overrides,
  };
}

function attention(
  overrides?: Partial<CockpitInventoryAttention>,
): CockpitInventoryAttention {
  return {
    id: "pint_approve1",
    sessionId: "thr_running",
    hostId: "host-a",
    attentionKind: "approval",
    expiresAt: null,
    ...overrides,
  };
}

function createHarness(initial?: Partial<CockpitInventory>) {
  const inventory: {
    sessions: CockpitInventorySession[];
    attentionItems: CockpitInventoryAttention[];
  } = {
    sessions: initial?.sessions ? [...initial.sessions] : [session()],
    attentionItems: initial?.attentionItems
      ? [...initial.attentionItems]
      : [attention()],
  };
  const effects: string[] = [];
  let receiptCount = 0;
  const ports: CockpitControlPorts = {
    now: () => 1_700_000_000_000,
    createReceiptId: () => {
      receiptCount += 1;
      return `receipt-${receiptCount}`;
    },
    receipts: createMemoryCockpitReceiptStore(),
    listInventory: () => inventory,
    async pause(sessionId) {
      effects.push(`pause:${sessionId}`);
      const current = inventory.sessions.find((entry) => entry.id === sessionId);
      if (current) current.status = "paused";
    },
    async resume(sessionId) {
      effects.push(`resume:${sessionId}`);
      const current = inventory.sessions.find((entry) => entry.id === sessionId);
      if (current) current.status = "running";
    },
    async steer(sessionId, message) {
      effects.push(`steer:${sessionId}:${message}`);
    },
    async takeOver(sessionId) {
      effects.push(`take_over:${sessionId}`);
      const current = inventory.sessions.find((entry) => entry.id === sessionId);
      if (current) current.status = "paused";
    },
    async approve(attentionId) {
      effects.push(`approve:${attentionId}`);
      inventory.attentionItems = inventory.attentionItems.filter(
        (entry) => entry.id !== attentionId,
      );
    },
    async deny(attentionId) {
      effects.push(`deny:${attentionId}`);
      inventory.attentionItems = inventory.attentionItems.filter(
        (entry) => entry.id !== attentionId,
      );
    },
    async answer(
      attentionId: string,
      answers: Record<string, CockpitUserAnswer>,
    ) {
      effects.push(`answer:${attentionId}:${JSON.stringify(answers)}`);
      inventory.attentionItems = inventory.attentionItems.filter(
        (entry) => entry.id !== attentionId,
      );
    },
  };
  return {
    control: createCockpitControl(ports),
    effects,
    inventory,
  };
}

function sessionRef(id = "thr_running", hostId = "host-a"): string {
  return encodeCockpitOwnerRef({ t: "session", i: id, h: hostId });
}

function attentionRef(id = "pint_approve1", hostId = "host-a"): string {
  return encodeCockpitOwnerRef({ t: "attention", i: id, h: hostId });
}

function request(
  overrides: Partial<CockpitActionRequest> &
    Pick<CockpitActionRequest, "action" | "idempotencyKey">,
): CockpitActionRequest {
  return cockpitActionRequestSchema.parse({
    ownerRef: sessionRef(),
    hostId: "host-a",
    confirmation: "none",
    ...overrides,
  });
}

describe("cockpit-control contract", () => {
  it("discovers agents, sessions, and attention with owner-supported actions", async () => {
    const { control } = createHarness();
    const discovery = cockpitDiscoverySchema.parse(
      await control.discover({ hostId: null }),
    );
    expect(discovery.agents).toHaveLength(1);
    expect(discovery.sessions).toHaveLength(1);
    expect(discovery.attentionItems).toHaveLength(1);
    expect(discovery.agents[0]?.supportedActions).toEqual([
      "steer",
      "pause",
      "take_over",
    ]);
    expect(discovery.attentionItems[0]?.supportedActions).toEqual([
      "approve",
      "deny",
    ]);
    expect(discovery.sessions[0]?.ownerRef).toBe(sessionRef());
  });

  it("pauses and resumes as a reversible write", async () => {
    const { control, effects } = createHarness();
    const pause = cockpitReceiptSchema.parse(
      await control.act(
        request({ action: { kind: "pause" }, idempotencyKey: "pause-1" }),
      ),
    );
    expect(pause.outcome).toBe("accepted");
    expect(pause.effectClass).toBe("reversible_write");
    const resume = cockpitReceiptSchema.parse(
      await control.act(
        request({ action: { kind: "resume" }, idempotencyKey: "resume-1" }),
      ),
    );
    expect(resume.outcome).toBe("accepted");
    expect(effects).toEqual(["pause:thr_running", "resume:thr_running"]);
  });

  it("approves an attention item", async () => {
    const { control, effects, inventory } = createHarness();
    const receipt = await control.act(
      request({
        ownerRef: attentionRef(),
        action: { kind: "approve" },
        idempotencyKey: "approve-1",
      }),
    );
    expect(receipt.outcome).toBe("accepted");
    expect(receipt.effectClass).toBe("approval");
    expect(effects).toEqual(["approve:pint_approve1"]);
    expect(inventory.attentionItems).toEqual([]);
  });

  it("replays an idempotency key without repeating the effect", async () => {
    const { control, effects } = createHarness();
    const first = await control.act(
      request({ action: { kind: "pause" }, idempotencyKey: "same" }),
    );
    const second = await control.act(
      request({ action: { kind: "pause" }, idempotencyKey: "same" }),
    );
    expect(first.outcome).toBe("accepted");
    expect(second.outcome).toBe("replayed");
    expect(second.receiptId).toBe(first.receiptId);
    expect(effects).toEqual(["pause:thr_running"]);
  });

  it("fails closed for unsupported, expired, unauthorized, and wrong-host actions", async () => {
    const { control } = createHarness({
      attentionItems: [
        attention({ id: "pint_old", expiresAt: 1 }),
        attention({
          id: "pint_question",
          attentionKind: "question",
          expiresAt: null,
        }),
      ],
    });

    const unsupported = await control.act(
      request({
        ownerRef: attentionRef("pint_question"),
        action: { kind: "approve" },
        idempotencyKey: "unsupported",
      }),
    );
    expect(unsupported.outcome).toBe("rejected");
    expect(unsupported.error?.code).toBe("unsupported");

    const expired = await control.act(
      request({
        ownerRef: attentionRef("pint_old"),
        action: { kind: "approve" },
        idempotencyKey: "expired",
      }),
    );
    expect(expired.outcome).toBe("rejected");
    expect(expired.error?.code).toBe("expired");

    const unauthorized = await control.act(
      request({
        ownerRef: "not-a-handle",
        action: { kind: "pause" },
        idempotencyKey: "unauthorized",
      }),
    );
    expect(unauthorized.outcome).toBe("rejected");
    expect(unauthorized.error?.code).toBe("unauthorized");
    const unauthorizedReplay = await control.act(
      request({
        ownerRef: "not-a-handle",
        action: { kind: "pause" },
        idempotencyKey: "unauthorized",
      }),
    );
    expect(unauthorizedReplay.outcome).toBe("replayed");

    const wrongHost = await control.act(
      request({
        hostId: "host-b",
        action: { kind: "pause" },
        idempotencyKey: "wrong-host",
      }),
    );
    expect(wrongHost.outcome).toBe("rejected");
    expect(wrongHost.error?.code).toBe("wrong_host");
  });

  it("keeps MFA and attestation as human gates", async () => {
    const { control, effects } = createHarness();
    const receipt = await control.act(
      request({
        action: { kind: "mfa" },
        idempotencyKey: "mfa-1",
      }),
    );
    expect(receipt.outcome).toBe("rejected");
    expect(receipt.error?.code).toBe("human_gate");
    expect(receipt.confirmationClass).toBe("human_gate");
    expect(effects).toEqual([]);
  });

  it("produces the same receipt through API, CLI, and MCP request fixtures", async () => {
    const { control } = createHarness();
    const ownerRef = sessionRef();
    const apiBody = {
      ownerRef,
      hostId: "host-a",
      confirmation: "none",
      idempotencyKey: "shared-1",
      action: { kind: "pause" },
    };
    const cliFlags = {
      ownerRef,
      host: "host-a",
      confirm: "none",
      idempotencyKey: "shared-1",
      action: "pause",
    };
    const mcpArgs = {
      owner_ref: ownerRef,
      host_id: "host-a",
      confirmation: "none",
      idempotency_key: "shared-1",
      action: { kind: "pause" },
    };

    const fromApi = cockpitActionRequestSchema.parse(apiBody);
    const fromCli = cockpitActionRequestSchema.parse({
      ownerRef: cliFlags.ownerRef,
      hostId: cliFlags.host,
      confirmation: cliFlags.confirm,
      idempotencyKey: cliFlags.idempotencyKey,
      action: { kind: cliFlags.action },
    });
    const fromMcp = cockpitActionRequestSchema.parse({
      ownerRef: mcpArgs.owner_ref,
      hostId: mcpArgs.host_id,
      confirmation: mcpArgs.confirmation,
      idempotencyKey: mcpArgs.idempotency_key,
      action: mcpArgs.action,
    });
    expect(fromCli).toEqual(fromApi);
    expect(fromMcp).toEqual(fromApi);

    const apiReceipt = await control.act(fromApi);
    const cliReceipt = await control.act(fromCli);
    const mcpReceipt = await control.act(fromMcp);
    expect(cliReceipt.receiptId).toBe(apiReceipt.receiptId);
    expect(mcpReceipt.receiptId).toBe(apiReceipt.receiptId);
    expect(cliReceipt.outcome).toBe("replayed");
    expect(mcpReceipt.outcome).toBe("replayed");
  });
});
