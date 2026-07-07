// bb-plugin-github — GitHub issues & pull requests inside BB.
//
// Auth rides on the GitHub CLI: if `gh auth status` passes, the plugin
// works. Repos are discovered from BB project sources (each local checkout's
// `origin` remote) plus an optional extraRepos setting. A background service
// syncs open + recently-closed issues/PRs into the plugin's SQLite cache;
// the frontend panel and @-mention providers read that cache, while
// mutations (comment, create, close/reopen, assign, label) and detail views go
// straight through `gh`.
import { execFile } from "node:child_process";
import type { BbPluginApi } from "@bb/plugin-sdk";

const SYNC_INTERVAL_MS = 5 * 60_000;
const ISSUE_PAGE = 100;
const CLOSED_ISSUE_PAGE = 50;
const PR_PAGE = 50;
const CLOSED_PR_PAGE = 30;

const GH_HINT =
  "Install the GitHub CLI (https://cli.github.com) and run `gh auth login`, " +
  "then `bb plugin reload github`.";

interface RepoInfo {
  repo: string; // "owner/name"
  projectId: string | null;
}

interface CachedItem {
  repo: string;
  number: number;
  kind: "issue" | "pr";
  title: string;
  state: string;
  author: string;
  labels: string[];
  assignees: string[];
  url: string;
  body: string;
  updatedAt: string;
}

interface ThreadLink {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  threadId: string;
  createdAt: string;
}

interface BbProjectSummary {
  id: string;
  sources?: Array<{ type: string; path: string }>;
}

interface SpawnedThreadSummary {
  id: string;
}

function needsConfiguration(message: string): Error {
  return Object.assign(new Error(message), {
    name: "NeedsConfigurationError",
  });
}

/** owner/name from any GitHub remote URL (https, ssh, git@), else null. */
export function parseGithubRemote(url: string): string | null {
  const match = url
    .trim()
    .match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  if (match === null) return null;
  return `${match[1]}/${match[2]}`;
}

function isRepoName(value: unknown): value is string {
  return typeof value === "string" && /^[\w.-]+\/[\w.-]+$/.test(value);
}

function run(
  file: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${file} ${args.slice(0, 3).join(" ")} failed: ${
                stderr.trim() || error.message
              }`,
            ),
          );
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    extraRepos: {
      type: "string",
      label: "Extra repositories",
      description:
        'Comma-separated "owner/repo" list to track in addition to repos discovered from BB projects.',
      default: "",
    },
    defaultProject: {
      type: "project",
      label: "Default BB project",
      description:
        "Where agent threads spawn for repos that are not attached to a BB project.",
    },
  });

  // ------------------------------------------------------------------
  // gh CLI plumbing. The server process may have a trimmed PATH, so probe
  // common install locations once and remember the winner.
  // ------------------------------------------------------------------
  let ghPath: string | null = null;
  let ghAuthError: string | null = "checking gh…";

  async function resolveGh(): Promise<string> {
    if (ghPath !== null) return ghPath;
    const candidates = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
    for (const candidate of candidates) {
      try {
        await run(candidate, ["--version"], 5_000);
        ghPath = candidate;
        return candidate;
      } catch {
        // try the next location
      }
    }
    throw needsConfiguration(`GitHub CLI not found. ${GH_HINT}`);
  }

  async function gh(args: string[], timeoutMs?: number): Promise<string> {
    const file = await resolveGh();
    const { stdout } = await run(file, args, timeoutMs);
    return stdout;
  }

  async function checkAuth(): Promise<void> {
    try {
      await gh(["auth", "status"], 10_000);
      ghAuthError = null;
    } catch (error) {
      ghAuthError = error instanceof Error ? error.message : String(error);
      throw needsConfiguration(`GitHub CLI is not authenticated. ${GH_HINT}`);
    }
  }

  // ------------------------------------------------------------------
  // Repo discovery: BB project sources → git origin → owner/repo.
  // ------------------------------------------------------------------
  let repoCache: { repos: RepoInfo[]; fetchedAt: number } | null = null;

  async function discoverRepos(force = false): Promise<RepoInfo[]> {
    if (!force && repoCache !== null && Date.now() - repoCache.fetchedAt < 60_000) {
      return repoCache.repos;
    }
    const byRepo = new Map<string, RepoInfo>();
    try {
      const projects = (await bb.sdk.projects.list()) as unknown as BbProjectSummary[];
      for (const project of projects) {
        for (const source of project.sources ?? []) {
          if (source.type !== "local_path") continue;
          try {
            const { stdout } = await run(
              "git",
              ["-C", source.path, "remote", "get-url", "origin"],
              5_000,
            );
            const repo = parseGithubRemote(stdout);
            if (repo !== null && !byRepo.has(repo)) {
              byRepo.set(repo, { repo, projectId: project.id });
            }
          } catch {
            // no remote / not a git checkout — skip this source
          }
        }
      }
    } catch (error) {
      bb.log.warn(
        `project discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const { extraRepos } = await settings.get();
    for (const raw of extraRepos.split(/[\s,]+/)) {
      if (isRepoName(raw) && !byRepo.has(raw)) {
        byRepo.set(raw, { repo: raw, projectId: null });
      }
    }
    const repos = [...byRepo.values()];
    repoCache = { repos, fetchedAt: Date.now() };
    return repos;
  }

  // ------------------------------------------------------------------
  // SQLite cache of open issues + PRs across tracked repos.
  // ------------------------------------------------------------------
  const db = bb.storage.sqlite();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS items (
       repo TEXT NOT NULL,
       number INTEGER NOT NULL,
       kind TEXT NOT NULL,
       title TEXT NOT NULL,
       state TEXT NOT NULL,
       author TEXT NOT NULL,
       labels TEXT NOT NULL,
       url TEXT NOT NULL,
       body TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (repo, kind, number)
     )`,
    `ALTER TABLE items ADD COLUMN assignees TEXT NOT NULL DEFAULT '[]'`,
  ]);

  function parseStringArray(raw: unknown): string[] {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // tolerate a corrupt row rather than failing the whole list
    }
    return [];
  }

  function rowToItem(row: Record<string, unknown>): CachedItem {
    return {
      repo: String(row.repo),
      number: Number(row.number),
      kind: row.kind === "pr" ? "pr" : "issue",
      title: String(row.title),
      state: String(row.state),
      author: String(row.author),
      labels: parseStringArray(row.labels),
      assignees: parseStringArray(row.assignees),
      url: String(row.url),
      body: String(row.body),
      updatedAt: String(row.updated_at),
    };
  }

  function listCachedItems(options: {
    kind?: "issue" | "pr";
    repo?: string;
    query?: string;
    /** "open" → OPEN only; "closed" → everything else (CLOSED, MERGED). */
    state?: "open" | "closed";
    /** Only items whose assignees include this login. */
    assignee?: string;
  }): CachedItem[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.kind !== undefined) {
      clauses.push("kind = ?");
      params.push(options.kind);
    }
    if (options.repo !== undefined) {
      clauses.push("repo = ?");
      params.push(options.repo);
    }
    if (options.state === "open") {
      clauses.push("state = 'OPEN'");
    } else if (options.state === "closed") {
      clauses.push("state != 'OPEN'");
    }
    if (options.assignee !== undefined) {
      clauses.push("assignees LIKE ?");
      params.push(`%${JSON.stringify(options.assignee)}%`);
    }
    const query = options.query?.trim() ?? "";
    if (query.length > 0) {
      clauses.push("(title LIKE ? OR CAST(number AS TEXT) LIKE ? OR repo LIKE ?)");
      const like = `%${query.replace(/^#/, "")}%`;
      params.push(like, like, like);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM items ${where} ORDER BY updated_at DESC`)
      .all(...params) as Record<string, unknown>[];
    return rows.map(rowToItem);
  }

  function getCachedItem(
    kind: "issue" | "pr",
    repo: string,
    number: number,
  ): CachedItem | null {
    const row = db
      .prepare("SELECT * FROM items WHERE repo = ? AND kind = ? AND number = ?")
      .get(repo, kind, number) as Record<string, unknown> | undefined;
    return row === undefined ? null : rowToItem(row);
  }

  interface GhListEntry {
    number?: unknown;
    title?: unknown;
    state?: unknown;
    author?: { login?: unknown };
    labels?: Array<{ name?: unknown }>;
    assignees?: Array<{ login?: unknown }>;
    url?: unknown;
    body?: unknown;
    updatedAt?: unknown;
  }

  function toItems(raw: string, repo: string, kind: "issue" | "pr"): CachedItem[] {
    const entries = JSON.parse(raw) as GhListEntry[];
    return entries
      .filter((entry) => typeof entry?.number === "number")
      .map((entry) => ({
        repo,
        number: entry.number as number,
        kind,
        title: String(entry.title ?? ""),
        state: String(entry.state ?? "OPEN"),
        author: String(entry.author?.login ?? ""),
        labels: (entry.labels ?? []).map((label) => String(label?.name ?? "")),
        assignees: (entry.assignees ?? []).map((user) => String(user?.login ?? "")),
        url: String(entry.url ?? ""),
        body: typeof entry.body === "string" ? entry.body : "",
        updatedAt: String(entry.updatedAt ?? ""),
      }));
  }

  // Open items plus a page of recently-closed ones, so the Closed filter has
  // something to show without a live gh call per view.
  async function syncRepo(repo: string): Promise<CachedItem[]> {
    const fields = "number,title,state,author,labels,assignees,url,body,updatedAt";
    const [openIssues, closedIssues, openPrs, closedPrs] = await Promise.all([
      gh([
        "issue", "list", "-R", repo, "--state", "open",
        "--limit", String(ISSUE_PAGE), "--json", fields,
      ]),
      gh([
        "issue", "list", "-R", repo, "--state", "closed",
        "--limit", String(CLOSED_ISSUE_PAGE), "--json", fields,
      ]),
      gh([
        "pr", "list", "-R", repo, "--state", "open",
        "--limit", String(PR_PAGE), "--json", fields,
      ]),
      gh([
        "pr", "list", "-R", repo, "--state", "closed",
        "--limit", String(CLOSED_PR_PAGE), "--json", fields,
      ]),
    ]);
    return [
      ...toItems(openIssues, repo, "issue"),
      ...toItems(closedIssues, repo, "issue"),
      ...toItems(openPrs, repo, "pr"),
      ...toItems(closedPrs, repo, "pr"),
    ];
  }

  function replaceRepoRows(repo: string, items: CachedItem[]): void {
    const insert = db.prepare(
      `INSERT INTO items (repo, number, kind, title, state, author, labels, assignees, url, body, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.transaction(() => {
      db.prepare("DELETE FROM items WHERE repo = ?").run(repo);
      for (const item of items) {
        insert.run(
          item.repo, item.number, item.kind, item.title, item.state,
          item.author, JSON.stringify(item.labels), JSON.stringify(item.assignees),
          item.url, item.body, item.updatedAt,
        );
      }
    })();
  }

  /** Patch a cached row in place after a mutation so the UI updates without
      waiting for the next full sync. */
  function patchCachedItem(
    kind: "issue" | "pr",
    repo: string,
    number: number,
    patch: { state?: string; assignees?: string[]; labels?: string[] },
  ): void {
    if (patch.state !== undefined) {
      db.prepare("UPDATE items SET state = ? WHERE repo = ? AND kind = ? AND number = ?")
        .run(patch.state, repo, kind, number);
    }
    if (patch.assignees !== undefined) {
      db.prepare("UPDATE items SET assignees = ? WHERE repo = ? AND kind = ? AND number = ?")
        .run(JSON.stringify(patch.assignees), repo, kind, number);
    }
    if (patch.labels !== undefined) {
      db.prepare("UPDATE items SET labels = ? WHERE repo = ? AND kind = ? AND number = ?")
        .run(JSON.stringify(patch.labels), repo, kind, number);
    }
    bb.realtime.publish("data-changed", {});
  }

  async function syncAll(force = false): Promise<{ repos: number; items: number }> {
    await checkAuth();
    const repos = await discoverRepos(force);
    const before = JSON.stringify(
      db.prepare("SELECT repo, kind, number, updated_at FROM items ORDER BY repo, kind, number").all(),
    );
    let total = 0;
    for (const { repo } of repos) {
      try {
        const items = await syncRepo(repo);
        replaceRepoRows(repo, items);
        total += items.length;
      } catch (error) {
        bb.log.warn(
          `sync failed for ${repo}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const after = JSON.stringify(
      db.prepare("SELECT repo, kind, number, updated_at FROM items ORDER BY repo, kind, number").all(),
    );
    await bb.storage.kv.set("sync-cursor", {
      lastSyncedAt: new Date().toISOString(),
      repos: repos.length,
      items: total,
    });
    if (before !== after) {
      bb.realtime.publish("data-changed", { items: total });
    }
    bb.log.info(`synced ${total} item(s) across ${repos.length} repo(s)`);
    return { repos: repos.length, items: total };
  }

  // Initial sync + 5-minute refresh loop. NeedsConfigurationError from a
  // missing/unauthenticated gh flips the plugin to needs-configuration
  // instead of crash-looping.
  bb.background.service("sync", {
    async start(signal) {
      while (!signal.aborted) {
        await syncAll();
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, SYNC_INTERVAL_MS);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    },
  });

  // Surface an unconfigured gh immediately instead of waiting for the
  // service's first crash.
  try {
    await checkAuth();
  } catch (error) {
    bb.status.needsConfiguration(
      error instanceof Error ? error.message : String(error),
    );
  }

  // ------------------------------------------------------------------
  // Issue/PR ↔ thread links (the pills in the UI).
  // kv: "link:<kind>:<repo>#<number>" → ThreadLink[]
  // ------------------------------------------------------------------
  function linkKey(kind: "issue" | "pr", repo: string, number: number): string {
    return `link:${kind}:${repo}#${number}`;
  }

  async function addLink(link: ThreadLink): Promise<void> {
    const key = linkKey(link.kind, link.repo, link.number);
    const existing = (await bb.storage.kv.get<ThreadLink[]>(key)) ?? [];
    await bb.storage.kv.set(key, [...existing, link]);
    bb.realtime.publish("links-changed", { key });
  }

  async function listAllLinks(): Promise<Record<string, ThreadLink[]>> {
    const keys = await bb.storage.kv.list("link:");
    const result: Record<string, ThreadLink[]> = {};
    for (const key of keys) {
      const links = await bb.storage.kv.get<ThreadLink[]>(key);
      if (links !== undefined && links.length > 0) {
        result[key.slice("link:".length)] = links;
      }
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Spawning agent threads on issues / PR reviews.
  // ------------------------------------------------------------------
  async function resolveProjectId(repo: string): Promise<string> {
    const repos = await discoverRepos();
    const info = repos.find((entry) => entry.repo === repo);
    if (info?.projectId != null) return info.projectId;
    const { defaultProject } = await settings.get();
    if (defaultProject) return defaultProject;
    throw new Error(
      `No BB project is attached to ${repo}. Create a project whose checkout has ` +
        "that origin remote, or set the defaultProject plugin setting.",
    );
  }

  async function spawnOnItem(
    kind: "issue" | "pr",
    repo: string,
    number: number,
  ): Promise<{ threadId: string }> {
    const item = getCachedItem(kind, repo, number);
    const title = item?.title ?? `${kind === "pr" ? "PR" : "issue"} #${number}`;
    const projectId = await resolveProjectId(repo);
    const ref = `${repo}#${number}`;
    const prompt =
      kind === "issue"
        ? [
            `Work on GitHub issue ${ref}: ${title}`,
            "",
            "Read the full issue and its comments first:",
            `  gh issue view ${number} -R ${repo} --comments`,
            "",
            item !== null && item.body.length > 0
              ? `Issue description:\n\n${item.body}`
              : "(no cached description — read it with the command above)",
            "",
            "Implement a fix or the requested change in this checkout. " +
              `If you open a pull request, include "Fixes #${number}" in its body.`,
          ].join("\n")
        : [
            `Review GitHub pull request ${ref}: ${title}`,
            "",
            "Read the PR and its diff:",
            `  gh pr view ${number} -R ${repo} --comments`,
            `  gh pr diff ${number} -R ${repo}`,
            "",
            "Review the change for correctness, missing tests, and design issues. " +
              "Summarize your findings with file/line references. Do not push " +
              "changes or post to GitHub unless asked.",
          ].join("\n");
    const thread = (await bb.sdk.threads.spawn({
      projectId,
      environment: { type: "project-default" },
      title: `${ref}: ${title}`.slice(0, 120),
      prompt,
    })) as unknown as SpawnedThreadSummary;
    await addLink({
      kind,
      repo,
      number,
      threadId: thread.id,
      createdAt: new Date().toISOString(),
    });
    bb.log.info(`spawned thread ${thread.id} for ${kind} ${ref}`);
    return { threadId: thread.id };
  }

  // ------------------------------------------------------------------
  // Viewer identity + per-repo assignable users, cached in memory so the
  // filter chips and assignee picker don't hit the network on every render.
  // ------------------------------------------------------------------
  let viewerCache: { login: string; fetchedAt: number } | null = null;

  async function getViewer(): Promise<string> {
    if (viewerCache !== null && Date.now() - viewerCache.fetchedAt < 60 * 60_000) {
      return viewerCache.login;
    }
    const raw = await gh(["api", "user"], 15_000);
    const login = String((JSON.parse(raw) as { login?: unknown })?.login ?? "");
    if (login.length === 0) throw new Error("could not resolve the gh viewer login");
    viewerCache = { login, fetchedAt: Date.now() };
    return login;
  }

  const assignableCache = new Map<string, { users: string[]; fetchedAt: number }>();
  const labelsCache = new Map<string, { labels: string[]; fetchedAt: number }>();

  async function getAssignableUsers(repo: string): Promise<string[]> {
    const cached = assignableCache.get(repo);
    if (cached !== undefined && Date.now() - cached.fetchedAt < 10 * 60_000) {
      return cached.users;
    }
    const raw = await gh(["api", `repos/${repo}/assignees?per_page=100`], 15_000);
    const entries = JSON.parse(raw) as Array<{ login?: unknown }>;
    const users = entries
      .map((entry) => String(entry?.login ?? ""))
      .filter((login) => login.length > 0)
      .sort((a, b) => a.localeCompare(b));
    assignableCache.set(repo, { users, fetchedAt: Date.now() });
    return users;
  }

  async function getRepoLabels(repo: string): Promise<string[]> {
    const cached = labelsCache.get(repo);
    if (cached !== undefined && Date.now() - cached.fetchedAt < 10 * 60_000) {
      return cached.labels;
    }
    const raw = await gh(["api", `repos/${repo}/labels?per_page=100`], 15_000);
    const entries = JSON.parse(raw) as Array<{ name?: unknown }>;
    const labels = entries
      .map((entry) => String(entry?.name ?? "").trim())
      .filter((name) => name.length > 0)
      .sort((a, b) => a.localeCompare(b));
    labelsCache.set(repo, { labels, fetchedAt: Date.now() });
    return labels;
  }

  // ------------------------------------------------------------------
  // rpc — the frontend data plane.
  // ------------------------------------------------------------------
  function requireItemInput(input: unknown): { repo: string; number: number } {
    const args = input as { repo?: unknown; number?: unknown };
    if (!isRepoName(args?.repo) || typeof args?.number !== "number") {
      throw new Error("expected { repo: \"owner/name\", number: number }");
    }
    return { repo: args.repo, number: args.number };
  }

  bb.rpc.register({
    /** () → auth/sync status for the panel banner. */
    async status() {
      const cursor = await bb.storage.kv.get<{
        lastSyncedAt: string;
        repos: number;
        items: number;
      }>("sync-cursor");
      const repos = await discoverRepos();
      return {
        ghOk: ghAuthError === null,
        ghError: ghAuthError,
        repos,
        lastSyncedAt: cursor?.lastSyncedAt ?? null,
      };
    },

    /** () → force a full sync now. */
    async refresh() {
      return await syncAll(true);
    },

    /** { kind?, repo?, query?, state?, mine? } → cached items, newest first. */
    async listItems(input: unknown) {
      const args = input as {
        kind?: unknown;
        repo?: unknown;
        query?: unknown;
        state?: unknown;
        mine?: unknown;
      };
      return {
        items: listCachedItems({
          kind: args?.kind === "issue" || args?.kind === "pr" ? args.kind : undefined,
          repo: isRepoName(args?.repo) ? args.repo : undefined,
          query: typeof args?.query === "string" ? args.query : undefined,
          state: args?.state === "open" || args?.state === "closed" ? args.state : undefined,
          assignee: args?.mine === true ? await getViewer() : undefined,
        }),
      };
    },

    /** () → the authenticated gh login, for "assign to me" affordances. */
    async viewer() {
      return { login: await getViewer() };
    },

    /** { repo } → logins that can be assigned to issues in that repo. */
    async assignableUsers(input: unknown) {
      const repo = (input as { repo?: unknown })?.repo;
      if (!isRepoName(repo)) throw new Error('expected { repo: "owner/name" }');
      return { users: await getAssignableUsers(repo) };
    },

    /** { repo } → labels available in that repo. */
    async repositoryLabels(input: unknown) {
      const repo = (input as { repo?: unknown })?.repo;
      if (!isRepoName(repo)) throw new Error('expected { repo: "owner/name" }');
      return { labels: await getRepoLabels(repo) };
    },

    /** { repo, number, state: "open"|"closed" } → close or reopen an issue. */
    async setIssueState(input: unknown) {
      const { repo, number } = requireItemInput(input);
      const state = (input as { state?: unknown })?.state;
      if (state !== "open" && state !== "closed") {
        throw new Error('expected state to be "open" or "closed"');
      }
      await gh([
        "issue", state === "closed" ? "close" : "reopen", String(number), "-R", repo,
      ]);
      patchCachedItem("issue", repo, number, {
        state: state === "closed" ? "CLOSED" : "OPEN",
      });
      return { ok: true };
    },

    /** { repo, number, assignees: string[] } → set the exact assignee list. */
    async setAssignees(input: unknown) {
      const { repo, number } = requireItemInput(input);
      const raw = (input as { assignees?: unknown })?.assignees;
      if (!Array.isArray(raw) || raw.some((login) => typeof login !== "string")) {
        throw new Error("expected { assignees: string[] }");
      }
      const next = [...new Set(raw as string[])];
      const current = getCachedItem("issue", repo, number)?.assignees ?? [];
      const add = next.filter((login) => !current.includes(login));
      const remove = current.filter((login) => !next.includes(login));
      if (add.length === 0 && remove.length === 0) return { ok: true, assignees: next };
      const args = ["issue", "edit", String(number), "-R", repo];
      if (add.length > 0) args.push("--add-assignee", add.join(","));
      if (remove.length > 0) args.push("--remove-assignee", remove.join(","));
      await gh(args);
      patchCachedItem("issue", repo, number, { assignees: next });
      return { ok: true, assignees: next };
    },

    /** { repo, number, labels: string[] } → set the exact issue label list. */
    async setLabels(input: unknown) {
      const { repo, number } = requireItemInput(input);
      const raw = (input as { labels?: unknown })?.labels;
      if (!Array.isArray(raw) || raw.some((label) => typeof label !== "string")) {
        throw new Error("expected { labels: string[] }");
      }
      const next = [
        ...new Set((raw as string[]).map((label) => label.trim()).filter(Boolean)),
      ];
      const currentRaw = await gh([
        "issue", "view", String(number), "-R", repo, "--json", "labels",
      ], 15_000);
      const currentDetail = JSON.parse(currentRaw) as {
        labels?: Array<{ name?: unknown }>;
      };
      const current = (currentDetail.labels ?? [])
        .map((label) => String(label?.name ?? "").trim())
        .filter((label) => label.length > 0);
      const add = next.filter((label) => !current.includes(label));
      const remove = current.filter((label) => !next.includes(label));
      if (add.length === 0 && remove.length === 0) return { ok: true, labels: next };
      const args = ["issue", "edit", String(number), "-R", repo];
      for (const label of add) args.push("--add-label", label);
      for (const label of remove) args.push("--remove-label", label);
      await gh(args);
      patchCachedItem("issue", repo, number, { labels: next });
      return { ok: true, labels: next };
    },

    /** { repo, number } → live issue detail incl. comments. */
    async getIssue(input: unknown) {
      const { repo, number } = requireItemInput(input);
      const raw = await gh([
        "issue", "view", String(number), "-R", repo,
        "--json", "number,title,body,state,author,createdAt,updatedAt,labels,assignees,url,comments",
      ]);
      const detail = JSON.parse(raw) as {
        comments?: Array<{
          author?: { login?: unknown };
          body?: unknown;
          createdAt?: unknown;
        }>;
      } & GhListEntry;
      return {
        issue: {
          repo,
          number,
          title: String(detail.title ?? ""),
          state: String(detail.state ?? ""),
          author: String(detail.author?.login ?? ""),
          body: typeof detail.body === "string" ? detail.body : "",
          labels: (detail.labels ?? []).map((label) => String(label?.name ?? "")),
          assignees: (detail.assignees ?? []).map((user) => String(user?.login ?? "")),
          url: String(detail.url ?? ""),
          updatedAt: String(detail.updatedAt ?? ""),
          comments: (detail.comments ?? []).map((comment) => ({
            author: String(comment.author?.login ?? ""),
            body: typeof comment.body === "string" ? comment.body : "",
            createdAt: String(comment.createdAt ?? ""),
          })),
        },
      };
    },

    /** { repo, number } → full PR detail: overview, checks, reviews, timeline
        comments, inline review threads (with diff hunks), and per-file
        patches. Three live calls in parallel: `gh pr view` covers the
        overview + reviews + issue-style comments, the REST pulls API covers
        what it cannot — inline review comments and file patches. */
    async getPull(input: unknown) {
      const { repo, number } = requireItemInput(input);
      const prFields =
        "number,title,body,state,isDraft,author,createdAt,updatedAt,labels," +
        "assignees,url,baseRefName,headRefName,additions,deletions," +
        "changedFiles,reviewDecision,mergeStateStatus,statusCheckRollup," +
        "comments,reviews,reviewRequests";
      const [viewRaw, reviewCommentsRaw, filesRaw] = await Promise.all([
        gh(["pr", "view", String(number), "-R", repo, "--json", prFields], 30_000),
        gh(["api", `repos/${repo}/pulls/${number}/comments?per_page=100`], 30_000),
        gh(["api", `repos/${repo}/pulls/${number}/files?per_page=100`], 30_000),
      ]);

      interface GhPullView extends GhListEntry {
        isDraft?: unknown;
        createdAt?: unknown;
        baseRefName?: unknown;
        headRefName?: unknown;
        additions?: unknown;
        deletions?: unknown;
        changedFiles?: unknown;
        reviewDecision?: unknown;
        mergeStateStatus?: unknown;
        statusCheckRollup?: Array<{
          __typename?: unknown;
          name?: unknown;
          context?: unknown;
          status?: unknown;
          conclusion?: unknown;
          state?: unknown;
          detailsUrl?: unknown;
          targetUrl?: unknown;
        }>;
        comments?: Array<{
          author?: { login?: unknown };
          body?: unknown;
          createdAt?: unknown;
        }>;
        reviews?: Array<{
          author?: { login?: unknown };
          state?: unknown;
          body?: unknown;
          submittedAt?: unknown;
        }>;
        reviewRequests?: Array<{ login?: unknown; name?: unknown; slug?: unknown }>;
      }
      const view = JSON.parse(viewRaw) as GhPullView;

      // CheckRun rows carry status/conclusion; classic StatusContext rows a
      // single state. Normalize both to one traffic-light value.
      const checks = (view.statusCheckRollup ?? []).map((entry) => {
        const conclusion = String(entry.conclusion ?? entry.state ?? "").toUpperCase();
        const running =
          entry.conclusion === "" ||
          ["IN_PROGRESS", "QUEUED", "PENDING", "EXPECTED", "WAITING"].includes(
            String(entry.status ?? entry.state ?? "").toUpperCase(),
          );
        const status =
          conclusion === "SUCCESS"
            ? "success"
            : conclusion === "FAILURE" || conclusion === "ERROR" || conclusion === "TIMED_OUT"
              ? "failure"
              : running
                ? "pending"
                : "neutral";
        return {
          name: String(entry.name ?? entry.context ?? "check"),
          status,
          url: String(entry.detailsUrl ?? entry.targetUrl ?? ""),
        };
      });

      interface GhReviewComment {
        id?: unknown;
        in_reply_to_id?: unknown;
        path?: unknown;
        line?: unknown;
        original_line?: unknown;
        diff_hunk?: unknown;
        body?: unknown;
        created_at?: unknown;
        user?: { login?: unknown };
      }
      const reviewComments = JSON.parse(reviewCommentsRaw) as GhReviewComment[];
      interface ReviewThread {
        path: string;
        line: number | null;
        diffHunk: string;
        comments: Array<{ author: string; body: string; createdAt: string }>;
      }
      // Group inline comments into threads: a comment without in_reply_to_id
      // roots a thread, replies chain onto their root's thread.
      const threadByRootId = new Map<number, ReviewThread>();
      for (const comment of reviewComments) {
        const id = Number(comment.id ?? NaN);
        const replyTo = Number(comment.in_reply_to_id ?? NaN);
        const entry = {
          author: String(comment.user?.login ?? ""),
          body: typeof comment.body === "string" ? comment.body : "",
          createdAt: String(comment.created_at ?? ""),
        };
        const rootThread = Number.isFinite(replyTo) ? threadByRootId.get(replyTo) : undefined;
        if (rootThread !== undefined) {
          rootThread.comments.push(entry);
          if (Number.isFinite(id)) threadByRootId.set(id, rootThread);
          continue;
        }
        const line = Number(comment.line ?? comment.original_line ?? NaN);
        const thread: ReviewThread = {
          path: String(comment.path ?? ""),
          line: Number.isFinite(line) ? line : null,
          diffHunk: typeof comment.diff_hunk === "string" ? comment.diff_hunk : "",
          comments: [entry],
        };
        if (Number.isFinite(id)) threadByRootId.set(id, thread);
      }
      const reviewThreads = [...new Set(threadByRootId.values())];

      interface GhPullFile {
        filename?: unknown;
        status?: unknown;
        additions?: unknown;
        deletions?: unknown;
        patch?: unknown;
      }
      const files = (JSON.parse(filesRaw) as GhPullFile[]).map((file) => {
        const patch = typeof file.patch === "string" ? file.patch : null;
        return {
          path: String(file.filename ?? ""),
          status: String(file.status ?? "modified"),
          additions: Number(file.additions ?? 0),
          deletions: Number(file.deletions ?? 0),
          // Very large patches stay on GitHub — the panel shows a link.
          patch: patch !== null && patch.length <= 20_000 ? patch : null,
        };
      });

      return {
        pull: {
          repo,
          number,
          title: String(view.title ?? ""),
          state: view.isDraft === true && String(view.state ?? "") === "OPEN"
            ? "DRAFT"
            : String(view.state ?? ""),
          author: String(view.author?.login ?? ""),
          body: typeof view.body === "string" ? view.body : "",
          url: String(view.url ?? ""),
          createdAt: String(view.createdAt ?? ""),
          updatedAt: String(view.updatedAt ?? ""),
          baseRefName: String(view.baseRefName ?? ""),
          headRefName: String(view.headRefName ?? ""),
          additions: Number(view.additions ?? 0),
          deletions: Number(view.deletions ?? 0),
          changedFiles: Number(view.changedFiles ?? files.length),
          labels: (view.labels ?? []).map((label) => String(label?.name ?? "")),
          assignees: (view.assignees ?? []).map((user) => String(user?.login ?? "")),
          reviewDecision: String(view.reviewDecision ?? ""),
          mergeStateStatus: String(view.mergeStateStatus ?? ""),
          reviewRequests: (view.reviewRequests ?? [])
            .map((entry) => String(entry.login ?? entry.name ?? entry.slug ?? ""))
            .filter((name) => name.length > 0),
          checks,
          comments: (view.comments ?? []).map((comment) => ({
            author: String(comment.author?.login ?? ""),
            body: typeof comment.body === "string" ? comment.body : "",
            createdAt: String(comment.createdAt ?? ""),
          })),
          reviews: (view.reviews ?? []).map((review) => ({
            author: String(review.author?.login ?? ""),
            state: String(review.state ?? ""),
            body: typeof review.body === "string" ? review.body : "",
            createdAt: String(review.submittedAt ?? ""),
          })),
          reviewThreads,
          files,
        },
      };
    },

    /** { repo, number, body } → add a PR conversation comment. */
    async commentPull(input: unknown) {
      const { repo, number } = requireItemInput(input);
      const body = (input as { body?: unknown })?.body;
      if (typeof body !== "string" || body.trim().length === 0) {
        throw new Error("comment body must be a non-empty string");
      }
      await gh(["pr", "comment", String(number), "-R", repo, "--body", body]);
      return { ok: true };
    },

    /** { threadId } → the PR most relevant to a BB thread: the thread's own
        environment PR (the branch the agent pushed) first, else a PR this
        thread was spawned to review. Null when neither exists. */
    async pullForThread(input: unknown) {
      const threadId = (input as { threadId?: unknown })?.threadId;
      if (typeof threadId !== "string" || threadId.length === 0) {
        throw new Error("expected { threadId: string }");
      }
      try {
        const thread = (await bb.sdk.threads.get({ threadId })) as unknown as {
          environmentId?: string | null;
        };
        if (thread?.environmentId) {
          const result = (await bb.sdk.environments.pullRequest({
            environmentId: thread.environmentId,
          })) as unknown as { pullRequest?: { url?: unknown } | null };
          const url = result?.pullRequest?.url;
          const match =
            typeof url === "string"
              ? url.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/)
              : null;
          if (match !== null) {
            return { pull: { repo: match[1], number: Number(match[2]) } };
          }
        }
      } catch {
        // no environment / PR lookup failed — fall through to spawn links
      }
      const links = await listAllLinks();
      for (const [key, threadLinks] of Object.entries(links)) {
        const match = key.match(/^pr:([\w.-]+\/[\w.-]+)#(\d+)$/);
        if (match === null) continue;
        if (threadLinks.some((link) => link.threadId === threadId)) {
          return { pull: { repo: match[1], number: Number(match[2]) } };
        }
      }
      return { pull: null };
    },

    /** { repo, number, body } → add an issue comment. */
    async commentIssue(input: unknown) {
      const { repo, number } = requireItemInput(input);
      const body = (input as { body?: unknown })?.body;
      if (typeof body !== "string" || body.trim().length === 0) {
        throw new Error("comment body must be a non-empty string");
      }
      await gh(["issue", "comment", String(number), "-R", repo, "--body", body]);
      return { ok: true };
    },

    /** { repo, title, body? } → create an issue, sync, return number+url. */
    async createIssue(input: unknown) {
      const args = input as { repo?: unknown; title?: unknown; body?: unknown };
      if (!isRepoName(args?.repo) || typeof args?.title !== "string" || args.title.trim().length === 0) {
        throw new Error("expected { repo: \"owner/name\", title: string, body?: string }");
      }
      const body = typeof args.body === "string" ? args.body : "";
      const stdout = await gh([
        "issue", "create", "-R", args.repo,
        "--title", args.title, "--body", body,
      ]);
      const match = stdout.trim().match(/\/issues\/(\d+)\s*$/);
      const number = match !== null ? Number(match[1]) : null;
      try {
        replaceRepoRows(args.repo, await syncRepo(args.repo));
        bb.realtime.publish("data-changed", {});
      } catch {
        // creation succeeded; the next scheduled sync will pick it up
      }
      return { number, url: stdout.trim() };
    },

    /** { repo, number } → spawn a worker thread on an issue. */
    async startWork(input: unknown) {
      const { repo, number } = requireItemInput(input);
      return await spawnOnItem("issue", repo, number);
    },

    /** { repo, number } → spawn a review thread on a PR. */
    async startReview(input: unknown) {
      const { repo, number } = requireItemInput(input);
      return await spawnOnItem("pr", repo, number);
    },

    /** () → every issue/PR → thread link, keyed "<kind>:<repo>#<number>". */
    async listLinks() {
      return { links: await listAllLinks() };
    },
  });

  // ------------------------------------------------------------------
  // @-mentions: issues and PRs attach their details as agent context.
  // Search reads the cache (2s time box); resolve prefers a live gh view
  // and falls back to the cache so a network blip doesn't block the send.
  // ------------------------------------------------------------------
  function mentionItems(kind: "issue" | "pr", query: string) {
    return listCachedItems({ kind, query, state: "open" })
      .slice(0, 8)
      .map((item) => ({
        id: `${item.repo}#${item.number}`,
        title: `#${item.number} ${item.title}`,
        subtitle: item.repo,
      }));
  }

  function parseMentionId(itemId: string): { repo: string; number: number } {
    const match = itemId.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
    if (match === null) throw new Error(`malformed mention id "${itemId}"`);
    return { repo: match[1], number: Number(match[2]) };
  }

  async function mentionContext(
    kind: "issue" | "pr",
    itemId: string,
  ): Promise<{ context: string }> {
    const { repo, number } = parseMentionId(itemId);
    const noun = kind === "pr" ? "pull request" : "issue";
    try {
      const raw = await gh(
        kind === "pr"
          ? ["pr", "view", String(number), "-R", repo, "--json", "number,title,body,state,author,url"]
          : ["issue", "view", String(number), "-R", repo, "--json", "number,title,body,state,author,url"],
        15_000,
      );
      const detail = JSON.parse(raw) as GhListEntry;
      return {
        context: [
          `# GitHub ${noun} ${repo}#${number}: ${String(detail.title ?? "")}`,
          "",
          `State: ${String(detail.state ?? "")} · Author: ${String(detail.author?.login ?? "")}`,
          `URL: ${String(detail.url ?? "")}`,
          "",
          typeof detail.body === "string" && detail.body.length > 0
            ? detail.body
            : "(no description)",
          "",
          `For full comments/diff run: gh ${kind === "pr" ? "pr" : "issue"} view ${number} -R ${repo} --comments`,
        ].join("\n"),
      };
    } catch (error) {
      const cached = getCachedItem(kind, repo, number);
      if (cached === null) throw error instanceof Error ? error : new Error(String(error));
      return {
        context: [
          `# GitHub ${noun} ${repo}#${number}: ${cached.title}`,
          "",
          `State: ${cached.state} · Author: ${cached.author}`,
          `URL: ${cached.url}`,
          "",
          cached.body.length > 0 ? cached.body : "(no description)",
        ].join("\n"),
      };
    }
  }

  bb.ui.registerMentionProvider({
    id: "issue",
    label: "GitHub issues",
    search({ query }) {
      return mentionItems("issue", query);
    },
    resolve(itemId) {
      return mentionContext("issue", itemId);
    },
  });

  bb.ui.registerMentionProvider({
    id: "pr",
    label: "GitHub pull requests",
    search({ query }) {
      return mentionItems("pr", query);
    },
    resolve(itemId) {
      return mentionContext("pr", itemId);
    },
  });

  // ------------------------------------------------------------------
  // CLI: `bb github …` for agents and terminals.
  // ------------------------------------------------------------------
  const USAGE = [
    "Usage:",
    "  bb github repos              List tracked repositories",
    "  bb github issues [repo]      List cached open issues",
    "  bb github prs [repo]         List cached open pull requests",
    "  bb github sync               Refresh the cache from GitHub now",
  ].join("\n");

  bb.cli.register({
    name: "github",
    summary: "Browse tracked GitHub repos, issues, and PRs",
    commands: [
      { name: "repos", summary: "List tracked repositories", usage: "bb github repos" },
      { name: "issues", summary: "List cached open issues", usage: "bb github issues [owner/repo]" },
      { name: "prs", summary: "List cached open pull requests", usage: "bb github prs [owner/repo]" },
      { name: "sync", summary: "Refresh the cache from GitHub now", usage: "bb github sync" },
    ],
    async run(argv) {
      const [sub, arg] = argv;
      try {
        if (sub === undefined || sub === "help" || sub === "--help") {
          return { exitCode: 0, stdout: USAGE };
        }
        if (sub === "repos") {
          const repos = await discoverRepos(true);
          if (repos.length === 0) {
            return { exitCode: 0, stdout: "No tracked repos. Attach a project with a GitHub remote or set extraRepos." };
          }
          return {
            exitCode: 0,
            stdout: repos
              .map((entry) => `${entry.repo}${entry.projectId !== null ? `\t(${entry.projectId})` : ""}`)
              .join("\n"),
          };
        }
        if (sub === "issues" || sub === "prs") {
          const items = listCachedItems({
            kind: sub === "prs" ? "pr" : "issue",
            repo: isRepoName(arg) ? arg : undefined,
            state: "open",
          });
          if (items.length === 0) {
            return { exitCode: 0, stdout: "Nothing cached. Run `bb github sync` first." };
          }
          return {
            exitCode: 0,
            stdout: items
              .map((item) => `${item.repo}#${item.number}\t[${item.state}]\t${item.title}`)
              .join("\n"),
          };
        }
        if (sub === "sync") {
          const { repos, items } = await syncAll(true);
          return { exitCode: 0, stdout: `Synced ${items} item(s) across ${repos} repo(s).` };
        }
        return { exitCode: 1, stderr: `Unknown subcommand "${sub}".\n${USAGE}` };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
