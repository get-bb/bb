import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consumePluginListingNotice,
  createConnection,
  getPluginListing,
  listPluginListingNotices,
  listPluginListings,
  migrate,
  type DbConnection,
} from "@bb/db";
import type { PluginListingDraftEntry } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  recordPluginListingSubmission,
  reconcilePluginListings,
  savePluginListingDraft,
} from "../../../src/services/plugins/plugin-listing-lifecycle.js";
import type { MarketplaceFetch } from "../../../src/services/plugin-catalog/marketplace-http.js";

const entry: PluginListingDraftEntry = {
  id: "review-notes",
  displayName: "Review Notes",
  description: "Collect review notes for a project.",
  icon: "Notebook",
  author: { name: "Reviewer", github: "reviewer" },
  category: "custom-category",
  source: {
    git: {
      url: "https://github.com/reviewer/bb-plugins.git",
      subdir: "plugins/review-notes",
      ref: "v1.0.0",
    },
  },
};
const pullRequestUrl = "https://github.com/get-bb/marketplace/pull/123";
const apiPath = "https://api.github.com/repos/get-bb/marketplace/pulls/123";
const headSha = "a".repeat(40);
const mergeSha = "b".repeat(40);
const createdAt = "2026-09-10T10:00:00Z";
const mergedAt = "2026-09-11T10:00:00Z";

interface GithubFixture {
  state: "open" | "closed";
  merged: boolean;
  entry: PluginListingDraftEntry;
  changedFile: string;
  headRepository: string | null;
}

function githubFetch(fixture: GithubFixture): MarketplaceFetch {
  return async (url) => {
    if (url === apiPath) {
      return Response.json({
        state: fixture.state,
        merged: fixture.merged,
        created_at: createdAt,
        merged_at: fixture.merged ? mergedAt : null,
        merge_commit_sha: fixture.merged ? mergeSha : null,
        base: { repo: { full_name: "get-bb/marketplace" } },
        head: {
          sha: headSha,
          repo:
            fixture.headRepository === null
              ? null
              : { full_name: fixture.headRepository },
        },
      });
    }
    if (url === `${apiPath}/files?per_page=100&page=1`) {
      return Response.json([
        { filename: fixture.changedFile, status: "modified" },
      ]);
    }
    if (
      url ===
      `https://api.github.com/repos/${fixture.merged ? "get-bb/marketplace" : "reviewer/marketplace"}/contents/entries/review-notes.json?ref=${fixture.merged ? mergeSha : headSha}`
    ) {
      return Response.json({
        encoding: "base64",
        content: Buffer.from(JSON.stringify(fixture.entry)).toString("base64"),
      });
    }
    throw new Error(`unexpected GitHub request: ${url}`);
  };
}

describe("authored plugin listing lifecycle", () => {
  let db: DbConnection;
  let directory: string;
  let fixture: GithubFixture;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "bb-plugin-listing-"));
    db = createConnection(join(directory, "bb.db"));
    migrate(db);
    fixture = {
      state: "open",
      merged: false,
      entry,
      changedFile: "entries/review-notes.json",
      headRepository: "reviewer/marketplace",
    };
  });

  afterEach(async () => {
    db.$client.close();
    await rm(directory, { recursive: true, force: true });
  });

  function saveDraft(draft = entry) {
    return savePluginListingDraft({
      db,
      pluginId: entry.id,
      entry: draft,
      at: 100,
    });
  }

  function recordSubmission(fetch = githubFetch(fixture)) {
    return recordPluginListingSubmission({
      db,
      pluginId: entry.id,
      pullRequestUrl,
      fetch,
      now: () => 200,
    });
  }

  function reconcile(accepted = true) {
    return reconcilePluginListings({
      db,
      acceptedEntries: new Map(accepted ? [[entry.id, entry.source]] : []),
      fetch: githubFetch(fixture),
      now: () => 300,
      warn: (message) => {
        throw new Error(message);
      },
    });
  }

  it("retains explicit authorship without an installed runtime across database reopening", () => {
    expect(listPluginListings(db)).toEqual([]);
    const saved = saveDraft();
    expect(saved.authorship).toBe("explicit");
    expect(saved.entry.category).toBe("custom-category");
    db.$client.close();
    db = createConnection(join(directory, "bb.db"));
    migrate(db);
    expect(listPluginListings(db)).toEqual([saved]);
    expect(saveDraft()).toEqual(saved);
  });

  it("requires an explicit draft and verifies the PR changes that exact entry", async () => {
    await expect(recordSubmission()).rejects.toThrow(
      "explicit authored listing draft",
    );
    saveDraft();
    fixture.changedFile = "entries/somebody-elses-plugin.json";
    await expect(recordSubmission()).rejects.toThrow(
      "does not change entries/review-notes.json",
    );
    fixture.changedFile = "entries/review-notes.json";
    fixture.entry = {
      ...entry,
      source: { npm: { package: "bb-plugin-unrelated" } },
    };
    await expect(recordSubmission()).rejects.toThrow(
      "differs from the saved draft",
    );
    expect(getPluginListing(db, entry.id)?.lifecycle.status).toBe("draft");
  });

  it("rejects credential-bearing release URLs before persisting authorship", () => {
    expect(() =>
      saveDraft({
        ...entry,
        source: {
          git: {
            url: "https://token@github.com/reviewer/private.git",
            ref: "main",
          },
        },
      }),
    ).toThrow("credentials");
    expect(listPluginListings(db)).toEqual([]);
  });

  it("repeats submission safely and waits for both merge and accepted catalog source", async () => {
    saveDraft();
    const recorded = await recordSubmission();
    expect(await recordSubmission()).toEqual(recorded);
    expect(await reconcile()).toBe(false);
    fixture.state = "closed";
    fixture.merged = true;
    fixture.headRepository = null;
    expect(await reconcile(false)).toBe(false);
    expect(getPluginListing(db, entry.id)?.lifecycle.status).toBe("in-review");
    expect(await reconcile()).toBe(true);
    const published = getPluginListing(db, entry.id);
    expect(published?.lifecycle).toEqual({
      status: "published",
      entryId: entry.id,
      publishedAt: Date.parse(mergedAt),
      pullRequest: { url: pullRequestUrl, openedAt: Date.parse(createdAt) },
    });
    expect(await recordSubmission()).toEqual(published);
    expect(await reconcile()).toBe(false);
    const notice = listPluginListingNotices(db)[0];
    expect(notice?.kind).toBe("published");
    expect(consumePluginListingNotice(db, notice?.id ?? "missing", 400)).toBe(
      true,
    );
    expect(consumePluginListingNotice(db, notice?.id ?? "missing", 500)).toBe(
      false,
    );
    db.$client.close();
    db = createConnection(join(directory, "bb.db"));
    migrate(db);
    expect(listPluginListingNotices(db)).toEqual([]);
    expect(await reconcile()).toBe(false);
  });

  it("returns a closed unmerged PR to draft without losing ownership or duplicating notices", async () => {
    saveDraft();
    await recordSubmission();
    fixture.state = "closed";
    expect(await reconcile()).toBe(true);
    expect(getPluginListing(db, entry.id)).toMatchObject({
      authorship: "explicit",
      entry,
      lifecycle: { status: "draft" },
    });
    expect(await reconcile()).toBe(false);
    expect(listPluginListingNotices(db)).toMatchObject([
      { kind: "returned", pullRequestUrl },
    ]);
  });

  it("recovers a submission result lost before the marketplace PR merged", async () => {
    saveDraft();
    fixture.state = "closed";
    fixture.merged = true;
    fixture.headRepository = null;
    expect((await recordSubmission()).lifecycle.status).toBe("in-review");
    expect(await reconcile()).toBe(true);
    expect(getPluginListing(db, entry.id)?.lifecycle.status).toBe("published");
  });

  it("preserves the existing review identity when the author updates a draft", async () => {
    saveDraft();
    const recorded = await recordSubmission();
    const updated = saveDraft({
      ...entry,
      description: "Updated review notes.",
    });
    expect(updated.lifecycle).toEqual(recorded.lifecycle);
    expect(updated.entry.description).toBe("Updated review notes.");
  });

  it("does not overwrite a newer draft when an earlier submission request finishes", async () => {
    saveDraft();
    const originalFetch = githubFetch(fixture);
    const fetch: MarketplaceFetch = async (url, init) => {
      const response = await originalFetch(url, init);
      if (url.includes("/contents/"))
        saveDraft({ ...entry, description: "Newer draft." });
      return response;
    };
    await expect(recordSubmission(fetch)).rejects.toThrow("listing changed");
    expect(getPluginListing(db, entry.id)).toMatchObject({
      entry: { description: "Newer draft." },
      lifecycle: { status: "draft" },
    });
  });
});
