import {
  collectOptionalFieldPaths,
  makeWorkspaceStatus,
} from "@bb/test-helpers";
import type { WorkspaceResolutionFailure } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import publicApiSource from "../src/public-api.ts?raw";
import * as contract from "../src/index.js";
import {
  PROJECT_CHANGE_KINDS,
  SYSTEM_CHANGE_KINDS,
  TERMINAL_COLS_MAX,
  TERMINAL_DATA_MAX_BASE64_LENGTH,
  TERMINAL_DATA_MAX_BYTES,
  TERMINAL_ROWS_MAX,
  automationSchema,
  createAutomationRequestSchema,
  createThreadTerminalRequestSchema,
  createHostJoinRequestSchema,
  createHostJoinResponseSchema,
  createLocalPersistentHostJoinRequest,
  createPersistentHostJoinRequest,
  createQueuedMessageRequestSchema,
  createManagerThreadRequestSchema,
  createProjectSourceRequestSchema,
  createPublicApiClient,
  createThreadRequestSchema,
  environmentActionRequestSchema,
  baseBranchSpecSchema,
  gitBranchNameSchema,
  reorderPinnedThreadRequestSchema,
  reorderQueuedMessageRequestSchema,
  resolvePendingInteractionRequestSchema,
  sendQueuedMessageRequestSchema,
  sendMessageRequestSchema,
  terminalClientMessageSchema,
  terminalOutputChunkSchema,
  threadListResponseSchema,
  threadPendingInteractionsResponseSchema,
  timelineTurnSummaryDetailsResponseSchema,
  updateEnvironmentRequestSchema,
  updateAutomationRequestSchema,
  unmanagedBranchSpecSchema,
} from "../src/index.js";

const INTENTIONAL_OPTIONAL_SERVER_FIELDS: Record<string, string> = {
  "apiErrorSchema.details":
    "Base error details are omitted unless a route has structured detail payloads.",
  "apiErrorSchema.retryable":
    "Error payloads may omit retryability when the server has no retry guidance.",
  "appDataListQuerySchema.prefix":
    "App data listing may omit prefix to list every value file under the app data root.",
  "appManifestSchema.entry":
    "App manifests may omit entry so the server can resolve index.html then index.md at the boundary.",
  "appManifestSchema.icon":
    "App manifests may omit icon so the server can resolve a logo file or the GridView fallback.",
  "appManifestSchema.name":
    "App manifests may omit name; the display label falls back to the slug applicationId when unset.",
  "createAutomationRequestSchema.action.threadRequest.environment.workspace.branch":
    "Unmanaged workspaces may omit branch when the daemon should not check out before starting the thread.",
  "createAutomationRequestSchema.action.threadRequest.environment.hostId":
    "Personal scheduled threads may omit hostId so the server can use the default connected local host.",
  "createAutomationRequestSchema.action.threadRequest.parentThreadId":
    "Automation creation may omit parentThreadId when the scheduled thread stays a root thread.",
  "createAutomationRequestSchema.action.threadRequest.permissionMode":
    "Automation creation may omit permissionMode and inherit the scheduled thread default.",
  "createAutomationRequestSchema.action.threadRequest.reasoningLevel":
    "Automation creation may omit reasoningLevel and inherit the scheduled thread default.",
  "createAutomationRequestSchema.action.threadRequest.serviceTier":
    "Automation creation may omit serviceTier and inherit the scheduled thread default.",
  "createAutomationRequestSchema.action.threadRequest.title":
    "Automation creation may omit title and use the generated thread title flow.",
  "createAutomationRequestSchema.autoArchive":
    "Automation creation may omit autoArchive and use the server default.",
  "createAutomationRequestSchema.enabled":
    "Automation creation may omit enabled and use the server default.",
  "createHostJoinRequestSchema.hostId":
    "Host join initiation may omit hostId when the server should generate a new persistent host id.",
  "createHostJoinRequestSchema.hostType":
    "Host join initiation may omit hostType and let the server choose the default persistent host policy.",
  "createQueuedMessageRequestSchema.model":
    "Queued messages may inherit the thread's default model.",
  "createQueuedMessageRequestSchema.reasoningLevel":
    "Queued messages may inherit the thread's default reasoning level.",
  "createQueuedMessageRequestSchema.permissionMode":
    "Queued messages may inherit the thread's default permission mode.",
  "createQueuedMessageRequestSchema.serviceTier":
    "Queued messages may inherit the thread's default service tier.",
  "createQueuedMessageRequestSchema.executionInputSources":
    "Queued message callers may omit source metadata; legacy callers treat supplied execution fields as explicit.",
  "createQueuedMessageRequestSchema.executionInputSources.model":
    "Queued message source metadata omits model when no caller-owned model value is being supplied.",
  "createQueuedMessageRequestSchema.executionInputSources.permissionMode":
    "Queued message source metadata omits permissionMode when no caller-owned permission value is being supplied.",
  "createQueuedMessageRequestSchema.executionInputSources.reasoningLevel":
    "Queued message source metadata omits reasoningLevel when no caller-owned reasoning value is being supplied.",
  "createQueuedMessageRequestSchema.executionInputSources.serviceTier":
    "Queued message source metadata omits serviceTier when no caller-owned tier value is being supplied.",
  "updateAutomationRequestSchema.action":
    "Automation PATCH requests omit action when leaving it unchanged.",
  "updateAutomationRequestSchema.action.threadRequest.environment.workspace.branch":
    "Unmanaged workspaces may omit branch when the daemon should not check out before starting the thread.",
  "updateAutomationRequestSchema.action.threadRequest.environment.hostId":
    "Personal scheduled-thread updates may omit hostId so the server can use the default connected local host.",
  "updateAutomationRequestSchema.action.threadRequest.parentThreadId":
    "Automation action updates may omit parentThreadId when the scheduled thread stays a root thread.",
  "updateAutomationRequestSchema.action.threadRequest.permissionMode":
    "Automation action updates may omit permissionMode and inherit the scheduled thread default.",
  "updateAutomationRequestSchema.action.threadRequest.reasoningLevel":
    "Automation action updates may omit reasoningLevel and inherit the scheduled thread default.",
  "updateAutomationRequestSchema.action.threadRequest.serviceTier":
    "Automation action updates may omit serviceTier and inherit the scheduled thread default.",
  "updateAutomationRequestSchema.action.threadRequest.title":
    "Automation action updates may omit title and use the generated thread title flow.",
  "updateAutomationRequestSchema.autoArchive":
    "Automation PATCH requests omit autoArchive when leaving it unchanged.",
  "updateAutomationRequestSchema.name":
    "Automation PATCH requests omit name when leaving it unchanged.",
  "updateAutomationRequestSchema.trigger":
    "Automation PATCH requests omit trigger when leaving it unchanged.",
  "createManagerThreadRequestSchema.model":
    "Manager creation may omit model and inherit remembered manager defaults for the resolved provider or the server manager default.",
  "createManagerThreadRequestSchema.name":
    "Manager creation may omit a custom name and use the server-generated default.",
  "createManagerThreadRequestSchema.providerId":
    "Manager creation may omit providerId and use remembered manager defaults or the server manager default.",
  "createManagerThreadRequestSchema.reasoningLevel":
    "Manager creation may omit reasoning level and use the server default.",
  "createManagerThreadRequestSchema.serviceTier":
    "Manager creation may omit service tier and use the server default.",
  "createManagerThreadRequestSchema.executionInputSources":
    "Manager creation may omit source metadata; legacy callers treat supplied execution fields as explicit.",
  "createManagerThreadRequestSchema.executionInputSources.model":
    "Manager creation source metadata omits model when the client is only displaying the server default.",
  "createManagerThreadRequestSchema.executionInputSources.providerId":
    "Manager creation source metadata omits providerId when the client is only displaying the server default.",
  "createManagerThreadRequestSchema.executionInputSources.reasoningLevel":
    "Manager creation source metadata omits reasoningLevel when the client is only displaying the server default.",
  "createManagerThreadRequestSchema.executionInputSources.serviceTier":
    "Manager creation source metadata omits serviceTier when the client is only displaying the server default.",
  "createManagerThreadRequestSchema.input":
    "Manager creation may omit initial input and use the server welcome-message template.",
  "createThreadRequestSchema.environment.workspace.branch":
    "Unmanaged workspaces may omit branch when the daemon should not check out before starting the thread.",
  "createThreadRequestSchema.environment.hostId":
    "Personal thread creation may omit hostId so the server can use the default connected local host.",
  "createThreadRequestSchema.model":
    "Thread creation may omit model and inherit the project/provider default.",
  "createThreadRequestSchema.parentThreadId":
    "Root thread creation omits a parent thread id.",
  "createThreadRequestSchema.providerId":
    "Thread creation may omit providerId and use the project's remembered provider choice.",
  "createThreadRequestSchema.permissionMode":
    "Thread creation may omit permission mode and use the server default.",
  "createThreadRequestSchema.reasoningLevel":
    "Thread creation may omit reasoning level and use the server default.",
  "createThreadRequestSchema.serviceTier":
    "Thread creation may omit service tier and use the server default.",
  "createThreadRequestSchema.executionInputSources":
    "Thread creation may omit source metadata; legacy callers treat supplied execution fields as explicit.",
  "createThreadRequestSchema.executionInputSources.model":
    "Thread creation source metadata omits model when the client is only displaying the server default.",
  "createThreadRequestSchema.executionInputSources.permissionMode":
    "Thread creation source metadata omits permissionMode when the client is only displaying the server default.",
  "createThreadRequestSchema.executionInputSources.providerId":
    "Thread creation source metadata omits providerId when the client is only displaying the server default.",
  "createThreadRequestSchema.executionInputSources.reasoningLevel":
    "Thread creation source metadata omits reasoningLevel when the client is only displaying the server default.",
  "createThreadRequestSchema.executionInputSources.serviceTier":
    "Thread creation source metadata omits serviceTier when the client is only displaying the server default.",
  "createThreadRequestSchema.title":
    "Thread creation may omit a custom title and use the generated title flow.",
  "environmentActionApiErrorSchema.details":
    "Some environment action failures do not have structured detail payloads.",
  "environmentActionApiErrorSchema.retryable":
    "Environment action errors may omit retryability when no retry hint exists.",
  "threadStorageFilesQuerySchema.limit":
    "Thread storage file listing may omit limit to use the default result count.",
  "threadStorageFilesQuerySchema.query":
    "Thread storage file listing may omit a search string to list files without filtering.",
  "projectFilesQuerySchema.limit":
    "Project file search may omit limit to use the server-side default result count.",
  "projectFilesQuerySchema.query":
    "Project file search may omit a search string to list files without filtering.",
  "sendMessageRequestSchema.model":
    "Follow-up sends may inherit the thread's default model.",
  "sendMessageRequestSchema.permissionMode":
    "Follow-up sends may inherit the thread's current permission mode.",
  "sendMessageRequestSchema.reasoningLevel":
    "Follow-up sends may inherit the thread's default reasoning level.",
  "sendMessageRequestSchema.senderThreadId":
    "Immediate agent-to-agent CLI sends include the current thread; user-originated sends and queued messages omit live sender context.",
  "sendMessageRequestSchema.serviceTier":
    "Follow-up sends may inherit the thread's default service tier.",
  "sendMessageRequestSchema.executionInputSources":
    "Follow-up sends may omit source metadata; legacy callers treat supplied execution fields as explicit.",
  "sendMessageRequestSchema.executionInputSources.model":
    "Follow-up source metadata omits model when no caller-owned model value is being supplied.",
  "sendMessageRequestSchema.executionInputSources.permissionMode":
    "Follow-up source metadata omits permissionMode when no caller-owned permission value is being supplied.",
  "sendMessageRequestSchema.executionInputSources.reasoningLevel":
    "Follow-up source metadata omits reasoningLevel when no caller-owned reasoning value is being supplied.",
  "sendMessageRequestSchema.executionInputSources.serviceTier":
    "Follow-up source metadata omits serviceTier when no caller-owned tier value is being supplied.",
  "systemExecutionOptionsQuerySchema.environmentId":
    "System execution option lookup may target a host indirectly through an environment id.",
  "systemExecutionOptionsQuerySchema.hostId":
    "System execution option lookup may target a specific host directly.",
  "systemExecutionOptionsQuerySchema.providerId":
    "System execution option lookup may omit provider id to use the chosen host's default provider.",
  "systemProvidersQuerySchema.environmentId":
    "System provider lookup may target a host indirectly through an environment id.",
  "systemProvidersQuerySchema.hostId":
    "System provider lookup may target a specific host directly.",
  "threadEventsQuerySchema.afterSeq":
    "Thread event listing may omit afterSeq to start from the beginning.",
  "threadEventsQuerySchema.limit":
    "Thread event listing may omit limit to use the server-side default page size.",
  "threadListQuerySchema.archived":
    "Thread listing may omit archived to include both archived and unarchived threads.",
  "threadListQuerySchema.limit":
    "Thread listing may omit limit to return all matching threads without pagination.",
  "threadListQuerySchema.managed":
    "Thread listing may omit managed to include both managed and unmanaged threads.",
  "threadListQuerySchema.offset":
    "Thread listing may omit offset to start from the first row.",
  "threadListQuerySchema.parentThreadId":
    "Thread listing may omit parentThreadId when not filtering by parent.",
  "threadListQuerySchema.projectId":
    "Thread listing may omit projectId to list across projects.",
  "threadListQuerySchema.type":
    "Thread listing may omit type when not filtering by thread type.",
  "threadTimelineQuerySchema.managerTimelineView":
    "Timeline queries may omit managerTimelineView unless explicitly requesting the standard manager timeline.",
  "threadTimelineQuerySchema.includeNestedRows":
    "Timeline queries may omit nested rows unless explicitly requested.",
  "threadTimelineQuerySchema.segmentLimit":
    "Timeline queries may omit segmentLimit to use the server-side default page size.",
  "threadTimelineQuerySchema.beforeAnchorSeq":
    "Timeline queries omit beforeAnchorSeq when requesting the latest page.",
  "threadTimelineQuerySchema.beforeAnchorId":
    "Timeline queries omit beforeAnchorId when requesting the latest page.",
  "threadTimelineQuerySchema.summaryOnly":
    "Timeline queries may omit summaryOnly; CLI sets it to skip row generation, web client always wants rows.",
  "threadTimelineResponseSchema.contextWindowUsage":
    "Timeline responses omit context window usage when the provider did not report it.",
  "timelineTurnSummaryDetailsQuerySchema.managerTimelineView":
    "Turn summary detail queries may omit managerTimelineView unless explicitly requesting the standard manager timeline.",
  "timelineTurnSummaryDetailsRequestSchema.managerTimelineView":
    "Turn summary detail requests may omit managerTimelineView unless explicitly requesting the standard manager timeline.",
  "updateProjectRequestSchema.name":
    "Project PATCH requests omit name when leaving it unchanged.",
  "updateProjectSourceRequestSchema.isDefault":
    "Project source PATCH requests omit isDefault when not changing the default source.",
  "updateProjectSourceRequestSchema.path":
    "Project source PATCH requests omit path when leaving it unchanged.",
  "updateThreadRequestSchema.model":
    "Thread PATCH requests omit model when leaving the sticky model override unchanged or use null to clear it.",
  "updateThreadRequestSchema.parentThreadId":
    "Thread PATCH requests omit parentThreadId when leaving it unchanged or use null to clear it.",
  "updateThreadRequestSchema.reasoningLevel":
    "Thread PATCH requests omit reasoningLevel when leaving the sticky reasoning override unchanged or use null to clear it.",
  "updateThreadRequestSchema.title":
    "Thread PATCH requests omit title when leaving it unchanged or use null to clear it.",
  "uploadedPromptAttachmentSchema.mimeType":
    "Uploaded attachments may omit mime type when the client could not determine one.",
};

function terminalDataBase64(byteLength: number): string {
  return Buffer.alloc(byteLength, "a").toString("base64");
}

const WORKSPACE_RESOLUTION_FAILURE: WorkspaceResolutionFailure = {
  code: "path_not_found",
  workspacePath: "/tmp/missing-workspace",
  message: "Managed workspace path does not exist: /tmp/missing-workspace",
};

describe("environment workspace response contract", () => {
  it("uses explicit status outcomes instead of nullable parallel fields", () => {
    expect(
      contract.environmentStatusResponseSchema.safeParse({
        outcome: "available",
        workspace: makeWorkspaceStatus(),
      }).success,
    ).toBe(true);
    expect(
      contract.environmentStatusResponseSchema.safeParse({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "Workspace status is not available for non-git environments",
      }).success,
    ).toBe(true);
    expect(
      contract.environmentStatusResponseSchema.safeParse({
        outcome: "unavailable",
        failure: WORKSPACE_RESOLUTION_FAILURE,
      }).success,
    ).toBe(true);
    expect(
      contract.environmentStatusResponseSchema.safeParse({
        workspace: null,
        workspaceUnavailable: null,
      }).success,
    ).toBe(false);
  });

  it("uses explicit diff outcomes instead of nullable parallel fields", () => {
    expect(
      contract.environmentDiffResponseSchema.safeParse({
        outcome: "available",
        diff: {
          diff: "",
          files: "",
          mergeBaseRef: null,
          shortstat: "",
          truncated: false,
        },
      }).success,
    ).toBe(true);
    expect(
      contract.environmentDiffResponseSchema.safeParse({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "Workspace diff is not available for non-git environments",
      }).success,
    ).toBe(true);
    expect(
      contract.environmentDiffResponseSchema.safeParse({
        outcome: "unavailable",
        failure: WORKSPACE_RESOLUTION_FAILURE,
      }).success,
    ).toBe(true);
    expect(
      contract.environmentDiffResponseSchema.safeParse({
        diff: null,
        workspaceUnavailable: WORKSPACE_RESOLUTION_FAILURE,
      }).success,
    ).toBe(false);
  });

  it("types workspace unavailable environment action errors", () => {
    expect(
      contract.environmentActionApiErrorSchema.safeParse({
        code: "workspace_unavailable",
        message: WORKSPACE_RESOLUTION_FAILURE.message,
        details: {
          kind: "workspace_unavailable",
          failure: WORKSPACE_RESOLUTION_FAILURE,
        },
      }).success,
    ).toBe(true);
  });
});

describe("git branch name contract", () => {
  it("accepts valid branch names", () => {
    const validNames = [
      "main",
      "release/1.2",
      "feature.foo",
      "user_name",
      "bb/thread-123",
    ];

    for (const name of validNames) {
      expect(gitBranchNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("rejects names git may parse ambiguously or refuses as refs", () => {
    const invalidNames = [
      "",
      "   ",
      "-release",
      "/release",
      ".release",
      "bar/.hidden",
      "bad\nbranch",
      "bad\u007fbranch",
      "bad branch",
      "bad\tbranch",
      "bad..branch",
      "bad@{branch",
      "bad\\branch",
      "bad:branch",
      "bad~branch",
      "bad^branch",
      "bad?branch",
      "bad*branch",
      "bad[branch",
      "bad/",
      "bad.lock",
      "bad.lock/branch",
      "bad//branch",
      "bad.",
      "@",
      "HEAD",
      "FETCH_HEAD",
    ];

    for (const name of invalidNames) {
      expect(gitBranchNameSchema.safeParse(name).success).toBe(false);
    }
  });

  it("uses the shared validator for managed and unmanaged branch specs", () => {
    expect(
      baseBranchSpecSchema.safeParse({
        kind: "named",
        name: "release/1.2",
      }).success,
    ).toBe(true);
    expect(
      baseBranchSpecSchema.safeParse({ kind: "named", name: "-release" })
        .success,
    ).toBe(false);
    expect(
      unmanagedBranchSpecSchema.safeParse({
        kind: "existing",
        name: "release/1.2",
      }).success,
    ).toBe(true);
    expect(
      unmanagedBranchSpecSchema.safeParse({
        kind: "existing",
        name: "release/1.2",
        mergeBaseBranch: "origin/main",
      }).success,
    ).toBe(false);
    expect(
      unmanagedBranchSpecSchema.safeParse({
        kind: "new",
        baseBranch: "release/1.2",
      }).success,
    ).toBe(true);
    expect(
      unmanagedBranchSpecSchema.safeParse({
        kind: "existing",
        name: "release 1.2",
      }).success,
    ).toBe(false);
    expect(
      unmanagedBranchSpecSchema.safeParse({
        kind: "new",
        baseBranch: "release 1.2",
      }).success,
    ).toBe(false);
    expect(
      contract.environmentDiffBranchesQuerySchema.safeParse({
        selectedBranch: "origin/main",
      }).success,
    ).toBe(true);
    expect(
      contract.environmentDiffBranchesQuerySchema.safeParse({
        selectedBranch: "origin/main lock",
      }).success,
    ).toBe(false);
    expect(
      contract.projectBranchesQuerySchema.safeParse({
        hostId: "host_123",
        selectedBranch: "upstream/main",
      }).success,
    ).toBe(true);
    expect(
      contract.projectBranchesQuerySchema.safeParse({
        hostId: "host_123",
        selectedBranch: "upstream/main lock",
      }).success,
    ).toBe(false);
    expect(
      contract.squashMergeOptionsSchema.safeParse({
        mergeBaseBranch: "origin/main",
      }).success,
    ).toBe(true);
    expect(
      contract.squashMergeOptionsSchema.safeParse({
        mergeBaseBranch: "origin/main lock",
      }).success,
    ).toBe(false);
    expect(
      updateEnvironmentRequestSchema.safeParse({
        mergeBaseBranch: "origin/main",
      }).success,
    ).toBe(true);
    expect(
      updateEnvironmentRequestSchema.safeParse({
        mergeBaseBranch: "origin/main lock",
      }).success,
    ).toBe(false);
    expect(
      contract.environmentStatusQuerySchema.safeParse({
        mergeBaseBranch: "origin/main",
      }).success,
    ).toBe(true);
    expect(
      contract.environmentStatusQuerySchema.safeParse({
        mergeBaseBranch: "origin/main lock",
      }).success,
    ).toBe(false);
    expect(
      contract.environmentDiffQuerySchema.safeParse({
        target: "all",
        mergeBaseBranch: "origin/main",
      }).success,
    ).toBe(true);
    expect(
      contract.environmentDiffQuerySchema.safeParse({
        target: "all",
        mergeBaseBranch: "origin/main lock",
      }).success,
    ).toBe(false);
  });
});

describe("public terminal contracts", () => {
  it("bounds terminal dimensions", () => {
    expect(
      createThreadTerminalRequestSchema.safeParse({
        cols: TERMINAL_COLS_MAX,
        rows: TERMINAL_ROWS_MAX,
      }).success,
    ).toBe(true);
    expect(
      createThreadTerminalRequestSchema.safeParse({
        cols: TERMINAL_COLS_MAX + 1,
        rows: TERMINAL_ROWS_MAX,
      }).success,
    ).toBe(false);
    expect(
      terminalClientMessageSchema.safeParse({
        type: "resize",
        cols: TERMINAL_COLS_MAX,
        rows: TERMINAL_ROWS_MAX + 1,
      }).success,
    ).toBe(false);
  });

  it("bounds and validates terminal data payloads", () => {
    const maxPayload = terminalDataBase64(TERMINAL_DATA_MAX_BYTES);
    const oversizedDecodedPayload = terminalDataBase64(
      TERMINAL_DATA_MAX_BYTES + 1,
    );
    const oversizedEncodedPayload = "A".repeat(
      TERMINAL_DATA_MAX_BASE64_LENGTH + 4,
    );

    expect(
      terminalClientMessageSchema.safeParse({
        type: "input",
        dataBase64: maxPayload,
      }).success,
    ).toBe(true);
    expect(
      terminalOutputChunkSchema.safeParse({
        seq: 0,
        dataBase64: maxPayload,
      }).success,
    ).toBe(true);
    expect(
      terminalClientMessageSchema.safeParse({
        type: "input",
        dataBase64: oversizedDecodedPayload,
      }).success,
    ).toBe(false);
    expect(
      terminalOutputChunkSchema.safeParse({
        seq: 0,
        dataBase64: "not base64!",
      }).success,
    ).toBe(false);
    expect(
      terminalClientMessageSchema.safeParse({
        type: "input",
        dataBase64: oversizedEncodedPayload,
      }).success,
    ).toBe(false);
  });
});

describe("server-contract canonical schemas", () => {
  it("parses lifecycle API error envelopes by code", () => {
    expect(
      contract.lifecycleApiErrorSchema.parse({
        code: "environment_not_ready",
        message: "Environment unavailable",
        details: {
          environmentStatus: "destroyed",
          hasPath: false,
          cleanupRequestedAt: 123,
        },
      }),
    ).toMatchObject({
      code: "environment_not_ready",
      details: { environmentStatus: "destroyed" },
    });

    expect(
      contract.lifecycleApiErrorSchema.parse({
        code: "thread_not_writable",
        message: "Thread is not writable",
        details: {
          reason: "not_active",
          archivedAt: null,
          stopRequestedAt: null,
          threadStatus: "idle",
        },
      }),
    ).toMatchObject({
      code: "thread_not_writable",
      details: { reason: "not_active" },
    });

    expect(
      contract.lifecycleApiErrorSchema.parse({
        code: "thread_environment_unavailable",
        message: "Thread environment is unavailable",
        details: {
          reason: "never_attached",
          environmentStatus: null,
        },
      }),
    ).toMatchObject({
      code: "thread_environment_unavailable",
      details: { reason: "never_attached" },
    });

    expect(
      contract.lifecycleApiErrorSchema.parse({
        code: "host_unavailable",
        message: "Host is unavailable",
        details: {
          reason: "disconnected",
          hostStatus: "disconnected",
          suspendedAt: null,
          destroyedAt: null,
        },
      }),
    ).toMatchObject({
      code: "host_unavailable",
      details: { reason: "disconnected" },
    });

    expect(
      contract.lifecycleApiErrorSchema.parse({
        code: "project_unavailable",
        message: "Project is unavailable",
        details: {
          reason: "pending_deletion",
          deletedAt: null,
        },
      }),
    ).toMatchObject({
      code: "project_unavailable",
      details: { reason: "pending_deletion" },
    });

    expect(
      contract.lifecycleApiErrorSchema.parse({
        code: "parent_thread_invalid",
        message: "Parent thread is invalid",
        details: {
          reason: "not_a_manager",
          subject: "parent",
        },
      }),
    ).toMatchObject({
      code: "parent_thread_invalid",
      details: { reason: "not_a_manager", subject: "parent" },
    });

    expect(() =>
      contract.lifecycleApiErrorSchema.parse({
        code: "thread_not_writable",
        message: "Thread is not writable",
        details: {
          reason: "destroyed",
          archivedAt: null,
          stopRequestedAt: null,
          threadStatus: "idle",
        },
      }),
    ).toThrow();
  });

  it("validates app manifests, icon names, entries, and data broadcasts", () => {
    const manifest = {
      manifestVersion: 1,
      id: "status",
      name: "Status",
      icon: "ListTodo",
      entry: "index.html",
      capabilities: ["data", "message"],
    };

    expect(contract.appManifestSchema.parse(manifest)).toEqual(manifest);
    expect(
      contract.appManifestSchema.parse({
        ...manifest,
        name: undefined,
      }),
    ).toEqual({
      ...manifest,
      name: "status",
    });
    expect(
      contract.appManifestSchema.parse({
        ...manifest,
        name: "",
      }),
    ).toEqual({
      ...manifest,
      name: "status",
    });
    expect(
      contract.appManifestSchema.safeParse({
        ...manifest,
        icon: "MissingIcon",
      }).success,
    ).toBe(false);
    expect(
      contract.appManifestSchema.safeParse({
        ...manifest,
        entry: "../index.html",
      }).success,
    ).toBe(false);
    expect(
      contract.appManifestSchema.safeParse({
        ...manifest,
        id: "Bad",
      }).success,
    ).toBe(false);
    expect(
      contract.appManifestSchema.safeParse({
        ...manifest,
        contributions: ["sidebar"],
      }).success,
    ).toBe(false);

    const message = {
      type: "app-data.changed",
      applicationId: "status",
      path: "state.json",
      value: { workers: [] },
      deleted: false,
      version: "next-hash",
    };
    expect(contract.appDataBroadcastMessageSchema.parse(message)).toEqual(
      message,
    );
    expect(
      contract.appDataBroadcastMessageSchema.parse({
        ...message,
        value: null,
        deleted: true,
        version: null,
      }),
    ).toMatchObject({
      deleted: true,
      version: null,
    });
    expect(
      contract.appDataBroadcastMessageSchema.parse({
        type: "app-data.resync",
        applicationId: "status",
      }),
    ).toEqual({
      type: "app-data.resync",
      applicationId: "status",
    });
  });

  it("parses request contracts", () => {
    expect(
      createAutomationRequestSchema.parse({
        name: "Daily summary",
        trigger: {
          cron: "0 8 * * 1-5",
          timezone: "America/Los_Angeles",
          triggerType: "schedule",
        },
        action: {
          actionType: "scheduled-thread",
          threadRequest: {
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Summarize yesterday's work" }],
            environment: {
              type: "host",
              hostId: "host_abc",
              workspace: {
                type: "managed-worktree",
                baseBranch: { kind: "default" },
              },
            },
          },
        },
      }),
    ).toMatchObject({
      name: "Daily summary",
    });

    expect(
      automationSchema.parse({
        id: "auto_123",
        projectId: "proj_123",
        name: "Daily summary",
        enabled: true,
        trigger: {
          cron: "0 8 * * 1-5",
          timezone: "America/Los_Angeles",
          triggerType: "schedule",
        },
        action: {
          actionType: "scheduled-thread",
          threadRequest: {
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Summarize yesterday's work" }],
            environment: {
              type: "host",
              hostId: "host_abc",
              workspace: {
                type: "managed-worktree",
                baseBranch: { kind: "default" },
              },
            },
          },
        },
        autoArchive: false,
        nextRunAt: 123,
        lastRunAt: null,
        runCount: 0,
        isValid: true,
        validationIssues: [],
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toMatchObject({
      id: "auto_123",
      projectId: "proj_123",
    });

    expect(
      createHostJoinRequestSchema.parse({
        hostType: "persistent",
      }),
    ).toMatchObject({
      hostType: "persistent",
    });

    expect(createHostJoinRequestSchema.parse({})).toEqual({});

    expect(
      createHostJoinRequestSchema.parse({
        hostId: "host_local",
        hostType: "persistent",
        joinMode: "local",
      }),
    ).toMatchObject({
      hostId: "host_local",
      hostType: "persistent",
      joinMode: "local",
    });

    expect(() =>
      createHostJoinRequestSchema.parse({
        joinMode: "local",
      }),
    ).toThrow();

    expect(
      createPersistentHostJoinRequest({ hostId: "host_persistent" }),
    ).toEqual({
      hostId: "host_persistent",
      hostType: "persistent",
    });
    expect(createPersistentHostJoinRequest({ hostId: null })).toEqual({
      hostType: "persistent",
    });
    expect(
      createLocalPersistentHostJoinRequest({ hostId: "host_local" }),
    ).toEqual({
      hostId: "host_local",
      hostType: "persistent",
      joinMode: "local",
    });
    expect(createLocalPersistentHostJoinRequest({ hostId: null })).toEqual({
      hostType: "persistent",
      joinMode: "local",
    });

    expect(
      createHostJoinResponseSchema.parse({
        expiresAt: 123456789,
        hostId: "host_123",
        joinCode: "bbde_example",
        joinCommand:
          "npx bb-app --server-url http://localhost:3334 --enroll-key bbde_example host-daemon",
      }),
    ).toMatchObject({
      hostId: "host_123",
    });

    expect(
      createThreadRequestSchema.parse({
        projectId: "proj_123",
        providerId: "codex",
        origin: "app",
        input: [{ type: "text", text: "Ship it" }],
        environment: {
          type: "host",
          hostId: "host_abc",
          workspace: { type: "unmanaged", path: null },
        },
      }),
    ).toMatchObject({
      projectId: "proj_123",
    });

    expect(
      updateAutomationRequestSchema.parse({
        enabled: true,
      }),
    ).toEqual({
      enabled: true,
    });

    expect(
      updateAutomationRequestSchema.parse({
        autoArchive: true,
      }),
    ).toEqual({
      autoArchive: true,
    });

    expect(() =>
      updateAutomationRequestSchema.parse({
        autoArchive: true,
        enabled: true,
      }),
    ).toThrow();

    expect(
      sendMessageRequestSchema.parse({
        input: [{ type: "text", text: "Follow up" }],
        mode: "auto",
      }),
    ).toMatchObject({
      mode: "auto",
    });

    expect(sendQueuedMessageRequestSchema.parse({ mode: "auto" })).toEqual({
      mode: "auto",
    });
    expect(() => sendQueuedMessageRequestSchema.parse({})).toThrow();
    expect(
      reorderQueuedMessageRequestSchema.parse({
        previousQueuedMessageId: null,
        nextQueuedMessageId: "qmsg_next",
      }),
    ).toEqual({
      previousQueuedMessageId: null,
      nextQueuedMessageId: "qmsg_next",
    });
    expect(() =>
      reorderQueuedMessageRequestSchema.parse({
        nextQueuedMessageId: "qmsg_next",
      }),
    ).toThrow();
    expect(
      reorderPinnedThreadRequestSchema.parse({
        previousThreadId: null,
        nextThreadId: "thr_next",
      }),
    ).toEqual({
      previousThreadId: null,
      nextThreadId: "thr_next",
    });
    expect(() =>
      reorderPinnedThreadRequestSchema.parse({
        nextThreadId: "thr_next",
      }),
    ).toThrow();

    expect(
      threadListResponseSchema.parse([
        {
          id: "thr_123",
          projectId: "proj_123",
          environmentId: null,
          automationId: null,
          providerId: "codex",
          type: "standard",
          title: "Pending thread",
          titleFallback: "Pending thread",
          status: "idle",
          parentThreadId: null,
          archivedAt: null,
          pinnedAt: null,
          pinSortKey: null,
          stopRequestedAt: null,
          deletedAt: null,
          lastReadAt: null,
          latestAttentionAt: 2,
          createdAt: 1,
          updatedAt: 2,
          runtime: {
            displayStatus: "idle",
            hostReconnectGraceExpiresAt: null,
          },
          hasPendingInteraction: true,
          environmentHostId: "host_123",
          environmentBranchName: "bb/test",
          environmentWorkspaceDisplayKind: "managed-worktree",
        },
      ]),
    ).toMatchObject([
      {
        id: "thr_123",
        hasPendingInteraction: true,
        environmentHostId: "host_123",
        environmentBranchName: "bb/test",
        environmentWorkspaceDisplayKind: "managed-worktree",
      },
    ]);

    expect(
      threadPendingInteractionsResponseSchema.parse([
        {
          id: "pi_123",
          threadId: "thr_123",
          turnId: "turn_123",
          providerId: "codex",
          providerThreadId: "provider-thread-123",
          providerRequestId: "request-123",
          status: "pending",
          payload: {
            kind: "approval",
            subject: {
              kind: "command",
              itemId: "item_123",
              command: "git push",
              cwd: "/tmp/project",
              actions: [],
              sessionGrant: null,
            },
            reason: "Needs approval",
            availableDecisions: ["allow_once", "deny"],
          },
          resolution: null,
          statusReason: null,
          createdAt: 1,
          resolvedAt: null,
        },
      ]),
    ).toHaveLength(1);

    expect(
      resolvePendingInteractionRequestSchema.parse({
        decision: "allow_for_session",
        grantedPermissions: null,
      }),
    ).toMatchObject({
      decision: "allow_for_session",
    });

    expect(
      resolvePendingInteractionRequestSchema.parse({
        decision: "deny",
      }),
    ).toMatchObject({
      decision: "deny",
    });

    expect(
      environmentActionRequestSchema.parse({
        action: "commit",
      }),
    ).toMatchObject({
      action: "commit",
    });

    expect(() =>
      environmentActionRequestSchema.parse({
        action: "commit",
        threadId: "thr_123",
      }),
    ).toThrow();

    expect(() =>
      contract.environmentActionResponseSchema.parse({
        action: "commit",
        commitSha: "sha",
        commitSubject: "subject",
        message: "",
        ok: true,
      }),
    ).toThrow();

    expect(() =>
      contract.environmentActionResponseSchema.parse({
        action: "squash_merge",
        commitSha: "sha",
        commitSubject: "subject",
        merged: true,
        message: "",
        ok: true,
      }),
    ).toThrow();

    expect(
      updateEnvironmentRequestSchema.parse({
        mergeBaseBranch: null,
      }),
    ).toEqual({
      mergeBaseBranch: null,
    });

    expect(
      createManagerThreadRequestSchema.parse({
        model: "claude-opus-4-7",
        providerId: "codex",
        origin: "app",
        reasoningLevel: "high",
        name: "Manager",
        environment: { type: "host", hostId: "host_123" },
      }),
    ).toMatchObject({
      providerId: "codex",
      environment: { type: "host", hostId: "host_123" },
    });

    expect(() =>
      createManagerThreadRequestSchema.parse({
        model: "claude-opus-4-7",
        providerId: "codex",
        origin: "app",
        permissionMode: "full",
        environment: { type: "host", hostId: "host_123" },
      }),
    ).toThrow();

    expect(() =>
      createManagerThreadRequestSchema.parse({
        model: "claude-opus-4-7",
        providerId: "codex",
        origin: "app",
        executionInputSources: {
          permissionMode: "explicit",
        },
        environment: { type: "host", hostId: "host_123" },
      }),
    ).toThrow();

    expect(
      createProjectSourceRequestSchema.parse({
        hostId: "host_123",
        type: "local_path",
        path: " /tmp/project/ ",
      }),
    ).toMatchObject({
      type: "local_path",
      path: "/tmp/project",
    });

    expect(() =>
      createProjectSourceRequestSchema.parse({
        hostId: "host_123",
        type: "local_path",
        path: "relative/project",
      }),
    ).toThrow("Project path must be an absolute path.");

    expect(() =>
      contract.updateProjectSourceRequestSchema.parse({
        type: "local_path",
        path: " C:\\Users\\michael\\bb\\ ",
      }),
    ).toThrow("Native Windows paths are not supported");

    expect(() =>
      contract.updateProjectSourceRequestSchema.parse({
        type: "local_path",
        path: "relative/path",
      }),
    ).toThrow("Project path must be an absolute path.");

    expect(
      timelineTurnSummaryDetailsResponseSchema.parse({ rows: [] }),
    ).toEqual({
      rows: [],
    });

    expect(PROJECT_CHANGE_KINDS).toEqual([
      "project-created",
      "project-updated",
      "project-deleted",
      "project-sources-changed",
      "threads-changed",
      "project-order-changed",
      "automations-changed",
      "nudges-changed",
    ]);
    expect(SYSTEM_CHANGE_KINDS).toEqual(["config-changed", "apps-changed"]);
  });

  it("keeps only intentional optional request fields", () => {
    expect(
      createThreadRequestSchema.parse({
        projectId: "proj_123",
        providerId: "codex",
        origin: "app",
        input: [{ type: "text", text: "Ship it" }],
        environment: {
          type: "host",
          hostId: "host_abc",
          workspace: { type: "unmanaged", path: null },
        },
      }),
    ).toMatchObject({
      environment: {
        type: "host",
      },
    });

    expect(
      createThreadRequestSchema.parse({
        projectId: "proj_personal",
        providerId: "codex",
        origin: "app",
        input: [{ type: "text", text: "Ship it without a project" }],
        environment: {
          type: "host",
          workspace: { type: "personal" },
        },
      }),
    ).toMatchObject({
      environment: {
        type: "host",
        workspace: { type: "personal" },
      },
    });

    expect(() =>
      createThreadRequestSchema.parse({
        projectId: "proj_123",
        providerId: "codex",
        origin: "app",
        input: [{ type: "text", text: "Missing host" }],
        environment: {
          type: "host",
          workspace: { type: "unmanaged", path: null },
        },
      }),
    ).toThrow();

    expect(
      sendMessageRequestSchema.parse({
        input: [{ type: "text", text: "Use the thread defaults" }],
        mode: "auto",
      }),
    ).toMatchObject({
      mode: "auto",
    });

    expect(
      createQueuedMessageRequestSchema.parse({
        input: [{ type: "text", text: "Queue this with inherited defaults" }],
      }),
    ).toMatchObject({
      input: [{ type: "text", text: "Queue this with inherited defaults" }],
    });

    expect(
      createManagerThreadRequestSchema.parse({
        origin: "cli",
        reasoningLevel: "high",
        name: "Missing model",
        environment: { type: "host", hostId: "host_123" },
      }),
    ).toMatchObject({
      origin: "cli",
    });

    expect(() =>
      createThreadRequestSchema.parse({
        projectId: "proj_123",
        providerId: "codex",
        input: [{ type: "text", text: "Ship it" }],
        environment: {
          type: "host",
          hostId: "host_abc",
          workspace: { type: "unmanaged", path: null },
        },
      }),
    ).toThrow();

    expect(() =>
      createManagerThreadRequestSchema.parse({
        reasoningLevel: "high",
        name: "Missing origin",
        environment: { type: "host", hostId: "host_123" },
      }),
    ).toThrow();
  });
});

describe("server-contract clients", () => {
  it("builds canonical public routes", () => {
    const publicClient = createPublicApiClient("http://localhost:3334");

    expect(
      publicClient.threads[":id"].send.$url({ param: { id: "thr_123" } })
        .pathname,
    ).toBe("/api/v1/threads/thr_123/send");
    expect(
      publicClient.threads[":id"]["queued-messages"].$url({
        param: { id: "thr_123" },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/queued-messages");
    expect(
      publicClient.threads[":id"]["queued-messages"][
        ":queuedMessageId"
      ].order.$url({
        param: { id: "thr_123", queuedMessageId: "qmsg_123" },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/queued-messages/qmsg_123/order");
    expect(
      publicClient.threads[":id"].pin.$url({
        param: { id: "thr_123" },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/pin");
    expect(
      publicClient.threads[":id"].unpin.$url({
        param: { id: "thr_123" },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/unpin");
    expect(
      publicClient.threads[":id"]["pin-order"].$url({
        param: { id: "thr_123" },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/pin-order");
    expect(
      publicClient.threads[":id"]["composer-bootstrap"].$url({
        param: { id: "thr_123" },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/composer-bootstrap");
    expect(publicClient.system["execution-options"].$url().pathname).toBe(
      "/api/v1/system/execution-options",
    );
    expect(
      publicClient.projects[":id"].managers.$url({
        param: { id: "proj_123" },
      }).pathname,
    ).toBe("/api/v1/projects/proj_123/managers");
    expect(
      publicClient.projects[":id"].paths.$url({
        param: { id: "proj_123" },
        query: {
          environmentId: "",
          includeFiles: "true",
          includeDirectories: "true",
        },
      }).pathname,
    ).toBe("/api/v1/projects/proj_123/paths");
    expect(
      publicClient.projects[":id"].automations.$url({
        param: { id: "proj_123" },
      }).pathname,
    ).toBe("/api/v1/projects/proj_123/automations");
    expect(
      publicClient.projects[":id"].automations[":automationId"].$url({
        param: { id: "proj_123", automationId: "auto_123" },
      }).pathname,
    ).toBe("/api/v1/projects/proj_123/automations/auto_123");
    expect(
      publicClient.threads[":id"].timeline["turn-summary-details"].$url({
        param: { id: "thr_123" },
        query: {
          turnId: "turn_123",
          sourceSeqStart: "1",
          sourceSeqEnd: "2",
        },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/timeline/turn-summary-details");
    expect(
      publicClient.threads[":id"]["thread-storage"].files.$url({
        param: { id: "thr_123" },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/thread-storage/files");
    expect(
      publicClient.threads[":id"]["thread-storage"].paths.$url({
        param: { id: "thr_123" },
        query: {
          includeFiles: "true",
          includeDirectories: "true",
        },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/thread-storage/paths");
    expect(
      publicClient.threads[":id"]["thread-storage"].content.$url({
        param: { id: "thr_123" },
        query: { path: "notes/plan.md" },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/thread-storage/content");
    expect(
      publicClient.threads[":id"]["host-files"].content.$url({
        param: { id: "thr_123" },
        query: { path: "/Users/me/notes/plan.md" },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/host-files/content");
    expect(
      publicClient.threads[":id"].interactions.$url({
        param: { id: "thr_123" },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/interactions");
    expect(
      publicClient.threads[":id"].interactions[":interactionId"].resolve.$url({
        param: { id: "thr_123", interactionId: "pi_123" },
      }).pathname,
    ).toBe("/api/v1/threads/thr_123/interactions/pi_123/resolve");
  });

  it("keeps route inputs in shared named types instead of inline objects", () => {
    expect(publicApiSource).not.toMatch(/json:\s*\{/);
    expect(publicApiSource).not.toMatch(/query:\s*\{/);
    expect(publicApiSource).not.toMatch(/form:\s*Record</);
  });

  it("bounds public file list search queries", () => {
    const maxQuery = "a".repeat(contract.FILE_LIST_QUERY_MAX_LENGTH);
    const longQuery = `${maxQuery}a`;

    expect(
      contract.projectFilesQuerySchema.parse({
        query: maxQuery,
        environmentId: "",
      }),
    ).toMatchObject({ query: maxQuery, environmentId: null });
    expect(() =>
      contract.projectFilesQuerySchema.parse({
        query: longQuery,
        environmentId: "",
      }),
    ).toThrow();
    expect(
      contract.threadStorageFilesQuerySchema.parse({ query: maxQuery }),
    ).toMatchObject({ query: maxQuery });
    expect(() =>
      contract.threadStorageFilesQuerySchema.parse({ query: longQuery }),
    ).toThrow();
    expect(
      contract.threadHostFileContentQuerySchema.parse({
        path: "/Users/me/notes/plan.md",
      }),
    ).toEqual({ path: "/Users/me/notes/plan.md" });
  });

  it("rejects zero timeline pagination cursor sequences", () => {
    expect(() =>
      contract.timelinePaginationCursorSchema.parse({
        anchorSeq: 0,
        anchorId: "row-1",
      }),
    ).toThrow();
    expect(() =>
      contract.threadTimelineQuerySchema.parse({
        beforeAnchorSeq: "0",
        beforeAnchorId: "row-1",
      }),
    ).toThrow();
  });

  it("requires manager assignment timeline system rows to carry status", () => {
    const baseRow = {
      id: "row-1",
      threadId: "thr_123",
      turnId: null,
      sourceSeqStart: 1,
      sourceSeqEnd: 1,
      startedAt: 1,
      createdAt: 1,
      kind: "system",
      title: "Thread assigned to manager",
      detail: null,
    };
    const managerAssignmentRow = {
      ...baseRow,
      systemKind: "operation",
      operationKind: "manager-assignment",
      status: "completed",
      completedAt: 1,
      managerAssignment: {
        action: "assign",
        previousManagerThreadId: null,
        previousManagerThreadTitle: null,
        nextManagerThreadId: "thr_manager",
        nextManagerThreadTitle: "Manager",
      },
    };

    expect(
      contract.timelineManagerAssignmentSystemRowSchema.parse(
        managerAssignmentRow,
      ),
    ).toMatchObject({
      status: "completed",
    });
    expect(() =>
      contract.timelineManagerAssignmentSystemRowSchema.parse({
        ...managerAssignmentRow,
        status: null,
      }),
    ).toThrow();
    expect(
      contract.timelineSystemRowSchema.parse({
        ...baseRow,
        systemKind: "debug",
        status: null,
      }),
    ).toMatchObject({
      status: null,
    });
  });

  it("keeps contract optional fields on an explicit allowlist", () => {
    const optionalFieldPaths = collectOptionalFieldPaths({
      apiErrorSchema: contract.apiErrorSchema,
      appDataListQuerySchema: contract.appDataListQuerySchema,
      appManifestSchema: contract.appManifestSchema,
      commitActionResponseSchema: contract.commitActionResponseSchema,
      createQueuedMessageRequestSchema:
        contract.createQueuedMessageRequestSchema,
      createAutomationRequestSchema: contract.createAutomationRequestSchema,
      createHostJoinRequestSchema: contract.createHostJoinRequestSchema,
      createManagerThreadRequestSchema:
        contract.createManagerThreadRequestSchema,
      createThreadRequestSchema: contract.createThreadRequestSchema,
      environmentActionApiErrorSchema: contract.environmentActionApiErrorSchema,
      environmentStatusResponseSchema: contract.environmentStatusResponseSchema,
      threadStorageFilesQuerySchema: contract.threadStorageFilesQuerySchema,
      projectFilesQuerySchema: contract.projectFilesQuerySchema,
      reorderManagerThreadRequestSchema:
        contract.reorderManagerThreadRequestSchema,
      reorderPinnedThreadRequestSchema:
        contract.reorderPinnedThreadRequestSchema,
      reorderProjectRequestSchema: contract.reorderProjectRequestSchema,
      reorderQueuedMessageRequestSchema:
        contract.reorderQueuedMessageRequestSchema,
      sendQueuedMessageRequestSchema: contract.sendQueuedMessageRequestSchema,
      sendQueuedMessageResponseSchema: contract.sendQueuedMessageResponseSchema,
      sendMessageRequestSchema: contract.sendMessageRequestSchema,
      squashMergeActionResponseSchema: contract.squashMergeActionResponseSchema,
      systemExecutionOptionsQuerySchema:
        contract.systemExecutionOptionsQuerySchema,
      systemProvidersQuerySchema: contract.systemProvidersQuerySchema,
      threadEventsQuerySchema: contract.threadEventsQuerySchema,
      threadListQuerySchema: contract.threadListQuerySchema,
      threadPendingInteractionsResponseSchema:
        contract.threadPendingInteractionsResponseSchema,
      threadTimelineQuerySchema: contract.threadTimelineQuerySchema,
      threadTimelineResponseSchema: contract.threadTimelineResponseSchema,
      timelineTurnSummaryDetailsQuerySchema:
        contract.timelineTurnSummaryDetailsQuerySchema,
      timelineTurnSummaryDetailsRequestSchema:
        contract.timelineTurnSummaryDetailsRequestSchema,
      resolvePendingInteractionRequestSchema:
        contract.resolvePendingInteractionRequestSchema,
      updateAutomationRequestSchema: contract.updateAutomationRequestSchema,
      updateProjectRequestSchema: contract.updateProjectRequestSchema,
      updateProjectSourceRequestSchema:
        contract.updateProjectSourceRequestSchema,
      updateThreadRequestSchema: contract.updateThreadRequestSchema,
      uploadedPromptAttachmentSchema: contract.uploadedPromptAttachmentSchema,
    });

    expect(optionalFieldPaths).toEqual(
      Object.keys(INTENTIONAL_OPTIONAL_SERVER_FIELDS).sort(),
    );
    expect(
      Object.values(INTENTIONAL_OPTIONAL_SERVER_FIELDS).every(
        (reason) => reason.trim().length > 0,
      ),
    ).toBe(true);
  });
});
