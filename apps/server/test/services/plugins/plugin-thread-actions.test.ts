import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { seedHost, seedProjectWithSource, seedThread } from "../../helpers/seed.js";

// The harness config uses serverPort 3334, so this host is on the local-app
// origin allowlist the "local" auth mode enforces.
const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";

// Actions cover the run contract: toast passthrough (with the handler ctx
// echoed so the test can assert threadId/projectId), void result, a throwing
// handler, and a malformed toast.
const ACTIONS_SOURCE = `
  export default function plugin(bb: any) {
    bb.ui.registerThreadAction({
      id: "echo-ctx",
      title: "Echo context",
      icon: "beaker",
      async run(ctx: any) {
        return { toast: { kind: "success", message: ctx.threadId + " " + ctx.projectId } };
      },
    });
    bb.ui.registerThreadAction({
      id: "quiet",
      title: "Quiet action",
      confirm: "Really run the quiet action?",
      async run() {},
    });
    bb.ui.registerThreadAction({
      id: "boom",
      title: "Boom",
      async run() {
        throw new Error("action boom");
      },
    });
    bb.ui.registerThreadAction({
      id: "bad-toast",
      title: "Bad toast",
      async run() {
        return { toast: { kind: "sparkle", message: "nope" } };
      },
    });
  }
`;

async function writePlugin(
  dir: string,
  options: { name: string; serverSource: string },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      bb: { server: "./server.ts" },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

async function runAction(
  harness: TestAppHarness,
  pluginId: string,
  actionId: string,
  body: unknown,
  init: { origin?: string; contentType?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  const contentType =
    init.contentType === undefined ? "application/json" : init.contentType;
  if (contentType !== null) headers["content-type"] = contentType;
  if (init.origin !== undefined) headers.origin = init.origin;
  return await harness.app.request(
    `${BASE}/api/v1/plugins/${pluginId}/actions/${actionId}`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
}

describe("plugin thread actions (bb.ui.registerThreadAction)", () => {
  let harness: TestAppHarness;
  let threadId: string;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
    const host = seedHost(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const thread = seedThread(harness.deps, { projectId: project.id });
    threadId = thread.id;
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      { name: "bb-plugin-actions", serverSource: ACTIONS_SOURCE },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("lists thread actions in GET /plugins/contributions without running plugin code", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { threadActions: unknown };
    expect(body.threadActions).toEqual([
      {
        pluginId: "actions",
        id: "echo-ctx",
        title: "Echo context",
        icon: "beaker",
        confirm: null,
      },
      {
        pluginId: "actions",
        id: "quiet",
        title: "Quiet action",
        icon: null,
        confirm: "Really run the quiet action?",
      },
      { pluginId: "actions", id: "boom", title: "Boom", icon: null, confirm: null },
      {
        pluginId: "actions",
        id: "bad-toast",
        title: "Bad toast",
        icon: null,
        confirm: null,
      },
    ]);
  });

  it("contributions go empty when the experiment is off", async () => {
    setExperiments(harness.db, { ...defaultExperiments, plugins: false });
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      cliCommands: [],
      threadActions: [],
      mentionProviders: [],
    });
  });

  it("runs an action and passes the returned toast through, with the thread's projectId in ctx", async () => {
    const response = await runAction(harness, "actions", "echo-ctx", {
      threadId,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      toast: { kind: string; message: string };
    };
    expect(body.ok).toBe(true);
    expect(body.toast.kind).toBe("success");
    const [ctxThreadId, ctxProjectId] = body.toast.message.split(" ");
    expect(ctxThreadId).toBe(threadId);
    expect(ctxProjectId).toMatch(/^proj_/);
  });

  it("runs a confirm-carrying action without server-side gating and returns { ok: true } for void results", async () => {
    // `confirm` is a declarative hint for the app; the server runs the
    // action regardless (the app owns the confirmation step).
    const response = await runAction(harness, "actions", "quiet", { threadId });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("maps a throwing handler to a 500 envelope and counts it in handlerStats", async () => {
    const response = await runAction(harness, "actions", "boom", { threadId });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "action boom" });
    const entry = harness.pluginService.list().find((p) => p.id === "actions");
    expect(entry?.handlerStats.errorCount).toBe(1);
    expect(entry?.statusDetail).toContain("thread action boom failed");
  });

  it("maps a malformed toast to a handler error", async () => {
    const response = await runAction(harness, "actions", "bad-toast", {
      threadId,
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("toast must be"),
    });
  });

  it("enforces local auth: foreign origin 403, non-JSON content type 415", async () => {
    const foreign = await runAction(
      harness,
      "actions",
      "echo-ctx",
      { threadId },
      { origin: EVIL_ORIGIN },
    );
    expect(foreign.status).toBe(403);

    const notJson = await runAction(
      harness,
      "actions",
      "echo-ctx",
      { threadId },
      { contentType: null },
    );
    expect(notJson.status).toBe(415);
  });

  it("maps unknown plugin/action/thread to 404, missing threadId to 400, disabled plugin to 503", async () => {
    const unknownPlugin = await runAction(harness, "ghost", "echo-ctx", {
      threadId,
    });
    expect(unknownPlugin.status).toBe(404);

    const unknownAction = await runAction(harness, "actions", "nope", {
      threadId,
    });
    expect(unknownAction.status).toBe(404);
    expect(await unknownAction.json()).toMatchObject({
      error: 'plugin "actions" has no thread action "nope"',
    });

    const unknownThread = await runAction(harness, "actions", "echo-ctx", {
      threadId: "thr_missing",
    });
    expect(unknownThread.status).toBe(404);
    expect(await unknownThread.json()).toMatchObject({
      error: 'unknown thread "thr_missing"',
    });

    const missingThreadId = await runAction(harness, "actions", "echo-ctx", {});
    expect(missingThreadId.status).toBe(400);

    await harness.pluginService.setEnabled("actions", false);
    const notRunning = await runAction(harness, "actions", "echo-ctx", {
      threadId,
    });
    expect(notRunning.status).toBe(503);

    // Disabling drops the contribution from the listing too.
    const contributions = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    expect(
      ((await contributions.json()) as { threadActions: unknown[] })
        .threadActions,
    ).toEqual([]);
  });

  it("returns the structured disabled error when the experiment is off", async () => {
    setExperiments(harness.db, { ...defaultExperiments, plugins: false });
    const response = await runAction(harness, "actions", "echo-ctx", {
      threadId,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("Plugins are disabled"),
    });
  });

  it("rejects duplicate action ids at registration (load fails loudly)", async () => {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "bb-plugin-dupe-action",
        serverSource: `
          export default function plugin(bb: any) {
            bb.ui.registerThreadAction({ id: "a", title: "A", run() {} });
            bb.ui.registerThreadAction({ id: "a", title: "A again", run() {} });
          }
        `,
      },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain('thread action "a" is already registered');
  });
});
