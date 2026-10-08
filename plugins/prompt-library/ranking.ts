import type { PromptSnippet } from "./contract.js";

const SNIPPET_LENGTH = 160;
const SNIPPET_LEAD = 32;

export interface RankedMatch<T> {
  item: T;
  positions: readonly number[];
  prefix: boolean;
  score: number;
}

export function compareRank(
  left: RankedMatch<unknown>,
  right: RankedMatch<unknown>,
): number {
  return Number(right.prefix) - Number(left.prefix) || right.score - left.score;
}

function startsWithQuery(text: string, prefix: string): boolean {
  return text
    .trimStart()
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .startsWith(prefix);
}

export function queryTerms(query: string): string[] {
  return query.trim().split(/\s+/u).filter(Boolean);
}

const WORD_START_SCORE = 3;
const SUBSTRING_SCORE = 2;
const ABBREVIATION_SCORE = 1;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const TOKEN = /\S+/gu;

interface TermMatch {
  score: number;
  positions: number[];
}

function foldCase(text: string): string {
  const folded = text.toLowerCase();
  if (folded.length === text.length) return folded;
  return Array.from(text, (char) => {
    const lower = char.toLowerCase();
    return lower.length === char.length ? lower : char;
  }).join("");
}

function isWordStart(token: string, index: number): boolean {
  return index === 0 || !WORD_CHAR.test(token[index - 1]!);
}

function range(start: number, length: number): number[] {
  return Array.from({ length }, (_, index) => start + index);
}

function abbreviationPositions(
  token: string,
  start: number,
  term: string,
): number[] | null {
  const positions = [start];
  let cursor = start + 1;
  for (const char of term.slice(1)) {
    const found = token.indexOf(char, cursor);
    if (found === -1) return null;
    positions.push(found);
    cursor = found + 1;
  }
  return positions;
}

function matchToken(token: string, term: string): TermMatch | null {
  if (token.length < term.length) return null;
  let substring: TermMatch | null = null;
  for (
    let found = token.indexOf(term);
    found !== -1;
    found = token.indexOf(term, found + 1)
  ) {
    const positions = range(found, term.length);
    if (isWordStart(token, found)) {
      return { score: WORD_START_SCORE, positions };
    }
    substring ??= { score: SUBSTRING_SCORE, positions };
  }
  if (substring !== null) return substring;
  for (
    let start = token.indexOf(term[0]!);
    start !== -1;
    start = token.indexOf(term[0]!, start + 1)
  ) {
    if (!isWordStart(token, start)) continue;
    const positions = abbreviationPositions(token, start, term);
    if (positions !== null) return { score: ABBREVIATION_SCORE, positions };
  }
  return null;
}

function matchTerm(folded: string, term: string): TermMatch | null {
  let best: TermMatch | null = null;
  for (const token of folded.matchAll(TOKEN)) {
    const match = matchToken(token[0], term);
    if (match === null || (best !== null && match.score <= best.score)) {
      continue;
    }
    best = {
      score: match.score,
      positions: match.positions.map((position) => token.index + position),
    };
    if (best.score === WORD_START_SCORE) break;
  }
  return best;
}

function matchTerms(text: string, terms: readonly string[]): TermMatch | null {
  const folded = foldCase(text);
  let score = 0;
  const positions = new Set<number>();
  for (const term of terms) {
    const match = matchTerm(folded, term);
    if (match === null) return null;
    score += match.score;
    for (const position of match.positions) positions.add(position);
  }
  return {
    score,
    positions: [...positions].sort((left, right) => left - right),
  };
}

export function rankByQuery<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
): RankedMatch<T>[] {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return items.map((item) => ({
      item,
      positions: [],
      prefix: false,
      score: 0,
    }));
  }
  const foldedTerms = terms.map(foldCase);
  const prefix = foldedTerms.join(" ");
  const ranked: RankedMatch<T>[] = [];
  for (const item of items) {
    const text = getText(item);
    const match = matchTerms(text, foldedTerms);
    if (match === null) continue;
    ranked.push({
      item,
      positions: match.positions,
      prefix: startsWithQuery(text, prefix),
      score: match.score,
    });
  }
  return ranked.sort(compareRank);
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
