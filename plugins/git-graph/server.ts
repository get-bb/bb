import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import {
  gitGraphRpcContract,
  type OverviewOutput,
  type SourceSummary,
} from "./contract.js";
import { gitGraphHostContract } from "./host-contract.js";
import { isValidRelativeFilePath, repoRelPathFormError } from "./git/paths.js";

const OVERVIEW_CACHE_TTL_MS = 15_000;
const OVERVIEW_CACHE_MAX_ENTRIES = 16;

type GitGraphHostClient = ExperimentalHostClient<typeof gitGraphHostContract>;

interface ResolvedSource extends SourceSummary {
  projectId: string;
}

interface ProjectSummary {
  id: string;
  name: string;
  sources: SourceSummary[];
}

export interface GitGraphPluginDeps {
  createHostClient: (bb: BbPluginApi) => GitGraphHostClient;
}

export function createGitGraphPlugin(deps?: GitGraphPluginDeps) {
  return async function plugin(bb: BbPluginApi) {
    const createHostClient =
      deps?.createHostClient ??
      ((bbApi: BbPluginApi) =>
        bbApi.hosts.experimental_client({
          contract: gitGraphHostContract,
        }));
    const hostClient = createHostClient(bb);

    async function loadProjectSummaries(): Promise<{
      projects: ProjectSummary[];
      byId: Map<string, ProjectSummary>;
    }> {
      const [projects, hosts] = await Promise.all([
        bb.sdk.projects.list(),
        bb.sdk.hosts.list().catch(() => []),
      ]);
      const hostNames = new Map<string, string>();
      for (const host of hosts) {
        hostNames.set(host.id, host.name.length > 0 ? host.name : host.id);
      }
      const summarized: ProjectSummary[] = projects.map((project) => ({
        id: project.id,
        name: project.name,
        sources: project.sources
          .filter((source) => source.type === "local_path")
          .map((source) => ({
            id: source.id,
            path: source.path,
            hostId: source.hostId,
            hostName: hostNames.get(source.hostId) ?? source.hostId,
            isDefault: source.isDefault,
          })),
      }));
      return {
        projects: summarized,
        byId: new Map(summarized.map((project) => [project.id, project])),
      };
    }

    async function resolveSource(input: {
      projectId: string;
      sourceId?: string;
    }): Promise<ResolvedSource> {
      const { byId } = await loadProjectSummaries();
      const project = byId.get(input.projectId);
      if (project === undefined) {
        throw new Error(`Unknown project ${input.projectId}.`);
      }
      if (project.sources.length === 0) {
        throw new Error(
          `Project ${project.name} has no local folder source attached.`,
        );
      }
      if (input.sourceId !== undefined) {
        const requested = project.sources.find(
          (source) => source.id === input.sourceId,
        );
        if (requested === undefined) {
          throw new Error(
            `Source ${input.sourceId} is not part of project ${project.name}.`,
          );
        }
        return { ...requested, projectId: project.id };
      }
      const fallback =
        project.sources.find((source) => source.isDefault) ??
        project.sources[0]!;
      return { ...fallback, projectId: project.id };
    }

    const overviewCache = new Map<
      string,
      { outcome: OverviewOutput; fetchedAt: number }
    >();

    async function getOverview(input: {
      projectId: string;
      sourceId?: string;
      refresh?: boolean;
    }): Promise<OverviewOutput> {
      const cacheKey = `${input.projectId}:${input.sourceId ?? ""}`;
      const cached = overviewCache.get(cacheKey);
      if (
        input.refresh !== true &&
        cached !== undefined &&
        Date.now() - cached.fetchedAt < OVERVIEW_CACHE_TTL_MS
      ) {
        return cached.outcome;
      }
      const source = await resolveSource(input);
      const scan = await hostClient.call(
        "scanRepos",
        { sourceRoot: source.path },
        { hostId: source.hostId },
      );
      const outcome: OverviewOutput = {
        source: {
          id: source.id,
          path: source.path,
          hostId: source.hostId,
          hostName: source.hostName,
          isDefault: source.isDefault,
        },
        repos: scan.repos,
        scanTruncated: scan.scanTruncated,
        scanError: scan.scanError,
      };
      if (overviewCache.size >= OVERVIEW_CACHE_MAX_ENTRIES) {
        const oldest = overviewCache.keys().next().value;
        if (oldest !== undefined) overviewCache.delete(oldest);
      }
      overviewCache.set(cacheKey, { outcome, fetchedAt: Date.now() });
      return outcome;
    }

    bb.rpc.register(gitGraphRpcContract, {
      async projects() {
        const { projects } = await loadProjectSummaries();
        return { projects };
      },

      async overview(input) {
        return await getOverview(input);
      },

      async repoStatus(input) {
        const source = await resolveSource(input);
        return await hostClient.call(
          "repoStatus",
          {
            sourceRoot: source.path,
            repoRelPath: input.repoRelPath,
          },
          { hostId: source.hostId },
        );
      },

      async history(input) {
        const formError = repoRelPathFormError(input.repoRelPath);
        if (formError !== null) {
          throw new Error(`Invalid repository path: ${formError}.`);
        }
        const source = await resolveSource(input);
        return await hostClient.call(
          "history",
          {
            sourceRoot: source.path,
            repoRelPath: input.repoRelPath,
            offset: input.offset,
            limit: input.limit,
            includeRemotes: input.includeRemotes === true,
            ...(input.query !== undefined ? { query: input.query } : {}),
            refs: input.refs,
          },
          { hostId: source.hostId },
        );
      },

      async commitDetail(input) {
        const formError = repoRelPathFormError(input.repoRelPath);
        if (formError !== null) {
          throw new Error(`Invalid repository path: ${formError}.`);
        }
        const source = await resolveSource(input);
        return await hostClient.call(
          "commitDetail",
          {
            sourceRoot: source.path,
            repoRelPath: input.repoRelPath,
            hash: input.hash,
          },
          { hostId: source.hostId },
        );
      },

      async filePatch(input) {
        if (!isValidRelativeFilePath(input.path)) {
          throw new Error("Invalid repository file path.");
        }
        const formError = repoRelPathFormError(input.repoRelPath);
        if (formError !== null) {
          throw new Error(`Invalid repository path: ${formError}.`);
        }
        const source = await resolveSource(input);
        return await hostClient.call(
          "filePatch",
          {
            sourceRoot: source.path,
            repoRelPath: input.repoRelPath,
            hash: input.hash,
            path: input.path,
          },
          { hostId: source.hostId },
        );
      },
    });

    const USAGE = [
      "Usage:",
      "  bb git-graph repos [--project <id>] [--source <id>]   List repositories under the project folder",
      "  bb git-graph log [n] [--repo <path>]                  Show the newest commits",
      "  bb git-graph show <hash> [--repo <path>]              Show one commit with its changed files",
      "",
      "Options:",
      "  --grep <text>     Filter commits by commit message",
      "  --project <id>    BB project id (defaults to the first project)",
      "  --source <id>     Project source id (defaults to the default source)",
      "  --repo <path>     Repository path relative to the project folder",
    ].join("\n");

    interface CliOptions {
      count: number;
      repo: string;
      grep: string;
      projectId: string;
      sourceId: string;
      hash: string;
    }

    function parseCliArgs(argv: readonly string[]): CliOptions | string {
      const options: CliOptions = {
        count: 20,
        repo: "",
        grep: "",
        projectId: "",
        sourceId: "",
        hash: "",
      };
      let index = 1;
      let positionalCount = 0;
      while (index < argv.length) {
        const arg = argv[index];
        index += 1;
        if (
          arg === "--project" ||
          arg === "--repo" ||
          arg === "--grep" ||
          arg === "--source"
        ) {
          const value = argv[index];
          index += 1;
          if (value === undefined) return `Missing value for ${arg}.`;
          if (arg === "--project") options.projectId = value;
          else if (arg === "--repo") options.repo = value;
          else if (arg === "--grep") options.grep = value;
          else options.sourceId = value;
          continue;
        }
        if (/^\d+$/u.test(arg) && positionalCount === 0) {
          const parsed = Number(arg);
          if (parsed < 1 || parsed > 300) return "Commit count must be 1-300.";
          options.count = parsed;
          positionalCount += 1;
          continue;
        }
        if (options.hash.length === 0 && /^[0-9a-f]{4,40}$/iu.test(arg)) {
          options.hash = arg.toLowerCase();
          positionalCount += 1;
          continue;
        }
        return `Unexpected argument "${arg}".`;
      }
      return options;
    }

    bb.cli.register({
      name: "git-graph",
      summary: "Inspect Git repositories in a project checkout (read-only)",
      commands: [
        {
          name: "repos",
          summary: "List repositories under the project folder",
          usage: "bb git-graph repos [--project <id>] [--source <id>]",
        },
        {
          name: "log",
          summary: "Show the newest commits",
          usage: "bb git-graph log [n] [--repo <path>] [--grep <text>]",
        },
        {
          name: "show",
          summary: "Show one commit with its changed files",
          usage: "bb git-graph show <hash> [--repo <path>]",
        },
      ],
      async run(argv) {
        try {
          const parsed = parseCliArgs(argv);
          if (typeof parsed === "string") {
            return { exitCode: 1, stderr: `${parsed}\n${USAGE}` };
          }
          const [subcommand] = argv;
          if (
            subcommand === undefined ||
            subcommand === "help" ||
            subcommand === "--help"
          ) {
            return { exitCode: 0, stdout: USAGE };
          }
          if (
            subcommand !== "repos" &&
            subcommand !== "log" &&
            subcommand !== "show"
          ) {
            return {
              exitCode: 1,
              stderr: `Unknown subcommand "${subcommand}".\n${USAGE}`,
            };
          }
          const { byId } = await loadProjectSummaries();
          const projectEntry =
            parsed.projectId.length > 0
              ? byId.get(parsed.projectId)
              : (byId.values().next().value ?? undefined);
          if (projectEntry === undefined) {
            return {
              exitCode: 1,
              stderr: "No BB projects found. Attach a local folder first.",
            };
          }
          const source =
            (parsed.sourceId.length > 0
              ? projectEntry.sources.find(
                  (candidate) => candidate.id === parsed.sourceId,
                )
              : undefined) ??
            projectEntry.sources.find((candidate) => candidate.isDefault) ??
            projectEntry.sources[0];
          if (source === undefined) {
            return {
              exitCode: 1,
              stderr: `Project ${projectEntry.name} has no local folder source attached.`,
            };
          }
          const overview = await getOverview({
            projectId: projectEntry.id,
            sourceId: source.id,
          });
          if (overview.scanError !== null) {
            return { exitCode: 1, stderr: overview.scanError };
          }
          if (subcommand === "repos") {
            if (overview.repos.length === 0) {
              return {
                exitCode: 0,
                stdout: `No Git repositories found under ${overview.source.path} on ${overview.source.hostName}.`,
              };
            }
            return {
              exitCode: 0,
              stdout: overview.repos
                .map((repo) => {
                  const label =
                    repo.relPath.length === 0 ? "(project root)" : repo.relPath;
                  const kind =
                    repo.gitLink === "submodule"
                      ? "submodule"
                      : repo.gitLink === "worktree"
                        ? "worktree"
                        : "";
                  const head = repo.head
                    ? (repo.head.branch ?? repo.head.abbrev)
                    : repo.empty
                      ? "empty"
                      : "unreadable";
                  const state =
                    repo.error !== null ? `error: ${repo.error}` : head;
                  return [
                    label,
                    kind,
                    state,
                    `${overview.source.path}\t${overview.source.hostName}`,
                  ]
                    .filter((part) => part.length > 0)
                    .join("\t");
                })
                .join("\n"),
            };
          }
          const repoRelPath =
            parsed.repo.length > 0
              ? parsed.repo
              : (
                  overview.repos.find((repo) => repo.position === "root") ??
                  overview.repos[0]
                )?.relPath;
          if (repoRelPath === undefined) {
            return {
              exitCode: 1,
              stderr: "No Git repositories found in this project.",
            };
          }
          const hostScopedInput = {
            sourceRoot: source.path,
            repoRelPath,
          };
          if (subcommand === "log") {
            const page = await hostClient.call(
              "history",
              {
                ...hostScopedInput,
                offset: 0,
                limit: parsed.count,
                includeRemotes: false,
                refs: [],
                ...(parsed.grep.length > 0 ? { query: parsed.grep } : {}),
              },
              { hostId: source.hostId },
            );
            if (page.empty) {
              return {
                exitCode: 0,
                stdout: "This repository has no commits yet.",
              };
            }
            if (page.commits.length === 0) {
              return { exitCode: 0, stdout: "No commits match the filter." };
            }
            return {
              exitCode: 0,
              stdout: page.commits
                .map((commit) => {
                  const refs =
                    commit.refs.length > 0
                      ? ` (${commit.refs
                          .map((ref) =>
                            ref.isHead ? `HEAD -> ${ref.name}` : ref.name,
                          )
                          .join(", ")})`
                      : "";
                  return `${commit.abbrev}\t${commit.authorDate}\t${commit.authorName}\t${commit.subject}${refs}`;
                })
                .join("\n"),
            };
          }
          if (parsed.hash.length === 0) {
            return {
              exitCode: 1,
              stderr: `Usage: bb git-graph show <hash> [--repo <path>]\n${USAGE}`,
            };
          }
          const detail = await hostClient.call(
            "commitDetail",
            { ...hostScopedInput, hash: parsed.hash },
            { hostId: source.hostId },
          );
          const lines = [
            `commit ${detail.commit.hash}`,
            ...detail.commit.refs.map(
              (ref) =>
                `ref: ${ref.isHead && ref.kind === "branch" ? `HEAD -> ${ref.name}` : `${ref.kind} ${ref.name}`}`,
            ),
            `tree ${detail.commit.tree}`,
            ...detail.commit.parents.map((parent) => `parent ${parent.hash}`),
            `Author: ${detail.commit.author.name} <${detail.commit.author.email}>`,
            `AuthorDate: ${detail.commit.author.date}`,
            `Commit: ${detail.commit.committer.name} <${detail.commit.committer.email}>`,
            `CommitDate: ${detail.commit.committer.date}`,
            "",
            detail.commit.message,
            "",
            "Files:",
            ...detail.files.map(
              (file) =>
                `  ${file.status}\t${file.path}${file.oldPath !== null ? ` (from ${file.oldPath})` : ""}`,
            ),
          ];
          return { exitCode: 0, stdout: lines.join("\n") };
        } catch (error) {
          return {
            exitCode: 1,
            stderr: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });
  };
}

export default createGitGraphPlugin();
