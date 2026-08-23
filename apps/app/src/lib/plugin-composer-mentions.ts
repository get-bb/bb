import type { PromptMentionResource } from "@bb/domain";
import type {
  PluginComposerBuiltInMention,
  PluginComposerScope,
} from "@get-bb/plugin-sdk";
import { sdk } from "@/lib/sdk";

interface PathQuery {
  query: string;
  limit: string;
  includeFiles: "true";
  includeDirectories: "true";
}

interface ResolvedPathEntry {
  kind: "file" | "directory";
  path: string;
  name: string;
}

type ProjectPathQuery = PathQuery & { projectId: string } & (
    | { hostId: string }
    | { hostId?: never }
  );

interface ComposerMentionSdk {
  environments: {
    paths(
      args: PathQuery & { environmentId: string },
    ): Promise<{ paths: ResolvedPathEntry[] }>;
  };
  projects: {
    get(args: { projectId: string }): Promise<{ id: string; name: string }>;
    paths(args: ProjectPathQuery): Promise<{ paths: ResolvedPathEntry[] }>;
  };
  threadSections: {
    get(args: { sectionId: string }): Promise<{ id: string; name: string }>;
  };
  threads: {
    get(args: {
      threadId: string;
    }): Promise<{ environmentId: string | null; projectId: string }>;
    resolveMentions(args: { threadIds: string[] }): Promise<
      Array<{
        threadId: string;
        projectId: string;
        label: string;
      }>
    >;
    storagePaths(
      args: PathQuery & { threadId: string },
    ): Promise<{ paths: ResolvedPathEntry[] }>;
  };
}

export interface NewThreadMentionContext {
  projectId: string;
  environmentId: string | null;
  hostId: string | null;
  threadStorageThreadId: string | null;
}

function requiredValue(value: string, description: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${description} must not be empty`);
  }
  return trimmed;
}

function normalizeMentionPath(value: string): string {
  const requestedPath = requiredValue(value, "Mention path");
  if (
    requestedPath.startsWith("/") ||
    requestedPath.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(requestedPath)
  ) {
    throw new Error("Mention path must be relative to its source");
  }
  const normalizedPath = requestedPath
    .replaceAll("\\", "/")
    .replace(/^\.\/+|\/+$/gu, "")
    .replace(/\/{2,}/gu, "/");
  if (normalizedPath.length === 0 || normalizedPath.split("/").includes("..")) {
    throw new Error("Mention path must stay within its source");
  }
  return normalizedPath;
}

function threadIdForComposerScope(scope: PluginComposerScope): string | null {
  switch (scope.kind) {
    case "thread":
    case "queued-message":
      return scope.threadId;
    case "side-chat":
      return scope.childThreadId ?? scope.parentThreadId;
    case "new-thread":
      return null;
  }
}

async function resolvePathMention(
  mention: Extract<PluginComposerBuiltInMention, { kind: "path" }>,
  scope: PluginComposerScope,
  client: ComposerMentionSdk,
  newThreadContext: NewThreadMentionContext | undefined,
): Promise<Extract<PromptMentionResource, { kind: "path" }>> {
  const requestedPath = normalizeMentionPath(mention.path);

  const threadId =
    newThreadContext === undefined
      ? threadIdForComposerScope(scope)
      : newThreadContext.threadStorageThreadId;
  const query = {
    query: requestedPath,
    limit: "100",
    includeFiles: "true" as const,
    includeDirectories: "true" as const,
  };

  let paths;
  if (mention.source === "thread-storage") {
    if (threadId === null) {
      throw new Error(
        "Thread-storage mentions require an existing thread composer",
      );
    }
    paths = (await client.threads.storagePaths({ threadId, ...query })).paths;
  } else if (newThreadContext !== undefined) {
    paths =
      newThreadContext.environmentId !== null
        ? (
            await client.environments.paths({
              environmentId: newThreadContext.environmentId,
              ...query,
            })
          ).paths
        : (
            await client.projects.paths(
              newThreadContext.hostId === null
                ? { projectId: newThreadContext.projectId, ...query }
                : {
                    projectId: newThreadContext.projectId,
                    hostId: newThreadContext.hostId,
                    ...query,
                  },
            )
          ).paths;
  } else if (threadId !== null) {
    const thread = await client.threads.get({ threadId });
    paths =
      thread.environmentId === null
        ? (
            await client.projects.paths({
              projectId: thread.projectId,
              ...query,
            })
          ).paths
        : (
            await client.environments.paths({
              environmentId: thread.environmentId,
              ...query,
            })
          ).paths;
  } else {
    if (scope.kind !== "new-thread" || scope.projectId === null) {
      throw new Error("Workspace mentions require a resolved project");
    }
    paths = (
      await client.projects.paths({ projectId: scope.projectId, ...query })
    ).paths;
  }

  const entry = paths.find((candidate) => candidate.path === requestedPath);
  if (entry === undefined) {
    throw new Error(
      `${mention.source} path "${requestedPath}" could not be resolved`,
    );
  }
  return {
    kind: "path",
    source: mention.source,
    entryKind: entry.kind,
    path: entry.path,
    label: entry.name,
  };
}

/** Resolve one BB-owned composer mention to its canonical stored resource. */
export async function resolveBuiltInComposerMention(
  mention: PluginComposerBuiltInMention,
  scope: PluginComposerScope,
  client: ComposerMentionSdk = sdk,
  newThreadContext?: NewThreadMentionContext,
): Promise<PromptMentionResource> {
  switch (mention.kind) {
    case "thread": {
      const threadId = requiredValue(mention.threadId, "Thread id");
      const resolution = (
        await client.threads.resolveMentions({ threadIds: [threadId] })
      )[0];
      if (resolution === undefined) {
        throw new Error(`Thread "${threadId}" could not be resolved`);
      }
      return { kind: "thread", ...resolution };
    }
    case "project": {
      const projectId = requiredValue(mention.projectId, "Project id");
      const project = await client.projects.get({ projectId });
      return { kind: "project", projectId: project.id, label: project.name };
    }
    case "section": {
      const sectionId = requiredValue(mention.sectionId, "Section id");
      const section = await client.threadSections.get({ sectionId });
      return { kind: "section", sectionId: section.id, label: section.name };
    }
    case "path":
      return resolvePathMention(mention, scope, client, newThreadContext);
  }
}
