import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAppSettings, setAppSettings } from "@bb/db";
import {
  createReuseThread,
  listThreadInteractions,
  sendTextMessage,
} from "../../integration/helpers/api.js";
import { waitForThreadStatus } from "../../integration/helpers/assertions.js";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../../integration/helpers/fixtures.js";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../../integration/helpers/harness.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const PROFILING_APP_DIST = resolve(repoRoot, "apps/app/dist-profiling");

const SIDEBAR_THREAD_COUNT = 500;
const TIMELINE_TURN_COUNT = 40;
const SEED_CONCURRENCY = 25;
const TURN_TIMEOUT_MS = 30_000;

const UI_PLUGINS = ["thread-list", "navigation", "composer", "drafts", "git"];

export interface RenderFixture {
  harness: IntegrationHarness;
  serverUrl: string;
  timelineThreadId: string;
  questionThreadId: string;
  pushTargetThreadId: string;
  sidebarThreadIds: readonly string[];
  cleanup(): Promise<void>;
}

function timelinePrompt(turn: number): string {
  switch (turn % 4) {
    case 0:
      return [
        `## Step ${turn}: review notes`,
        "",
        `Paragraph for turn ${turn}. It is long enough to wrap in the timeline column and`,
        "carries **bold**, _emphasis_ and `inline code` so the markdown renderer works.",
        "",
        "- first point",
        "- second point",
        "  - nested point",
        "",
        "> A quoted line for the blockquote renderer.",
      ].join("\n");
    case 1:
      return [
        `Turn ${turn} code sample:`,
        "",
        "```ts",
        `export function step${turn}(input: number): number {`,
        "  const doubled = input * 2;",
        "  return doubled + 1;",
        "}",
        "```",
      ].join("\n");
    case 2:
      return `call_tool:render_fixture_tool_${turn}`;
    default:
      return [
        `| Column | Turn ${turn} |`,
        "| --- | --- |",
        "| alpha | one |",
        "| beta | two |",
      ].join("\n");
  }
}

async function runTurn(
  harness: IntegrationHarness,
  threadId: string,
  text: string,
): Promise<void> {
  await sendTextMessage(harness.api, threadId, { text });
  await waitForThreadStatus(harness.api, threadId, "idle", TURN_TIMEOUT_MS);
}

async function inBatches<T>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(run));
  }
}

async function waitForPendingQuestion(
  harness: IntegrationHarness,
  threadId: string,
): Promise<void> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const interactions = await listThreadInteractions(harness.api, threadId);
    if (interactions.some((interaction) => interaction.status === "pending")) {
      return;
    }
    await new Promise((settle) => setTimeout(settle, 100));
  }
  throw new Error(`Thread ${threadId} never raised its question`);
}

export async function startRenderFixture(
  options: { port?: number } = {},
): Promise<RenderFixture> {
  if (!existsSync(resolve(PROFILING_APP_DIST, "index.html"))) {
    throw new Error(
      `${PROFILING_APP_DIST}/index.html is missing. Run: pnpm exec turbo run build:profiling --filter=@bb/app`,
    );
  }
  const harness = await createIntegrationHarness({
    serverPort: options.port,
    staticDir: PROFILING_APP_DIST,
    builtinPlugins: UI_PLUGINS,
  });
  try {
    setAppSettings(harness.db, {
      ...getAppSettings(harness.db),
      onboardingCompletedAt: new Date(0).toISOString(),
    });
    const project = await createProjectFixture(harness, {
      name: "Render invariants",
    });
    const timeline = await createReadyHostThread(harness, {
      projectId: project.id,
      title: "Long timeline",
      workspace: { type: "unmanaged", path: null },
      timeoutMs: TURN_TIMEOUT_MS,
    });
    const environmentId = timeline.environment.id;

    const sidebarThreadIds: string[] = [];
    const ordinals = Array.from(
      { length: SIDEBAR_THREAD_COUNT },
      (_, index) => index + 1,
    );
    for (const ordinal of ordinals) {
      const thread = await createReuseThread(harness.api, {
        environmentId,
        projectId: project.id,
        title: `Sidebar thread ${String(ordinal).padStart(3, "0")}`,
      });
      sidebarThreadIds.push(thread.id);
    }
    await inBatches(sidebarThreadIds, SEED_CONCURRENCY, async (threadId) => {
      await waitForThreadStatus(harness.api, threadId, "idle", TURN_TIMEOUT_MS);
    });

    const question = await createReuseThread(harness.api, {
      environmentId,
      projectId: project.id,
      title: "Pending question",
    });
    await waitForThreadStatus(
      harness.api,
      question.id,
      "idle",
      TURN_TIMEOUT_MS,
    );
    await sendTextMessage(harness.api, question.id, { text: "ask_user" });
    await waitForPendingQuestion(harness, question.id);

    for (let turn = 0; turn < TIMELINE_TURN_COUNT; turn += 1) {
      await runTurn(harness, timeline.thread.id, timelinePrompt(turn));
    }

    const pushTarget = await createReuseThread(harness.api, {
      environmentId,
      projectId: project.id,
      title: "Push target",
    });
    await waitForThreadStatus(
      harness.api,
      pushTarget.id,
      "idle",
      TURN_TIMEOUT_MS,
    );

    return {
      harness,
      serverUrl: harness.serverUrl,
      timelineThreadId: timeline.thread.id,
      questionThreadId: question.id,
      pushTargetThreadId: pushTarget.id,
      sidebarThreadIds,
      cleanup: () => harness.cleanup(),
    };
  } catch (error) {
    await harness.cleanup();
    throw error;
  }
}
