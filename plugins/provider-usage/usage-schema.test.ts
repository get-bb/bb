import { describe, expect, it } from "vitest";
import {
  selectUsageMachine,
  providerUsageTone,
  type UsageProvider,
  type UsageMachine,
} from "./usage-schema.js";

function provider(
  id: string,
  displayName: string,
  usedPercent: number,
): UsageProvider {
  return {
    id,
    providerId: id,
    accountLabel: null,
    displayName,
    logoUrl: null,
    icon: null,
    strings: { iconTint: null },
    signInHint: "Sign in.",
    expiredHint: "Sign in again.",
    usage: {
      status: "ok",
      accountEmail: null,
      planLabel: null,
      windows: [
        {
          label: "Five-hour limit",
          usedPercent,
          resetsAt: null,
          cost: null,
        },
      ],
    },
  };
}

describe("usage warning state", () => {
  it("distinguishes normal, warning, and critical usage", () => {
    const low = provider("codex", "Codex", 79);
    const warning = provider("codex", "Codex", 80);
    const critical = provider("codex", "Codex", 95);

    expect(providerUsageTone(low)).toBeNull();
    expect(providerUsageTone(warning)).toBe("warning");
    expect(providerUsageTone(critical)).toBe("critical");
  });
});

describe("default usage source", () => {
  const machine: UsageMachine = {
    id: "host-one",
    displayName: "My machine",
    status: "connected",
    providers: [],
    error: null,
  };
  const pool: UsageMachine = {
    ...machine,
    id: "source:account-pool",
    displayName: "Account Pooler",
  };
  it("prefers even an empty pool to thread-local usage, while preserving explicit selection", () => {
    expect(selectUsageMachine([machine, pool], null, machine.id)).toBe(pool);
    expect(selectUsageMachine([machine, pool], machine.id, null)).toBe(machine);
    expect(selectUsageMachine([machine], pool.id, machine.id)).toBe(machine);
    expect(
      selectUsageMachine(
        [machine, { ...pool, error: "Unavailable" }],
        null,
        machine.id,
      ),
    ).toBe(machine);
  });
});
