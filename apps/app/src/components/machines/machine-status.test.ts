import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  machinePhaseLabel,
  machineStatusLabel,
  machineStatusTone,
} from "./machine-status";

describe("resuming machine status", () => {
  const host = makeHost({
    status: "connected",
    lifecycle: {
      phase: "resuming",
      suspendedAt: 1,
      message: "Restoring compute",
      pendingLog: "",
      teardown: null,
    },
  });

  it("keeps lifecycle status ahead of the transport connection", () => {
    expect(machinePhaseLabel(host.lifecycle)).toBe("Resuming");
    expect(machineStatusLabel({ host, now: 2 })).toBe(
      "Resuming · Restoring compute",
    );
    expect(machineStatusTone(host)).toBe("attention");
  });
});
