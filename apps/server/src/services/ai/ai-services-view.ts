import { getAiServiceSelections, setAiServiceSelection } from "@bb/db";
import { promptInputSchema, type AiTextTask } from "@bb/domain";
import type {
  SetAiServiceSelectionRequest,
  SystemAiServicesResponse,
  TestAiServiceResponse,
} from "@bb/server-contract";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { buildThreadTitlePrompt } from "../threads/title-generation.js";
import {
  aiServiceKey,
  aiServiceSupportsTask,
  aiServiceTasks,
} from "./ai-service-registry.js";
import { automaticAiServiceRank, runTextAiTask } from "./ai-tasks.js";
import {
  buildCommitMessagePrompt,
  sanitizeGeneratedCommitMessage,
} from "./commit-message.js";
import { sanitizeGeneratedTitle } from "../threads/title-generation.js";

type AiServicesViewDeps = Pick<
  LoggedWorkSessionDeps,
  "aiServices" | "config" | "db" | "hub" | "logger"
>;

const SAMPLE_TITLE_INPUT = [
  promptInputSchema.parse({
    type: "text",
    text: "The settings page needs a dark mode toggle, and it should remember each user's choice across devices.",
  }),
];

const SAMPLE_COMMIT = {
  diffDescription: "the working tree",
  shortstat: " 2 files changed, 38 insertions(+), 4 deletions(-)",
  files: "M\tsrc/settings/theme.ts\nA\tsrc/settings/DarkModeToggle.tsx",
  patch: [
    "diff --git a/src/settings/theme.ts b/src/settings/theme.ts",
    "-export const defaultTheme = 'light';",
    "+export const defaultTheme = readStoredTheme() ?? 'light';",
    "diff --git a/src/settings/DarkModeToggle.tsx b/src/settings/DarkModeToggle.tsx",
    "+export function DarkModeToggle() {",
    "+  const [theme, setTheme] = useStoredTheme();",
    "+  return <Switch checked={theme === 'dark'} onChange={toggle(setTheme)} />;",
    "+}",
  ].join("\n"),
};

export async function buildAiServicesView(
  deps: AiServicesViewDeps,
): Promise<SystemAiServicesResponse> {
  const services = deps.aiServices.list();
  const statuses = await Promise.all(
    services.map((service) => deps.aiServices.status(aiServiceKey(service))),
  );
  return {
    selections: getAiServiceSelections(deps.db),
    services: services
      .map((service, index) => ({
        id: service.id,
        displayName: service.displayName,
        pluginId: service.pluginId,
        tasks: aiServiceTasks(service),
        automaticRank: automaticAiServiceRank(service),
        status: statuses[index] ?? { ready: false, message: "Unknown" },
      }))
      .sort(
        (a, b) =>
          (a.automaticRank ?? Number.MAX_SAFE_INTEGER) -
            (b.automaticRank ?? Number.MAX_SAFE_INTEGER) ||
          a.displayName.localeCompare(b.displayName),
      ),
  };
}

export async function updateAiServiceSelection(
  deps: AiServicesViewDeps,
  request: SetAiServiceSelectionRequest,
): Promise<SystemAiServicesResponse> {
  const { selection, task } = request;
  if (selection.mode === "service") {
    const service = deps.aiServices.get(selection);
    if (service === null) {
      throw new ApiError(
        400,
        "invalid_request",
        `No loaded plugin "${selection.pluginId}" serves AI service "${selection.serviceId}"`,
      );
    }
    if (!aiServiceSupportsTask(service, task)) {
      throw new ApiError(
        400,
        "invalid_request",
        `AI service "${service.id}" does not handle ${task}`,
      );
    }
  }
  setAiServiceSelection(deps.db, task, selection);
  deps.hub.notifySystem(["config-changed"]);
  return buildAiServicesView(deps);
}

function sampleFor(task: AiTextTask): {
  prompt: string;
  sanitize: (value: string) => string | null;
} {
  if (task === "commit-message") {
    return {
      prompt: buildCommitMessagePrompt(SAMPLE_COMMIT),
      sanitize: sanitizeGeneratedCommitMessage,
    };
  }
  const prompt = buildThreadTitlePrompt(SAMPLE_TITLE_INPUT);
  if (prompt === null) {
    throw new Error("The sample title prompt is empty");
  }
  return { prompt, sanitize: sanitizeGeneratedTitle };
}

export async function testAiService(
  deps: AiServicesViewDeps,
  args: { task: AiTextTask; signal: AbortSignal },
): Promise<TestAiServiceResponse> {
  const sample = sampleFor(args.task);
  const outcome = await runTextAiTask(deps, {
    task: args.task,
    label: "AI service test",
    prompt: sample.prompt,
    signal: args.signal,
  });
  if (!outcome.ok) {
    return {
      ok: false,
      message: outcome.message,
      durationMs: outcome.durationMs,
    };
  }
  const text = sample.sanitize(outcome.value);
  if (text === null) {
    return {
      ok: false,
      message: `${outcome.service.displayName} returned an empty reply`,
      durationMs: outcome.durationMs,
    };
  }
  return {
    ok: true,
    pluginId: outcome.service.pluginId,
    serviceId: outcome.service.id,
    displayName: outcome.service.displayName,
    text,
    durationMs: outcome.durationMs,
  };
}
