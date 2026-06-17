import fs from "node:fs/promises";
import path from "node:path";
import type { AgentRuntimeOptions } from "@bb/agent-runtime";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import {
  encodeClientTurnRequestIdNumber,
  type ClientTurnRequestId,
  type PromptInput,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandDispatchError,
  dispatchCommand,
  dispatchOnlineRpcCommand,
} from "../../src/command-dispatch.js";
import type { FetchProjectAttachment } from "../../src/project-attachments.js";
import { RuntimeManager } from "../../src/runtime-manager.js";
import {
  cleanupTempDirs,
  createFakeRuntime,
  createFakeWorkspace,
  createHarness,
  makeDispatchOptions,
  makeTempDir,
} from "./dispatch-helpers.js";

afterEach(cleanupTempDirs);

let nextClientRequestIdValue = 1;
const IMAGE_ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024;
const FILE_ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;

type TextPromptInput = Extract<PromptInput, { type: "text" }>;

function textPromptInput(text: string): TextPromptInput {
  return { type: "text", text, mentions: [] };
}

function nextClientRequestId(): ClientTurnRequestId {
  const requestId = encodeClientTurnRequestIdNumber({
    value: nextClientRequestIdValue,
  });
  nextClientRequestIdValue += 1;
  return requestId;
}

describe("thread command dispatch", () => {
  it("evicts stale runtime and rejects thread.start when the loaded runtime path differs from workspaceContext", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-loaded" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-loaded",
      workspacePath: "/tmp/env-loaded",
    });

    const command: Extract<HostDaemonCommand, { type: "thread.start" }> = {
      type: "thread.start",
      environmentId: "env-loaded",
      threadId: "thread-stale-start",
      workspaceContext: {
        workspacePath: "/tmp/env-stale",
        workspaceProvisionType: "unmanaged",
      },
      projectId: "project-stale-start",
      providerId: "fake",
      requestId: nextClientRequestId(),
      input: [textPromptInput("start")],
      options: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        workflowsEnabled: false,
        permissionMode: "full",
        permissionEscalation: null,
      },
      instructions: "Be a helpful coding agent.",
      dynamicTools: [],
      injectedSkillSources: [],
      instructionMode: "append",
    };

    await expect(
      dispatchCommand(command, harness.dispatchOptions()),
    ).rejects.toMatchObject({
      code: "workspace_type_mismatch",
    });
    expect(harness.runtimeState.startedThreadId).toBeUndefined();
    expect(harness.runtimeState.shutdownCount).toBe(1);
    expect(harness.workspaceState.destroyed).toBe(false);

    await expect(
      dispatchCommand(
        {
          ...command,
          requestId: nextClientRequestId(),
        },
        harness.dispatchOptions(),
      ),
    ).resolves.toMatchObject({
      providerThreadId: "provider-thread-stale-start",
    });
    expect(harness.runtimeState.startedThreadId).toBe("thread-stale-start");
  });

  it("rejects turn.submit when the loaded runtime path differs from resume workspaceContext", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-loaded" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-loaded",
      workspacePath: "/tmp/env-loaded",
    });

    await expect(
      dispatchCommand(
        {
          type: "turn.submit",
          environmentId: "env-loaded",
          threadId: "thread-stale-turn",
          requestId: nextClientRequestId(),
          input: [textPromptInput("continue")],
          options: {
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "medium",
            workflowsEnabled: false,
            permissionMode: "full",
            permissionEscalation: null,
          },
          target: { mode: "start" },
          resumeContext: {
            workspaceContext: {
              workspacePath: "/tmp/env-stale",
              workspaceProvisionType: "unmanaged",
            },
            projectId: "project-stale-turn",
            providerId: "fake",
            providerThreadId: "provider-thread-stale-turn",
            instructions: "Be a helpful coding agent.",
            dynamicTools: [],
            injectedSkillSources: [],
            instructionMode: "append",
          },
        },
        harness.dispatchOptions(),
      ),
    ).rejects.toMatchObject({
      code: "workspace_type_mismatch",
    });
    expect(harness.runtimeState.ranTurnClientRequestId).toBeUndefined();
    expect(harness.runtimeState.resumedThreadId).toBeUndefined();
  });

  it("stages uploaded thread.start attachments before runtime input", async () => {
    const threadStorageRootPath = await makeTempDir(
      "bb-thread-start-attachments-",
    );
    const harness = createHarness();
    const requestId = nextClientRequestId();
    const uploadedNotesContent = "content:notes-uploaded.txt";
    const fetchProjectAttachment = vi.fn<FetchProjectAttachment>(
      async (args) => ({
        bytes: Buffer.from(`content:${args.path}`),
      }),
    );

    await dispatchCommand(
      {
        type: "thread.start",
        environmentId: "env-attachments",
        threadId: "thread-attachments",
        workspaceContext: {
          workspacePath: "/tmp/env-attachments",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "project-attachments",
        providerId: "fake",
        requestId,
        input: [
          textPromptInput("inspect these"),
          {
            type: "localFile",
            path: "notes-uploaded.txt",
            name: "notes.txt",
            sizeBytes: Buffer.byteLength(uploadedNotesContent),
          },
          { type: "localImage", path: "screenshot-uploaded.png" },
          { type: "localFile", path: "/tmp/already-readable.txt" },
        ],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "Be a helpful coding agent.",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
      },
      {
        ...harness.dispatchOptions({ threadStorageRootPath }),
        fetchProjectAttachment,
      },
    );

    expect(fetchProjectAttachment).toHaveBeenCalledTimes(2);
    expect(fetchProjectAttachment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        expectedSizeBytes: Buffer.byteLength(uploadedNotesContent),
        maxBytes: FILE_ATTACHMENT_LIMIT_BYTES,
        projectId: "project-attachments",
        threadId: "thread-attachments",
        path: "notes-uploaded.txt",
      }),
    );
    expect(fetchProjectAttachment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        maxBytes: IMAGE_ATTACHMENT_LIMIT_BYTES,
        projectId: "project-attachments",
        threadId: "thread-attachments",
        path: "screenshot-uploaded.png",
      }),
    );

    const runtimeInput = harness.runtimeState.startedInput ?? [];
    const stagedFile = runtimeInput[1];
    const stagedImage = runtimeInput[2];
    const existingFile = runtimeInput[3];
    if (stagedFile?.type !== "localFile") {
      throw new Error("Expected staged local file input");
    }
    if (stagedImage?.type !== "localImage") {
      throw new Error("Expected staged local image input");
    }
    if (existingFile?.type !== "localFile") {
      throw new Error("Expected existing local file input");
    }
    const stagingDir = path.join(
      threadStorageRootPath,
      "thread-attachments",
      "Attachments",
    );
    expect(stagedFile.path.startsWith(`${stagingDir}${path.sep}`)).toBe(true);
    expect(stagedImage.path.startsWith(`${stagingDir}${path.sep}`)).toBe(true);
    expect(path.basename(stagedFile.path)).toBe("notes.txt");
    expect(path.basename(stagedImage.path)).toBe("screenshot-uploaded.png");
    expect(existingFile.path).toBe("/tmp/already-readable.txt");
    await expect(fs.readFile(stagedFile.path, "utf8")).resolves.toBe(
      uploadedNotesContent,
    );
    await expect(fs.readFile(stagedImage.path, "utf8")).resolves.toBe(
      "content:screenshot-uploaded.png",
    );
    expect((await fs.stat(stagedFile.path)).mode & 0o777).toBe(0o600);

    await fs.rm(path.join(threadStorageRootPath, "thread-attachments"), {
      recursive: true,
      force: true,
    });
    await expect(
      fs.stat(path.join(threadStorageRootPath, "thread-attachments")),
    ).rejects.toThrow();
  });

  it("stages uploaded turn.submit attachments before runtime input", async () => {
    const threadStorageRootPath = await makeTempDir(
      "bb-turn-submit-attachments-",
    );
    const harness = createHarness();
    const requestId = nextClientRequestId();
    const fetchProjectAttachment = vi.fn<FetchProjectAttachment>(
      async (args) => ({
        bytes: Buffer.from(`content:${args.path}`),
      }),
    );

    await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-submit-attachments",
        threadId: "thread-submit-attachments",
        requestId,
        input: [{ type: "localFile", path: "follow-up-uploaded.har" }],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-submit-attachments",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-submit-attachments",
          providerId: "fake",
          providerThreadId: "provider-submit-attachments",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "start" },
      },
      {
        ...harness.dispatchOptions({ threadStorageRootPath }),
        fetchProjectAttachment,
      },
    );

    expect(fetchProjectAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        maxBytes: FILE_ATTACHMENT_LIMIT_BYTES,
        projectId: "project-submit-attachments",
        threadId: "thread-submit-attachments",
        path: "follow-up-uploaded.har",
      }),
    );
    const runtimeInput = harness.runtimeState.ranTurnInput ?? [];
    const stagedFile = runtimeInput[0];
    if (stagedFile?.type !== "localFile") {
      throw new Error("Expected staged local file input");
    }
    const stagingDir = path.join(
      threadStorageRootPath,
      "thread-submit-attachments",
      "Attachments",
    );
    expect(stagedFile.path.startsWith(`${stagingDir}${path.sep}`)).toBe(true);
    expect(path.basename(stagedFile.path)).toBe("follow-up-uploaded.har");
    await expect(fs.readFile(stagedFile.path, "utf8")).resolves.toBe(
      "content:follow-up-uploaded.har",
    );
  });

  it("resumes turn.submit again when attachment staging loses the hosted thread", async () => {
    const threadStorageRootPath = await makeTempDir(
      "bb-turn-submit-reaped-during-staging-",
    );
    const harness = createHarness({
      workspacePath: "/tmp/env-reaped-during-staging",
    });
    const threadId = "thread-reaped-during-staging";
    const providerThreadId = "provider-reaped-during-staging";
    harness.threadControls.setProviderSession(threadId, {
      providerId: "fake",
      providerThreadId,
    });
    const originalRunTurn = harness.runtime.runTurn;
    harness.runtime.runTurn = async (args) => {
      expect(harness.runtime.hasThread(args.threadId)).toBe(true);
      await originalRunTurn(args);
    };
    const fetchProjectAttachment = vi.fn<FetchProjectAttachment>(
      async (args) => {
        expect(args.path).toBe("follow-up-uploaded.txt");
        expect(harness.runtime.hasThread(threadId)).toBe(true);
        expect(harness.runtimeState.resumedThreadId).toBeUndefined();
        harness.threadControls.clearProviderSession(threadId);
        return {
          bytes: Buffer.from("content:follow-up-uploaded.txt"),
        };
      },
    );

    await expect(
      dispatchCommand(
        {
          type: "turn.submit",
          environmentId: "env-reaped-during-staging",
          threadId,
          requestId: nextClientRequestId(),
          input: [{ type: "localFile", path: "follow-up-uploaded.txt" }],
          options: {
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "medium",
            workflowsEnabled: false,
            permissionMode: "full",
            permissionEscalation: null,
          },
          resumeContext: {
            workspaceContext: {
              workspacePath: "/tmp/env-reaped-during-staging",
              workspaceProvisionType: "unmanaged",
            },
            projectId: "project-reaped-during-staging",
            providerId: "fake",
            providerThreadId,
            instructions: "Be a helpful coding agent.",
            dynamicTools: [],
            injectedSkillSources: [],
            instructionMode: "append",
          },
          target: { mode: "start" },
        },
        {
          ...harness.dispatchOptions({ threadStorageRootPath }),
          fetchProjectAttachment,
        },
      ),
    ).resolves.toEqual({ appliedAs: "new-turn" });

    expect(fetchProjectAttachment).toHaveBeenCalledTimes(1);
    expect(harness.runtimeState.resumedThreadId).toBe(threadId);
    expect(harness.runtimeState.resumedProviderThreadId).toBe(providerThreadId);
    expect(harness.runtimeState.ranTurnInput?.[0]?.type).toBe("localFile");
  });

  it("leaves runtime-readable attachment paths unstaged", async () => {
    const threadStorageRootPath = await makeTempDir("bb-no-stage-attachments-");
    const harness = createHarness();
    const fetchProjectAttachment = vi.fn<FetchProjectAttachment>();

    await dispatchCommand(
      {
        type: "thread.start",
        environmentId: "env-no-stage-attachments",
        threadId: "thread-no-stage-attachments",
        workspaceContext: {
          workspacePath: "/tmp/env-no-stage-attachments",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "project-no-stage-attachments",
        providerId: "fake",
        requestId: nextClientRequestId(),
        input: [
          { type: "localFile", path: "https://example.test/log.har" },
          { type: "localImage", path: "C:\\Users\\michael\\screenshot.png" },
        ],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "Be a helpful coding agent.",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
      },
      {
        ...harness.dispatchOptions({ threadStorageRootPath }),
        fetchProjectAttachment,
      },
    );

    expect(fetchProjectAttachment).not.toHaveBeenCalled();
    expect(harness.runtimeState.startedInput).toEqual([
      { type: "localFile", path: "https://example.test/log.har" },
      { type: "localImage", path: "C:\\Users\\michael\\screenshot.png" },
    ]);
    await expect(
      fs.stat(path.join(threadStorageRootPath, "thread-no-stage-attachments")),
    ).rejects.toThrow();
  });

  it("stages prompt attachments in a readable flat attachments directory", async () => {
    const threadStorageRootPath = await makeTempDir("bb-restage-attachments-");
    const harness = createHarness();
    const requestId = nextClientRequestId();
    const stagingDir = path.join(
      threadStorageRootPath,
      "thread-restage-attachments",
      "Attachments",
    );
    const restagedPath = path.join(stagingDir, "fresh-uploaded.txt");
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.writeFile(restagedPath, "stale");
    const fetchProjectAttachment = vi.fn<FetchProjectAttachment>(async () => ({
      bytes: Buffer.from("fresh"),
    }));

    await dispatchCommand(
      {
        type: "thread.start",
        environmentId: "env-restage-attachments",
        threadId: "thread-restage-attachments",
        workspaceContext: {
          workspacePath: "/tmp/env-restage-attachments",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "project-restage-attachments",
        providerId: "fake",
        requestId,
        input: [
          { type: "localFile", path: "fresh-uploaded.txt" },
          { type: "localFile", path: "fresh-uploaded.txt" },
        ],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "Be a helpful coding agent.",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
      },
      {
        ...harness.dispatchOptions({ threadStorageRootPath }),
        fetchProjectAttachment,
      },
    );

    await expect(fs.readFile(restagedPath, "utf8")).resolves.toBe("fresh");
    await expect(fs.readdir(stagingDir)).resolves.toEqual([
      "fresh-uploaded-2.txt",
      "fresh-uploaded.txt",
    ]);
  });

  it("cleans up staged attachments when fetching a later attachment fails", async () => {
    const threadStorageRootPath = await makeTempDir(
      "bb-failed-stage-attachments-",
    );
    const harness = createHarness();
    const requestId = nextClientRequestId();
    const fetchProjectAttachment = vi.fn<FetchProjectAttachment>(
      async (args) => {
        if (args.path === "second-uploaded.txt") {
          throw new Error("server unavailable");
        }
        return {
          bytes: Buffer.from(`content:${args.path}`),
        };
      },
    );

    let thrown: unknown;
    try {
      await dispatchCommand(
        {
          type: "thread.start",
          environmentId: "env-failed-stage-attachments",
          threadId: "thread-failed-stage-attachments",
          workspaceContext: {
            workspacePath: "/tmp/env-failed-stage-attachments",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-failed-stage-attachments",
          providerId: "fake",
          requestId,
          input: [
            { type: "localFile", path: "first-uploaded.txt" },
            { type: "localFile", path: "second-uploaded.txt" },
          ],
          options: {
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "medium",
            workflowsEnabled: false,
            permissionMode: "full",
            permissionEscalation: null,
          },
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        {
          ...harness.dispatchOptions({ threadStorageRootPath }),
          fetchProjectAttachment,
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CommandDispatchError);
    expect(thrown).toMatchObject({ code: "attachment_unavailable" });
    expect(fetchProjectAttachment).toHaveBeenCalledTimes(2);
    expect(harness.provisions).toEqual([]);
    expect(harness.runtimeState.startedThreadId).toBeUndefined();
    await expect(
      fs.stat(
        path.join(
          threadStorageRootPath,
          "thread-failed-stage-attachments",
          "Attachments",
          "first-uploaded.txt",
        ),
      ),
    ).rejects.toThrow();
  });

  it("rejects attachment responses that do not match declared size", async () => {
    const threadStorageRootPath = await makeTempDir(
      "bb-oversized-stage-attachments-",
    );
    const harness = createHarness();
    const requestId = nextClientRequestId();
    const fetchProjectAttachment = vi.fn<FetchProjectAttachment>(async () => ({
      bytes: Buffer.from("too-large"),
    }));

    await expect(
      dispatchCommand(
        {
          type: "thread.start",
          environmentId: "env-oversized-stage-attachments",
          threadId: "thread-oversized-stage-attachments",
          workspaceContext: {
            workspacePath: "/tmp/env-oversized-stage-attachments",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-oversized-stage-attachments",
          providerId: "fake",
          requestId,
          input: [
            {
              type: "localFile",
              path: "oversized-uploaded.txt",
              sizeBytes: 4,
            },
          ],
          options: {
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "medium",
            workflowsEnabled: false,
            permissionMode: "full",
            permissionEscalation: null,
          },
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        {
          ...harness.dispatchOptions({ threadStorageRootPath }),
          fetchProjectAttachment,
        },
      ),
    ).rejects.toMatchObject({ code: "attachment_unavailable" });
    expect(harness.provisions).toEqual([]);
    await expect(
      fs.stat(
        path.join(
          threadStorageRootPath,
          "thread-oversized-stage-attachments",
          "Attachments",
          "oversized-uploaded.txt",
        ),
      ),
    ).rejects.toThrow();
  });

  it("cleans up staged thread.start attachments when runtime start fails", async () => {
    const threadStorageRootPath = await makeTempDir(
      "bb-runtime-failed-start-attachments-",
    );
    const harness = createHarness();
    const requestId = nextClientRequestId();
    harness.runtime.startThread = async () => {
      throw new Error("runtime start failed");
    };
    const fetchProjectAttachment = vi.fn<FetchProjectAttachment>(async () => ({
      bytes: Buffer.from("content"),
    }));

    await expect(
      dispatchCommand(
        {
          type: "thread.start",
          environmentId: "env-runtime-failed-start-attachments",
          threadId: "thread-runtime-failed-start-attachments",
          workspaceContext: {
            workspacePath: "/tmp/env-runtime-failed-start-attachments",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-runtime-failed-start-attachments",
          providerId: "fake",
          requestId,
          input: [{ type: "localFile", path: "runtime-failed-uploaded.txt" }],
          options: {
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "medium",
            workflowsEnabled: false,
            permissionMode: "full",
            permissionEscalation: null,
          },
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        {
          ...harness.dispatchOptions({ threadStorageRootPath }),
          fetchProjectAttachment,
        },
      ),
    ).rejects.toThrow("runtime start failed");
    await expect(
      fs.stat(
        path.join(
          threadStorageRootPath,
          "thread-runtime-failed-start-attachments",
          "Attachments",
          "runtime-failed-uploaded.txt",
        ),
      ),
    ).rejects.toThrow();
  });

  it("cleans up staged turn.submit attachments when runtime turn fails", async () => {
    const threadStorageRootPath = await makeTempDir(
      "bb-runtime-failed-turn-attachments-",
    );
    const harness = createHarness();
    const requestId = nextClientRequestId();
    harness.runtime.runTurn = async () => {
      throw new Error("runtime turn failed");
    };
    const fetchProjectAttachment = vi.fn<FetchProjectAttachment>(async () => ({
      bytes: Buffer.from("content"),
    }));

    await expect(
      dispatchCommand(
        {
          type: "turn.submit",
          environmentId: "env-runtime-failed-turn-attachments",
          threadId: "thread-runtime-failed-turn-attachments",
          requestId,
          input: [{ type: "localFile", path: "runtime-turn-uploaded.txt" }],
          options: {
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "medium",
            workflowsEnabled: false,
            permissionMode: "full",
            permissionEscalation: null,
          },
          resumeContext: {
            workspaceContext: {
              workspacePath: "/tmp/env-runtime-failed-turn-attachments",
              workspaceProvisionType: "unmanaged",
            },
            projectId: "project-runtime-failed-turn-attachments",
            providerId: "fake",
            providerThreadId: "provider-runtime-failed-turn-attachments",
            instructions: "Be a helpful coding agent.",
            dynamicTools: [],
            injectedSkillSources: [],
            instructionMode: "append",
          },
          target: { mode: "start" },
        },
        {
          ...harness.dispatchOptions({ threadStorageRootPath }),
          fetchProjectAttachment,
        },
      ),
    ).rejects.toThrow("runtime turn failed");
    await expect(
      fs.stat(
        path.join(
          threadStorageRootPath,
          "thread-runtime-failed-turn-attachments",
          "Attachments",
          "runtime-turn-uploaded.txt",
        ),
      ),
    ).rejects.toThrow();
  });

  it("covers thread lifecycle commands", async () => {
    const harness = createHarness();

    const startResult = await dispatchCommand(
      {
        type: "thread.start",
        environmentId: "env-1",
        threadId: "thread-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "project-1",
        providerId: "fake",
        requestId: nextClientRequestId(),
        input: [textPromptInput("hello")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "Be a helpful coding agent.",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
      },
      harness.dispatchOptions(),
    );
    const renameResult = await dispatchCommand(
      {
        type: "thread.rename",
        environmentId: "env-1",
        threadId: "thread-1",
        title: "Renamed",
      },
      harness.dispatchOptions(),
    );
    const archiveResult = await dispatchCommand(
      {
        type: "thread.archive",
        environmentId: "env-1",
        threadId: "thread-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        providerId: "fake",
        providerThreadId: "provider-thread-1",
      },
      harness.dispatchOptions(),
    );
    const unarchiveResult = await dispatchCommand(
      {
        type: "thread.unarchive",
        environmentId: "env-1",
        threadId: "thread-1",
        providerId: "fake",
        providerThreadId: "provider-thread-1",
      },
      harness.dispatchOptions(),
    );
    const stopResult = await dispatchCommand(
      {
        type: "thread.stop",
        environmentId: "env-1",
        threadId: "thread-1",
      },
      harness.dispatchOptions(),
    );

    expect(startResult).toEqual({ providerThreadId: "provider-thread-1" });
    expect(harness.runtimeState.startedEnvironmentId).toBe("env-1");
    expect(renameResult).toEqual({});
    expect(archiveResult).toEqual({});
    expect(unarchiveResult).toEqual({});
    expect(stopResult).toEqual({});
    expect(harness.runtimeState.startedThreadId).toBe("thread-1");
    expect(harness.runtimeState.startedInstructions).toBe(
      "Be a helpful coding agent.",
    );
    expect(harness.runtimeState.renamedTitle).toBe("Renamed");
    expect(harness.runtimeState.archivedThreadId).toBe("thread-1");
    expect(harness.runtimeState.archivedProviderId).toBe("fake");
    expect(harness.runtimeState.archivedProviderThreadId).toBe(
      "provider-thread-1",
    );
    expect(harness.runtimeState.unarchivedThreadId).toBe("thread-1");
    expect(harness.runtimeState.unarchivedProviderId).toBe("fake");
    expect(harness.runtimeState.unarchivedProviderThreadId).toBe(
      "provider-thread-1",
    );
    // The archive removed the thread from the runtime, so the later stop is
    // an idempotent no-op that never reaches the provider.
    expect(harness.runtimeState.stoppedThreadId).toBeUndefined();
    expect(harness.manager.listActiveThreads()).toEqual([]);
  });

  it("stops a hosted thread through the runtime", async () => {
    const harness = createHarness();

    await dispatchCommand(
      {
        type: "thread.start",
        environmentId: "env-1",
        threadId: "thread-stop",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "project-1",
        providerId: "fake",
        requestId: nextClientRequestId(),
        input: [textPromptInput("work until stopped")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "Be a helpful coding agent.",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
      },
      harness.dispatchOptions(),
    );
    expect(harness.runtime.hasThread("thread-stop")).toBe(true);

    const stopResult = await dispatchCommand(
      {
        type: "thread.stop",
        environmentId: "env-1",
        threadId: "thread-stop",
      },
      harness.dispatchOptions(),
    );

    expect(stopResult).toEqual({});
    expect(harness.runtimeState.stoppedThreadId).toBe("thread-stop");
    expect(harness.runtime.hasThread("thread-stop")).toBe(false);

    // A second stop is an idempotent no-op that never reaches the provider.
    harness.runtimeState.stoppedThreadId = undefined;
    await expect(
      dispatchCommand(
        {
          type: "thread.stop",
          environmentId: "env-1",
          threadId: "thread-stop",
        },
        harness.dispatchOptions(),
      ),
    ).resolves.toEqual({});
    expect(harness.runtimeState.stoppedThreadId).toBeUndefined();
  });

  it("creates the environment runtime for archive commands when needed", async () => {
    const harness = createHarness({ workspacePath: "/tmp/recreated-env" });

    const result = await dispatchCommand(
      {
        type: "thread.archive",
        environmentId: "env-recreated",
        threadId: "thread-archive",
        workspaceContext: {
          workspacePath: "/tmp/recreated-env",
          workspaceProvisionType: "unmanaged",
        },
        providerId: "fake",
        providerThreadId: "provider-archive",
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({});
    expect(harness.provisions).toEqual([
      expect.objectContaining({
        workspaceProvisionType: "unmanaged",
        path: "/tmp/recreated-env",
        signal: expect.any(AbortSignal),
      }),
    ]);
    expect(harness.runtimeState.archivedThreadId).toBe("thread-archive");
    expect(harness.runtimeState.archivedProviderId).toBe("fake");
    expect(harness.runtimeState.archivedProviderThreadId).toBe(
      "provider-archive",
    );
  });

  it("forgets archived runtime threads so later sends resume the provider thread", async () => {
    const harness = createHarness();

    await dispatchCommand(
      {
        type: "thread.start",
        environmentId: "env-resume-after-archive",
        threadId: "thread-resume-after-archive",
        workspaceContext: {
          workspacePath: "/tmp/env-resume-after-archive",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "project-1",
        providerId: "fake",
        requestId: nextClientRequestId(),
        input: [textPromptInput("hello")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "Be a helpful coding agent.",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
      },
      harness.dispatchOptions(),
    );

    await dispatchCommand(
      {
        type: "thread.archive",
        environmentId: "env-resume-after-archive",
        threadId: "thread-resume-after-archive",
        workspaceContext: {
          workspacePath: "/tmp/env-resume-after-archive",
          workspaceProvisionType: "unmanaged",
        },
        providerId: "fake",
        providerThreadId: "provider-thread-resume-after-archive",
      },
      harness.dispatchOptions(),
    );
    expect(harness.runtime.hasThread("thread-resume-after-archive")).toBe(
      false,
    );

    await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-resume-after-archive",
        threadId: "thread-resume-after-archive",
        requestId: nextClientRequestId(),
        input: [textPromptInput("follow up")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-resume-after-archive",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-thread-resume-after-archive",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "start" },
      },
      harness.dispatchOptions(),
    );

    expect(harness.runtimeState.resumedThreadId).toBe(
      "thread-resume-after-archive",
    );
    expect(harness.runtimeState.resumedProviderThreadId).toBe(
      "provider-thread-resume-after-archive",
    );
    expect(harness.runtimeState.ranTurnText).toBe("follow up");
  });

  it("unarchives through provider maintenance runtime after managed workspace cleanup", async () => {
    const dataDir = await makeTempDir("bb-daemon-data-");
    const oldManagedWorkspacePath = path.join(dataDir, "destroyed-worktree");
    const harness = createHarness({ workspacePath: oldManagedWorkspacePath });

    const result = await dispatchCommand(
      {
        type: "thread.unarchive",
        environmentId: "env-unarchive-cleaned",
        threadId: "thread-unarchive-cleaned",
        providerId: "fake",
        providerThreadId: "provider-unarchive-cleaned",
      },
      harness.dispatchOptions({ dataDir }),
    );

    expect(result).toEqual({});
    expect(harness.provisions).toEqual([]);
    const maintenanceWorkspace = await fs.stat(
      path.join(dataDir, "provider-maintenance-workspace"),
    );
    expect(maintenanceWorkspace.isDirectory()).toBe(true);
    expect(harness.runtimeState.unarchivedThreadId).toBe(
      "thread-unarchive-cleaned",
    );
    expect(harness.runtimeState.unarchivedProviderId).toBe("fake");
    expect(harness.runtimeState.unarchivedProviderThreadId).toBe(
      "provider-unarchive-cleaned",
    );
  });

  it("covers turn.submit start and auto targets", async () => {
    const harness = createHarness();
    const runRequestId = nextClientRequestId();
    const steerRequestId = nextClientRequestId();
    await harness.manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    harness.threadControls.setProviderSession("thread-1", {
      providerId: "fake",
      providerThreadId: "provider-1",
    });

    const runResult = await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-1",
        threadId: "thread-1",
        requestId: runRequestId,
        input: [textPromptInput("hello")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-1",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "start" },
      },
      harness.dispatchOptions(),
    );
    const steerResult = await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-1",
        threadId: "thread-1",
        requestId: steerRequestId,
        input: [textPromptInput("adjust")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-1",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "auto", expectedTurnId: "turn-1" },
      },
      harness.dispatchOptions(),
    );

    expect(runResult).toEqual({ appliedAs: "new-turn" });
    expect(steerResult).toEqual({ appliedAs: "steer" });
    expect(harness.runtimeState.ranTurnText).toBe("hello");
    expect(harness.runtimeState.ranTurnClientRequestId).toBe(runRequestId);
    expect(harness.runtimeState.steeredTurnId).toBe("turn-1");
    expect(harness.runtimeState.steeredClientRequestId).toBe(steerRequestId);
    expect(harness.runtimeState.steeredTurnInstructions).toBe(
      "Be a helpful coding agent.",
    );
  });

  it("reports a resident thread idle after its turn completes and active again on the next turn.submit", async () => {
    const harness = createHarness();
    await harness.manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    harness.threadControls.setProviderSession("thread-1", {
      providerId: "fake",
      providerThreadId: "provider-1",
    });

    await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-1",
        threadId: "thread-1",
        requestId: nextClientRequestId(),
        input: [textPromptInput("finish this")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-1",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "start" },
      },
      harness.dispatchOptions(),
    );
    // The provider finishes the turn; the runtime clears its active turn.
    harness.threadControls.endActiveTurn("thread-1");
    expect(harness.manager.listActiveThreads()).toEqual([]);

    const result = await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-1",
        threadId: "thread-1",
        requestId: nextClientRequestId(),
        input: [textPromptInput("resume work")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-1",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "start" },
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({ appliedAs: "new-turn" });
    expect(harness.runtimeState.ranTurnText).toBe("resume work");
    // The runtime still hosts the thread, so no resume round-trip happens.
    expect(harness.runtimeState.resumedThreadId).toBeUndefined();
    expect(harness.manager.listActiveThreads()).toEqual([
      {
        threadId: "thread-1",
      },
    ]);
  });

  it("keeps an active thread active when auto turn.submit steers its turn", async () => {
    const harness = createHarness();
    await harness.manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    harness.threadControls.setActiveTurn("thread-1", "turn-1");

    const result = await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-1",
        threadId: "thread-1",
        requestId: nextClientRequestId(),
        input: [textPromptInput("adjust course")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-1",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "auto", expectedTurnId: "turn-1" },
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({ appliedAs: "steer" });
    expect(harness.runtimeState.steeredTurnId).toBe("turn-1");
    expect(harness.manager.listActiveThreads()).toEqual([
      {
        threadId: "thread-1",
      },
    ]);
  });

  it("falls back to a new turn when auto turn.submit sees a stale turn", async () => {
    const harness = createHarness();
    const requestId = nextClientRequestId();
    await harness.manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    harness.threadControls.setProviderSession("thread-1", {
      providerId: "fake",
      providerThreadId: "provider-1",
    });
    harness.runtime.steerTurn = async (args) => {
      harness.runtimeState.steeredTurnId = args.expectedTurnId;
      harness.runtimeState.steeredClientRequestId = args.clientRequestId;
      return {
        status: "stale",
        activeTurnId: null,
      };
    };

    const result = await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-1",
        threadId: "thread-1",
        requestId,
        input: [textPromptInput("send anyway")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-1",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "auto", expectedTurnId: "turn-old" },
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({ appliedAs: "new-turn" });
    expect(harness.runtimeState.steeredTurnId).toBe("turn-old");
    expect(harness.runtimeState.steeredClientRequestId).toBe(requestId);
    expect(harness.runtimeState.ranTurnText).toBe("send anyway");
    expect(harness.runtimeState.ranTurnClientRequestId).toBe(requestId);
  });

  it("falls back to a new turn when explicit steer sees a stale turn", async () => {
    const harness = createHarness();
    const requestId = nextClientRequestId();
    await harness.manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    harness.threadControls.setProviderSession("thread-1", {
      providerId: "fake",
      providerThreadId: "provider-1",
    });
    harness.runtime.steerTurn = async (args) => ({
      status: "stale",
      activeTurnId: args.expectedTurnId,
    });

    const result = await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-1",
        threadId: "thread-1",
        requestId,
        input: [textPromptInput("strict steer")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-1",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "steer", expectedTurnId: "turn-old" },
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({ appliedAs: "new-turn" });
    expect(harness.runtimeState.ranTurnText).toBe("strict steer");
    expect(harness.runtimeState.ranTurnClientRequestId).toBe(requestId);
  });

  it("starts a new turn when explicit steer has no expected turn", async () => {
    const harness = createHarness();
    const requestId = nextClientRequestId();
    await harness.manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    harness.threadControls.setProviderSession("thread-1", {
      providerId: "fake",
      providerThreadId: "provider-1",
    });

    const result = await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-1",
        threadId: "thread-1",
        requestId,
        input: [textPromptInput("send without active turn")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-1",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "steer", expectedTurnId: null },
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({ appliedAs: "new-turn" });
    expect(harness.runtimeState.ranTurnText).toBe("send without active turn");
    expect(harness.runtimeState.ranTurnClientRequestId).toBe(requestId);
    expect(harness.runtimeState.steeredTurnId).toBeUndefined();
  });

  it("lazily resumes a missing thread runtime before turn.submit", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-lazy" });

    const result = await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-lazy",
        threadId: "thread-1",
        requestId: nextClientRequestId(),
        input: [textPromptInput("hello")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-lazy",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-1",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "start" },
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({ appliedAs: "new-turn" });
    expect(harness.provisions).toEqual([
      expect.objectContaining({
        workspaceProvisionType: "unmanaged",
        path: "/tmp/env-lazy",
        signal: expect.any(AbortSignal),
      }),
    ]);
    expect(harness.runtimeState.resumedEnvironmentId).toBe("env-lazy");
    expect(harness.runtimeState.resumedProviderThreadId).toBe("provider-1");
    expect(harness.runtimeState.ranTurnText).toBe("hello");
  });

  it("re-resolves thread runtime after provider exit clears known threads", async () => {
    const exitedFake = createFakeRuntime();
    const replacementFake = createFakeRuntime();
    const fakes = [exitedFake, replacementFake];
    const { workspace } = createFakeWorkspace("/tmp/env-exit");
    let createRuntimeCalls = 0;
    let onProcessExit:
      | NonNullable<AgentRuntimeOptions["onProcessExit"]>
      | undefined;
    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: (options) => {
        const fake = fakes[createRuntimeCalls];
        createRuntimeCalls += 1;
        if (!fake) {
          throw new Error("Unexpected extra runtime creation");
        }
        onProcessExit = options.onProcessExit;
        return fake.runtime;
      },
    });

    await manager.ensureEnvironment({
      environmentId: "env-exit",
      workspacePath: "/tmp/env-exit",
    });
    exitedFake.threadControls.setProviderSession("thread-1", {
      providerId: "fake",
      providerThreadId: "provider-1",
    });
    onProcessExit?.({
      providerId: "fake",
      threads: [
        {
          activeTurnId: null,
          providerThreadId: "provider-1",
          threadId: "thread-1",
        },
      ],
      code: 1,
      expected: false,
      signal: null,
      stderr: null,
    });

    const result = await dispatchCommand(
      {
        type: "turn.submit",
        environmentId: "env-exit",
        threadId: "thread-1",
        requestId: nextClientRequestId(),
        input: [textPromptInput("after exit")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        resumeContext: {
          workspaceContext: {
            workspacePath: "/tmp/env-exit",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          providerThreadId: "provider-1",
          instructions: "Be a helpful coding agent.",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
        },
        target: { mode: "start" },
      },
      makeDispatchOptions({ runtimeManager: manager }),
    );

    expect(result).toEqual({ appliedAs: "new-turn" });
    // The exit dropped the environment entry, so the dispatch creates a fresh
    // runtime and resumes the thread there instead of reusing the dead one.
    expect(createRuntimeCalls).toBe(2);
    expect(replacementFake.state.resumedThreadId).toBe("thread-1");
    expect(replacementFake.state.ranTurnText).toBe("after exit");
  });

  it("covers provider.list_models", async () => {
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      {
        type: "provider.list_models",
        providerId: "fake",
      },
      {
        ...harness.dispatchOptions(),
        listModels: async () => ({
          models: [
            {
              id: "model-1",
              model: "model-1",
              displayName: "Model 1",
              description: "Test model",
              supportedReasoningEfforts: [],
              defaultReasoningEffort: "medium",
              isDefault: true,
            },
          ],
          selectedOnlyModels: [
            {
              id: "model-1-legacy",
              model: "model-1-legacy",
              displayName: "Model 1 (Legacy)",
              description: "Retired model retained for existing selections",
              supportedReasoningEfforts: [],
              defaultReasoningEffort: "medium",
              isDefault: false,
            },
          ],
        }),
      },
    );

    expect(result).toEqual({
      models: [
        {
          id: "model-1",
          model: "model-1",
          displayName: "Model 1",
          description: "Test model",
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [
        {
          id: "model-1-legacy",
          model: "model-1-legacy",
          displayName: "Model 1 (Legacy)",
          description: "Retired model retained for existing selections",
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "medium",
          isDefault: false,
        },
      ],
    });
  });

  it("uses the server-provided thread runtime config", async () => {
    const threadStorage = await makeTempDir("bb-thread-runtime-");
    const harness = createHarness({ workspacePath: threadStorage });
    const threadInstructions = [
      "You are a thread in a project inside bb.",
      "Prefer concise user updates.",
      "Delegate implementation quickly.",
      "Parent Project",
      threadStorage,
    ].join("\n");

    await dispatchCommand(
      {
        type: "thread.start",
        environmentId: "env-parent",
        threadId: "thread-parent",
        workspaceContext: {
          workspacePath: threadStorage,
          workspaceProvisionType: "unmanaged",
        },
        projectId: "project-1",
        providerId: "fake",
        requestId: nextClientRequestId(),
        input: [textPromptInput("hello")],
        options: {
          model: "claude-opus-4-7",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: threadInstructions,
        dynamicTools: [
          {
            name: "notify_user",
            description: "Send a user-visible update from the thread.",
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: {
                text: {
                  type: "string",
                  description: "User-visible message text.",
                },
              },
              required: ["text"],
            },
          },
        ],
        injectedSkillSources: [],
        instructionMode: "replace",
      },
      harness.dispatchOptions(),
    );

    expect(harness.runtimeState.startedDynamicTools).toEqual([
      expect.objectContaining({ name: "notify_user" }),
    ]);
    expect(harness.runtimeState.startedInstructions).toBe(threadInstructions);
  });

  it("creates threadStoragePath directory before starting the thread", async () => {
    const tempDir = await makeTempDir("bb-thread-storage-start-");
    const storagePath = path.join(tempDir, "thr_abc123");
    const harness = createHarness();

    await dispatchCommand(
      {
        type: "thread.start",
        environmentId: "env-1",
        threadId: "thread-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "project-1",
        providerId: "fake",
        requestId: nextClientRequestId(),
        input: [textPromptInput("hello")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "test",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
        threadStoragePath: storagePath,
      },
      harness.dispatchOptions({ threadStorageRootPath: tempDir }),
    );

    const stat = await fs.stat(storagePath);
    expect(stat.isDirectory()).toBe(true);
  });

  it("does not fail when threadStoragePath is omitted", async () => {
    const harness = createHarness();

    const result = await dispatchCommand(
      {
        type: "thread.start",
        environmentId: "env-1",
        threadId: "thread-1",
        workspaceContext: {
          workspacePath: "/tmp/env-1",
          workspaceProvisionType: "unmanaged",
        },
        projectId: "project-1",
        providerId: "fake",
        requestId: nextClientRequestId(),
        input: [textPromptInput("hello")],
        options: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          workflowsEnabled: false,
          permissionMode: "full",
          permissionEscalation: null,
        },
        instructions: "test",
        dynamicTools: [],
        injectedSkillSources: [],
        instructionMode: "append",
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({ providerThreadId: "provider-thread-1" });
  });

  it("rejects thread.start when threadStoragePath escapes storage root", async () => {
    const tempDir = await makeTempDir("bb-thread-storage-start-traversal-");
    const harness = createHarness();

    await expect(
      dispatchCommand(
        {
          type: "thread.start",
          environmentId: "env-1",
          threadId: "thread-1",
          workspaceContext: {
            workspacePath: "/tmp/env-1",
            workspaceProvisionType: "unmanaged",
          },
          projectId: "project-1",
          providerId: "fake",
          requestId: nextClientRequestId(),
          input: [textPromptInput("hello")],
          options: {
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "medium",
            workflowsEnabled: false,
            permissionMode: "full",
            permissionEscalation: null,
          },
          instructions: "test",
          dynamicTools: [],
          injectedSkillSources: [],
          instructionMode: "append",
          threadStoragePath: "/tmp/evil-escape",
        },
        harness.dispatchOptions({ threadStorageRootPath: tempDir }),
      ),
    ).rejects.toMatchObject({
      code: "invalid_path",
      message: expect.stringContaining("escapes"),
    });
  });
});
