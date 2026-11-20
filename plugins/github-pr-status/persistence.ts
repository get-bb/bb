import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  pullRequestSchema,
  type PullRequest,
  type PullRequestWatch,
} from "./contract.js";
import { watchProgressSchema, type WatchProgress } from "./watch.js";

const PERSISTENCE_ENABLED = true;
const PERSISTENCE_VERSION = 1;

export type StoredWatch = PullRequestWatch & {
  progress: WatchProgress;
  unavailableSince: number | null;
};

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
const watchRow = z.object({
  thread_id: z.string().min(1),
  environment_id: z.string().min(1),
  url: z.string().url(),
  number: z.number().int().positive(),
  started_at: z.number(),
  progress: z
    .string()
    .transform((value, ctx): unknown => {
      try {
        return JSON.parse(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid watch progress" });
        return z.NEVER;
      }
    })
    .pipe(watchProgressSchema),
  unavailable_since: z.number().nullable(),
});
const linkRow = z.object({
  environment_id: z.string(),
  url: z.string().url().nullable(),
  branch: z.string().nullable(),
  discovered_at: z.number(),
});

export function createPullRequestPersistence(storage: BbPluginApi["storage"]) {
  if (!PERSISTENCE_ENABLED)
    return {
      snapshots: () => [],
      links: () => [],
      saveSnapshot() {},
      link() {},
      removeEnvironment() {},
      watches: (): StoredWatch[] => [],
      saveWatch() {},
      removeWatch() {},
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
    `CREATE TABLE watches (
      thread_id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      url TEXT NOT NULL,
      number INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      progress TEXT NOT NULL,
      unavailable_since INTEGER
    );`,
  ]);
  if (db.pragma("user_version", { simple: true }) !== PERSISTENCE_VERSION)
    db.transaction(() => {
      db.exec("DELETE FROM links; DELETE FROM snapshots;");
      db.pragma(`user_version = ${PERSISTENCE_VERSION}`);
    })();
  const prune = () =>
    db
      .prepare(
        "DELETE FROM snapshots WHERE NOT EXISTS (SELECT 1 FROM links WHERE links.url = snapshots.url)",
      )
      .run();
  function readRows<T>(
    table: "snapshots" | "links" | "watches",
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
            "DELETE FROM links WHERE url = (SELECT url FROM snapshots WHERE rowid = ?)",
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
    links() {
      const links = readRows("links", linkRow).map((row) => ({
        environmentId: row.environment_id,
        url: row.url,
        branch: row.branch,
        discoveredAt: row.discovered_at,
      }));
      prune();
      return links;
    },
    saveSnapshot(pullRequest: PullRequest, fetchedAt: number) {
      db.prepare(
        `INSERT INTO snapshots (url, content, fetched_at) VALUES (?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET content = excluded.content, fetched_at = excluded.fetched_at
        WHERE snapshots.content != excluded.content`,
      ).run(pullRequest.url, JSON.stringify(pullRequest), fetchedAt);
    },
    link(
      environmentId: string,
      url: string | null,
      branch: string | null,
      discoveredAt: number,
    ) {
      db.transaction(() => {
        const { changes } = db
          .prepare(
            `INSERT INTO links (environment_id, url, branch, discovered_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(environment_id) DO UPDATE SET url = excluded.url, branch = excluded.branch,
          discovered_at = excluded.discovered_at
          WHERE links.url IS NOT excluded.url OR links.branch IS NOT excluded.branch`,
          )
          .run(environmentId, url, branch, discoveredAt);
        if (changes > 0) prune();
      })();
    },
    watches(): StoredWatch[] {
      return readRows("watches", watchRow).map((row) => ({
        threadId: row.thread_id,
        environmentId: row.environment_id,
        url: row.url,
        number: row.number,
        startedAt: row.started_at,
        progress: row.progress,
        unavailableSince: row.unavailable_since,
      }));
    },
    saveWatch(watch: StoredWatch) {
      db.prepare(
        `INSERT INTO watches (thread_id, environment_id, url, number, started_at, progress, unavailable_since)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET environment_id = excluded.environment_id, url = excluded.url,
        number = excluded.number, started_at = excluded.started_at, progress = excluded.progress,
        unavailable_since = excluded.unavailable_since`,
      ).run(
        watch.threadId,
        watch.environmentId,
        watch.url,
        watch.number,
        watch.startedAt,
        JSON.stringify(watch.progress),
        watch.unavailableSince,
      );
    },
    removeWatch(threadId: string) {
      db.prepare("DELETE FROM watches WHERE thread_id = ?").run(threadId);
    },
    removeEnvironment(environmentId: string) {
      db.transaction(() => {
        db.prepare("DELETE FROM links WHERE environment_id = ?").run(
          environmentId,
        );
        prune();
      })();
    },
  };
}
export type PullRequestPersistence = ReturnType<
  typeof createPullRequestPersistence
>;
