import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestThreadSequence, getThread, setExperiments } from "@bb/db";
import { defaultExperiments, turnScope } from "@bb/domain";
import {
  generatedSkillsRootPath,
  pluginCommandsSkillDir,
} from "../../../src/services/plugins/plugin-commands-skill.js";
import { resolveInjectedSkillSources } from "../../../src/services/skills/injected-skills.js";
import { applyLoggedThreadLifecycleEvent } from "../../../src/services/threads/lifecycle-outcome.js";
import {
  seedEvent,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../../helpers/seed.js";
import {
  createTestAppHarness,
  startTestServer,
  testLogger,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";

/** The repo's real hero example plugins — installed exactly as shipped. */
const EXAMPLES_DIR = fileURLToPath(
  new URL("../../../../../examples/plugins", import.meta.url),
);

// The examples pin engines.bb to ">=0.9"; the harness default app version
// ("0.0.0-test") would legitimately mark them incompatible.
const APP_VERSION = "1.0.0";

function slackHeaders(
  signingSecret: string,
  rawBody: string,
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    "v0=" +
    createHmac("sha256", signingSecret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex");
  return {
    "content-type": "application/json",
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": signature,
  };
}

describe("hero plugin: agent-enrichment", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness({ appVersion: APP_VERSION });
    setExperiments(harness.db, { ...defaultExperiments, plugins: true });
    const entry = await harness.pluginService.installPath(
      join(EXAMPLES_DIR, "agent-enrichment"),
    );
    expect(entry.id).toBe("agent-enrichment");
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  async function runDocs(argv: string[]): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/agent-enrichment/cli`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ argv }),
      },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
  }

  it("bb docs search returns excerpts from the bundled docs via the CLI endpoint", async () => {
    const result = await runDocs(["search", "conventional commits"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("conventions.md");
    expect(result.stdout).toContain("conventional commits");

    // The kv cache backs `bb docs last`.
    const last = await runDocs(["last"]);
    expect(last.exitCode).toBe(0);
    expect(last.stdout).toContain('"conventional commits"');
  });

  it("the caseSensitive boolean setting changes search behavior without a reload", async () => {
    const insensitive = await runDocs(["search", "CONVENTIONAL COMMITS"]);
    expect(insensitive.stdout).toContain("conventions.md");

    await harness.pluginService.updateSettings("agent-enrichment", {
      caseSensitive: true,
    });
    const sensitive = await runDocs(["search", "CONVENTIONAL COMMITS"]);
    expect(sensitive.exitCode).toBe(0);
    expect(sensitive.stdout).toContain("No matches");
  });

  it("its command reaches agents through the generated plugin-commands skill", async () => {
    const skillFile = join(
      pluginCommandsSkillDir(harness.config.dataDir),
      "SKILL.md",
    );
    const content = await readFile(skillFile, "utf8");
    expect(content).toContain("## bb docs —");
    expect(content).toContain("bb docs search <query...>");

    // Resolved the same way thread-runtime-config wires the generated root.
    const sources = resolveInjectedSkillSources(testLogger, {
      additionalSkillsRootPaths: [
        generatedSkillsRootPath(harness.config.dataDir),
      ],
      builtinSkillsRootPath: join(harness.config.dataDir, "builtin-skills"),
      dataDir: harness.config.dataDir,
    });
    expect(
      sources.find((source) => source.name === "plugin-commands")
        ?.skillFilePath,
    ).toBe(skillFile);
  });

  it("auto-imports its skills/ directory through the plugin skills tier", () => {
    const pluginSkillsRootPaths = harness.pluginService.listSkillsRootPaths();
    expect(pluginSkillsRootPaths).toContain(
      join(EXAMPLES_DIR, "agent-enrichment", "skills"),
    );
    // Resolved the same way thread-runtime-config wires the plugin tier.
    const sources = resolveInjectedSkillSources(testLogger, {
      builtinSkillsRootPath: join(harness.config.dataDir, "builtin-skills"),
      dataDir: harness.config.dataDir,
      pluginSkillsRootPaths,
    });
    const skill = sources.find((source) => source.name === "repo-conventions");
    expect(skill).toBeDefined();
    expect(skill?.description).toContain("Conventions");
    expect(skill?.sourceRootPath).toBe(
      join(EXAMPLES_DIR, "agent-enrichment", "skills", "repo-conventions"),
    );
  });
});

describe("hero plugin: slack-bot", () => {
  it("webhook → spawn → thread.idle → chat.postMessage, end to end", async () => {
    const server = await startTestServer({ appVersion: APP_VERSION });
    const realFetch = globalThis.fetch;
    const slackCalls: Array<{ url: string; body: Record<string, unknown> }> =
      [];
    try {
      setExperiments(server.db, { ...defaultExperiments, plugins: true });
      const { host } = seedHostSession(server.deps);
      seedPrimaryHost(server.deps, host.id);
      const { project } = seedProjectWithSource(server.deps, {
        hostId: host.id,
        path: "/tmp/slack-bot-hero-source",
      });

      // Mock ONLY the outbound Slack Web API (the true external boundary);
      // everything else — including the plugin's loopback bb.sdk calls —
      // passes through to the real fetch.
      globalThis.fetch = (async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.startsWith("https://slack.com/")) {
          slackCalls.push({
            url,
            body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          });
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          });
        }
        return realFetch(input, init);
      }) as typeof fetch;

      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const entry = await server.pluginService.installPath(
        join(EXAMPLES_DIR, "slack-bot"),
      );
      expect(entry.id).toBe("slack-bot");
      // Unconfigured: loaded, but honestly reporting what it needs.
      expect(entry.status).toBe("needs-configuration");
      expect(entry.statusDetail).toContain("bb plugin config slack-bot");

      // Configure (as `bb plugin config slack-bot set ...` would) + reload.
      const signingSecret = "test-signing-secret";
      await server.pluginService.updateSettings("slack-bot", {
        botToken: "xoxb-test-token",
        signingSecret,
        channelId: "C0GENERAL",
        project: project.id,
      });
      await server.pluginService.reload("slack-bot");
      expect(
        server.pluginService.list().find((p) => p.id === "slack-bot")?.status,
      ).toBe("running");

      const eventsUrl = `${server.baseUrl}/api/v1/plugins/slack-bot/http/events`;

      // An unsigned request never reaches the event handlers.
      const forged = await realFetch(eventsUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
          "x-slack-signature": "v0=deadbeef",
        },
        body: JSON.stringify({ type: "url_verification", challenge: "nope" }),
      });
      expect(forged.status).toBe(401);

      // Slack's URL-verification handshake round-trips the challenge.
      const challengeBody = JSON.stringify({
        type: "url_verification",
        challenge: "challenge-123",
      });
      const verification = await realFetch(eventsUrl, {
        method: "POST",
        headers: slackHeaders(signingSecret, challengeBody),
        body: challengeBody,
      });
      expect(verification.status).toBe(200);
      expect(await verification.json()).toEqual({
        challenge: "challenge-123",
      });

      // An app_mention spawns an attributed BB thread and records the
      // Slack-thread ↔ BB-thread mapping in kv.
      const mentionBody = JSON.stringify({
        type: "event_callback",
        event: {
          type: "app_mention",
          channel: "C0GENERAL",
          text: "<@U0BOT> summarize the release notes",
          ts: "1720000000.000100",
        },
      });
      const mention = await realFetch(eventsUrl, {
        method: "POST",
        headers: slackHeaders(signingSecret, mentionBody),
        body: mentionBody,
      });
      expect(mention.status).toBe(200);
      expect(await mention.json()).toEqual({ ok: true });

      const api = server.pluginService.getApi("slack-bot");
      expect(api).toBeDefined();
      const threadId = await api?.storage.kv.get<string>(
        "slack:1720000000.000100",
      );
      expect(threadId).toBeDefined();
      const threadRow = getThread(server.db, threadId as string);
      expect(threadRow?.originPluginId).toBe("slack-bot");
      expect(threadRow?.title).toBe("Slack: summarize the release notes");

      // Drive the spawned thread to idle through the real lifecycle seam
      // (no live provider in tests) with an assistant message on record.
      const lifecycleDeps = {
        db: server.db,
        hub: server.hub,
        logger: testLogger,
      };
      applyLoggedThreadLifecycleEvent(lifecycleDeps, {
        threadId: threadId as string,
        event: { type: "run.started" },
      });
      seedEvent(server.deps, {
        threadId: threadId as string,
        environmentId: threadRow?.environmentId ?? null,
        providerThreadId: "provider-slack-1",
        scope: turnScope("turn-1"),
        sequence:
          getLatestThreadSequence(server.db, {
            threadId: threadId as string,
          }) + 1,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "assistant-1",
            text: "Release notes: all green.",
          },
        },
      });
      const outcome = applyLoggedThreadLifecycleEvent(lifecycleDeps, {
        threadId: threadId as string,
        event: { type: "run.succeeded" },
      });
      expect(outcome.applied).toBe(true);

      // thread.idle → chat.postMessage into the originating Slack thread.
      await vi.waitFor(() => expect(slackCalls).toHaveLength(1));
      expect(slackCalls[0]?.url).toBe(
        "https://slack.com/api/chat.postMessage",
      );
      expect(slackCalls[0]?.body).toEqual({
        channel: "C0GENERAL",
        thread_ts: "1720000000.000100",
        text: "Release notes: all green.",
      });

      // The failure-isolation stats saw the handler and recorded no errors.
      const listed = server.pluginService
        .list()
        .find((p) => p.id === "slack-bot");
      expect(listed?.handlerStats.errorCount).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      await server.pluginService.stop();
      await server.close();
    }
  });
});
