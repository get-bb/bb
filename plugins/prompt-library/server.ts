import {
  cliCommand,
  defineCli,
  PluginCliError,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import type { ComposerDraft } from "@get-bb/plugin-sdk";
import {
  promptLibraryRpcContract,
  promptTitleSchema,
  type PromptRow,
  type SearchPromptsInput,
} from "./contract.js";
import { createHistoryCache, type HistoryCandidate } from "./history-cache.js";
import {
  buildSnippet,
  createSearchIndex,
  matchPositions,
  queryTerms,
} from "./ranking.js";
import {
  createStarredPromptStore,
  STARRED_PROMPT_MIGRATIONS,
  type StarredPrompt,
} from "./store.js";

const STARRED_RESULT_LIMIT = 20;
const RECENT_RESULT_LIMIT = 30;
const INDEX_CHUNK_SIZE = 500;

type SearchItem =
  | { kind: "starred"; prompt: StarredPrompt }
  | { kind: "recent"; candidate: HistoryCandidate };

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

export default function promptLibraryPlugin(bb: BbPluginApi): void {
  const db = bb.storage.database();
  bb.storage.migrate(db, STARRED_PROMPT_MIGRATIONS);
  const store = createStarredPromptStore(db);

  const controller = new AbortController();
  const index = createSearchIndex<SearchItem>();
  const historyCache = createHistoryCache(
    (args) => bb.sdk.experimental_promptHistory.list(args),
    async (entries) => {
      for (
        let offset = 0;
        offset < entries.length;
        offset += INDEX_CHUNK_SIZE
      ) {
        controller.signal.throwIfAborted();
        for (const candidate of entries.slice(
          offset,
          offset + INDEX_CHUNK_SIZE,
        )) {
          index.add({
            item: { kind: "recent", candidate },
            text: candidate.prompt.text,
            time: candidate.createdAt,
          });
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    controller.signal,
  );
  let refresh: Promise<void> | null = null;
  let refreshedAt = -Infinity;
  let historyError: string | null = null;
  let names = new Map<string, string>();
  let namesRefreshedAt = -Infinity;
  let namesPending: Promise<void> | null = null;

  function refreshNames(): Promise<void> {
    if (namesPending !== null) return namesPending;
    if (Date.now() - namesRefreshedAt < 60_000) return Promise.resolve();
    namesPending = bb.sdk.projects
      .list({ includePersonal: true, signal: controller.signal })
      .then((projects) => {
        names = new Map(projects.map((project) => [project.id, project.name]));
        namesRefreshedAt = Date.now();
      })
      .finally(() => {
        namesPending = null;
      });
    return namesPending;
  }

  function loadHistory(): Promise<void> {
    if (refresh !== null) return refresh;
    historyError = null;
    refresh = historyCache
      .refresh()
      .then(() => {
        refreshedAt = Date.now();
      })
      .catch((cause: unknown) => {
        historyError = cause instanceof Error ? cause.message : String(cause);
        throw cause;
      })
      .finally(() => {
        refresh = null;
      });
    return refresh;
  }

  const warmup = setImmediate(() => {
    if (refreshedAt === -Infinity && historyError === null)
      void loadHistory().catch(() => {});
    void refreshNames().catch(() => {});
  });
  bb.onDispose(async () => {
    clearImmediate(warmup);
    controller.abort();
    await Promise.allSettled([refresh, namesPending]);
  });

  function inScope(candidate: HistoryCandidate, input: SearchPromptsInput) {
    if (input.scope === "thread") return candidate.threadId === input.threadId;
    if (input.scope === "project") {
      return candidate.projectId === input.projectId;
    }
    return true;
  }

  function historySearchable(input: SearchPromptsInput): boolean {
    if (input.scope === "thread") return input.threadId !== null;
    if (input.scope === "project") return input.projectId !== null;
    return true;
  }

  function orderedItems(
    input: SearchPromptsInput,
    starredPrompts: readonly StarredPrompt[],
    history: readonly HistoryCandidate[],
  ): SearchItem[] {
    const searching = queryTerms(input.query).length > 0;
    const normalizedQuery = input.query.trim().toLowerCase();
    const exactTitle = (item: SearchItem) =>
      item.kind === "starred" &&
      item.prompt.title?.toLowerCase() === normalizedQuery;
    const items: SearchItem[] = searching
      ? index
          .search(
            input.query,
            starredPrompts.map((prompt) => ({
              item: { kind: "starred", prompt },
              text: `${prompt.prompt.text}\n${prompt.title ?? ""}`,
              time: prompt.lastUsedAt ?? prompt.createdAt,
            })),
            Date.now(),
            (item) =>
              item.kind === "starred" ||
              item.candidate.scope ===
                (input.composer === "new-thread" ? "project" : "thread"),
          )
          .sort(
            (left, right) =>
              Number(exactTitle(right.item)) - Number(exactTitle(left.item)),
          )
          .map((match) => match.item)
      : [
          ...starredPrompts.map((prompt): SearchItem => ({
            kind: "starred",
            prompt,
          })),
          ...history.map((candidate): SearchItem => ({
            kind: "recent",
            candidate,
          })),
        ];
    const seenTexts = new Set(
      searching ? starredPrompts.map((prompt) => prompt.prompt.text) : [],
    );
    const includeHistory = historySearchable(input);
    let starredCount = 0;
    let recentCount = 0;
    const ordered: SearchItem[] = [];
    for (const item of items) {
      if (item.kind === "starred") {
        if (starredCount === STARRED_RESULT_LIMIT) continue;
        starredCount += 1;
        ordered.push(item);
        continue;
      }
      const { candidate } = item;
      const text = candidate.prompt.text;
      if (!includeHistory || recentCount === RECENT_RESULT_LIMIT) continue;
      if (!inScope(candidate, input)) continue;
      if (text.trim().length === 0 || seenTexts.has(text)) continue;
      seenTexts.add(text);
      recentCount += 1;
      ordered.push(item);
    }
    return ordered;
  }

  function snippet(text: string, query: string) {
    return buildSnippet(text, matchPositions(text, query));
  }

  async function search(input: SearchPromptsInput) {
    const starredPrompts = store.list();
    const starredIdsByText = new Map(
      starredPrompts.map((prompt) => [prompt.prompt.text, prompt.id]),
    );
    const includeHistory = historySearchable(input);
    if (includeHistory) {
      if (
        input.refreshHistory &&
        (input.waitForHistory ||
          historyError !== null ||
          Date.now() - refreshedAt >= 2_000)
      ) {
        void loadHistory().catch(() => {});
      }
      if (input.waitForHistory) {
        if (refresh !== null) await refresh;
        if (historyCache.snapshot().length > 0) await refreshNames();
      } else {
        void refreshNames().catch(() => {});
      }
    }
    const history = includeHistory ? historyCache.snapshot() : [];
    const items = orderedItems(input, starredPrompts, history);
    const prompts = items.map((item): PromptRow => {
      if (item.kind === "starred") {
        const { prompt } = item;
        return {
          kind: "starred",
          id: prompt.id,
          title: prompt.title,
          titleSnippet:
            prompt.title === null ? null : snippet(prompt.title, input.query),
          prompt: prompt.prompt,
          snippet: snippet(prompt.prompt.text, input.query),
          createdAt: prompt.createdAt,
          lastUsedAt: prompt.lastUsedAt,
        };
      }
      const { candidate } = item;
      const text = candidate.prompt.text;
      return {
        kind: "recent",
        id: candidate.id,
        prompt: candidate.prompt,
        snippet: snippet(text, input.query),
        createdAt: candidate.createdAt,
        projectId: candidate.projectId,
        projectName: names.get(candidate.projectId) ?? null,
        threadId: candidate.threadId,
        starredId: starredIdsByText.get(text) ?? null,
      };
    });
    return {
      prompts,
      loading: includeHistory && refresh !== null,
      historyError: includeHistory ? historyError : null,
    };
  }

  function star(prompt: ComposerDraft, title: string | null): StarredPrompt {
    const starred = store.star(prompt, title, Date.now());
    if (starred === null) {
      throw new Error("A starred prompt needs some text.");
    }
    return starred;
  }

  function setTitle(id: string, title: string | null) {
    if (!store.setTitle(id, title)) {
      throw new PluginCliError(`Unknown starred prompt: ${id}`, {
        code: "unknown_prompt",
        hint: "Run `bb prompts list` for starred prompt ids.",
      });
    }
    return { id, title };
  }

  bb.rpc.register(promptLibraryRpcContract, {
    search,
    star: ({ prompt, title }) => ({
      id: star({ text: prompt.text, mentions: prompt.mentions }, title).id,
    }),
    setTitle: ({ id, title }) => setTitle(id, title),
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
        "Without a query, starred prompts appear before recent ones in the composer's Prompts… picker (Ctrl+R). Search matches titles and prompt text, with exact title matches first. A query otherwise ranks both in one list: prompts that start with the query first, then by match type (exact, word start, typo, inside a word, abbreviation), then starred prompts and prompts of the searching composer's kind (thread starts in the new-thread composer, follow-ups in a thread), then by relevance decayed by age. Previous prompts come from bb's prompt history.",
      commands: {
        search: cliCommand({
          summary: "Search starred and previous prompts",
          positionals: [
            {
              name: "query",
              description:
                "Words that must each match a prompt word exactly, as its start, with one typo, inside it, or as an abbreviation; omit to list the most recent",
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
            composer: {
              type: "enum",
              values: ["new-thread", "follow-up"],
              default: "follow-up",
              description:
                "Rank like this composer: new-thread favors prompts that started threads, follow-up favors follow-ups",
            },
            partial: {
              type: "boolean",
              description:
                "Return available results immediately; JSON includes loading and historyError",
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
              composer: options.composer,
              waitForHistory: !options.partial,
              refreshHistory: true,
            });
            if (options.json) {
              return { exitCode: 0, stdout: JSON.stringify(result) };
            }
            const lines = result.prompts.map((row) =>
              row.kind === "starred"
                ? `★ ${row.id}  ${row.title === null ? "" : `${row.title} — `}${row.snippet.text}`
                : `  ${new Date(row.createdAt).toISOString()}  ${row.snippet.text}`,
            );
            return {
              exitCode: 0,
              stdout: [
                lines.length > 0
                  ? lines.join("\n")
                  : result.loading
                    ? "Loading prompts…"
                    : "No prompts found",
                ...(result.loading ? ["Searching older prompts…"] : []),
                ...(result.historyError === null
                  ? []
                  : [`History unavailable: ${result.historyError}`]),
              ].join("\n"),
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
                    title: prompt.title,
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
                          `${prompt.id}  ${prompt.title === null ? "" : `${prompt.title} — `}${buildSnippet(prompt.prompt.text, []).text}`,
                      )
                      .join("\n")
                  : "No starred prompts",
            };
          },
        }),
        star: cliCommand({
          summary:
            "Star a prompt; existing text keeps its title (use prompts title to rename)",
          positionals: [
            {
              name: "text",
              description: "The prompt text",
              required: true,
              variadic: true,
            },
          ],
          options: {
            title: {
              type: "string",
              description: "Optional title (up to 120 characters)",
            },
            json: JSON_OPTION,
          },
          run({ options, positionals }) {
            const starred = star(
              {
                text: positionals.text.join(" "),
                mentions: [],
              },
              promptTitleSchema.parse(options.title ?? null),
            );
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify({
                    id: starred.id,
                    title: starred.title,
                    text: starred.prompt.text,
                  })
                : starred.id,
            };
          },
        }),
        title: cliCommand({
          summary: "Rename a starred prompt; use --clear to remove its title",
          positionals: [
            { name: "id", description: "Starred prompt id", required: true },
            {
              name: "title",
              description: "New title (up to 120 characters)",
              variadic: true,
            },
          ],
          options: {
            clear: { type: "boolean", description: "Remove the title" },
            json: JSON_OPTION,
          },
          run({ options, positionals }) {
            if (
              options.clear
                ? positionals.title.length > 0
                : positionals.title.length === 0
            ) {
              throw new PluginCliError(
                "Provide a title or --clear, but not both.",
                { code: "invalid_arguments" },
              );
            }
            const title = promptTitleSchema.parse(
              options.clear ? null : positionals.title.join(" "),
            );
            const result = setTitle(positionals.id, title);
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify(result)
                : title === null
                  ? `Cleared title for ${result.id}`
                  : `Renamed ${result.id} to ${title}`,
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
