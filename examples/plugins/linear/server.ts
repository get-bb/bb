// bb-plugin-linear — the full-stack "Linear" hero plugin (design §8).
//
// A background schedule syncs your open Linear issues into a per-plugin
// SQLite cache; the frontend bundle (app.tsx) renders them in a homepage
// section, a board nav panel, and a per-thread "Issue" tab; @-mentioning an
// issue attaches its details as agent context; and `bb linear issues|sync`
// gives agents (and humans) the same surface over the CLI.
//
// Surfaces demonstrated: secret + defaulted + project settings,
// bb.storage.sqlite() + storage.migrate, bb.storage.kv (sync cursor +
// thread↔issue links), bb.background.schedule, bb.realtime.publish,
// bb.rpc (listIssues/startWork/issueForThread/listLinks),
// bb.ui.registerMentionProvider, bb.cli.register, and
// bb.sdk.threads.spawn with plugin attribution.
//
// The type-only import is erased at load time; this file runs as-is.
import type { BbPluginApi } from "@bb/plugin-sdk";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

const CONFIGURE_HINT =
  "Set apiKey (a Linear personal API key) with `bb plugin config linear`, " +
  "then `bb plugin reload linear`.";

const USAGE = [
  "Usage:",
  "  bb linear issues [query...]   List cached open issues (optionally filtered)",
  "  bb linear sync                Fetch open issues from Linear now",
].join("\n");

/** One page covers small/medium teams; the cache is a working set, not an
 * archive. */
const SYNC_PAGE_SIZE = 100;

/** A cached issue row (the shape every surface — rpc, CLI, mentions —
 * shares). */
interface CachedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  state: string;
  updatedAt: string;
}

interface SyncCursor {
  lastSyncedAt: number;
  count: number;
}

/** Open = anything not completed or canceled, filtered to the configured
 * team when `teamKey` is set. */
const ISSUES_QUERY = `
  query OpenIssues($filter: IssueFilter, $first: Int) {
    issues(filter: $filter, first: $first) {
      nodes {
        id
        identifier
        title
        description
        updatedAt
        state { name }
      }
    }
  }
`;

/**
 * Name-matched needs-configuration error (see NeedsConfigurationError in the
 * host): plugin sources have no runtime import of the class, so the host
 * matches on `error.name`.
 */
function needsConfiguration(message: string): Error {
  return Object.assign(new Error(message), {
    name: "NeedsConfigurationError",
  });
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    apiKey: {
      type: "string",
      label: "Linear API key",
      description:
        "Personal API key (Linear → Settings → Security & access → API keys).",
      secret: true,
    },
    teamKey: {
      type: "string",
      label: "Team key",
      description:
        'Optional team key like "ENG" to sync only that team\'s issues.',
      default: "",
    },
    defaultProject: {
      type: "project",
      label: "Default BB project",
      description:
        "Where startWork spawns threads when the click site has no project.",
    },
  });

  // Loaded-but-unconfigured is a first-class state: report it instead of
  // letting every sync crash. The cache and rpc surface keep working.
  const initial = await settings.get();
  if (!initial.apiKey) {
    bb.status.needsConfiguration(CONFIGURE_HINT);
  }

  // The issue cache lives in the plugin's own SQLite database (bigger and
  // more relational than the 256KB-per-value kv). storage.migrate is
  // append-only: never reorder or edit shipped statements.
  const db = bb.storage.sqlite();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS issues (
       id TEXT PRIMARY KEY,
       identifier TEXT NOT NULL,
       title TEXT NOT NULL,
       description TEXT NOT NULL,
       state TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
  ]);

  function rowToIssue(row: Record<string, unknown>): CachedIssue {
    return {
      id: String(row.id),
      identifier: String(row.identifier),
      title: String(row.title),
      description: String(row.description),
      state: String(row.state),
      updatedAt: String(row.updated_at),
    };
  }

  function listCachedIssues(filter?: string): CachedIssue[] {
    const rows =
      filter !== undefined && filter.trim().length > 0
        ? (db
            .prepare(
              "SELECT * FROM issues WHERE identifier LIKE ? OR title LIKE ? ORDER BY updated_at DESC",
            )
            .all(
              `%${filter.trim()}%`,
              `%${filter.trim()}%`,
            ) as Record<string, unknown>[])
        : (db
            .prepare("SELECT * FROM issues ORDER BY updated_at DESC")
            .all() as Record<string, unknown>[]);
    return rows.map(rowToIssue);
  }

  function getCachedIssue(issueId: string): CachedIssue | null {
    const row = db.prepare("SELECT * FROM issues WHERE id = ?").get(issueId) as
      | Record<string, unknown>
      | undefined;
    return row === undefined ? null : rowToIssue(row);
  }

  /**
   * Fetch open issues from Linear and replace the cache. Publishes
   * "issues-updated" only when the cached set actually changed, so idle
   * syncs stay silent on the frontend.
   */
  async function syncIssues(): Promise<{ count: number; changed: boolean }> {
    const { apiKey, teamKey } = await settings.get();
    if (!apiKey) {
      throw needsConfiguration(`Linear API key not set. ${CONFIGURE_HINT}`);
    }
    const filter = {
      state: { type: { nin: ["completed", "canceled"] } },
      ...(teamKey.trim().length > 0
        ? { team: { key: { eq: teamKey.trim() } } }
        : {}),
    };
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        // Personal API keys go in Authorization directly (no "Bearer").
        authorization: apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: ISSUES_QUERY,
        variables: { filter, first: SYNC_PAGE_SIZE },
      }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw needsConfiguration(
          `Linear rejected the API key (HTTP ${response.status}). ${CONFIGURE_HINT}`,
        );
      }
      throw new Error(`Linear API returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      data?: {
        issues?: {
          nodes?: Array<{
            id?: unknown;
            identifier?: unknown;
            title?: unknown;
            description?: unknown;
            updatedAt?: unknown;
            state?: { name?: unknown };
          }>;
        };
      };
      errors?: Array<{ message?: unknown }>;
    };
    if (body.errors !== undefined && body.errors.length > 0) {
      throw new Error(
        `Linear API error: ${String(body.errors[0]?.message ?? "unknown")}`,
      );
    }
    const issues: CachedIssue[] = (body.data?.issues?.nodes ?? [])
      .filter((node) => typeof node?.id === "string")
      .map((node) => ({
        id: String(node.id),
        identifier: String(node.identifier ?? ""),
        title: String(node.title ?? ""),
        description: typeof node.description === "string" ? node.description : "",
        state: String(node.state?.name ?? "Unknown"),
        updatedAt: String(node.updatedAt ?? ""),
      }));

    // [id, updatedAt] is a change fingerprint: Linear bumps updatedAt on
    // every edit, and removals/additions change the id set.
    const fingerprint = (pairs: Array<[string, string]>) =>
      JSON.stringify([...pairs].sort((a, b) => a[0].localeCompare(b[0])));
    const before = fingerprint(
      (
        db.prepare("SELECT id, updated_at FROM issues").all() as Array<{
          id: string;
          updated_at: string;
        }>
      ).map((row) => [row.id, row.updated_at]),
    );
    const after = fingerprint(issues.map((issue) => [issue.id, issue.updatedAt]));

    const insert = db.prepare(
      "INSERT INTO issues (id, identifier, title, description, state, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    db.transaction(() => {
      db.prepare("DELETE FROM issues").run();
      for (const issue of issues) {
        insert.run(
          issue.id,
          issue.identifier,
          issue.title,
          issue.description,
          issue.state,
          issue.updatedAt,
        );
      }
    })();

    await bb.storage.kv.set("sync-cursor", {
      lastSyncedAt: Date.now(),
      count: issues.length,
    } satisfies SyncCursor);

    const changed = before !== after;
    if (changed) {
      bb.realtime.publish("issues-updated", { count: issues.length });
    }
    bb.log.info(
      `synced ${issues.length} open issue(s)${changed ? "" : " (no changes)"}`,
    );
    return { count: issues.length, changed };
  }

  // Every 5 minutes, while the plugin is loaded. Failures land in
  // `bb plugin list` via the schedule's last_error; a missing API key is
  // reported as needs-configuration instead of a crash. (Wrapped because a
  // schedule fn returns void/Promise<void>; syncIssues returns a summary.)
  bb.background.schedule("sync-issues", "*/5 * * * *", async () => {
    await syncIssues();
  });

  // ------------------------------------------------------------------
  // rpc — the frontend bundle's data plane (app.tsx calls these).
  // ------------------------------------------------------------------
  bb.rpc.register({
    /** () → { count } — force a Linear fetch now (the board header's Sync
     * button). Publishes "issues-updated" via syncIssues on changes. */
    async sync() {
      const result = await syncIssues();
      return { count: result.count };
    },

    /** { filter? } → { issues } from the cache (no network). */
    listIssues(input: unknown) {
      const filter =
        typeof (input as { filter?: unknown })?.filter === "string"
          ? (input as { filter: string }).filter
          : undefined;
      return { issues: listCachedIssues(filter) };
    },

    /**
     * { issueId, projectId? } → spawn a thread working on the issue.
     * projectId falls back to the defaultProject setting; the server
     * resolves the project-default environment and bb.sdk fills in
     * origin "plugin" + originPluginId "linear".
     */
    async startWork(input: unknown) {
      const args = input as { issueId?: unknown; projectId?: unknown };
      if (typeof args?.issueId !== "string") {
        throw new Error("startWork expects { issueId: string, projectId?: string }");
      }
      const issue = getCachedIssue(args.issueId);
      if (issue === null) {
        throw new Error(
          `unknown issue "${args.issueId}" — run \`bb linear sync\` and retry`,
        );
      }
      const { defaultProject } = await settings.get();
      const projectId =
        typeof args.projectId === "string" && args.projectId.length > 0
          ? args.projectId
          : defaultProject;
      if (!projectId) {
        throw new Error(
          "No BB project to spawn into — open a project first, or set the " +
            "defaultProject setting (`bb plugin config linear`).",
        );
      }
      const thread = await bb.sdk.threads.spawn({
        projectId,
        environment: { type: "project-default" },
        title: `${issue.identifier}: ${issue.title}`.slice(0, 120),
        prompt:
          `Work on Linear issue ${issue.identifier}: ${issue.title}\n\n` +
          `State: ${issue.state}\n\n` +
          (issue.description.length > 0
            ? issue.description
            : "(no description)"),
      });
      await bb.storage.kv.set(`link:${thread.id}`, issue.id);
      bb.log.info(`startWork ${issue.identifier} → thread ${thread.id}`);
      return { threadId: thread.id };
    },

    /** { threadId } → { issue: CachedIssue | null } for the panel tab. */
    async issueForThread(input: unknown) {
      const threadId = (input as { threadId?: unknown })?.threadId;
      if (typeof threadId !== "string") {
        throw new Error("issueForThread expects { threadId: string }");
      }
      const issueId = await bb.storage.kv.get<string>(`link:${threadId}`);
      return { issue: issueId === undefined ? null : getCachedIssue(issueId) };
    },

    /**
     * () → { threadIds } of every thread linked to an issue. The frontend
     * keeps these in a module-level cache because the threadPanelTab
     * `visible()` predicate is synchronous (see README).
     */
    async listLinks() {
      const keys = await bb.storage.kv.list("link:");
      return { threadIds: keys.map((key) => key.slice("link:".length)) };
    },
  });

  // ------------------------------------------------------------------
  // @-mentions: "@ENG-123 …" attaches the issue as agent-only context.
  // ------------------------------------------------------------------
  bb.ui.registerMentionProvider({
    id: "linear-issue",
    label: "Linear issues",
    search({ query }) {
      return listCachedIssues(query)
        .slice(0, 8)
        .map((issue) => ({
          id: issue.id,
          title: `${issue.identifier} ${issue.title}`,
          subtitle: issue.state,
        }));
    },
    resolve(itemId) {
      const issue = getCachedIssue(itemId);
      if (issue === null) {
        throw new Error(
          `unknown Linear issue "${itemId}" — the cache may be stale; run \`bb linear sync\``,
        );
      }
      return {
        context: [
          `# Linear issue ${issue.identifier}: ${issue.title}`,
          "",
          `State: ${issue.state}`,
          "",
          issue.description.length > 0 ? issue.description : "(no description)",
        ].join("\n"),
      };
    },
  });

  // ------------------------------------------------------------------
  // CLI: the agent-facing surface (`bb linear …` from any thread's bash).
  // ------------------------------------------------------------------
  bb.cli.register({
    name: "linear",
    summary: "Browse cached Linear issues and force a sync",
    commands: [
      {
        name: "issues",
        summary: "List cached open issues (optionally filtered)",
        usage: "bb linear issues [query...]",
      },
      {
        name: "sync",
        summary: "Fetch open issues from Linear now",
        usage: "bb linear sync",
      },
    ],
    async run(argv) {
      const [sub, ...rest] = argv;
      if (sub === undefined || sub === "help" || sub === "--help") {
        return { exitCode: 0, stdout: USAGE };
      }
      if (sub === "issues") {
        const issues = listCachedIssues(rest.join(" "));
        if (issues.length === 0) {
          return {
            exitCode: 0,
            stdout: "No cached issues. Run `bb linear sync` first.",
          };
        }
        const cursor = await bb.storage.kv.get<SyncCursor>("sync-cursor");
        const lines = issues.map(
          (issue) => `${issue.identifier}\t[${issue.state}]\t${issue.title}`,
        );
        if (cursor !== undefined) {
          lines.push(`(${issues.length} issue(s), last synced ${new Date(cursor.lastSyncedAt).toISOString()})`);
        }
        return { exitCode: 0, stdout: lines.join("\n") };
      }
      if (sub === "sync") {
        try {
          const { count, changed } = await syncIssues();
          return {
            exitCode: 0,
            stdout: `Synced ${count} open issue(s)${changed ? "" : " (no changes)"}.`,
          };
        } catch (error) {
          return {
            exitCode: 1,
            stderr: error instanceof Error ? error.message : String(error),
          };
        }
      }
      return { exitCode: 1, stderr: `Unknown subcommand "${sub}".\n${USAGE}` };
    },
  });
}
