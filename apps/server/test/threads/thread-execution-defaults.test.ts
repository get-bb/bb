import {
  markThreadDeleted,
  setDisabledProviderIds,
  upsertProjectExecutionDefaults,
} from "@bb/db";
import type {
  PermissionMode,
  ReasoningLevel,
  RecordedPermissionMode,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { buildExecutionOptions } from "../../src/services/threads/thread-commands.js";
import type { ThreadCreateServiceRequestInput } from "../../src/services/threads/thread-create-request.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { resolveExistingThreadPermissionMode } from "../../src/services/threads/thread-execution-plan.js";
import { availableModelFixture } from "../helpers/available-models.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import { seedModelCatalog } from "../helpers/provider-model-catalogs.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface ParentFixture {
  deleted: boolean;
  providerId: string;
  recordedPermissionMode: RecordedPermissionMode | null;
}

interface ExecutionDefaultsCase {
  name: string;
  parent: ParentFixture | null;
  projectPermissionMode: PermissionMode | null;
  disabledProviderIds: string[];
  childProviderId: string;
  childRecordedPermissionMode: RecordedPermissionMode | null;
  request: Pick<
    ThreadCreateServiceRequestInput,
    | "executionInputSources"
    | "model"
    | "permissionMode"
    | "providerId"
    | "reasoningLevel"
    | "serviceTier"
  >;
  expected: {
    model: string;
    permissionMode: PermissionMode;
    reasoningLevel: ReasoningLevel;
    serviceTier: string;
  };
}

function liveParent(
  providerId: string,
  recordedPermissionMode: RecordedPermissionMode | null,
): ParentFixture {
  return { deleted: false, providerId, recordedPermissionMode };
}

const parentExecution = {
  model: "parent-model",
  reasoningLevel: "low",
  serviceTier: "fast",
} as const;
const projectExecution = {
  model: "project-model",
  reasoningLevel: "medium",
  serviceTier: "default",
} as const;
const childRecordedExecution = {
  model: "gpt-5",
  reasoningLevel: "medium",
  serviceTier: "default",
} as const;
const piModel = "openai-codex/gpt-5.4";

const cases: ExecutionDefaultsCase[] = [
  {
    name: "inherits a same-provider parent's whole execution",
    parent: liveParent("codex", "accept-edits"),
    projectPermissionMode: "auto",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: {},
    expected: { ...parentExecution, permissionMode: "accept-edits" },
  },
  {
    name: "inherits the parent's provider ahead of project defaults",
    parent: liveParent("claude-code", "accept-edits"),
    projectPermissionMode: "auto",
    disabledProviderIds: [],
    childProviderId: "claude-code",
    childRecordedPermissionMode: null,
    request: {},
    expected: { ...parentExecution, permissionMode: "accept-edits" },
  },
  {
    name: "inherits only the permission mode with an explicit other provider",
    parent: liveParent("claude-code", "accept-edits"),
    projectPermissionMode: "auto",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: { providerId: "codex" },
    expected: { ...projectExecution, permissionMode: "accept-edits" },
  },
  {
    name: "keeps parent defaults with an explicit matching provider",
    parent: liveParent("claude-code", "accept-edits"),
    projectPermissionMode: "auto",
    disabledProviderIds: [],
    childProviderId: "claude-code",
    childRecordedPermissionMode: null,
    request: { providerId: "claude-code" },
    expected: { ...parentExecution, permissionMode: "accept-edits" },
  },
  {
    name: "honors explicit model and reasoning ahead of the parent",
    parent: liveParent("codex", "accept-edits"),
    projectPermissionMode: "auto",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: { model: "requested-model", reasoningLevel: "high" },
    expected: {
      ...parentExecution,
      model: "requested-model",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
    },
  },
  {
    name: "honors an explicit service tier ahead of the parent",
    parent: liveParent("codex", "accept-edits"),
    projectPermissionMode: "auto",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: { serviceTier: "ultrafast" },
    expected: {
      ...parentExecution,
      serviceTier: "ultrafast",
      permissionMode: "accept-edits",
    },
  },
  {
    name: "falls back to project defaults without parent execution",
    parent: liveParent("claude-code", null),
    projectPermissionMode: "full",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: {},
    expected: { ...projectExecution, permissionMode: "full" },
  },
  {
    name: "ignores unowned picker values before inheriting parent execution",
    parent: liveParent("claude-code", "accept-edits"),
    projectPermissionMode: "auto",
    disabledProviderIds: [],
    childProviderId: "claude-code",
    childRecordedPermissionMode: null,
    request: {
      providerId: "codex",
      model: "stale-model",
      reasoningLevel: "high",
      executionInputSources: {},
    },
    expected: { ...parentExecution, permissionMode: "accept-edits" },
  },
  {
    name: "falls back to project defaults when the parent provider is disabled",
    parent: liveParent("claude-code", "accept-edits"),
    projectPermissionMode: "auto",
    disabledProviderIds: ["claude-code"],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: {},
    expected: { ...projectExecution, permissionMode: "accept-edits" },
  },
  {
    name: "maps a legacy readonly parent mode before inheriting it",
    parent: liveParent("codex", "readonly"),
    projectPermissionMode: "full",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: {},
    expected: { ...parentExecution, permissionMode: "accept-edits" },
  },
  {
    name: "resolves an inherited mode to the child provider's supported mode",
    parent: liveParent("codex", "workspace-write"),
    projectPermissionMode: "accept-edits",
    disabledProviderIds: [],
    childProviderId: "pi",
    childRecordedPermissionMode: null,
    request: { providerId: "pi", model: piModel },
    expected: {
      ...projectExecution,
      model: piModel,
      permissionMode: "full",
    },
  },
  {
    name: "runs a Pi child of an auto parent at full",
    parent: liveParent("codex", "auto"),
    projectPermissionMode: null,
    disabledProviderIds: [],
    childProviderId: "pi",
    childRecordedPermissionMode: null,
    request: { providerId: "pi", model: piModel },
    expected: { ...projectExecution, model: piModel, permissionMode: "full" },
  },
  {
    name: "honors a requested full mode for a Pi child of an auto parent",
    parent: liveParent("codex", "auto"),
    projectPermissionMode: null,
    disabledProviderIds: [],
    childProviderId: "pi",
    childRecordedPermissionMode: null,
    request: { providerId: "pi", model: piModel, permissionMode: "full" },
    expected: { ...projectExecution, model: piModel, permissionMode: "full" },
  },
  {
    name: "honors an explicitly requested mode above the parent's",
    parent: liveParent("codex", "auto"),
    projectPermissionMode: "auto",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: { permissionMode: "full" },
    expected: { ...parentExecution, permissionMode: "full" },
  },
  {
    name: "allows a child to run below its parent's mode",
    parent: liveParent("codex", "full"),
    projectPermissionMode: "auto",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: { permissionMode: "accept-edits" },
    expected: { ...parentExecution, permissionMode: "accept-edits" },
  },
  {
    name: "uses project defaults for a root thread",
    parent: null,
    projectPermissionMode: "accept-edits",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: {},
    expected: { ...projectExecution, permissionMode: "accept-edits" },
  },
  {
    name: "defaults a root Codex thread to auto",
    parent: null,
    projectPermissionMode: null,
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: { model: "gpt-5" },
    expected: { ...projectExecution, model: "gpt-5", permissionMode: "auto" },
  },
  {
    name: "defaults a child to auto without parent history or project defaults",
    parent: liveParent("codex", null),
    projectPermissionMode: null,
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: { model: "gpt-5" },
    expected: { ...projectExecution, model: "gpt-5", permissionMode: "auto" },
  },
  {
    name: "defaults a Pi child to full without parent history",
    parent: liveParent("pi", null),
    projectPermissionMode: null,
    disabledProviderIds: [],
    childProviderId: "pi",
    childRecordedPermissionMode: null,
    request: { providerId: "pi", model: piModel },
    expected: { ...projectExecution, model: piModel, permissionMode: "full" },
  },
  {
    name: "uses root defaults when the parent is deleted",
    parent: {
      deleted: true,
      providerId: "codex",
      recordedPermissionMode: "full",
    },
    projectPermissionMode: "accept-edits",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: null,
    request: {},
    expected: { ...projectExecution, permissionMode: "accept-edits" },
  },
  {
    name: "prefers a requested mode over the child's recorded mode",
    parent: null,
    projectPermissionMode: "full",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: "workspace-write",
    request: { permissionMode: "auto" },
    expected: { ...childRecordedExecution, permissionMode: "auto" },
  },
  {
    name: "maps a legacy readonly recorded mode to Accept Edits",
    parent: null,
    projectPermissionMode: "full",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: "readonly",
    request: {},
    expected: { ...childRecordedExecution, permissionMode: "accept-edits" },
  },
  {
    name: "keeps the child's recorded execution above the parent's",
    parent: liveParent("codex", "auto"),
    projectPermissionMode: "auto",
    disabledProviderIds: [],
    childProviderId: "codex",
    childRecordedPermissionMode: "full",
    request: {},
    expected: { ...childRecordedExecution, permissionMode: "full" },
  },
  {
    name: "keeps a Pi child's recorded full mode under an auto parent",
    parent: liveParent("codex", "auto"),
    projectPermissionMode: null,
    disabledProviderIds: [],
    childProviderId: "pi",
    childRecordedPermissionMode: "full",
    request: { model: piModel },
    expected: {
      ...childRecordedExecution,
      model: piModel,
      permissionMode: "full",
    },
  },
];

async function seedCase(
  harness: TestAppHarness,
  testCase: ExecutionDefaultsCase,
) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const parent =
    testCase.parent === null
      ? null
      : seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          providerId: testCase.parent.providerId,
        });
  if (parent !== null && testCase.parent?.recordedPermissionMode) {
    seedThreadRuntimeState(harness.deps, {
      threadId: parent.id,
      environmentId: environment.id,
      providerThreadId: "parent-session",
      ...parentExecution,
      permissionMode: testCase.parent.recordedPermissionMode,
    });
  }
  if (testCase.projectPermissionMode !== null) {
    upsertProjectExecutionDefaults(harness.db, {
      projectId: project.id,
      providerId: "codex",
      ...projectExecution,
      permissionMode: testCase.projectPermissionMode,
    });
  }
  setDisabledProviderIds(harness.db, testCase.disabledProviderIds);
  return { environment, host, parent, project };
}

describe("thread execution defaults", () => {
  it.each(
    cases.filter(
      (testCase) =>
        testCase.parent?.deleted !== true &&
        testCase.childRecordedPermissionMode === null,
    ),
  )("creates: $name", async (testCase) => {
    await withTestHarness(async (harness) => {
      const { environment, host, parent, project } = await seedCase(
        harness,
        testCase,
      );
      await seedModelCatalog(harness, {
        hostId: host.id,
        providerId: testCase.childProviderId,
        models: [
          availableModelFixture({
            model: testCase.expected.model,
            reasoningLevels: [testCase.expected.reasoningLevel],
          }),
        ],
      });

      const child = await createThreadFromRequest(harness.deps, {
        projectId: project.id,
        ...(parent !== null ? { parentThreadId: parent.id } : {}),
        environment: { type: "reuse", environmentId: environment.id },
        input: textInput("Check execution defaults"),
        origin: "cli",
        startedOnBehalfOf: null,
        ...testCase.request,
      });
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === child.id,
      );
      if (start.command.type !== "thread.start") {
        throw new Error("Expected child start command");
      }

      expect(child.providerId).toBe(testCase.childProviderId);
      expect({
        model: start.command.options.model,
        permissionMode: start.command.options.permissionMode,
        reasoningLevel: start.command.options.reasoningLevel,
        serviceTier: start.command.options.serviceTier,
      }).toEqual(testCase.expected);
    });
  });

  it.each(cases)("resolves an existing thread: $name", async (testCase) => {
    await withTestHarness(async (harness) => {
      const { environment, parent, project } = await seedCase(
        harness,
        testCase,
      );
      if (parent !== null && testCase.parent?.deleted) {
        markThreadDeleted(harness.db, harness.hub, { threadId: parent.id });
      }
      const child = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: parent?.id ?? null,
        providerId: testCase.childProviderId,
      });
      if (testCase.childRecordedPermissionMode !== null) {
        seedThreadRuntimeState(harness.deps, {
          threadId: child.id,
          environmentId: environment.id,
          providerThreadId: "child-session",
          ...childRecordedExecution,
          permissionMode: testCase.childRecordedPermissionMode,
        });
      }
      const { providerId: _providerId, ...request } = testCase.request;

      const execution = await buildExecutionOptions(harness.deps, request, {
        threadId: child.id,
      });

      expect({
        model: execution.model,
        permissionMode: execution.permissionMode,
        reasoningLevel: execution.reasoningLevel,
        serviceTier: execution.serviceTier,
      }).toEqual(testCase.expected);
      if (request.permissionMode === undefined) {
        expect(
          resolveExistingThreadPermissionMode(harness.deps, child.id),
        ).toBe(testCase.expected.permissionMode);
      }
    });
  });
});
