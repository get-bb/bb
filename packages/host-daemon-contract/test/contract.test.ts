import { collectOptionalFieldPaths } from "@bb/test-helpers";
import { threadScope, type JsonObject } from "@bb/domain";
import { describe, expect, it } from "vitest";
import * as contract from "../src/index.js";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  HOST_DAEMON_ONLINE_RPC_COMMAND_TYPES,
  TERMINAL_COLS_MAX,
  TERMINAL_DATA_MAX_BASE64_LENGTH,
  TERMINAL_DATA_MAX_BYTES,
  TERMINAL_ROWS_MAX,
  createHostDaemonClient,
  hostDaemonEnrollRequestSchema,
  hostDaemonEnrollResponseSchema,
  hostDaemonCommandEnvelopeSchema,
  hostDaemonCommandResultResponseSchema,
  hostDaemonCommandResultSchemaByType,
  hostDaemonCommandsQuerySchema,
  hostDaemonCommandSchema,
  hostDaemonDaemonWsMessageSchema,
  hostDaemonEventBatchRequestSchema,
  hostDaemonEventBatchResponseSchema,
  hostDaemonInteractiveInterruptRequestSchema,
  hostDaemonInteractiveInterruptResponseSchema,
  hostDaemonInteractiveRequestResponseSchema,
  hostDaemonInteractiveRequestSchema,
  hostDaemonOnlineRpcCommandSchema,
  type HostDaemonOnlineRpcCommandType,
  hostDaemonOnlineRpcResponseMessageSchema,
  hostDaemonOnlineRpcResultSchemaByType,
  hostDaemonServerWsMessageSchema,
  hostDaemonSessionOpenRequestSchema,
  hostDaemonSessionOpenResponseSchema,
  hostDaemonTerminalOutputChunkSchema,
} from "../src/index.js";

const PRODUCER_EVENT_ID = "hdevt_23456789abcdefghijkm";
const CLIENT_REQUEST_ID = "creq_23456789ab";

type OnlineRpcResponseResultFixtures = Record<
  HostDaemonOnlineRpcCommandType,
  JsonObject
>;

interface OnlineRpcResponseMismatchCase {
  commandType: HostDaemonOnlineRpcCommandType;
  name: string;
  result: JsonObject;
}

interface OnlineRpcResponseRoundTripCase {
  commandType: HostDaemonOnlineRpcCommandType;
  name: string;
  result: JsonObject;
}

const RESOLVED_REPLAY_EXECUTION_OPTIONS: JsonObject = {
  model: "test/model",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "workspace-write",
  source: "client/turn/requested",
};

const REPLAY_CAPTURE_SUMMARY_RESULT: JsonObject = {
  captureId: "cap_lx0_abcdefgh",
  capturedAt: 1_700_000_000_000,
  completedAt: 1_700_000_000_100,
  providerId: "codex",
  projectId: "proj_123",
  environmentId: "env_123",
  threadId: "thr_123",
  title: "Replay capture",
  kind: "turn-start",
  userInputPreview: "Run the test",
  execution: RESOLVED_REPLAY_EXECUTION_OPTIONS,
  eventCounts: {
    rawProviderEvents: 2,
    droppedRecords: 0,
  },
  errorMessage: null,
};

const REPLAY_CAPTURE_MANIFEST_RESULT: JsonObject = {
  ...REPLAY_CAPTURE_SUMMARY_RESULT,
  schemaVersion: 3,
  source: "live-dev-capture",
  providerThreadId: "provider-thread-123",
  turns: [
    {
      turnId: "turn_123",
      userInput: [
        {
          type: "text",
          text: "Run the test",
        },
      ],
      createdAt: 1_700_000_000_010,
    },
  ],
};

const WORKSPACE_UNAVAILABLE_RESULT: JsonObject = {
  outcome: "unavailable",
  failure: {
    code: "path_not_found",
    workspacePath: "/tmp/missing-workspace",
    message: "Workspace path is missing",
  },
};

const WORKSPACE_STATUS_AVAILABLE_RESULT: JsonObject = {
  outcome: "available",
  workspaceStatus: {
    workingTree: {
      insertions: 3,
      deletions: 1,
      files: [
        {
          path: "src/index.ts",
          status: "M",
          insertions: 3,
          deletions: 1,
        },
      ],
      hasUncommittedChanges: true,
      state: "dirty_and_committed_unmerged",
    },
    branch: {
      currentBranch: "feature/host-rpc",
      defaultBranch: "main",
    },
    mergeBase: {
      insertions: 5,
      deletions: 0,
      files: [
        {
          path: "README.md",
          status: "A",
          insertions: 5,
          deletions: 0,
        },
      ],
      mergeBaseBranch: "main",
      baseRef: "abc123",
      aheadCount: 1,
      behindCount: 0,
      hasCommittedUnmergedChanges: true,
      commits: [
        {
          sha: "abcdef123456",
          shortSha: "abcdef1",
          subject: "Add host RPC guard",
          authorName: "Test User",
          authoredAt: 1_700_000_000_000,
        },
      ],
    },
  },
};

const WORKSPACE_DIFF_AVAILABLE_RESULT: JsonObject = {
  outcome: "available",
  diff: {
    diff: "diff --git a/src/index.ts b/src/index.ts\n",
    truncated: false,
    shortstat: "1 file changed, 3 insertions(+), 1 deletion(-)",
    files: "src/index.ts\n",
    mergeBaseRef: "abc123",
  },
};

const ONLINE_RPC_RESPONSE_RESULT_FIXTURES: OnlineRpcResponseResultFixtures = {
  "development.replay": {},
  "host.list_files": {
    files: [
      {
        path: "src/index.ts",
        name: "index.ts",
      },
    ],
    truncated: false,
  },
  "host.list_paths": {
    paths: [
      {
        kind: "file",
        path: "src/index.ts",
        name: "index.ts",
        score: 1,
        positions: [0, 4],
      },
    ],
    truncated: false,
  },
  "host.list_branches": {
    branches: ["main"],
    branchesTruncated: false,
    checkout: {
      kind: "branch",
      branchName: "main",
      headSha: "abc123",
    },
    defaultBranch: "main",
    hasUncommittedChanges: false,
    operation: {
      kind: "none",
    },
    remoteBranches: ["origin/main"],
    remoteBranchesTruncated: false,
    selectedBranch: {
      name: "main",
      kind: "local",
    },
  },
  "host.list_manager_templates": {
    templates: [{ name: "default" }],
    activeName: "default",
  },
  "host.file_metadata": {
    path: "/tmp/report.html",
    modifiedAtMs: 1234,
    sizeBytes: 42,
  },
  "host.read_file": {
    path: "/tmp/report.html",
    content: "<!doctype html>",
    contentEncoding: "utf8",
    mimeType: "text/html",
    sizeBytes: 15,
  },
  "host.read_file_relative": {
    path: "assets/logo.png",
    content: "iVBORw0KGgo=",
    contentEncoding: "base64",
    mimeType: "image/png",
    sizeBytes: 8,
  },
  "provider.list": {
    providers: [
      {
        id: "codex",
        displayName: "Codex",
        capabilities: {
          supportsArchive: true,
          supportsRename: true,
          supportsServiceTier: true,
          supportsUserQuestion: true,
          supportedPermissionModes: ["workspace-write"],
        },
        available: true,
      },
    ],
  },
  "provider.list_models": {
    models: [
      {
        id: "codex/gpt-5",
        model: "gpt-5",
        displayName: "GPT-5",
        description: "Test model",
        supportedReasoningEfforts: [
          {
            reasoningEffort: "medium",
            description: "Balanced",
          },
        ],
        defaultReasoningEffort: "medium",
        isDefault: true,
      },
    ],
    selectedOnlyModels: [],
  },
  "workspace.status": WORKSPACE_UNAVAILABLE_RESULT,
  "workspace.diff": WORKSPACE_UNAVAILABLE_RESULT,
};

const ADDITIONAL_ONLINE_RPC_RESPONSE_ROUND_TRIP_CASES: OnlineRpcResponseRoundTripCase[] =
  [
    {
      name: "development.replay capture-list result",
      commandType: "development.replay",
      result: {
        captures: [REPLAY_CAPTURE_SUMMARY_RESULT],
      },
    },
    {
      name: "development.replay capture-get manifest result",
      commandType: "development.replay",
      result: REPLAY_CAPTURE_MANIFEST_RESULT,
    },
    {
      name: "workspace.status available result",
      commandType: "workspace.status",
      result: WORKSPACE_STATUS_AVAILABLE_RESULT,
    },
    {
      name: "workspace.diff available result",
      commandType: "workspace.diff",
      result: WORKSPACE_DIFF_AVAILABLE_RESULT,
    },
  ];

const ONLINE_RPC_RESPONSE_MISMATCH_CASES: OnlineRpcResponseMismatchCase[] = [
  {
    name: "host.file_metadata command with a read-file result",
    commandType: "host.file_metadata",
    result: {
      path: "/tmp/report.html",
      content: "<!doctype html>",
      contentEncoding: "utf8",
      mimeType: "text/html",
      sizeBytes: 15,
    },
  },
  {
    name: "host.read_file command with a metadata result",
    commandType: "host.read_file",
    result: {
      path: "/tmp/report.html",
      modifiedAtMs: 1234,
      sizeBytes: 42,
    },
  },
  {
    name: "provider.list command with a provider-model result",
    commandType: "provider.list",
    result: {
      models: [],
      selectedOnlyModels: [],
    },
  },
  {
    name: "development.replay command with a provider-list result",
    commandType: "development.replay",
    result: {
      providers: [],
    },
  },
  {
    name: "provider.list command with a replay-list result",
    commandType: "provider.list",
    result: {
      captures: [],
    },
  },
];

function buildHostRpcResponseMessage(
  commandType: HostDaemonOnlineRpcCommandType,
  result: JsonObject,
): JsonObject {
  return {
    type: "host-rpc.response",
    requestId: `rpc-${commandType}`,
    commandType,
    ok: true,
    result,
  };
}

function expectHostRpcResponseRoundTrip(
  commandType: HostDaemonOnlineRpcCommandType,
  result: JsonObject,
  name: string,
): void {
  const message = buildHostRpcResponseMessage(commandType, result);
  const jsonRoundTripped = JSON.parse(JSON.stringify(message));

  expect(
    hostDaemonOnlineRpcResponseMessageSchema.parse(jsonRoundTripped),
    name,
  ).toEqual(message);
  expect(hostDaemonDaemonWsMessageSchema.parse(jsonRoundTripped), name).toEqual(
    message,
  );
}

function terminalDataBase64(byteLength: number): string {
  return Buffer.alloc(byteLength, "a").toString("base64");
}

const INTENTIONAL_OPTIONAL_HOST_DAEMON_FIELDS: Record<string, string> = {
  "hostDaemonCommandSchema.checkout":
    "environment.provision only includes checkout instructions for unmanaged workspaces that requested a branch mutation.",
  "hostDaemonOnlineRpcCommandSchema.mergeBaseBranch":
    "workspace.status may omit mergeBaseBranch when the caller only needs working-tree state.",
  "hostDaemonOnlineRpcCommandSchema.query":
    "host.list_files may omit a search string to list files without filtering.",
  "hostDaemonOnlineRpcCommandSchema.ref":
    "host.read_file may omit ref to read from disk; setting ref switches to git history at that ref.",
  "hostDaemonOnlineRpcCommandSchema.rootPath":
    "host.read_file and host.file_metadata may omit rootPath only for explicit absolute disk reads; ref-based reads still require it.",
  "hostDaemonOnlineRpcCommandSchema.selectedBranch":
    "host.list_branches may omit exact selected-branch classification when the caller only needs a branch option page.",
  "hostDaemonCommandSchema.threadStoragePath":
    "thread.start may include a storage path for manager threads so the daemon creates the directory before the agent starts.",
  "hostDaemonCommandSchema.disallowedTools":
    "manager thread runtime context may omit provider-specific built-in tool removals for providers that do not need them.",
  "hostDaemonCommandSchema.resumeContext.disallowedTools":
    "turn.submit resume context may omit provider-specific built-in tool removals for providers that do not need them.",
};

describe("host-daemon local schemas", () => {
  it("parses workspace open target routes", () => {
    expect(
      contract.workspaceOpenTargetSchema.parse({
        id: "vscode",
        label: "VS Code",
        capabilities: {
          openDirectory: true,
          openFile: true,
          openFileAtLine: true,
        },
      }),
    ).toEqual({
      id: "vscode",
      label: "VS Code",
      capabilities: {
        openDirectory: true,
        openFile: true,
        openFileAtLine: true,
      },
    });

    expect(
      contract.workspaceOpenTargetsResponseSchema.parse({
        targets: [
          {
            id: "default-app",
            label: "Default App",
            capabilities: {
              openDirectory: true,
              openFile: true,
              openFileAtLine: false,
            },
          },
          {
            id: "finder",
            label: "Finder",
            capabilities: {
              openDirectory: true,
              openFile: false,
              openFileAtLine: false,
            },
          },
          {
            id: "terminal",
            label: "Terminal",
            capabilities: {
              openDirectory: true,
              openFile: false,
              openFileAtLine: false,
            },
          },
        ],
      }),
    ).toEqual({
      targets: [
        {
          id: "default-app",
          label: "Default App",
          capabilities: {
            openDirectory: true,
            openFile: true,
            openFileAtLine: false,
          },
        },
        {
          id: "finder",
          label: "Finder",
          capabilities: {
            openDirectory: true,
            openFile: false,
            openFileAtLine: false,
          },
        },
        {
          id: "terminal",
          label: "Terminal",
          capabilities: {
            openDirectory: true,
            openFile: false,
            openFileAtLine: false,
          },
        },
      ],
    });

    expect(
      contract.openInTargetRequestSchema.parse({
        lineNumber: 12,
        path: "/tmp/workspace",
        targetId: "zed",
      }),
    ).toEqual({
      lineNumber: 12,
      path: "/tmp/workspace",
      targetId: "zed",
    });
  });

  it("rejects malformed workspace open payloads", () => {
    expect(() =>
      contract.workspaceOpenTargetSchema.parse({
        id: "unknown-editor",
        label: "Unknown",
        capabilities: {
          openDirectory: true,
          openFile: true,
          openFileAtLine: true,
        },
      }),
    ).toThrow();

    expect(() =>
      contract.workspaceOpenTargetSchema.parse({
        id: "vscode",
        label: "VS Code",
      }),
    ).toThrow();

    expect(() =>
      contract.workspaceOpenTargetsResponseSchema.parse({
        targets: [
          {
            id: "vscode",
            label: "",
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      contract.openInTargetRequestSchema.parse({
        path: "/tmp/workspace",
      }),
    ).toThrow();

    expect(() =>
      contract.openInTargetRequestSchema.parse({
        lineNumber: 0,
        path: "/tmp/workspace",
        targetId: "zed",
      }),
    ).toThrow();
  });
});

describe("host-daemon command schemas", () => {
  it("parses valid workspace and provisioning commands", () => {
    expect(
      hostDaemonEnrollRequestSchema.parse({
        hostId: "host_123",
        hostName: "test-host",
        hostType: "persistent",
      }),
    ).toMatchObject({
      hostId: "host_123",
      hostType: "persistent",
    });

    expect(
      hostDaemonEnrollResponseSchema.parse({
        hostId: "host_123",
        hostKey: "bbdh_example",
      }),
    ).toMatchObject({
      hostId: "host_123",
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "workspace.commit",
        environmentId: "env_123",
        environmentStatus: "ready",
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "unmanaged",
        },
        threadId: "thr_123",
        message: "Checkpoint work",
      }),
    ).toMatchObject({
      type: "workspace.commit",
      message: "Checkpoint work",
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "environment.cleanup_preflight",
        environmentId: "env_123",
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "managed-worktree",
        },
        mergeBaseBranch: "main",
      }),
    ).toMatchObject({
      type: "environment.cleanup_preflight",
      mergeBaseBranch: "main",
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: {
          threadId: "thr_123",
          provisioningId: "tpv_123",
        },
        workspaceProvisionType: "managed-worktree",
        sourcePath: "/tmp/project",
        targetPath: "/tmp/project/.bb/env",
        branchName: "bb/env-123",
        baseBranch: null,
        setupTimeoutMs: 900000,
      }),
    ).toMatchObject({
      type: "environment.provision",
      workspaceProvisionType: "managed-worktree",
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "environment.provision",
        environmentId: "env_personal",
        initiator: null,
        workspaceProvisionType: "personal",
        targetPath: "/tmp/bb/personal-workspaces/env_personal",
      }),
    ).toMatchObject({
      type: "environment.provision",
      workspaceProvisionType: "personal",
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: null,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/project",
        checkout: {
          kind: "existing",
          name: "feature/test",
        },
      }),
    ).toMatchObject({
      type: "environment.provision",
      workspaceProvisionType: "unmanaged",
      checkout: {
        kind: "existing",
        name: "feature/test",
      },
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: null,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/project",
        checkout: {
          kind: "new",
          name: "bb/env-123",
          baseBranch: "release",
        },
      }),
    ).toMatchObject({
      type: "environment.provision",
      workspaceProvisionType: "unmanaged",
      checkout: {
        kind: "new",
        baseBranch: "release",
      },
    });

    expect(
      hostDaemonCommandEnvelopeSchema.parse({
        id: "hcmd_123",
        attemptId: "hcat_123",
        cursor: 7,
        command: {
          type: "workspace.commit",
          environmentId: "env_123",
          environmentStatus: "ready",
          workspaceContext: {
            workspacePath: "/tmp/workspace",
            workspaceProvisionType: "unmanaged",
          },
          threadId: "thr_123",
          message: "Checkpoint work",
        },
      }),
    ).toMatchObject({
      id: "hcmd_123",
      attemptId: "hcat_123",
      cursor: 7,
    });

    expect(
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.list_files",
        path: "/tmp/workspace",
        limit: 1000,
      }),
    ).toMatchObject({
      type: "host.list_files",
      path: "/tmp/workspace",
      limit: 1000,
    });

    expect(
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.list_paths",
        path: "/tmp/workspace",
        limit: 1000,
        includeFiles: true,
        includeDirectories: true,
      }),
    ).toMatchObject({
      type: "host.list_paths",
      path: "/tmp/workspace",
      limit: 1000,
      includeFiles: true,
      includeDirectories: true,
    });

    expect(
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.list_branches",
        path: "/tmp/workspace",
        query: "release",
        selectedBranch: "origin/main",
        limit: 50,
      }),
    ).toMatchObject({
      type: "host.list_branches",
      path: "/tmp/workspace",
      query: "release",
      selectedBranch: "origin/main",
      limit: 50,
    });

    expect(
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.file_metadata",
        path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
        rootPath: "/tmp/bb-data/thread-storage/thread-123",
      }),
    ).toMatchObject({
      type: "host.file_metadata",
      path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
      rootPath: "/tmp/bb-data/thread-storage/thread-123",
    });

    expect(
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.read_file",
        path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
        rootPath: "/tmp/bb-data/thread-storage/thread-123",
      }),
    ).toMatchObject({
      type: "host.read_file",
      path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
      rootPath: "/tmp/bb-data/thread-storage/thread-123",
    });

    expect(
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.read_file",
        path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
      }),
    ).toMatchObject({
      type: "host.read_file",
      path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
    });

    expect(
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.read_file",
        path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
        rootPath: "/tmp/bb-data/thread-storage/thread-123",
        ref: "HEAD",
      }),
    ).toMatchObject({
      type: "host.read_file",
      path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
      rootPath: "/tmp/bb-data/thread-storage/thread-123",
      ref: "HEAD",
    });

    expect(
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.read_file_relative",
        rootPath: "/tmp/bb-data/apps/demo/assets",
        path: "logo.png",
        dotfiles: "deny",
      }),
    ).toMatchObject({
      type: "host.read_file_relative",
      rootPath: "/tmp/bb-data/apps/demo/assets",
      path: "logo.png",
      dotfiles: "deny",
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "host.write_file_relative",
        rootPath: "/tmp/bb-data/apps/demo/data",
        path: "state.json",
        dotfiles: "deny",
        content: "[1,2,3]\n",
        contentEncoding: "utf8",
      }),
    ).toMatchObject({
      type: "host.write_file_relative",
      path: "state.json",
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "host.delete_file_relative",
        rootPath: "/tmp/bb-data/apps/demo/data",
        path: "state.json",
        dotfiles: "deny",
      }),
    ).toMatchObject({
      type: "host.delete_file_relative",
      path: "state.json",
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "host.delete_path_relative",
        rootPath: "/tmp/bb-data/thread-storage/thread-123/apps",
        path: "demo",
        dotfiles: "deny",
      }),
    ).toMatchObject({
      type: "host.delete_path_relative",
      path: "demo",
    });

    expect(
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.list_files",
        path: "/tmp/bb-data/thread-storage/thread-123",
        limit: 100,
      }),
    ).toMatchObject({
      type: "host.list_files",
      path: "/tmp/bb-data/thread-storage/thread-123",
      limit: 100,
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "interactive.resolve",
        environmentId: "env_123",
        threadId: "thr_123",
        interactionId: "pint_123",
        providerId: "codex",
        providerThreadId: "provider-thread-123",
        providerRequestId: "request-123",
        resolution: {
          decision: "allow_for_session",
          grantedPermissions: null,
        },
      }),
    ).toMatchObject({
      type: "interactive.resolve",
      interactionId: "pint_123",
      resolution: {
        decision: "allow_for_session",
      },
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "codex.inference.complete",
        model: "gpt-5.4-mini",
        prompt: "Return a JSON object with a short title.",
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["title"],
          properties: {
            title: { type: "string" },
          },
        },
        timeoutMs: 10000,
      }),
    ).toMatchObject({
      type: "codex.inference.complete",
      model: "gpt-5.4-mini",
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "codex.voice.transcribe",
        model: "gpt-4o-mini-transcribe",
        audioBase64: Buffer.from("audio").toString("base64"),
        mimeType: "audio/webm",
        filename: "prompt.webm",
        prompt: null,
        timeoutMs: 30000,
      }),
    ).toMatchObject({
      type: "codex.voice.transcribe",
      model: "gpt-4o-mini-transcribe",
      mimeType: "audio/webm",
    });
  });

  it("rejects old provider-agnostic AI command names", () => {
    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "inference.complete",
        model: "gpt-5.4-mini",
        prompt: "Return a title",
        outputSchema: { type: "object" },
        timeoutMs: 10000,
      }),
    ).toThrow();

    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "voice.transcribe",
        model: "gpt-4o-mini-transcribe",
        audioBase64: Buffer.from("audio").toString("base64"),
        mimeType: "audio/webm",
        filename: "prompt.webm",
        prompt: null,
        timeoutMs: 30000,
      }),
    ).toThrow();
  });

  it("rejects online-RPC-only read commands from the durable command schema", () => {
    const onlineReadCommands = [
      { type: "host.list_files", path: "/tmp/workspace", limit: 100 },
      {
        type: "host.list_paths",
        path: "/tmp/workspace",
        limit: 100,
        includeFiles: true,
        includeDirectories: true,
      },
      {
        type: "host.list_branches",
        path: "/tmp/workspace",
        limit: 50,
      },
      { type: "host.list_manager_templates" },
      {
        type: "host.file_metadata",
        path: "/tmp/workspace/README.md",
        rootPath: "/tmp/workspace",
      },
      {
        type: "host.read_file",
        path: "/tmp/workspace/README.md",
        rootPath: "/tmp/workspace",
      },
      {
        type: "host.read_file_relative",
        rootPath: "/tmp/workspace",
        path: "README.md",
        dotfiles: "deny",
      },
      { type: "provider.list" },
      { type: "provider.list_models", providerId: "codex" },
      {
        type: "workspace.status",
        environmentId: "env_123",
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "managed-worktree",
        },
      },
      {
        type: "workspace.diff",
        environmentId: "env_123",
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "managed-worktree",
        },
        target: { type: "uncommitted" },
        maxDiffBytes: 1000,
        maxFileListBytes: 1000,
      },
    ];

    for (const command of onlineReadCommands) {
      expect(() => hostDaemonCommandSchema.parse(command)).toThrow();
      expect(hostDaemonOnlineRpcCommandSchema.parse(command)).toMatchObject({
        type: command.type,
      });
    }
  });

  it("requires Codex inference schemas and results to be JSON objects", () => {
    for (const outputSchema of [null, "object", ["object"]]) {
      expect(() =>
        hostDaemonCommandSchema.parse({
          type: "codex.inference.complete",
          model: "gpt-5.4-mini",
          prompt: "Return a title",
          outputSchema,
          timeoutMs: 10000,
        }),
      ).toThrow();
    }

    expect(() =>
      hostDaemonCommandResultSchemaByType["codex.inference.complete"].parse({
        model: "gpt-5.4-mini",
        value: null,
      }),
    ).toThrow();

    expect(
      hostDaemonCommandResultSchemaByType["codex.inference.complete"].parse({
        model: "gpt-5.4-mini",
        value: { title: "Short title" },
      }),
    ).toEqual({
      model: "gpt-5.4-mini",
      value: { title: "Short title" },
    });
  });

  it("rejects malformed environment.provision commands at parse time", () => {
    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: null,
        workspaceProvisionType: "managed-worktree",
        sourcePath: "/tmp/project",
        targetPath: "/tmp/project/.bb/env",
      }),
    ).toThrow();

    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: null,
        workspaceProvisionType: "unmanaged",
      }),
    ).toThrow();

    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: null,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/project",
        checkout: { kind: "new", name: "bb/env-123" },
      }),
    ).toThrow();

    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: null,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/project",
        checkout: { kind: "existing" },
      }),
    ).toThrow();

    expect(() =>
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.read_file",
        path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
        ref: "HEAD",
      }),
    ).toThrow();

    expect(() =>
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.read_file_relative",
        rootPath: "/tmp/bb-data/apps/demo/assets",
        path: "logo.png",
      }),
    ).toThrow();
  });

  it("requires environmentId on thread and turn commands", () => {
    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "thread.start",
        threadId: "thr_123",
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "proj_123",
        providerId: "codex",
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "Be concise.",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
        requestId: CLIENT_REQUEST_ID,
        input: [{ type: "text", text: "hello" }],
      }),
    ).toThrow();

    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "turn.submit",
        threadId: "thr_123",
        requestId: CLIENT_REQUEST_ID,
        input: [{ type: "text", text: "follow up" }],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/workspace",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "proj_123",
          providerId: "codex",
          providerThreadId: "prov_123",
          instructions: "Be concise.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "start" },
      }),
    ).toThrow();
  });

  it("parses thread.start with workspacePath", () => {
    expect(
      hostDaemonCommandSchema.parse({
        type: "thread.start",
        environmentId: "env_123",
        threadId: "thr_123",
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "proj_123",
        providerId: "codex",
        requestId: CLIENT_REQUEST_ID,
        input: [{ type: "text", text: "hello" }],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "Be a helpful manager.",
        dynamicTools: [
          {
            name: "message_user",
            description: "Send a user-visible update",
            inputSchema: { type: "object" },
          },
        ],
        instructionMode: "replace",
      }),
    ).toMatchObject({
      type: "thread.start",
      workspaceContext: {
        workspacePath: "/tmp/workspace",
        workspaceProvisionType: "unmanaged",
      },
    });
  });

  it("keeps contract optional fields on an explicit allowlist", () => {
    const optionalFieldPaths = collectOptionalFieldPaths({
      hostDaemonActiveThreadSchema: contract.hostDaemonActiveThreadSchema,
      hostDaemonCommandSchema: contract.hostDaemonCommandSchema,
      hostDaemonInteractiveRequestSchema:
        contract.hostDaemonInteractiveRequestSchema,
      hostDaemonInteractiveRequestResponseSchema:
        contract.hostDaemonInteractiveRequestResponseSchema,
      hostDaemonOnlineRpcCommandSchema:
        contract.hostDaemonOnlineRpcCommandSchema,
      workspaceCommitResultSchema:
        contract.hostDaemonCommandResultSchemaByType["workspace.commit"],
      workspaceSquashMergeResultSchema:
        contract.hostDaemonCommandResultSchemaByType["workspace.squash_merge"],
    });

    expect(optionalFieldPaths).toEqual(
      Object.keys(INTENTIONAL_OPTIONAL_HOST_DAEMON_FIELDS).sort(),
    );
    expect(
      Object.values(INTENTIONAL_OPTIONAL_HOST_DAEMON_FIELDS).every(
        (reason) => reason.trim().length > 0,
      ),
    ).toBe(true);
  });

  it("requires requestId, resumeContext, and target for turn.submit", () => {
    expect(
      hostDaemonCommandSchema.parse({
        type: "turn.submit",
        environmentId: "env_123",
        threadId: "thr_123",
        requestId: CLIENT_REQUEST_ID,
        input: [{ type: "text", text: "hello" }],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/workspace",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "proj_123",
          providerId: "codex",
          providerThreadId: "provider_123",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "start" },
      }),
    ).toMatchObject({
      type: "turn.submit",
      requestId: CLIENT_REQUEST_ID,
      resumeContext: {
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "unmanaged",
        },
      },
      target: { mode: "start" },
    });

    expect(
      hostDaemonCommandSchema.parse({
        type: "turn.submit",
        environmentId: "env_123",
        threadId: "thr_123",
        requestId: CLIENT_REQUEST_ID,
        input: [{ type: "text", text: "adjust" }],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/workspace",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "proj_123",
          providerId: "codex",
          providerThreadId: "provider_123",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "auto", expectedTurnId: "turn_123" },
      }),
    ).toMatchObject({
      type: "turn.submit",
      requestId: CLIENT_REQUEST_ID,
      target: { mode: "auto", expectedTurnId: "turn_123" },
    });

    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "turn.submit",
        environmentId: "env_123",
        threadId: "thr_123",
        input: [{ type: "text", text: "hello" }],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/workspace",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "proj_123",
          providerId: "codex",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
        },
        target: { mode: "start" },
      }),
    ).toThrow();

    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "thread.start",
        environmentId: "env_123",
        threadId: "thr_123",
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "proj_123",
        providerId: "codex",
        requestId: CLIENT_REQUEST_ID,
        input: [{ type: "text", text: "hello" }],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "Be concise.",
        dynamicTools: [],
      }),
    ).toThrow();
  });

  it("rejects old eventSequence command fields", () => {
    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "thread.start",
        environmentId: "env_123",
        threadId: "thr_123",
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "proj_123",
        providerId: "codex",
        requestId: CLIENT_REQUEST_ID,
        eventSequence: 1,
        input: [{ type: "text", text: "hello" }],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "Be concise.",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
      }),
    ).toThrow();

    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "turn.submit",
        environmentId: "env_123",
        threadId: "thr_123",
        requestId: CLIENT_REQUEST_ID,
        eventSequence: 2,
        input: [{ type: "text", text: "hello" }],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/workspace",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "proj_123",
          providerId: "codex",
          providerThreadId: "provider_123",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "start" },
      }),
    ).toThrow();

    expect(() =>
      hostDaemonCommandSchema.parse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: {
          threadId: "thr_123",
          provisioningId: "tpv_123",
          eventSequence: 3,
        },
        workspaceProvisionType: "managed-worktree",
        sourcePath: "/tmp/project",
        targetPath: "/tmp/project/.bb/env",
        branchName: "bb/env-123",
        setupTimeoutMs: 900000,
      }),
    ).toThrow();
  });

  it("rejects invalid branch names at command boundaries", () => {
    expect(
      hostDaemonCommandSchema.safeParse({
        type: "host.list_branches",
        path: "/tmp/workspace",
        selectedBranch: "origin/main lock",
        limit: 50,
      }).success,
    ).toBe(false);

    expect(
      hostDaemonCommandSchema.safeParse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: null,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/project",
        checkout: { kind: "existing", name: "feature/test lock" },
      }).success,
    ).toBe(false);

    expect(
      hostDaemonCommandSchema.safeParse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: null,
        workspaceProvisionType: "unmanaged",
        path: "/tmp/project",
        checkout: {
          kind: "new",
          name: "bb/env-123",
          baseBranch: "release lock",
        },
      }).success,
    ).toBe(false);

    expect(
      hostDaemonCommandSchema.safeParse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: null,
        workspaceProvisionType: "managed-worktree",
        sourcePath: "/tmp/project",
        targetPath: "/tmp/project/.bb/env",
        branchName: "bb/env lock",
        baseBranch: null,
        setupTimeoutMs: 900000,
      }).success,
    ).toBe(false);

    expect(
      hostDaemonCommandSchema.safeParse({
        type: "environment.provision",
        environmentId: "env_123",
        initiator: null,
        workspaceProvisionType: "managed-worktree",
        sourcePath: "/tmp/project",
        targetPath: "/tmp/project/.bb/env",
        branchName: "bb/env-123",
        baseBranch: "release lock",
        setupTimeoutMs: 900000,
      }).success,
    ).toBe(false);

    expect(
      hostDaemonCommandSchema.safeParse({
        type: "workspace.status",
        environmentId: "env_123",
        environmentStatus: "ready",
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "unmanaged",
        },
        mergeBaseBranch: "origin/main lock",
      }).success,
    ).toBe(false);

    expect(
      hostDaemonCommandSchema.safeParse({
        type: "workspace.squash_merge",
        environmentId: "env_123",
        environmentStatus: "ready",
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "unmanaged",
        },
        targetBranch: "main lock",
        commitMessage: "Merge branch",
      }).success,
    ).toBe(false);
  });

  it("bounds file list command queries and limits", () => {
    const longQuery = "a".repeat(contract.FILE_LIST_QUERY_MAX_LENGTH + 1);

    expect(() =>
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.list_files",
        path: "/tmp/bb-data/thread-storage/thread-123",
        query: longQuery,
        limit: 100,
      }),
    ).toThrow();

    expect(() =>
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.list_files",
        path: "/tmp/bb-data/thread-storage/thread-123",
        limit: contract.FILE_LIST_LIMIT_MAX + 1,
      }),
    ).toThrow();

    expect(() =>
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.list_files",
        path: "/tmp/workspace",
        query: longQuery,
        limit: 100,
      }),
    ).toThrow();

    expect(() =>
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.list_files",
        path: "/tmp/workspace",
        limit: contract.FILE_LIST_LIMIT_MAX + 1,
      }),
    ).toThrow();

    expect(() =>
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.list_paths",
        path: "/tmp/workspace",
        query: longQuery,
        limit: 100,
        includeFiles: true,
        includeDirectories: true,
      }),
    ).toThrow();

    expect(() =>
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.list_paths",
        path: "/tmp/workspace",
        limit: contract.FILE_LIST_LIMIT_MAX + 1,
        includeFiles: true,
        includeDirectories: true,
      }),
    ).toThrow();

    expect(() =>
      hostDaemonOnlineRpcCommandSchema.parse({
        type: "host.list_paths",
        path: "/tmp/workspace",
        limit: 100,
        includeFiles: false,
        includeDirectories: false,
      }),
    ).toThrow();
  });

  it("keeps typed per-command result schemas", () => {
    expect(
      hostDaemonOnlineRpcResultSchemaByType["host.list_files"].parse({
        files: [{ path: "notes/today.md", name: "today.md" }],
        truncated: false,
      }),
    ).toMatchObject({
      files: [{ path: "notes/today.md", name: "today.md" }],
      truncated: false,
    });

    expect(
      hostDaemonOnlineRpcResultSchemaByType["host.list_paths"].parse({
        paths: [
          {
            kind: "directory",
            path: "notes",
            name: "notes",
            score: 0,
            positions: [],
          },
          {
            kind: "file",
            path: "notes/today.md",
            name: "today.md",
            score: 240,
            positions: [0, 1, 2],
          },
        ],
        truncated: false,
      }),
    ).toMatchObject({
      paths: [
        { kind: "directory", path: "notes" },
        { kind: "file", path: "notes/today.md" },
      ],
      truncated: false,
    });

    expect(
      hostDaemonOnlineRpcResultSchemaByType["host.list_branches"].parse({
        branches: ["main", "feature/test"],
        branchesTruncated: false,
        checkout: {
          kind: "branch",
          branchName: "feature/test",
          headSha: "abc123",
        },
        defaultBranch: "main",
        hasUncommittedChanges: true,
        operation: { kind: "merge", hasConflicts: true },
        remoteBranches: ["origin/main"],
        remoteBranchesTruncated: false,
        selectedBranch: { name: "origin/main", kind: "remote" },
      }),
    ).toMatchObject({
      checkout: {
        kind: "branch",
        branchName: "feature/test",
      },
      hasUncommittedChanges: true,
      operation: { kind: "merge", hasConflicts: true },
    });

    expect(
      hostDaemonOnlineRpcResultSchemaByType["host.read_file"].parse({
        path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
        content: "# Preferences",
        contentEncoding: "utf8",
        mimeType: "text/markdown",
        sizeBytes: 13,
      }),
    ).toMatchObject({
      path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
      content: "# Preferences",
      contentEncoding: "utf8",
    });

    expect(
      hostDaemonOnlineRpcResultSchemaByType["host.read_file_relative"].parse({
        path: "assets/logo.png",
        content: "iVBORw0KGgo=",
        contentEncoding: "base64",
        mimeType: "image/png",
        sizeBytes: 8,
      }),
    ).toMatchObject({
      path: "assets/logo.png",
      content: "iVBORw0KGgo=",
      contentEncoding: "base64",
    });

    expect(
      hostDaemonOnlineRpcResultSchemaByType["host.file_metadata"].parse({
        path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
        modifiedAtMs: 1234.5,
        sizeBytes: 26_214_401,
      }),
    ).toMatchObject({
      path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
      modifiedAtMs: 1234.5,
      sizeBytes: 26_214_401,
    });

    expect(
      hostDaemonCommandResultSchemaByType["host.delete_path_relative"].parse({
        path: "demo",
        deleted: true,
      }),
    ).toEqual({
      path: "demo",
      deleted: true,
    });

    expect(
      hostDaemonCommandResultSchemaByType[
        "environment.cleanup_preflight"
      ].parse({
        outcome: "safe_to_destroy",
      }),
    ).toEqual({
      outcome: "safe_to_destroy",
    });

    expect(
      hostDaemonCommandResultSchemaByType[
        "environment.cleanup_preflight"
      ].parse({
        outcome: "already_missing",
        failure: {
          code: "path_not_found",
          workspacePath: "/tmp/missing",
          message: "Managed workspace path does not exist: /tmp/missing",
        },
      }),
    ).toEqual({
      outcome: "already_missing",
      failure: {
        code: "path_not_found",
        workspacePath: "/tmp/missing",
        message: "Managed workspace path does not exist: /tmp/missing",
      },
    });

    expect(
      hostDaemonOnlineRpcResultSchemaByType["workspace.status"].parse({
        outcome: "available",
        workspaceStatus: {
          workingTree: {
            insertions: 0,
            deletions: 0,
            files: [],
            hasUncommittedChanges: false,
            state: "clean",
          },
          branch: {
            currentBranch: "bb/env-123",
            defaultBranch: "main",
          },
          mergeBase: null,
        },
      }),
    ).toMatchObject({
      outcome: "available",
      workspaceStatus: {
        workingTree: {
          state: "clean",
        },
      },
    });

    expect(
      hostDaemonOnlineRpcResultSchemaByType["workspace.diff"].parse({
        outcome: "unavailable",
        failure: {
          code: "not_git_repo",
          workspacePath: "/tmp/workspace",
          message: "Path is not a git repository: /tmp/workspace",
        },
      }),
    ).toMatchObject({
      outcome: "unavailable",
      failure: {
        code: "not_git_repo",
      },
    });

    expect(() =>
      hostDaemonCommandResultSchemaByType["workspace.commit"].parse({
        commitSha: "",
      }),
    ).toThrow();
  });

  it("includes discovered workspace properties in environment.provision result", () => {
    expect(
      hostDaemonCommandResultSchemaByType["environment.provision"].parse({
        path: "/tmp/env",
        isGitRepo: true,
        isWorktree: true,
        branchName: "bb/env-123",
        defaultBranch: "main",
        transcript: [
          {
            type: "step",
            key: "setup",
            text: "/bin/bash .bb-env-setup.sh",
            status: "completed",
          },
        ],
      }),
    ).toMatchObject({
      isGitRepo: true,
      isWorktree: true,
      branchName: "bb/env-123",
    });
  });
});

describe("host-daemon session schemas", () => {
  it("parses valid session open and event batch payloads", () => {
    expect(
      hostDaemonSessionOpenRequestSchema.parse({
        hostId: "host_123",
        instanceId: "instance_1",
        hostName: "Michael's MacBook",
        hostType: "persistent",
        dataDir: "/tmp/bb-data",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        activeThreads: [
          {
            threadId: "thr_123",
          },
        ],
      }),
    ).toMatchObject({
      hostId: "host_123",
      hostType: "persistent",
      loadedEnvironments: [],
    });

    expect(
      hostDaemonSessionOpenRequestSchema.parse({
        hostId: "host_123",
        instanceId: "instance_1",
        hostName: "Michael's MacBook",
        hostType: "persistent",
        dataDir: "/tmp/bb-data",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        activeThreads: [],
        loadedEnvironments: [
          {
            environmentId: "env_123",
          },
        ],
      }),
    ).toMatchObject({
      loadedEnvironments: [
        {
          environmentId: "env_123",
        },
      ],
    });

    expect(() =>
      hostDaemonSessionOpenRequestSchema.parse({
        hostId: "host_123",
        instanceId: "instance_1",
        hostName: "Michael's MacBook",
        hostType: "persistent",
        dataDir: "/tmp/bb-data",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        activeThreads: [
          {
            threadId: "",
          },
        ],
      }),
    ).toThrow();

    expect(
      hostDaemonSessionOpenRequestSchema.parse({
        hostId: "host_123",
        instanceId: "instance_1",
        hostName: "Michael's MacBook",
        hostType: "persistent",
        dataDir: "/tmp/bb-data",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
        activeThreads: [],
      }),
    ).toMatchObject({
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
    });

    expect(() =>
      hostDaemonSessionOpenRequestSchema.parse({
        hostId: "host_123",
        instanceId: "instance_1",
        hostName: "Michael's MacBook",
        hostType: "persistent",
        dataDir: "/tmp/bb-data",
        protocolVersion: 0,
        activeThreads: [],
      }),
    ).toThrow();

    expect(
      hostDaemonCommandsQuerySchema.parse({
        sessionId: "session_123",
        limit: "100",
        waitMs: "0",
      }),
    ).toMatchObject({
      sessionId: "session_123",
    });

    expect(
      hostDaemonSessionOpenResponseSchema.parse({
        sessionId: "session_123",
        heartbeatIntervalMs: 5_000,
        leaseTimeoutMs: 30_000,
        trackedThreadTargets: [
          {
            environmentId: "env_123",
            threadId: "thr_123",
          },
        ],
      }),
    ).toMatchObject({
      sessionId: "session_123",
      retiredEnvironmentIds: [],
      trackedThreadTargets: [
        {
          environmentId: "env_123",
          threadId: "thr_123",
        },
      ],
    });

    expect(() =>
      hostDaemonSessionOpenResponseSchema.parse({
        sessionId: "session_123",
        heartbeatIntervalMs: 5_000,
        leaseTimeoutMs: 30_000,
        trackedThreadTargets: [],
        threadHighWaterMarks: { thr_123: 10 },
      }),
    ).toThrow();

    expect(
      hostDaemonEventBatchRequestSchema.parse({
        sessionId: "session_123",
        events: [
          {
            producerEventId: PRODUCER_EVENT_ID,
            threadId: "thr_123",
            event: {
              type: "system/error",
              threadId: "thr_123",
              scope: threadScope(),
              message: "boom",
            },
          },
        ],
      }),
    ).toMatchObject({
      sessionId: "session_123",
      events: [
        {
          producerEventId: PRODUCER_EVENT_ID,
          threadId: "thr_123",
        },
      ],
    });

    expect(
      hostDaemonEventBatchResponseSchema.parse({
        acceptedEvents: [
          {
            producerEventId: PRODUCER_EVENT_ID,
            threadId: "thr_123",
            sequence: 42,
          },
        ],
        rejectedEvents: [
          {
            producerEventId: "hdevt_23456789abcdefghijkn",
            reason: "thread_not_owned_by_host",
            threadId: "thr_stale",
          },
        ],
      }),
    ).toEqual({
      acceptedEvents: [
        {
          producerEventId: PRODUCER_EVENT_ID,
          threadId: "thr_123",
          sequence: 42,
        },
      ],
      rejectedEvents: [
        {
          producerEventId: "hdevt_23456789abcdefghijkn",
          reason: "thread_not_owned_by_host",
          threadId: "thr_stale",
        },
      ],
    });

    expect(() =>
      hostDaemonEventBatchResponseSchema.parse({
        acceptedEvents: [],
      }),
    ).toThrow();

    expect(() =>
      hostDaemonEventBatchResponseSchema.parse({
        acceptedEvents: [],
        rejectedEvents: [
          {
            producerEventId: "hdevt_23456789abcdefghijkn",
            reason: "unknown_reason",
            threadId: "thr_stale",
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      hostDaemonEventBatchRequestSchema.parse({
        sessionId: "session_123",
        events: [
          {
            producerEventId: PRODUCER_EVENT_ID,
            threadId: "thr_123",
            sequence: 1,
            event: {
              type: "system/error",
              threadId: "thr_123",
              scope: threadScope(),
              message: "boom",
            },
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      hostDaemonEventBatchResponseSchema.parse({
        acceptedEvents: [
          {
            producerEventId: PRODUCER_EVENT_ID,
            threadId: "thr_123",
            sequence: 42,
          },
        ],
        rejectedEvents: [],
        threadHighWaterMarks: {
          thr_123: 42,
        },
      }),
    ).toThrow();

    expect(
      hostDaemonCommandResultResponseSchema.parse({
        ok: true,
      }),
    ).toEqual({
      ok: true,
    });

    expect(() =>
      hostDaemonCommandResultResponseSchema.parse({
        ok: true,
        threadHighWaterMarks: {
          thr_123: 43,
        },
      }),
    ).toThrow();

    expect(
      hostDaemonDaemonWsMessageSchema.parse({
        type: "environment-change",
        environmentId: "env_123",
        change: "work-status-changed",
      }),
    ).toEqual({
      type: "environment-change",
      environmentId: "env_123",
      change: "work-status-changed",
    });

    expect(
      hostDaemonDaemonWsMessageSchema.parse({
        type: "environment-change",
        environmentId: "env_123",
        change: "git-refs-changed",
      }),
    ).toEqual({
      type: "environment-change",
      environmentId: "env_123",
      change: "git-refs-changed",
    });

    expect(
      hostDaemonDaemonWsMessageSchema.parse({
        type: "environment-change",
        environmentId: "env_123",
        change: "thread-storage-changed",
      }),
    ).toEqual({
      type: "environment-change",
      environmentId: "env_123",
      change: "thread-storage-changed",
    });

    expect(
      hostDaemonDaemonWsMessageSchema.parse({
        type: "application-storage-changed",
      }),
    ).toEqual({
      type: "application-storage-changed",
    });

    expect(
      contract.hostDaemonAppDataChangeRequestSchema.parse({
        sessionId: "session_123",
        threadId: "thr_123",
        appId: "status",
        path: "state.json",
        value: { workers: [] },
        deleted: false,
        version: "next-hash",
      }),
    ).toEqual({
      sessionId: "session_123",
      threadId: "thr_123",
      appId: "status",
      path: "state.json",
      value: { workers: [] },
      deleted: false,
      version: "next-hash",
    });

    expect(
      contract.hostDaemonAppDataChangeRequestSchema.parse({
        sessionId: "session_123",
        threadId: "thr_123",
        appId: "status",
        path: "state.json",
        value: null,
        deleted: true,
        version: null,
      }),
    ).toMatchObject({
      deleted: true,
      version: null,
    });

    expect(() =>
      contract.hostDaemonAppDataChangeRequestSchema.parse({
        sessionId: "session_123",
        threadId: "thr_123",
        appId: "status",
        path: "state.json",
        value: { workers: [] },
        deleted: false,
        version: null,
      }),
    ).toThrow();

    expect(
      contract.hostDaemonAppDataResyncRequestSchema.parse({
        sessionId: "session_123",
        threadId: "thr_123",
        appId: "status",
      }),
    ).toEqual({
      sessionId: "session_123",
      threadId: "thr_123",
      appId: "status",
    });

    expect(
      hostDaemonInteractiveRequestSchema.parse({
        sessionId: "session_123",
        interaction: {
          threadId: "thr_123",
          turnId: "turn_123",
          providerId: "codex",
          providerThreadId: "provider-thread-123",
          providerRequestId: "request-123",
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
        },
      }),
    ).toMatchObject({
      sessionId: "session_123",
      interaction: {
        providerId: "codex",
      },
    });

    expect(
      hostDaemonInteractiveRequestResponseSchema.parse({
        outcome: "created",
        interactionId: "pint_123",
        status: "pending",
      }),
    ).toMatchObject({
      outcome: "created",
      interactionId: "pint_123",
    });

    expect(
      hostDaemonInteractiveRequestResponseSchema.parse({
        outcome: "existing",
        interactionId: "pint_123",
        status: "resolving",
      }),
    ).toMatchObject({
      outcome: "existing",
      interactionId: "pint_123",
      status: "resolving",
    });

    expect(
      hostDaemonInteractiveInterruptRequestSchema.parse({
        sessionId: "session_123",
        providerId: "codex",
        threadIds: ["thr_123"],
        reason: "Provider exited",
      }),
    ).toEqual({
      sessionId: "session_123",
      providerId: "codex",
      threadIds: ["thr_123"],
      reason: "Provider exited",
    });

    expect(
      hostDaemonInteractiveInterruptResponseSchema.parse({
        ok: true,
        interactionIds: ["pint_123"],
      }),
    ).toEqual({
      ok: true,
      interactionIds: ["pint_123"],
    });
  });

  it("restricts daemon websocket control and RPC messages", () => {
    expect(
      hostDaemonServerWsMessageSchema.parse({
        type: "commands-available",
      }),
    ).toEqual({ type: "commands-available" });

    expect(
      hostDaemonServerWsMessageSchema.parse({
        type: "session-close",
        reason: "replaced",
      }),
    ).toMatchObject({
      type: "session-close",
      reason: "replaced",
    });

    expect(
      hostDaemonServerWsMessageSchema.parse({
        type: "session-close",
        reason: "daemon-disconnect",
      }),
    ).toMatchObject({
      type: "session-close",
      reason: "daemon-disconnect",
    });

    expect(() =>
      hostDaemonServerWsMessageSchema.parse({
        type: "session-close",
        reason: "shutdown",
      }),
    ).toThrow();

    expect(
      hostDaemonDaemonWsMessageSchema.parse({
        type: "heartbeat",
      }),
    ).toMatchObject({
      type: "heartbeat",
    });

    expect(() =>
      hostDaemonDaemonWsMessageSchema.parse({
        type: "heartbeat",
        bufferDepth: 0,
      }),
    ).toThrow();

    expect(
      hostDaemonServerWsMessageSchema.parse({
        type: "host-rpc.request",
        requestId: "rpc-1",
        command: { type: "provider.list" },
      }),
    ).toEqual({
      type: "host-rpc.request",
      requestId: "rpc-1",
      command: { type: "provider.list" },
    });

    expect(
      hostDaemonDaemonWsMessageSchema.parse({
        type: "host-rpc.response",
        requestId: "rpc-1",
        commandType: "provider.list",
        ok: true,
        result: { providers: [] },
      }),
    ).toEqual({
      type: "host-rpc.response",
      requestId: "rpc-1",
      commandType: "provider.list",
      ok: true,
      result: { providers: [] },
    });

    expect(
      hostDaemonDaemonWsMessageSchema.parse({
        type: "host-rpc.response",
        requestId: "rpc-1",
        commandType: "host.read_file",
        ok: true,
        result: {
          path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
          content: "# Preferences",
          contentEncoding: "utf8",
          mimeType: "text/markdown",
          modifiedAtMs: 1234.5,
          sizeBytes: 13,
        },
      }),
    ).toEqual({
      type: "host-rpc.response",
      requestId: "rpc-1",
      commandType: "host.read_file",
      ok: true,
      result: {
        path: "/tmp/bb-data/thread-storage/thread-123/PREFERENCES.md",
        content: "# Preferences",
        contentEncoding: "utf8",
        mimeType: "text/markdown",
        modifiedAtMs: 1234.5,
        sizeBytes: 13,
      },
    });

    expect(
      hostDaemonDaemonWsMessageSchema.parse({
        type: "host-rpc.response",
        requestId: "rpc-1",
        commandType: "host.read_file_relative",
        ok: true,
        result: {
          path: "assets/logo.png",
          content: "iVBORw0KGgo=",
          contentEncoding: "base64",
          mimeType: "image/png",
          modifiedAtMs: 1234.5,
          sizeBytes: 8,
        },
      }),
    ).toEqual({
      type: "host-rpc.response",
      requestId: "rpc-1",
      commandType: "host.read_file_relative",
      ok: true,
      result: {
        path: "assets/logo.png",
        content: "iVBORw0KGgo=",
        contentEncoding: "base64",
        mimeType: "image/png",
        modifiedAtMs: 1234.5,
        sizeBytes: 8,
      },
    });

    expect(
      hostDaemonDaemonWsMessageSchema.safeParse({
        type: "host-rpc.response",
        requestId: "rpc-1",
        commandType: "provider.list",
        ok: true,
        result: { models: [], selectedOnlyModels: [] },
      }).success,
    ).toBe(false);
  });

  it("round-trips every online RPC response success variant through daemon websocket schemas", () => {
    // Keep this table-driven instead of inspecting Zod internals: the exported
    // schema behavior is stable API, while union internals are not.
    expect(Object.keys(ONLINE_RPC_RESPONSE_RESULT_FIXTURES).sort()).toEqual(
      [...HOST_DAEMON_ONLINE_RPC_COMMAND_TYPES].sort(),
    );

    for (const commandType of HOST_DAEMON_ONLINE_RPC_COMMAND_TYPES) {
      expectHostRpcResponseRoundTrip(
        commandType,
        ONLINE_RPC_RESPONSE_RESULT_FIXTURES[commandType],
        commandType,
      );
    }

    for (const testCase of ADDITIONAL_ONLINE_RPC_RESPONSE_ROUND_TRIP_CASES) {
      expectHostRpcResponseRoundTrip(
        testCase.commandType,
        testCase.result,
        testCase.name,
      );
    }
  });

  it("rejects online RPC response results that do not match commandType", () => {
    for (const testCase of ONLINE_RPC_RESPONSE_MISMATCH_CASES) {
      const message = buildHostRpcResponseMessage(
        testCase.commandType,
        testCase.result,
      );
      const jsonRoundTripped = JSON.parse(JSON.stringify(message));

      expect(
        hostDaemonOnlineRpcResponseMessageSchema.safeParse(jsonRoundTripped)
          .success,
        testCase.name,
      ).toBe(false);
      expect(
        hostDaemonDaemonWsMessageSchema.safeParse(jsonRoundTripped).success,
        testCase.name,
      ).toBe(false);
    }
  });

  it("bounds terminal dimensions in daemon websocket messages", () => {
    expect(
      hostDaemonServerWsMessageSchema.safeParse({
        type: "terminal.open",
        requestId: "request-1",
        terminalId: "term_123",
        threadId: "thr_123",
        environmentId: "env_123",
        workspaceContext: {
          workspacePath: "/tmp/workspace",
          workspaceProvisionType: "unmanaged",
        },
        cols: TERMINAL_COLS_MAX,
        rows: TERMINAL_ROWS_MAX,
      }).success,
    ).toBe(true);
    expect(
      hostDaemonServerWsMessageSchema.safeParse({
        type: "terminal.resize",
        terminalId: "term_123",
        cols: TERMINAL_COLS_MAX + 1,
        rows: TERMINAL_ROWS_MAX,
      }).success,
    ).toBe(false);
    expect(
      hostDaemonDaemonWsMessageSchema.safeParse({
        type: "terminal.opened",
        requestId: "request-1",
        terminalId: "term_123",
        shell: "/bin/zsh",
        title: "zsh",
        initialCwd: "/tmp/workspace",
        currentCwd: null,
        cols: TERMINAL_COLS_MAX,
        rows: TERMINAL_ROWS_MAX + 1,
      }).success,
    ).toBe(false);
  });

  it("bounds and validates terminal data in daemon websocket messages", () => {
    const maxPayload = terminalDataBase64(TERMINAL_DATA_MAX_BYTES);
    const oversizedDecodedPayload = terminalDataBase64(
      TERMINAL_DATA_MAX_BYTES + 1,
    );
    const oversizedEncodedPayload = "A".repeat(
      TERMINAL_DATA_MAX_BASE64_LENGTH + 4,
    );

    expect(
      hostDaemonServerWsMessageSchema.safeParse({
        type: "terminal.input",
        terminalId: "term_123",
        dataBase64: maxPayload,
      }).success,
    ).toBe(true);
    expect(
      hostDaemonTerminalOutputChunkSchema.safeParse({
        seq: 0,
        dataBase64: maxPayload,
      }).success,
    ).toBe(true);
    expect(
      hostDaemonDaemonWsMessageSchema.safeParse({
        type: "terminal.replay",
        requestId: "request-1",
        terminalId: "term_123",
        chunks: [
          {
            seq: 0,
            dataBase64: oversizedDecodedPayload,
          },
        ],
        nextSeq: 1,
      }).success,
    ).toBe(false);
    expect(
      hostDaemonServerWsMessageSchema.safeParse({
        type: "terminal.input",
        terminalId: "term_123",
        dataBase64: "not base64!",
      }).success,
    ).toBe(false);
    expect(
      hostDaemonTerminalOutputChunkSchema.safeParse({
        seq: 0,
        dataBase64: oversizedEncodedPayload,
      }).success,
    ).toBe(false);
  });

  it("builds an internal client rooted at /internal", () => {
    const client = createHostDaemonClient("http://localhost:3334", "secret");

    expect(client.session.open.$url().pathname).toBe("/internal/session/open");
    expect(client.session.commands.$url().pathname).toBe(
      "/internal/session/commands",
    );
    expect(client.session["command-result"].$url().pathname).toBe(
      "/internal/session/command-result",
    );
    expect(client.session["app-data-change"].$url().pathname).toBe(
      "/internal/session/app-data-change",
    );
    expect(client.session["app-data-resync"].$url().pathname).toBe(
      "/internal/session/app-data-resync",
    );
  });
});
