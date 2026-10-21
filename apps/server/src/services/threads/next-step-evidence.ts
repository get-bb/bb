import { events, getEnvironment, getProject, getThread } from "@bb/db";
import { and, eq, inArray, or } from "drizzle-orm";
import type { NextStepEvidence } from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";

function repositoryUrl(remote: string): URL | null {
  try {
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/u.exec(remote);
    const url = new URL(
      remote.includes("://")
        ? remote
        : scp
          ? `https://${scp[1]}/${scp[2]}`
          : remote,
    );
    url.pathname = url.pathname.replace(/\.git\/?$/u, "").replace(/\/$/u, "");
    return url;
  } catch {
    return null;
  }
}

export function isNextStepRepositoryReference(
  remote: string,
  evidence: NextStepEvidence,
): boolean {
  const repository = repositoryUrl(remote);
  if (repository === null) return false;
  try {
    const ref = new URL(evidence.ref);
    if (
      ref.protocol !== "https:" ||
      ref.username ||
      ref.password ||
      ref.host !== repository.host
    )
      return false;
    const suffix = ref.pathname.slice(repository.pathname.length);
    if (!ref.pathname.startsWith(`${repository.pathname}/`)) return false;
    switch (evidence.source) {
      case "issue":
        return /^\/(?:-\/)?issues\/\d+\/?$/u.test(suffix);
      case "pull_request":
        return (
          /^\/(?:pull|pull-requests|merge_requests)\/\d+\/?$/u.test(suffix) ||
          /^\/-\/merge_requests\/\d+\/?$/u.test(suffix)
        );
      case "ci_run":
        return /^\/(?:actions\/runs\/\d+(?:\/attempts\/\d+)?|-\/pipelines\/\d+)\/?$/u.test(
          suffix,
        );
      default:
        return false;
    }
  } catch {
    return false;
  }
}

export async function validateNextStepEvidence(
  deps: WorkSessionDeps,
  threadId: string,
  evidence: readonly NextStepEvidence[],
): Promise<void> {
  const thread = getThread(deps.db, threadId);
  if (!thread) throw new ApiError(404, "thread_not_found", "Thread not found");
  const environment =
    thread.environmentId === null
      ? null
      : getEnvironment(deps.db, thread.environmentId);
  const project = getProject(deps.db, thread.projectId);
  for (const entry of evidence) {
    let valid = false;
    if (entry.source === "conversation") {
      valid =
        deps.db
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              eq(events.threadId, threadId),
              or(eq(events.id, entry.ref), eq(events.itemId, entry.ref)),
              inArray(events.itemKind, ["userMessage", "agentMessage"]),
              inArray(events.type, ["item/started", "item/completed"]),
            ),
          )
          .limit(1)
          .get() !== undefined;
    } else if (entry.source === "file" || entry.source === "commit") {
      if (environment?.path) {
        try {
          if (entry.source === "file") {
            if (
              !/^(?:[A-Za-z]:|[\\/])/u.test(entry.ref) &&
              !entry.ref.split(/[\\/]/u).includes("..")
            ) {
              await callHostOnlineRpc(deps, {
                hostId: environment.hostId,
                timeoutMs: 10_000,
                command: {
                  type: "host.read_file_relative",
                  rootPath: environment.path,
                  path: entry.ref,
                  followRootSymlink: true,
                  dotfiles: "allow",
                },
              });
              valid = true;
            }
          } else if (/^[a-f0-9]{4,40}$/iu.test(entry.ref)) {
            const result = await callHostOnlineRpc(deps, {
              hostId: environment.hostId,
              timeoutMs: 10_000,
              command: {
                type: "workspace.diffFiles",
                environmentId: environment.id,
                workspaceContext: { workspacePath: environment.path },
                target: { type: "commit", sha: entry.ref },
                maxFiles: 1,
                ignoreWhitespace: false,
              },
            });
            valid = result.outcome === "available";
          }
        } catch {
          valid = false;
        }
      }
    } else if (project?.gitRemoteUrl) {
      valid = isNextStepRepositoryReference(project.gitRemoteUrl, entry);
    }
    if (!valid)
      throw new ApiError(
        400,
        "next_step_invalid_evidence",
        "An evidence reference could not be verified in this thread or project",
      );
  }
}
