import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  getPluginListing,
  listInReviewPluginListings,
  writePluginListing,
  type DbConnection,
} from "@bb/db";
import {
  pluginListingDraftEntrySchema,
  pluginListingPullRequestUrlSchema,
  type PluginListingDraftEntry,
  type PluginListingRecord,
  type MarketplaceEntrySource,
} from "@bb/domain";
import { z } from "zod";
import {
  assertPublicMarketplaceUrl,
  type MarketplaceFetch,
} from "../plugin-catalog/marketplace-http.js";

const githubPullSchema = z.object({
  state: z.enum(["open", "closed"]),
  merged: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
  merged_at: z.iso.datetime({ offset: true }).nullable(),
  merge_commit_sha: z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .nullable(),
  base: z.object({
    repo: z.object({ full_name: z.literal("get-bb/marketplace") }),
  }),
  head: z.object({
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
    repo: z
      .object({
        full_name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
      })
      .nullable(),
  }),
});
type GithubPull = z.infer<typeof githubPullSchema>;

const githubPullFilesSchema = z.array(
  z.object({ filename: z.string(), status: z.string() }),
);
const githubFileSchema = z.object({
  encoding: z.literal("base64"),
  content: z.string(),
});

export class PluginListingConflictError extends Error {
  override readonly name = "PluginListingConflictError";
}

function canonicalPullRequestUrl(raw: string): string {
  const url = new URL(pluginListingPullRequestUrlSchema.parse(raw));
  return `https://github.com${url.pathname.replace(/\/$/u, "")}`;
}

function pullRequestApiPath(url: string): string {
  const number = new URL(url).pathname.split("/").at(-1);
  return `https://api.github.com/repos/get-bb/marketplace/pulls/${number}`;
}

async function fetchGithubJson<T>(
  fetch: MarketplaceFetch,
  url: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "bb-plugin-listings",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return schema.parse(await response.json());
}

function validateReleaseSource(entry: PluginListingDraftEntry): void {
  if ("git" in entry.source) {
    assertPublicMarketplaceUrl(entry.source.git.url);
  } else if ("npm" in entry.source && entry.source.npm.registry !== undefined) {
    assertPublicMarketplaceUrl(entry.source.npm.registry);
  }
}

interface SavePluginListingDraftArgs {
  db: DbConnection;
  pluginId: string;
  entry: PluginListingDraftEntry;
  at: number;
}

export function savePluginListingDraft(
  args: SavePluginListingDraftArgs,
): PluginListingRecord {
  const entry = pluginListingDraftEntrySchema.parse(args.entry);
  if (entry.id !== args.pluginId) {
    throw new Error("the listing entry and plugin must have the same id");
  }
  validateReleaseSource(entry);
  const current = getPluginListing(args.db, args.pluginId);
  if (current !== undefined && isDeepStrictEqual(current.entry, entry)) {
    return current;
  }
  const record: PluginListingRecord = {
    pluginId: args.pluginId,
    authorship: "explicit",
    entry,
    lifecycle:
      current?.lifecycle.status === "in-review"
        ? current.lifecycle
        : { status: "draft" },
  };
  if (!writePluginListing({ ...args, current, record, notice: null })) {
    throw new PluginListingConflictError(
      "the listing changed; reload and retry",
    );
  }
  return record;
}

interface VerifyPullEntryArgs {
  fetch: MarketplaceFetch;
  pull: GithubPull;
  pullRequestUrl: string;
  entry: PluginListingDraftEntry;
}

async function verifyPullEntry(args: VerifyPullEntryArgs): Promise<void> {
  const path = `entries/${args.entry.id}.json`;
  let changed = false;
  for (let page = 1; page <= 30; page += 1) {
    const files = await fetchGithubJson(
      args.fetch,
      `${pullRequestApiPath(args.pullRequestUrl)}/files?per_page=100&page=${page}`,
      githubPullFilesSchema,
    );
    changed = files.some(
      (file) => file.filename === path && file.status !== "removed",
    );
    if (changed || files.length < 100) break;
  }
  if (!changed) {
    throw new PluginListingConflictError(
      `the pull request does not change ${path}`,
    );
  }
  const repository = args.pull.merged
    ? args.pull.base.repo.full_name
    : args.pull.head.repo?.full_name;
  const revision = args.pull.merged
    ? args.pull.merge_commit_sha
    : args.pull.head.sha;
  if (repository === undefined || revision === null) {
    throw new PluginListingConflictError(
      "the pull request source repository is unavailable",
    );
  }
  const file = await fetchGithubJson(
    args.fetch,
    `https://api.github.com/repos/${repository}/contents/${path}?ref=${revision}`,
    githubFileSchema,
  );
  const entry = pluginListingDraftEntrySchema.parse(
    JSON.parse(Buffer.from(file.content, "base64").toString("utf8")),
  );
  if (!isDeepStrictEqual(entry, args.entry)) {
    throw new PluginListingConflictError(
      "the pull request entry differs from the saved draft; save the current entry before recording it",
    );
  }
}

interface RecordPluginListingSubmissionArgs {
  db: DbConnection;
  pluginId: string;
  pullRequestUrl: string;
  fetch: MarketplaceFetch;
  now: () => number;
}

export async function recordPluginListingSubmission(
  args: RecordPluginListingSubmissionArgs,
): Promise<PluginListingRecord> {
  const current = getPluginListing(args.db, args.pluginId);
  if (current === undefined) {
    throw new PluginListingConflictError(
      "save an explicit authored listing draft first",
    );
  }
  const url = canonicalPullRequestUrl(args.pullRequestUrl);
  if (
    current.lifecycle.status !== "draft" &&
    current.lifecycle.pullRequest.url === url
  ) {
    return current;
  }
  if (current.lifecycle.status !== "draft") {
    throw new PluginListingConflictError(
      "this listing already has a recorded pull request",
    );
  }
  const pull = await fetchGithubJson(
    args.fetch,
    pullRequestApiPath(url),
    githubPullSchema,
  );
  await verifyPullEntry({
    fetch: args.fetch,
    pull,
    pullRequestUrl: url,
    entry: current.entry,
  });
  if (pull.state !== "open" && !pull.merged) {
    throw new PluginListingConflictError(
      "the submission pull request must be open",
    );
  }
  const record: PluginListingRecord = {
    ...current,
    lifecycle: {
      status: "in-review",
      pullRequest: { url, openedAt: Date.parse(pull.created_at) },
    },
  };
  if (
    !writePluginListing({
      db: args.db,
      current,
      record,
      notice: null,
      at: args.now(),
    })
  ) {
    const latest = getPluginListing(args.db, args.pluginId);
    if (
      latest?.lifecycle.status === "in-review" &&
      latest.lifecycle.pullRequest.url === url
    ) {
      return latest;
    }
    throw new PluginListingConflictError(
      "the listing changed; reload and retry",
    );
  }
  return record;
}

interface ReconcilePluginListingsArgs {
  db: DbConnection;
  acceptedEntries: ReadonlyMap<string, MarketplaceEntrySource>;
  fetch: MarketplaceFetch;
  now: () => number;
  warn: (message: string) => void;
}

export async function reconcilePluginListings(
  args: ReconcilePluginListingsArgs,
): Promise<boolean> {
  let changed = false;
  for (const current of listInReviewPluginListings(args.db)) {
    if (current.lifecycle.status !== "in-review") continue;
    const { pullRequest } = current.lifecycle;
    try {
      const pull = await fetchGithubJson(
        args.fetch,
        pullRequestApiPath(pullRequest.url),
        githubPullSchema,
      );
      if (pull.state !== "closed") continue;
      if (pull.merged) {
        const acceptedSource = args.acceptedEntries.get(current.entry.id);
        if (!isDeepStrictEqual(acceptedSource, current.entry.source)) continue;
        await verifyPullEntry({
          fetch: args.fetch,
          pull,
          pullRequestUrl: pullRequest.url,
          entry: current.entry,
        });
        if (pull.merged_at === null) continue;
      }
      const at = args.now();
      const kind = pull.merged ? "published" : "returned";
      const record: PluginListingRecord = {
        ...current,
        lifecycle: pull.merged
          ? {
              status: "published",
              entryId: current.entry.id,
              publishedAt: Date.parse(pull.merged_at ?? pull.created_at),
              pullRequest,
            }
          : { status: "draft" },
      };
      const noticeKey = createHash("sha256")
        .update(JSON.stringify([current.pluginId, pullRequest.url, kind]))
        .digest("hex");
      if (
        writePluginListing({
          db: args.db,
          current,
          record,
          at,
          notice: {
            id: `pln_${noticeKey}`,
            pluginId: current.pluginId,
            pluginName: current.entry.displayName,
            kind,
            pullRequestUrl: pullRequest.url,
            createdAt: at,
          },
        })
      ) {
        changed = true;
      }
    } catch (error) {
      args.warn(
        `listing reconciliation failed for ${current.pluginId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return changed;
}
