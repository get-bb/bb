import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../test/helpers/test-app.js";
import { seedHost, seedProjectWithSource } from "../../test/helpers/seed.js";

let harness: TestAppHarness;
let projectId: string;
let otherProjectId: string;

const AGENT_TRIGGER = {
  triggerType: "schedule" as const,
  cron: "0 9 * * *",
  timezone: "America/New_York",
};

function agentExecution() {
  return {
    mode: "script" as const,
    script: 'echo \'{"wakeAgent": false}\'',
    interpreter: "bash" as const,
  };
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Daily digest",
    trigger: AGENT_TRIGGER,
    execution: {
      mode: "agent",
      prompt: "Summarize.",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "readonly",
    },
    environment: { type: "host", workspace: { type: "personal" } },
    origin: "agent",
    ...overrides,
  };
}

async function post(path: string, body: unknown): Promise<Response> {
  return harness.app.request(`/api/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown): Promise<Response> {
  return harness.app.request(`/api/v1${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  harness = await createTestAppHarness();
  const host = seedHost(harness);
  projectId = seedProjectWithSource(harness, {
    hostId: host.id,
    name: "Project A",
    path: "/tmp/bb-automations-a",
  }).project.id;
  otherProjectId = seedProjectWithSource(harness, {
    hostId: host.id,
    name: "Project B",
    path: "/tmp/bb-automations-b",
  }).project.id;
});

afterEach(async () => {
  await harness.cleanup();
});

describe("automations routes", () => {
  it("creates, gets, lists, updates, pauses, resumes, and deletes", async () => {
    const createRes = await post(
      `/projects/${projectId}/automations`,
      createBody(),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.origin).toBe("agent");
    expect(created.enabled).toBe(true);
    expect(created.nextRunAt).toBeGreaterThan(Date.now());
    expect(created.execution.mode).toBe("agent");
    const automationId = created.id;

    const getRes = await harness.app.request(
      `/api/v1/projects/${projectId}/automations/${automationId}`,
    );
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).id).toBe(automationId);

    const listRes = await harness.app.request(
      `/api/v1/projects/${projectId}/automations`,
    );
    expect((await listRes.json())).toHaveLength(1);

    const updateRes = await patch(
      `/projects/${projectId}/automations/${automationId}`,
      { name: "Renamed", trigger: { ...AGENT_TRIGGER, cron: "0 10 * * *" } },
    );
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.name).toBe("Renamed");

    const pauseRes = await post(
      `/projects/${projectId}/automations/${automationId}/pause`,
      undefined,
    );
    const paused = await pauseRes.json();
    expect(paused.enabled).toBe(false);
    expect(paused.nextRunAt).toBeNull();

    const resumeRes = await post(
      `/projects/${projectId}/automations/${automationId}/resume`,
      undefined,
    );
    const resumed = await resumeRes.json();
    expect(resumed.enabled).toBe(true);
    expect(resumed.nextRunAt).toBeGreaterThan(Date.now());

    const deleteRes = await harness.app.request(
      `/api/v1/projects/${projectId}/automations/${automationId}`,
      { method: "DELETE" },
    );
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ ok: true });

    const afterDelete = await harness.app.request(
      `/api/v1/projects/${projectId}/automations`,
    );
    expect(await afterDelete.json()).toHaveLength(0);
  });

  it("stores an inline script under the data dir and returns scriptFile", async () => {
    const res = await post(
      `/projects/${projectId}/automations`,
      createBody({
        name: "Watchdog",
        execution: agentExecution(),
      }),
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.execution.mode).toBe("script");
    expect(created.execution.scriptFile).toBeDefined();
    expect(created.execution.script).toBeUndefined();
  });

  it("rejects an invalid cron expression with 400", async () => {
    const res = await post(
      `/projects/${projectId}/automations`,
      createBody({ trigger: { ...AGENT_TRIGGER, cron: "not a cron" } }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_request");
  });

  it("rejects unknown fields via strict parsing", async () => {
    const res = await post(
      `/projects/${projectId}/automations`,
      createBody({ surprise: true }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for an automation in a different project", async () => {
    const createRes = await post(
      `/projects/${projectId}/automations`,
      createBody(),
    );
    const created = await createRes.json();
    const res = await harness.app.request(
      `/api/v1/projects/${otherProjectId}/automations/${created.id}`,
    );
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("automation_not_found");
  });

  it("creates a manual run (202) and lists run history", async () => {
    const createRes = await post(
      `/projects/${projectId}/automations`,
      createBody({ name: "Watchdog", execution: agentExecution() }),
    );
    const created = await createRes.json();

    const runRes = await post(
      `/projects/${projectId}/automations/${created.id}/run`,
      {},
    );
    expect(runRes.status).toBe(202);
    const { run } = await runRes.json();
    expect(run.automationId).toBe(created.id);
    expect(run.trigger).toBe("manual");

    const runsRes = await harness.app.request(
      `/api/v1/projects/${projectId}/automations/${created.id}/runs`,
    );
    expect(runsRes.status).toBe(200);
    const runsBody = await runsRes.json();
    expect(runsBody.runs.length).toBeGreaterThanOrEqual(1);
    expect(runsBody.nextCursor).toBeNull();
  });

  it("dedupes a manual run on idempotency key", async () => {
    const createRes = await post(
      `/projects/${projectId}/automations`,
      createBody({ name: "Watchdog", execution: agentExecution() }),
    );
    const created = await createRes.json();

    const first = await post(
      `/projects/${projectId}/automations/${created.id}/run`,
      { idempotencyKey: "abc" },
    );
    const second = await post(
      `/projects/${projectId}/automations/${created.id}/run`,
      { idempotencyKey: "abc" },
    );
    const firstRun = (await first.json()).run;
    const secondRun = (await second.json()).run;
    expect(secondRun.id).toBe(firstRun.id);
  });

  it("includes automations across projects in the overview", async () => {
    await post(`/projects/${projectId}/automations`, createBody());
    await post(`/projects/${otherProjectId}/automations`, createBody());
    const res = await harness.app.request(`/api/v1/automations`);
    const body = await res.json();
    expect(body.automations).toHaveLength(2);
  });
});
