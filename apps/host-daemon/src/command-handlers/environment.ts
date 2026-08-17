import { threadScope, type ProvisioningTranscriptEntry } from "@bb/domain";
import type {
  EnvironmentProvisionCommand,
  HostDaemonCommandResult,
} from "@bb/host-daemon-contract";
import {
  getPersonalWorkspaceRoot,
  validatePersonalWorkspaceTargetPath,
  WorkspaceError,
  type ProvisionWorkspaceArgs,
} from "@bb/host-workspace";
import {
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";

type ProvisionProgressCallback = (entry: ProvisioningTranscriptEntry) => void;
interface ProvisionProgressEmitter {
  flush: () => void;
  onProgress: ProvisionProgressCallback;
}
type BuildOnProgressArgs = {
  command: CommandOf<"environment.provision">;
  options: CommandDispatchOptions;
  transcript: ProvisioningTranscriptEntry[];
};

const PROVISION_PROGRESS_BATCH_MS = 1_000;
const GITHUB_API_TIMEOUT_MS = 8_000;

type RevisionAvailability = "not_found" | "unavailable";

export async function classifyGithubRevisionAvailability(args: {
  providerRepositoryId: string;
  baseBranch: string | null;
  baseRevision: string;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<RevisionAvailability> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const token = args.env.GH_TOKEN?.trim() || args.env.GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "bb-host-daemon",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = (url: string) =>
    fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    });
  try {
    const repository = await request(
      `https://api.github.com/repositories/${args.providerRepositoryId}`,
    );
    if (!repository.ok) return "unavailable";
    const body: unknown = await repository.json();
    if (
      body === null ||
      typeof body !== "object" ||
      !("full_name" in body) ||
      typeof body.full_name !== "string" ||
      !/^[^/]+\/[^/]+$/u.test(body.full_name) ||
      !("default_branch" in body) ||
      typeof body.default_branch !== "string"
    ) {
      return "unavailable";
    }
    const target = await request(
      `https://api.github.com/repos/${body.full_name}/commits/${encodeURIComponent(args.baseRevision)}`,
    );
    if (target.status !== 404) return "unavailable";
    const baseBranch = args.baseBranch ?? body.default_branch;
    const base = await request(
      `https://api.github.com/repos/${body.full_name}/commits/${encodeURIComponent(baseBranch)}`,
    );
    return base.ok ? "not_found" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function provisionEnvironment(
  command: CommandOf<"environment.provision">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"environment.provision">> {
  const alreadyExists =
    options.runtimeManager.get(command.environmentId) != null;

  const transcript: ProvisioningTranscriptEntry[] = [];
  const progress = buildOnProgress({
    command,
    options,
    transcript,
  });

  try {
    let entry;
    try {
      entry = await options.runtimeManager.ensureEnvironment({
        environmentId: command.environmentId,
        provision: toProvisionWorkspaceOptions(
          command,
          options,
          progress.onProgress,
        ),
      });
    } catch (error) {
      const revisionStartPoint =
        command.workspaceProvisionType === "managed-worktree" &&
        command.startPoint.kind === "revision"
          ? command.startPoint
          : null;
      if (
        error instanceof WorkspaceError &&
        error.code === "revision_missing_after_fetch" &&
        revisionStartPoint !== null
      ) {
        const availability = await classifyGithubRevisionAvailability({
          providerRepositoryId: revisionStartPoint.providerRepositoryId,
          baseBranch: revisionStartPoint.baseBranch,
          baseRevision: revisionStartPoint.baseRevision,
          env: {
            ...process.env,
            ...options.runtimeManager.getShellEnv(),
          },
        });
        if (availability === "not_found") {
          throw new WorkspaceError(
            "revision_not_found",
            `Repository revision is unavailable: ${revisionStartPoint.baseRevision}`,
            { cause: error },
          );
        }
        throw new WorkspaceError(
          "revision_unavailable",
          `Repository revision availability is uncertain: ${revisionStartPoint.baseRevision}`,
          { cause: error },
        );
      }
      if (
        error instanceof WorkspaceError &&
        error.code === "git_command_timeout" &&
        revisionStartPoint !== null
      ) {
        throw new WorkspaceError(
          "revision_unavailable",
          `Repository revision fetch timed out: ${revisionStartPoint.baseRevision}`,
          { cause: error },
        );
      }
      throw error;
    }

    const revisionStartPoint =
      command.workspaceProvisionType === "managed-worktree" &&
      command.startPoint.kind === "revision"
        ? command.startPoint
        : null;
    const [branchName, resolvedDefaultBranch, verifiedBaseRevision] =
      await Promise.all([
        entry.workspace.getCurrentBranch(),
        entry.workspace.isGitRepo
          ? entry.workspace.getDefaultBranch()
          : Promise.resolve(null),
        revisionStartPoint !== null
          ? entry.workspace.getHeadSha()
          : Promise.resolve(null),
      ]);
    if (revisionStartPoint !== null && verifiedBaseRevision === null) {
      throw new WorkspaceError(
        "revision_mismatch",
        `Provisioned workspace has no verifiable HEAD: ${entry.workspace.path}`,
      );
    }
    const defaultBranch = entry.workspace.isGitRepo
      ? (resolvedDefaultBranch ?? branchName)
      : null;

    // For fresh provisions, emit cwd (for unmanaged) and branch/SHA entries.
    if (!alreadyExists) {
      if (!entry.workspace.managed) {
        progress.onProgress({
          type: "step",
          key: "workspace-path",
          text: `Using workspace: ${entry.workspace.path}`,
          status: "completed",
          startedAt: Date.now(),
        });
      }
      if (entry.workspace.isGitRepo && branchName) {
        let branchText = `Using branch: ${branchName}`;
        const metadata: { branchName: string; sha?: string } = { branchName };
        try {
          const sha = await entry.workspace.getHeadSha();
          if (sha) {
            branchText = `Using branch: ${branchName} (${sha.slice(0, 7)})`;
            metadata.sha = sha;
          }
        } catch {
          // SHA unavailable (e.g., empty repo)
        }
        progress.onProgress({
          type: "step",
          key: "workspace-branch",
          text: branchText,
          status: "completed",
          startedAt: Date.now(),
          metadata,
        });
      }
    }

    return {
      path: entry.workspace.path,
      isGitRepo: entry.workspace.isGitRepo,
      isWorktree: entry.workspace.isWorktree,
      branchName,
      defaultBranch,
      verifiedBaseRevision,
      transcript: alreadyExists ? [] : transcript,
    };
  } finally {
    // Flush buffered progress events before reporting the command result so
    // streamed transcript entries stay ordered ahead of the terminal outcome.
    progress.flush();
    if (command.initiator) {
      await options.eventSink.flush();
    }
  }
}

export function cancelEnvironmentProvision(
  command: CommandOf<"environment.provision.cancel">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"environment.provision.cancel">> {
  return options.runtimeManager.cancelEnvironmentProvision({
    environmentId: command.environmentId,
  });
}

function buildOnProgress(args: BuildOnProgressArgs): ProvisionProgressEmitter {
  const { command, options, transcript } = args;
  const initiator = command.initiator;
  const eventSink = options.eventSink;
  if (!initiator) {
    return {
      flush: () => undefined,
      onProgress: (entry) => {
        transcript.push(entry);
      },
    };
  }
  const threadId = initiator.threadId;
  const pendingEntries: ProvisioningTranscriptEntry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pendingEntries.length === 0) {
      return;
    }
    const entries = pendingEntries.splice(0, pendingEntries.length);
    eventSink.emit({
      threadId,
      event: {
        type: "system/thread-provisioning",
        threadId,
        scope: threadScope(),
        provisioningId: initiator.provisioningId,
        status: "active",
        environmentId: command.environmentId,
        entries,
      },
    });
  };

  const scheduleFlush = () => {
    if (flushTimer !== null) {
      return;
    }
    flushTimer = setTimeout(flush, PROVISION_PROGRESS_BATCH_MS);
  };

  return {
    flush,
    onProgress: (entry) => {
      transcript.push(entry);
      pendingEntries.push(entry);
      scheduleFlush();
    },
  };
}

export function toProvisionWorkspaceOptions(
  command: EnvironmentProvisionCommand,
  options: Pick<CommandDispatchOptions, "dataDir">,
  onProgress?: ProvisionProgressCallback,
): ProvisionWorkspaceArgs {
  switch (command.workspaceProvisionType) {
    case "unmanaged": {
      return {
        workspaceProvisionType: "unmanaged" as const,
        path: command.path,
        ...(command.checkout ? { checkout: command.checkout } : {}),
        onProgress,
      };
    }
    case "managed-worktree": {
      return {
        workspaceProvisionType: command.workspaceProvisionType,
        sourcePath: command.sourcePath,
        targetPath: command.targetPath,
        branchName: command.branchName,
        startPoint:
          command.startPoint.kind === "branch"
            ? command.startPoint
            : {
                kind: "revision",
                baseBranch: command.startPoint.baseBranch,
                revision: command.startPoint.baseRevision,
                allowExistingDescendant:
                  command.startPoint.allowExistingDescendant,
              },
        timeoutMs: command.setupTimeoutMs,
        onProgress,
      };
    }
    case "personal": {
      const personalWorkspaceRoot = getPersonalWorkspaceRoot(options.dataDir);
      const targetPath = validatePersonalWorkspaceTargetPath({
        environmentId: command.environmentId,
        personalWorkspaceRoot,
        targetPath: command.targetPath,
      });
      return {
        workspaceProvisionType: command.workspaceProvisionType,
        environmentId: command.environmentId,
        personalWorkspaceRoot,
        targetPath,
        onProgress,
      };
    }
  }
}
