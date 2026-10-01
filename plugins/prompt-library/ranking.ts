import { Fzf } from "fzf";
import type { PromptSnippet } from "./contract.js";

const SNIPPET_LENGTH = 160;
const SNIPPET_LEAD = 32;

export interface RankedMatch<T> {
  item: T;
  positions: readonly number[];
}

export function queryTerms(query: string): string[] {
  return query.trim().split(/\s+/u).filter(Boolean);
}

const PRECISE_SCORING_POOL_LIMIT = 1000;

interface IndexedItem<T> {
  item: T;
  index: number;
}

interface TermMatches {
  score: number;
  positions: Set<number>;
}

function matchTerms<T>(
  pool: readonly IndexedItem<T>[],
  terms: readonly string[],
  getText: (item: T) => string,
  fuzzy: "v1" | "v2",
): { pool: IndexedItem<T>[]; matches: Map<number, TermMatches> } {
  let remaining = [...pool];
  const matches = new Map<number, TermMatches>();
  for (const term of terms) {
    const found = new Fzf(remaining, {
      selector: (entry) => getText(entry.item),
      casing: "smart-case",
      sort: false,
      fuzzy,
    }).find(term);
    remaining = found.map((match) => match.item);
    for (const match of found) {
      const existing = matches.get(match.item.index) ?? {
        score: 0,
        positions: new Set<number>(),
      };
      existing.score += match.score;
      for (const position of match.positions) existing.positions.add(position);
      matches.set(match.item.index, existing);
    }
  }
  return { pool: remaining, matches };
}

export function rankByQuery<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
): RankedMatch<T>[] {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return items.map((item) => ({ item, positions: [] }));
  }
  const indexed = items.map((item, index) => ({ item, index }));
  let result = matchTerms(indexed, terms, getText, "v1");
  if (result.pool.length <= PRECISE_SCORING_POOL_LIMIT) {
    result = matchTerms(result.pool, terms, getText, "v2");
  }
  const { matches } = result;
  return result.pool
    .map((entry) => ({ entry, match: matches.get(entry.index)! }))
    .sort(
      (left, right) =>
        right.match.score - left.match.score ||
        left.entry.index - right.entry.index,
    )
    .map(({ entry, match }) => ({
      item: entry.item,
      positions: [...match.positions].sort((left, right) => left - right),
    }));
}

export function buildSnippet(
  text: string,
  positions: readonly number[],
): PromptSnippet {
  const firstPosition = positions[0] ?? 0;
  const start =
    firstPosition < SNIPPET_LENGTH - SNIPPET_LEAD
      ? 0
      : firstPosition - SNIPPET_LEAD;
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const body = text.slice(start, end).replace(/\s/gu, " ");
  const highlights: [number, number][] = [];
  for (const position of positions) {
    if (position < start || position >= end) continue;
    const offset = position - start + prefix.length;
    const last = highlights.at(-1);
    if (last !== undefined && last[1] === offset) {
      last[1] = offset + 1;
    } else {
      highlights.push([offset, offset + 1]);
    }
  }
  return { text: `${prefix}${body}${suffix}`, highlights };
}
