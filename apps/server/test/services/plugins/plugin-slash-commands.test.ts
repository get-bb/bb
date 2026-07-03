import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setExperiments } from "@bb/db";
import { defaultExperiments } from "@bb/domain";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { RESERVED_COMPOSER_SLASH_COMMANDS } from "../../../src/services/plugins/plugin-api.js";
import { BUILT_IN_PROVIDER_COMMANDS } from "../../../src/services/threads/provider-command-typeahead.js";

// The harness config uses serverPort 3334, so this host is on the local-app
// origin allowlist the "local" auth mode enforces.
const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";

// Commands cover the return contract: insertText (with the handler ctx
// echoed so the test can assert args/threadId/projectId, including the null
// homepage path), send, void, a throwing handler, and a malformed result.
const SLASH_SOURCE = `
  export default function plugin(bb: any) {
    bb.ui.registerSlashCommand({
      name: "standup",
      description: "Draft a standup summary",
      async run(ctx: any) {
        return { insertText: JSON.stringify(ctx) };
      },
    });
    bb.ui.registerSlashCommand({
      name: "send-note",
      description: "Send a note",
      async run() {
        return { send: [{ type: "text", text: "note from plugin", mentions: [] }] };
      },
    });
    bb.ui.registerSlashCommand({
      name: "quiet",
      description: "Do nothing visible",
      async run() {},
    });
    bb.ui.registerSlashCommand({
      name: "boom",
      description: "Throw",
      async run() {
        throw new Error("slash boom");
      },
    });
    bb.ui.registerSlashCommand({
      name: "bad-result",
      description: "Return garbage",
      async run() {
        return { insertText: 42 };
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

async function runSlash(
  harness: TestAppHarness,
  pluginId: string,
  name: string,
  body: unknown,
  init: { origin?: string; contentType?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  const contentType =
    init.contentType === undefined ? "application/json" : init.contentType;
  if (contentType !== null) headers["content-type"] = contentType;
  if (init.origin !== undefined) headers.origin = init.origin;
  return await harness.app.request(
    `${BASE}/api/v1/plugins/${pluginId}/slash/${name}`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
}

describe("plugin slash commands (bb.ui.registerSlashCommand)", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      { name: "bb-plugin-slash", serverSource: SLASH_SOURCE },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("keeps RESERVED_COMPOSER_SLASH_COMMANDS in sync with the built-in composer commands", () => {
    expect([...RESERVED_COMPOSER_SLASH_COMMANDS].sort()).toEqual(
      BUILT_IN_PROVIDER_COMMANDS.map((command) => command.name).sort(),
    );
  });

  it("lists slash commands in GET /plugins/contributions without running plugin code", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { slashCommands: unknown };
    expect(body.slashCommands).toEqual([
      {
        pluginId: "slash",
        name: "standup",
        description: "Draft a standup summary",
      },
      { pluginId: "slash", name: "send-note", description: "Send a note" },
      { pluginId: "slash", name: "quiet", description: "Do nothing visible" },
      { pluginId: "slash", name: "boom", description: "Throw" },
      { pluginId: "slash", name: "bad-result", description: "Return garbage" },
    ]);
  });

  it("runs a command with args + thread/project context and returns the insertText envelope", async () => {
    const response = await runSlash(harness, "slash", "standup", {
      args: "yesterday",
      threadId: "thr_abc",
      projectId: "proj_abc",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      action: string;
      insertText: string;
    };
    expect(body.ok).toBe(true);
    expect(body.action).toBe("insertText");
    expect(JSON.parse(body.insertText)).toEqual({
      args: "yesterday",
      threadId: "thr_abc",
      projectId: "proj_abc",
    });
  });

  it("passes null threadId/projectId and empty args on the homepage composer path", async () => {
    const response = await runSlash(harness, "slash", "standup", {});
    expect(response.status).toBe(200);
    const body = (await response.json()) as { insertText: string };
    expect(JSON.parse(body.insertText)).toEqual({
      args: "",
      threadId: null,
      projectId: null,
    });
  });

  it("returns the send envelope with schema-validated PromptInputs", async () => {
    const response = await runSlash(harness, "slash", "send-note", {
      threadId: "thr_abc",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      action: "send",
      send: [{ type: "text", text: "note from plugin", mentions: [] }],
    });
  });

  it("returns the none envelope for void results", async () => {
    const response = await runSlash(harness, "slash", "quiet", {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, action: "none" });
  });

  it("maps a throwing handler to a 500 envelope and counts it in handlerStats", async () => {
    const response = await runSlash(harness, "slash", "boom", {});
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "slash boom" });
    const entry = harness.pluginService.list().find((p) => p.id === "slash");
    expect(entry?.handlerStats.errorCount).toBe(1);
    expect(entry?.statusDetail).toContain("slash command boom failed");
  });

  it("maps a malformed result to a handler error", async () => {
    const response = await runSlash(harness, "slash", "bad-result", {});
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("insertText must be"),
    });
  });

  it("rejects a malformed body with 400", async () => {
    const response = await runSlash(harness, "slash", "standup", {
      args: 42,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("expected { args?: string"),
    });
  });

  it("enforces local auth: foreign origin 403, non-JSON content type 415", async () => {
    const foreign = await runSlash(
      harness,
      "slash",
      "standup",
      {},
      { origin: EVIL_ORIGIN },
    );
    expect(foreign.status).toBe(403);

    const notJson = await runSlash(
      harness,
      "slash",
      "standup",
      {},
      { contentType: null },
    );
    expect(notJson.status).toBe(415);
  });

  it("maps unknown plugin/command to 404, disabled plugin to 503, experiment off to 422", async () => {
    const unknownPlugin = await runSlash(harness, "ghost", "standup", {});
    expect(unknownPlugin.status).toBe(404);

    const unknownCommand = await runSlash(harness, "slash", "nope", {});
    expect(unknownCommand.status).toBe(404);
    expect(await unknownCommand.json()).toMatchObject({
      error: 'plugin "slash" has no slash command "nope"',
    });

    await harness.pluginService.setEnabled("slash", false);
    const notRunning = await runSlash(harness, "slash", "standup", {});
    expect(notRunning.status).toBe(503);

    // Disabling drops the contribution from the listing too.
    const contributions = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    expect(
      ((await contributions.json()) as { slashCommands: unknown[] })
        .slashCommands,
    ).toEqual([]);

    await harness.pluginService.setEnabled("slash", true);
    setExperiments(harness.db, { ...defaultExperiments, plugins: false });
    const disabled = await runSlash(harness, "slash", "standup", {});
    expect(disabled.status).toBe(422);
    expect(await disabled.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("Plugins are disabled"),
    });
  });

  it("rejects reserved built-in composer command names at registration", async () => {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "bb-plugin-reserved-slash",
        serverSource: `
          export default function plugin(bb: any) {
            bb.ui.registerSlashCommand({
              name: "compact",
              description: "Shadow the built-in",
              run() {},
            });
          }
        `,
      },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain(
      'slash command "/compact" is a built-in composer command',
    );
  });

  it("rejects duplicate and malformed names at registration (load fails loudly)", async () => {
    const dupeDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "bb-plugin-dupe-slash",
        serverSource: `
          export default function plugin(bb: any) {
            bb.ui.registerSlashCommand({ name: "a", description: "A", run() {} });
            bb.ui.registerSlashCommand({ name: "a", description: "A again", run() {} });
          }
        `,
      },
    );
    const dupe = await harness.pluginService.installPath(dupeDir);
    expect(dupe.status).toBe("error");
    expect(dupe.statusDetail).toContain(
      'slash command "a" is already registered',
    );

    const badNameDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "bb-plugin-bad-slash-name",
        serverSource: `
          export default function plugin(bb: any) {
            bb.ui.registerSlashCommand({ name: "Standup", description: "Nope", run() {} });
          }
        `,
      },
    );
    const badName = await harness.pluginService.installPath(badNameDir);
    expect(badName.status).toBe("error");
    expect(badName.statusDetail).toContain("invalid slash command name");
  });
});
