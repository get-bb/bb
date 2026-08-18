import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKFLOW_SETTINGS,
  WORKFLOW_SETTING_DESCRIPTORS,
  parseWorkflowSettings,
  parseStoredWorkflowSettings,
  registerWorkflowSettings,
  type WorkflowSettings,
} from "./settings.js";

function rawSettings(
  overrides: Partial<Record<keyof WorkflowSettings, string>> = {},
) {
  return {
    maxActiveRuns: "4",
    maxConcurrentAgents: "8",
    maxAgentCalls: "100",
    totalRunTimeoutMs: "86400000",
    retentionDays: "30",
    maxNotificationBytes: "16384",
    ...overrides,
  };
}

describe("workflow settings policy", () => {
  it("keeps descriptor defaults and immutable internal defaults aligned", () => {
    const descriptorDefaults = {
      maxActiveRuns: WORKFLOW_SETTING_DESCRIPTORS.maxActiveRuns.default,
      maxConcurrentAgents:
        WORKFLOW_SETTING_DESCRIPTORS.maxConcurrentAgents.default,
      maxAgentCalls: WORKFLOW_SETTING_DESCRIPTORS.maxAgentCalls.default,
      totalRunTimeoutMs: WORKFLOW_SETTING_DESCRIPTORS.totalRunTimeoutMs.default,
      retentionDays: WORKFLOW_SETTING_DESCRIPTORS.retentionDays.default,
      maxNotificationBytes:
        WORKFLOW_SETTING_DESCRIPTORS.maxNotificationBytes.default,
    };

    expect(parseWorkflowSettings(descriptorDefaults)).toEqual(
      DEFAULT_WORKFLOW_SETTINGS,
    );
    expect(Object.isFrozen(DEFAULT_WORKFLOW_SETTINGS)).toBe(true);
  });

  it("parses every custom value and deliberately trims surrounding whitespace", () => {
    const parsed = parseWorkflowSettings({
      maxActiveRuns: "  12\t",
      maxConcurrentAgents: "16",
      maxAgentCalls: "750",
      totalRunTimeoutMs: "172800000",
      retentionDays: "90",
      maxNotificationBytes: "65536",
    });

    expect(parsed).toEqual({
      maxActiveRuns: 12,
      maxConcurrentAgents: 16,
      maxAgentCalls: 750,
      totalRunTimeoutMs: 172_800_000,
      retentionDays: 90,
      maxNotificationBytes: 65_536,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", " \t\n"],
    ["exponent", "1e2"],
    ["hexadecimal", "0x10"],
    ["fractional", "4.5"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["signed", "+4"],
    ["negative", "-4"],
    ["unknown text", "many"],
  ])("rejects %s numeric syntax", (_category, value) => {
    expect(() =>
      parseWorkflowSettings(rawSettings({ maxActiveRuns: value })),
    ).toThrow(/Maximum active runs.*base-10 integer.*1 through 32/);
  });

  it("rejects a digit-only integer too large to be finite", () => {
    expect(() =>
      parseWorkflowSettings(rawSettings({ maxActiveRuns: "9".repeat(400) })),
    ).toThrow(/Maximum active runs.*finite base-10 integer/);
  });

  it.each([
    ["maxActiveRuns", "0", "33", "Maximum active runs"],
    ["maxConcurrentAgents", "0", "65", "Per-run agent concurrency"],
    ["maxAgentCalls", "0", "1001", "Maximum agent calls"],
    ["totalRunTimeoutMs", "59999", "604800001", "Total run timeout"],
    ["retentionDays", "0", "3651", "Retention days"],
    ["maxNotificationBytes", "1023", "262145", "Maximum notification bytes"],
  ] as const)(
    "enforces lower and upper bounds for %s",
    (key, below, above, label) => {
      expect(() =>
        parseWorkflowSettings(rawSettings({ [key]: below })),
      ).toThrow(new RegExp(label));
      expect(() =>
        parseWorkflowSettings(rawSettings({ [key]: above })),
      ).toThrow(new RegExp(label));
    },
  );

  it("registers descriptors and returns parsed fake-host values", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "workflows",
      settings: {
        maxActiveRuns: " 6 ",
        maxAgentCalls: "250",
      },
    });
    const settings = registerWorkflowSettings(bb);

    expect(harness.registrations.settingsDescriptors).toEqual(
      WORKFLOW_SETTING_DESCRIPTORS,
    );
    await expect(settings.get()).resolves.toEqual({
      ...DEFAULT_WORKFLOW_SETTINGS,
      maxActiveRuns: 6,
      maxAgentCalls: 250,
    });

    const changes: Array<{
      next: WorkflowSettings;
      previous: WorkflowSettings;
    }> = [];
    settings.onChange((next, previous) => changes.push({ next, previous }));
    await harness.setSettings({ maxConcurrentAgents: "12" });

    expect(changes).toHaveLength(1);
    expect(changes[0]?.previous.maxConcurrentAgents).toBe(8);
    expect(changes[0]?.next.maxConcurrentAgents).toBe(12);
  });

  it("surfaces a field-specific error for an invalid fake-host value", async () => {
    const { bb } = createFakePluginHost({
      pluginId: "workflows",
      settings: { retentionDays: "forever" },
    });

    await expect(registerWorkflowSettings(bb).get()).rejects.toThrow(
      /Retention days.*base-10 integer.*1 through 3650/,
    );
  });

  it("accepts a valid update after replacing invalid persisted settings", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "workflows",
      settings: { retentionDays: "forever" },
    });
    const settings = registerWorkflowSettings(bb);
    await expect(settings.get()).rejects.toThrow("Retention days");
    const changes: WorkflowSettings[] = [];
    const errors: string[] = [];
    settings.onChange(
      (next) => changes.push(next),
      (error) => errors.push(error.message),
    );

    await harness.setSettings({ maxActiveRuns: "0" });
    expect(errors.at(-1)).toContain("Maximum active runs");
    await harness.setSettings({ retentionDays: "14", maxActiveRuns: "6" });
    expect(changes.at(-1)).toMatchObject({
      retentionDays: 14,
      maxActiveRuns: 6,
    });
  });

  it("round-trips current snapshots and tolerates the removed stall timeout", () => {
    expect(parseStoredWorkflowSettings(DEFAULT_WORKFLOW_SETTINGS)).toEqual(
      DEFAULT_WORKFLOW_SETTINGS,
    );
    expect(
      parseStoredWorkflowSettings({
        ...DEFAULT_WORKFLOW_SETTINGS,
        workerStallTimeoutMs: 1_800_000,
      }),
    ).toEqual(DEFAULT_WORKFLOW_SETTINGS);
    expect(() => parseStoredWorkflowSettings({ maxActiveRuns: 4 })).toThrow(
      "unexpected fields",
    );
    expect(() =>
      parseStoredWorkflowSettings({
        ...DEFAULT_WORKFLOW_SETTINGS,
        unknownPolicy: 1,
      }),
    ).toThrow("unexpected fields");
  });
});
