import {
  cliCommand,
  defineCli,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import type { ComposerDraft } from "@get-bb/plugin-sdk";
import {
  promptLibraryRpcContract,
  type PromptRow,
  type SearchPromptsInput,
} from "./contract.js";
import { createHistoryCache, type HistoryCandidate } from "./history-cache.js";
import {
  buildSnippet,
  compareRank,
  queryTerms,
  rankByQuery,
  type RankedMatch,
} from "./ranking.js";
import {
  createStarredPromptStore,
  STARRED_PROMPT_MIGRATIONS,
  type StarredPrompt,
} from "./store.js";

const STARRED_RESULT_LIMIT = 20;
const RECENT_RESULT_LIMIT = 30;

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

export default function promptLibraryPlugin(bb: BbPluginApi): void {
  const db = bb.storage.database();
  bb.storage.migrate(db, STARRED_PROMPT_MIGRATIONS);
  const store = createStarredPromptStore(db);

  const historyCache = createHistoryCache((args) =>
    bb.sdk.experimental_promptHistory.list(args),
  );

  function inScope(candidate: HistoryCandidate, input: SearchPromptsInput) {
    if (input.scope === "thread") return candidate.threadId === input.threadId;
    if (input.scope === "project") {
      return candidate.projectId === input.projectId;
    }
    return true;
  }

  function rankHistory(
    loaded: readonly HistoryCandidate[],
    input: SearchPromptsInput,
    excludedTexts: ReadonlySet<string>,
  ) {
    const seen = new Set<string>(excludedTexts);
    const candidates: HistoryCandidate[] = [];
    for (const candidate of loaded) {
      const text = candidate.prompt.text;
      if (!inScope(candidate, input)) continue;
      if (text.trim().length === 0 || seen.has(text)) continue;
      seen.add(text);
      candidates.push(candidate);
    }
    return rankByQuery(candidates, input.query, (item) => item.prompt.text);
  }

  async function searchHistory(
    input: SearchPromptsInput,
    excludedTexts: ReadonlySet<string>,
  ) {
    if (input.scope === "thread" && input.threadId === null) return [];
    if (input.scope === "project" && input.projectId === null) return [];
    let loaded: readonly HistoryCandidate[] | null =
      await historyCache.refresh();
    let ranked = rankHistory(loaded, input, excludedTexts);
    while (ranked.length < RECENT_RESULT_LIMIT) {
      loaded = await historyCache.loadOlder();
      if (loaded === null) break;
      ranked = rankHistory(loaded, input, excludedTexts);
    }
    return ranked.slice(0, RECENT_RESULT_LIMIT);
  }

  async function projectNames(
    projectIds: ReadonlySet<string>,
  ): Promise<Map<string, string>> {
    if (projectIds.size === 0) return new Map();
    const projects = await bb.sdk.projects.list({ includePersonal: true });
    return new Map(
      projects
        .filter((project) => projectIds.has(project.id))
        .map((project) => [project.id, project.name]),
    );
  }

  function starredRow(
    prompt: StarredPrompt,
    positions: readonly number[],
  ): PromptRow {
    return {
      kind: "starred",
      id: prompt.id,
      prompt: prompt.prompt,
      snippet: buildSnippet(prompt.prompt.text, positions),
      createdAt: prompt.createdAt,
      lastUsedAt: prompt.lastUsedAt,
    };
  }

  async function search(input: SearchPromptsInput) {
    const searching = queryTerms(input.query).length > 0;
    const starredPrompts = store.list();
    const starredIdsByText = new Map(
      starredPrompts.map((prompt) => [prompt.prompt.text, prompt.id]),
    );
    const starred = rankByQuery(
      starredPrompts,
      input.query,
      (prompt) => prompt.prompt.text,
    )
      .slice(0, STARRED_RESULT_LIMIT)
      .map((match) => ({
        ...match,
        row: starredRow(match.item, match.positions),
      }));
    const history = await searchHistory(
      input,
      searching ? new Set(starredIdsByText.keys()) : new Set(),
    );
    const names = await projectNames(
      new Set(history.map((match) => match.item.projectId)),
    );
    const recent = history.map((match) => {
      const { item, positions } = match;
      const text = item.prompt.text;
      const row: PromptRow = {
        kind: "recent",
        id: item.id,
        prompt: item.prompt,
        snippet: buildSnippet(text, positions),
        createdAt: item.createdAt,
        projectId: item.projectId,
        projectName: names.get(item.projectId) ?? null,
        threadId: item.threadId,
        starredId: starredIdsByText.get(text) ?? null,
      };
      return { ...match, row };
    });
    const matches: (RankedMatch<unknown> & { row: PromptRow })[] = [
      ...starred,
      ...recent,
    ];
    if (searching) matches.sort(compareRank);
    return { prompts: matches.map((match) => match.row) };
  }

  function star(prompt: ComposerDraft): StarredPrompt {
    const starred = store.star(prompt, Date.now());
    if (starred === null) {
      throw new Error("A starred prompt needs some text.");
    }
    return starred;
  }

  bb.rpc.register(promptLibraryRpcContract, {
    search,
    star: ({ prompt }) => ({
      id: star({ text: prompt.text, mentions: prompt.mentions }).id,
    }),
    unstar: ({ id }) => ({ unstarred: store.unstar(id) }),
    markUsed({ id }) {
      store.markUsed(id, Date.now());
      return null;
    },
  });

  bb.cli.register(
    defineCli({
      name: "prompts",
      summary: "Search previous prompts and manage starred prompts",
      description:
        "Without a query, starred prompts appear before recent ones in the composer's Prompts… picker (Ctrl+R). A query ranks both in one list: prefix matches first, then by fuzzy score, with starred and then newer prompts breaking ties. Previous prompts come from bb's prompt history.",
      commands: {
        search: cliCommand({
          summary: "Search starred and previous prompts",
          positionals: [
            {
              name: "query",
              description: "Words to fuzzy-match; omit to list the most recent",
              variadic: true,
            },
          ],
          options: {
            project: {
              type: "string",
              description: "Search this project's prompts",
            },
            thread: {
              type: "string",
              description: "Search this thread's prompts",
            },
            json: JSON_OPTION,
          },
          constraints: [
            { kind: "at-most-one", options: ["project", "thread"] },
          ],
          async run({ options, positionals }) {
            const result = await search({
              query: positionals.query.join(" "),
              scope:
                options.thread !== undefined
                  ? "thread"
                  : options.project !== undefined
                    ? "project"
                    : "global",
              projectId: options.project ?? null,
              threadId: options.thread ?? null,
            });
            if (options.json) {
              return { exitCode: 0, stdout: JSON.stringify(result) };
            }
            const lines = result.prompts.map((row) =>
              row.kind === "starred"
                ? `★ ${row.id}  ${row.snippet.text}`
                : `  ${new Date(row.createdAt).toISOString()}  ${row.snippet.text}`,
            );
            return {
              exitCode: 0,
              stdout: lines.length > 0 ? lines.join("\n") : "No prompts found",
            };
          },
        }),
        list: cliCommand({
          summary: "List starred prompts, most recently used first",
          options: { json: JSON_OPTION },
          run({ options }) {
            const prompts = store.list();
            if (options.json) {
              return {
                exitCode: 0,
                stdout: JSON.stringify(
                  prompts.map((prompt) => ({
                    id: prompt.id,
                    prompt: prompt.prompt,
                    createdAt: prompt.createdAt,
                    lastUsedAt: prompt.lastUsedAt,
                  })),
                ),
              };
            }
            return {
              exitCode: 0,
              stdout:
                prompts.length > 0
                  ? prompts
                      .map(
                        (prompt) =>
                          `${prompt.id}  ${buildSnippet(prompt.prompt.text, []).text}`,
                      )
                      .join("\n")
                  : "No starred prompts",
            };
          },
        }),
        star: cliCommand({
          summary: "Star a prompt",
          positionals: [
            {
              name: "text",
              description: "The prompt text",
              required: true,
              variadic: true,
            },
          ],
          options: { json: JSON_OPTION },
          run({ options, positionals }) {
            const starred = star({
              text: positionals.text.join(" "),
              mentions: [],
            });
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify({ id: starred.id, text: starred.prompt.text })
                : starred.id,
            };
          },
        }),
        unstar: cliCommand({
          summary: "Unstar a prompt",
          positionals: [
            {
              name: "id",
              description: "Starred prompt id, as `bb prompts list` prints it",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          run({ options, positionals }) {
            if (!store.unstar(positionals.id)) {
              throw new PluginCliError(
                `Unknown starred prompt: ${positionals.id}`,
                {
                  code: "unknown_prompt",
                  hint: "Run `bb prompts list` for starred prompt ids.",
                },
              );
            }
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify({ id: positionals.id, unstarred: true })
                : `Unstarred ${positionals.id}`,
            };
          },
        }),
      },
    }),
  );
}
