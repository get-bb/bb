import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { pullRequestSchema, type PullRequest } from "./contract.js";

const PERSISTENCE_ENABLED = true;
const PERSISTENCE_VERSION = 1;

export type PullRequestTarget = {
  environmentId: string;
  slot: { kind: "repo"; label: string } | { kind: "link"; url: string };
};

export type SavedRepo = { label: string; rootPath: string };

export function pullRequestTargetKey(target: PullRequestTarget): string {
  return JSON.stringify([
    target.environmentId,
    target.slot.kind,
    target.slot.kind === "repo" ? target.slot.label : target.slot.url,
  ]);
}

function slotFor(
  kind: "repo" | "link",
  value: string,
): PullRequestTarget["slot"] {
  return kind === "repo" ? { kind, label: value } : { kind, url: value };
}

function slotValue(target: PullRequestTarget): string {
  return target.slot.kind === "repo" ? target.slot.label : target.slot.url;
}

const snapshotRow = z.object({
  url: z.string().url(),
  content: z
    .string()
    .transform((value, ctx): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid snapshot JSON" });
        return z.NEVER;
      }
    })
    .pipe(pullRequestSchema),
  fetched_at: z.number(),
});
const targetRow = z.object({
  environment_id: z.string(),
  kind: z.enum(["repo", "link"]),
  value: z.string(),
  url: z.string().url().nullable(),
  branch: z.string().nullable(),
  discovered_at: z.number(),
});
const linkedRow = z.object({ url: z.string().url() });
const reposRow = z.object({
  environment_id: z.string(),
  repos: z
    .string()
    .transform((value, ctx): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid repos JSON" });
        return z.NEVER;
      }
    })
    .pipe(
      z.array(z.object({ label: z.string(), rootPath: z.string().min(1) })),
    ),
});

export function createPullRequestPersistence(storage: BbPluginApi["storage"]) {
  if (!PERSISTENCE_ENABLED)
    return {
      snapshots: () => [],
      targets: () => [],
      saveSnapshot() {},
      link() {},
      removeTarget() {},
      removeEnvironment() {},
      repos: () => new Map<string, SavedRepo[]>(),
      saveRepos() {},
      linkedUrls: (): string[] => [],
      addLinkedUrl() {},
      removeLinkedUrl() {},
    };
  const db = storage.database();
  storage.migrate(db, [
    `CREATE TABLE snapshots (
      url TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE links (
      environment_id TEXT PRIMARY KEY,
      url TEXT,
      branch TEXT,
      discovered_at INTEGER NOT NULL
    );
    CREATE INDEX links_url ON links(url);`,
    `CREATE TABLE targets (
      environment_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      url TEXT,
      branch TEXT,
      discovered_at INTEGER NOT NULL,
      PRIMARY KEY (environment_id, kind, value)
    );
    CREATE INDEX targets_url ON targets(url);
    INSERT INTO targets (environment_id, kind, value, url, branch, discovered_at)
      SELECT environment_id, 'repo', '', url, branch, discovered_at FROM links;
    DROP TABLE links;
    CREATE TABLE linked_pull_requests (
      environment_id TEXT NOT NULL,
      url TEXT NOT NULL,
      linked_at INTEGER NOT NULL,
      PRIMARY KEY (environment_id, url)
    );
    CREATE TABLE environment_repos (
      environment_id TEXT PRIMARY KEY,
      repos TEXT NOT NULL
    );`,
  ]);
  if (db.pragma("user_version", { simple: true }) !== PERSISTENCE_VERSION)
    db.transaction(() => {
      db.exec("DELETE FROM targets; DELETE FROM snapshots;");
      db.pragma(`user_version = ${PERSISTENCE_VERSION}`);
    })();
  const prune = () =>
    db
      .prepare(
        "DELETE FROM snapshots WHERE NOT EXISTS (SELECT 1 FROM targets WHERE targets.url = snapshots.url)",
      )
      .run();
  function readRows<T>(
    table: "snapshots" | "targets" | "environment_repos",
    schema: z.ZodType<T>,
  ) {
    const valid: T[] = [];
    for (const raw of db
      .prepare(`SELECT rowid AS row_id, * FROM ${table}`)
      .all()) {
      const result = schema.safeParse(raw);
      if (result.success) {
        valid.push(result.data);
        continue;
      }
      const identity = z.object({ row_id: z.number() }).safeParse(raw);
      if (!identity.success) continue;
      db.transaction(() => {
        if (table === "snapshots")
          db.prepare(
            "DELETE FROM targets WHERE url = (SELECT url FROM snapshots WHERE rowid = ?)",
          ).run(identity.data.row_id);
        db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(
          identity.data.row_id,
        );
      })();
    }
    return valid;
  }
  prune();
  return {
    snapshots() {
      return readRows("snapshots", snapshotRow).map((row) => ({
        pullRequest: row.content,
        fetchedAt: row.fetched_at,
      }));
    },
    targets() {
      const targets = readRows("targets", targetRow).map((row) => ({
        target: {
          environmentId: row.environment_id,
          slot: slotFor(row.kind, row.value),
        },
        url: row.url,
        branch: row.branch,
        discoveredAt: row.discovered_at,
      }));
      prune();
      return targets;
    },
    saveSnapshot(pullRequest: PullRequest, fetchedAt: number) {
      db.prepare(
        `INSERT INTO snapshots (url, content, fetched_at) VALUES (?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET content = excluded.content, fetched_at = excluded.fetched_at
        WHERE snapshots.content != excluded.content`,
      ).run(pullRequest.url, JSON.stringify(pullRequest), fetchedAt);
    },
    link(
      target: PullRequestTarget,
      url: string | null,
      branch: string | null,
      discoveredAt: number,
    ) {
      db.transaction(() => {
        const { changes } = db
          .prepare(
            `INSERT INTO targets (environment_id, kind, value, url, branch, discovered_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(environment_id, kind, value) DO UPDATE SET url = excluded.url, branch = excluded.branch,
          discovered_at = excluded.discovered_at
          WHERE targets.url IS NOT excluded.url OR targets.branch IS NOT excluded.branch`,
          )
          .run(
            target.environmentId,
            target.slot.kind,
            slotValue(target),
            url,
            branch,
            discoveredAt,
          );
        if (changes > 0) prune();
      })();
    },
    removeTarget(target: PullRequestTarget) {
      db.transaction(() => {
        db.prepare(
          "DELETE FROM targets WHERE environment_id = ? AND kind = ? AND value = ?",
        ).run(target.environmentId, target.slot.kind, slotValue(target));
        prune();
      })();
    },
    removeEnvironment(environmentId: string) {
      db.transaction(() => {
        for (const table of [
          "targets",
          "linked_pull_requests",
          "environment_repos",
        ])
          db.prepare(`DELETE FROM ${table} WHERE environment_id = ?`).run(
            environmentId,
          );
        prune();
      })();
    },
    repos() {
      return new Map(
        readRows("environment_repos", reposRow).map((row) => [
          row.environment_id,
          row.repos,
        ]),
      );
    },
    saveRepos(environmentId: string, repos: readonly SavedRepo[]) {
      db.prepare(
        `INSERT INTO environment_repos (environment_id, repos) VALUES (?, ?)
        ON CONFLICT(environment_id) DO UPDATE SET repos = excluded.repos
        WHERE environment_repos.repos != excluded.repos`,
      ).run(environmentId, JSON.stringify(repos));
    },
    linkedUrls(environmentId: string): string[] {
      return db
        .prepare(
          "SELECT url FROM linked_pull_requests WHERE environment_id = ? ORDER BY linked_at, rowid",
        )
        .all(environmentId)
        .flatMap((raw) => {
          const row = linkedRow.safeParse(raw);
          return row.success ? [row.data.url] : [];
        });
    },
    addLinkedUrl(environmentId: string, url: string) {
      db.prepare(
        "INSERT INTO linked_pull_requests (environment_id, url, linked_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      ).run(environmentId, url, Date.now());
    },
    removeLinkedUrl(environmentId: string, url: string) {
      db.prepare(
        "DELETE FROM linked_pull_requests WHERE environment_id = ? AND url = ?",
      ).run(environmentId, url);
    },
  };
}
export type PullRequestPersistence = ReturnType<
  typeof createPullRequestPersistence
>;
