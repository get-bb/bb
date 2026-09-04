import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogPayloads,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerCockpitCommands } from "../../commands/cockpit.js";
import { encodeCockpitOwnerRef } from "@bb/domain";

describe("bb cockpit command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerCockpitCommands(program, () => "http://server");

  it("bb cockpit discover prints sessions from the shared contract", async () => {
    const ownerRef = encodeCockpitOwnerRef({
      t: "session",
      i: "thr_running",
      h: "host-a",
    });
    const discover = vi.fn(async () => ({
      hostId: null,
      agents: [
        {
          ownerRef,
          displayName: "Running agent",
          providerId: "codex",
          hostId: "host-a",
          status: "running",
          supportedActions: ["steer", "pause", "take_over"],
        },
      ],
      sessions: [
        {
          ownerRef,
          agentOwnerRef: ownerRef,
          displayName: "Running agent",
          providerId: "codex",
          hostId: "host-a",
          status: "running",
          supportedActions: ["steer", "pause", "take_over"],
        },
      ],
      attentionItems: [],
    }));
    stubServerApi({ "v1.cockpit.$get": discover });

    await runCommand(["cockpit", "discover"], register);

    expect(discover).toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "Running agent",
    );
  });

  it("bb cockpit act sends the shared action request", async () => {
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
    stubServerApi({ "v1.cockpit.actions.$post": act });

    await runCommand(
      [
        "cockpit",
        "act",
        "--owner-ref",
        ownerRef,
        "--action",
        "pause",
        "--idempotency-key",
        "pause-1",
        "--host",
        "host-a",
        "--json",
      ],
      register,
    );

    expect(act).toHaveBeenCalledWith({
      json: {
        ownerRef,
        action: { kind: "pause" },
        idempotencyKey: "pause-1",
        hostId: "host-a",
        confirmation: "none",
      },
    });
  });
});
