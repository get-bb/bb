import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { noopNotifier } from "../../src/notifier.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  archiveThread,
  createThread,
  searchThreadsWithPendingInteractionState,
  upsertThreadSearchSegments,
} from "../../src/data/threads.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

interface FixtureThread {
  title: string | null;
  titleFallback: string | null;
  messages: readonly string[];
  updatedAt: number;
  archived: boolean;
}

interface RankingCase {
  query: string;
  group: "active" | "archived";
  titleMatches: readonly string[];
}

function thread(
  title: string | null,
  messages: readonly string[],
  updatedAt: number,
  options: { titleFallback?: string; archived?: boolean } = {},
): FixtureThread {
  return {
    title,
    titleFallback: options.titleFallback ?? null,
    messages,
    updatedAt,
    archived: options.archived ?? false,
  };
}

const workspace: readonly FixtureThread[] = [
  thread("Moss plugins", ["Pin the plugin list in the sidebar"], 10),
  thread("Moss editor", ["the editor loads plugins lazily"], 40),
  thread("Quick switcher in palette", ["open the last thread first"], 12),
  thread("Coordinator Mode", ["spawn workers from the lead"], 14),
  thread("Google Ads spike", ["the spend doubled overnight"], 16),
  thread("Plugins blog post", ["draft the intro"], 18),
  thread("Redesign info panel", ["group the sections in one list"], 20),
  thread("Thread title fixes", ["titles drop the emoji"], 22),
  thread("Café sync", ["move the weekly call"], 24),
  thread("Plugin SDK docs", ["document the slots"], 26),
  thread(null, ["start with the importer"], 28, {
    titleFallback: "Add a regression test for search",
  }),
  thread(
    "Weekly planning",
    [
      "moss plugins moss plugins moss plugins",
      "quick switcher notes in the palette",
      "coordinator mode and the thread title",
    ],
    95,
    { titleFallback: "regression test the importer" },
  ),
  thread(
    "Content strategy and calendar",
    [
      "google ads google ads budget",
      "review google ads in the calendar",
      "the ads team wants google numbers",
    ],
    90,
  ),
  thread(
    "Rename child threads to subthreads",
    [
      "the info panel shows the thread title",
      "info panel info panel",
      "add a regression test in the panel",
    ],
    85,
  ),
  thread(
    "Sidebar updates",
    [
      "plugins blog",
      "the cafe sync link",
      "sdk notes in the docs",
      "a regression test for the sidebar",
    ],
    80,
  ),
  thread("iPhone promotional screenshot", ["capture the hero"], 30, {
    archived: true,
  }),
  thread(
    "Launch checklist",
    ["iphone promotional copy for the launch", "iphone promotional again"],
    70,
    { archived: true },
  ),
];

const cases: readonly RankingCase[] = [
  { query: "moss plugins", group: "active", titleMatches: ["Moss plugins"] },
  {
    query: "quick switcher",
    group: "active",
    titleMatches: ["Quick switcher in palette"],
  },
  {
    query: "coordinator mode",
    group: "active",
    titleMatches: ["Coordinator Mode"],
  },
  { query: "google ads", group: "active", titleMatches: ["Google Ads spike"] },
  {
    query: "plugins blog",
    group: "active",
    titleMatches: ["Plugins blog post"],
  },
  {
    query: "info panel",
    group: "active",
    titleMatches: ["Redesign info panel"],
  },
  {
    query: "thread title",
    group: "active",
    titleMatches: ["Thread title fixes"],
  },
  {
    query: "moss",
    group: "active",
    titleMatches: ["Moss editor", "Moss plugins"],
  },
  {
    query: "iphone promotional",
    group: "archived",
    titleMatches: ["iPhone promotional screenshot"],
  },
  {
    query: "regression test",
    group: "active",
    titleMatches: ["Add a regression test for search"],
  },
  { query: "cafe", group: "active", titleMatches: ["Café sync"] },
  { query: "plugin-sdk", group: "active", titleMatches: ["Plugin SDK docs"] },
  {
    query: "in",
    group: "active",
    titleMatches: ["Redesign info panel", "Quick switcher in palette"],
  },
  { query: "the", group: "active", titleMatches: [] },
];

function searchWords(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function hasEveryWord(texts: readonly string[], query: string): boolean {
  const textWords = texts.flatMap(searchWords);
  return searchWords(query).every((queryWord) =>
    textWords.some((word) => word.startsWith(queryWord)),
  );
}

function displayTitle(fixture: FixtureThread): string {
  return fixture.title ?? fixture.titleFallback ?? "";
}

function seedWorkspace(): ReturnType<typeof createConnection> {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const setUpdatedAt = db.$client.prepare(
    "UPDATE threads SET updated_at = ? WHERE id = ?",
  );
  for (const fixture of workspace) {
    const created = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      title: fixture.title,
      titleFallback: fixture.titleFallback,
    });
    upsertThreadSearchSegments(db, {
      segments: fixture.messages.map((text, index) => ({
        threadId: created.id,
        sourceKind: index % 2 === 0 ? "user_message" : "assistant_message",
        sourceKey: `event:${index + 1}`,
        sourceSeq: index + 1,
        text,
      })),
    });
    if (fixture.archived) archiveThread(db, noopNotifier, created.id);
    setUpdatedAt.run(fixture.updatedAt, created.id);
  }
  return db;
}

describe("thread search ranking evals", () => {
  it.each(cases)("ranks $query", ({ query, group, titleMatches }) => {
    const db = seedWorkspace();
    try {
      const results = searchThreadsWithPendingInteractionState(db, {
        query,
        limitPerGroup: 20,
      })[group];
      const titles = results.results.map(
        (result) => result.thread.title ?? result.thread.titleFallback ?? "",
      );
      const expectedMatches = workspace.filter(
        (fixture) =>
          fixture.archived === (group === "archived") &&
          hasEveryWord(
            [
              fixture.title ?? "",
              fixture.titleFallback ?? "",
              ...fixture.messages,
            ],
            query,
          ),
      );

      expect(results.total).toBe(expectedMatches.length);
      expect(titles.slice(0, titleMatches.length)).toEqual(titleMatches);
      const rest = results.results.slice(titleMatches.length);
      expect(
        rest.filter((result) =>
          hasEveryWord(
            [result.thread.title || result.thread.titleFallback || ""],
            query,
          ),
        ),
      ).toEqual([]);
      expect(rest.map((result) => result.thread.updatedAt)).toEqual(
        rest.map((result) => result.thread.updatedAt).sort((a, b) => b - a),
      );
      expect([...titles].sort()).toEqual(
        expectedMatches.map(displayTitle).sort(),
      );
      const queryWords = searchWords(query);
      for (const result of results.results) {
        for (const match of result.matches) {
          expect(match.highlightRanges.length).toBeGreaterThan(0);
          for (const range of match.highlightRanges) {
            const [highlighted = ""] = searchWords(
              match.text.slice(range.start, range.end),
            );
            expect(
              queryWords.some((word) => highlighted.startsWith(word)),
            ).toBe(true);
          }
        }
      }
    } finally {
      db.$client.close();
    }
  });
});
