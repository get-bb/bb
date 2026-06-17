import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Force the inline-script write to fail so we can assert the create is atomic:
// because the script is written BEFORE the row is inserted, a write failure must
// leave NO automation row behind (no enabled, scheduled, script-less leftover).
const writeInlineAutomationScript = vi.fn();
vi.mock(import("../services/scheduling/automation-scripts.js"), async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    writeInlineAutomationScript: (...args: unknown[]) =>
      writeInlineAutomationScript(...args),
  };
});

const { createTestAppHarness } = await import("../../test/helpers/test-app.js");
const { seedHost, seedProjectWithSource } = await import(
  "../../test/helpers/seed.js"
);

type TestAppHarness = Awaited<ReturnType<typeof createTestAppHarness>>;

let harness: TestAppHarness;
let projectId: string;

beforeEach(async () => {
  harness = await createTestAppHarness();
  const host = seedHost(harness);
  projectId = seedProjectWithSource(harness, {
    hostId: host.id,
    name: "Project",
    path: "/tmp/bb-automations-atomicity",
  }).project.id;
  writeInlineAutomationScript.mockReset();
});

afterEach(async () => {
  await harness.cleanup();
  vi.restoreAllMocks();
});

describe("automations create atomicity", () => {
  it("leaves no automation row when the inline script write fails", async () => {
    writeInlineAutomationScript.mockRejectedValueOnce(new Error("disk full"));

    const res = await harness.app.request(
      `/api/v1/projects/${projectId}/automations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Watchdog",
          trigger: {
            triggerType: "schedule",
            cron: "0 9 * * *",
            timezone: "America/New_York",
          },
          execution: {
            mode: "script",
            script: "echo hi",
            interpreter: "bash",
          },
          environment: { type: "host", workspace: { type: "personal" } },
          origin: "agent",
        }),
      },
    );

    // The write failure surfaces as a 500 (not an ApiError), but crucially no
    // row was inserted: the script write happens before the single insert.
    expect(res.status).toBe(500);

    const listRes = await harness.app.request(
      `/api/v1/projects/${projectId}/automations`,
    );
    expect(await listRes.json()).toHaveLength(0);
  });
});
