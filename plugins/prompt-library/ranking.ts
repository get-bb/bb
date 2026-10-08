import type { PromptSnippet } from "./contract.js";

const SNIPPET_LENGTH = 160;
const SNIPPET_LEAD = 32;
const WORD = /[\p{L}\p{N}]+/gu;
const OPENING_LENGTH = 200;
const TYPO_MIN_LENGTH = 4;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const RECENCY_HALF_LIFE_MS = 7 * 86_400_000;

type MatchKind = "exact" | "prefix" | "typo" | "substring" | "abbreviation";

const MATCH_WEIGHTS: Record<MatchKind, number> = {
  exact: 1,
  prefix: 0.7,
  typo: 0.5,
  substring: 0.4,
  abbreviation: 0.3,
};

export interface SearchDocument<T> {
  item: T;
  text: string;
  time: number;
}

export interface SearchMatch<T> {
  item: T;
  prefix: boolean;
  quality: number;
  score: number;
  time: number;
}

interface TermMatch {
  weight: number;
  frequency: number;
}

interface IndexedDocument<T> {
  item: T;
  text: string;
  time: number;
  length: number;
}

interface AnalyzedText {
  length: number;
  counts: Map<string, number>;
}

function foldCase(text: string): string {
  const folded = text.toLowerCase();
  if (folded.length === text.length) return folded;
  return Array.from(text, (char) => {
    const lower = char.toLowerCase();
    return lower.length === char.length ? lower : char;
  }).join("");
}

function normalizeOpening(text: string): string {
  return foldCase(text.trimStart().slice(0, OPENING_LENGTH)).replace(
    /\s+/gu,
    " ",
  );
}

function isSpace(char: string): boolean {
  return /\s/u.test(char);
}

function startsWithOpening(text: string, opening: string): boolean {
  let position = 0;
  while (position < text.length && isSpace(text[position]!)) position += 1;
  for (let index = 0; index < opening.length; index += 1) {
    const char = text[position];
    if (char === undefined) return false;
    if (isSpace(char)) {
      if (opening[index] !== " ") return false;
      while (position < text.length && isSpace(text[position]!)) position += 1;
      continue;
    }
    const lower = char.toLowerCase();
    if ((lower.length === 1 ? lower : char) !== opening[index]) return false;
    position += 1;
  }
  return true;
}

export function queryTerms(query: string): string[] {
  return [...new Set(foldCase(query).match(WORD) ?? [])];
}

function analyze(text: string): AnalyzedText {
  const counts = new Map<string, number>();
  let length = 0;
  for (const [word] of foldCase(text).matchAll(WORD)) {
    length += 1;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return { length, counts };
}

function abbreviationPositions(word: string, term: string): number[] | null {
  if (word[0] !== term[0]) return null;
  const positions = [0];
  for (const char of term.slice(1)) {
    const found = word.indexOf(char, positions.at(-1)! + 1);
    if (found === -1) return null;
    positions.push(found);
  }
  return positions;
}

function withinOneEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  let same = 0;
  while (
    same < left.length &&
    same < right.length &&
    left[same] === right[same]
  ) {
    same += 1;
  }
  if (left.length !== right.length) {
    const [shorter, longer] =
      left.length < right.length ? [left, right] : [right, left];
    return shorter.slice(same) === longer.slice(same + 1);
  }
  return (
    left.slice(same + 1) === right.slice(same + 1) ||
    (left[same] === right[same + 1] &&
      left[same + 1] === right[same] &&
      left.slice(same + 2) === right.slice(same + 2))
  );
}

function matchKind(word: string, term: string): MatchKind | null {
  if (word === term) return "exact";
  if (word.startsWith(term)) return "prefix";
  if (term.length >= TYPO_MIN_LENGTH && withinOneEdit(word, term)) {
    return "typo";
  }
  if (word.includes(term)) return "substring";
  if (term.length >= 2 && abbreviationPositions(word, term) !== null) {
    return "abbreviation";
  }
  return null;
}

function bestTermMatch(
  counts: ReadonlyMap<string, number>,
  term: string,
): TermMatch | null {
  let best: TermMatch | null = null;
  for (const [word, count] of counts) {
    const kind = matchKind(word, term);
    if (kind === null) continue;
    const weight = MATCH_WEIGHTS[kind];
    if (best === null || weight > best.weight) {
      best = { weight, frequency: count };
    } else if (weight === best.weight) {
      best.frequency += count;
    }
  }
  return best;
}

export function compareMatches(
  left: SearchMatch<unknown>,
  right: SearchMatch<unknown>,
): number {
  return (
    Number(right.prefix) - Number(left.prefix) ||
    right.quality - left.quality ||
    right.score - left.score ||
    right.time - left.time
  );
}

export function createSearchIndex<T>() {
  const documents: IndexedDocument<T>[] = [];
  const postings = new Map<string, number[]>();
  let totalLength = 0;

  function termMatches(term: string): Map<number, TermMatch> {
    const matches = new Map<number, TermMatch>();
    for (const [word, list] of postings) {
      if (word.length < term.length - 1) continue;
      const kind = matchKind(word, term);
      if (kind === null) continue;
      const weight = MATCH_WEIGHTS[kind];
      for (let offset = 0; offset < list.length; offset += 2) {
        const document = list[offset]!;
        const count = list[offset + 1]!;
        const existing = matches.get(document);
        if (existing === undefined || weight > existing.weight) {
          matches.set(document, { weight, frequency: count });
        } else if (weight === existing.weight) {
          existing.frequency += count;
        }
      }
    }
    return matches;
  }

  return {
    add(document: SearchDocument<T>): void {
      const { length, counts } = analyze(document.text);
      const index = documents.length;
      for (const [word, count] of counts) {
        const list = postings.get(word);
        if (list === undefined) postings.set([...word].join(""), [index, count]);
        else list.push(index, count);
      }
      totalLength += length;
      documents.push({
        item: document.item,
        text: document.text,
        time: document.time,
        length,
      });
    },

    search(
      query: string,
      extras: readonly SearchDocument<T>[],
      now: number,
    ): SearchMatch<T>[] {
      const terms = queryTerms(query);
      if (terms.length === 0) return [];
      const opening = normalizeOpening(query);
      const indexed = terms.map(termMatches);
      const analyzedExtras = extras.map((extra) => {
        const analyzed = analyze(extra.text);
        return {
          extra,
          analyzed,
          matches: terms.map((term) => bestTermMatch(analyzed.counts, term)),
        };
      });
      const count = documents.length + extras.length;
      const averageLength =
        (totalLength +
          analyzedExtras.reduce((sum, entry) => sum + entry.analyzed.length, 0)) /
        Math.max(1, count);
      const inverseFrequency = terms.map((_, termIndex) => {
        const frequency =
          indexed[termIndex]!.size +
          analyzedExtras.filter((entry) => entry.matches[termIndex] !== null)
            .length;
        return Math.log(1 + (count - frequency + 0.5) / (frequency + 0.5));
      });

      function scored(
        item: T,
        time: number,
        text: string,
        length: number,
        matches: readonly TermMatch[],
      ): SearchMatch<T> {
        const norm =
          BM25_K1 * (1 - BM25_B + (BM25_B * length) / averageLength);
        let quality = 0;
        let relevance = 0;
        matches.forEach(({ weight, frequency }, termIndex) => {
          quality += weight;
          relevance +=
            weight *
            inverseFrequency[termIndex]! *
            ((frequency * (BM25_K1 + 1)) / (frequency + norm));
        });
        const age = Math.max(0, now - time);
        return {
          item,
          prefix: startsWithOpening(text, opening),
          quality,
          score: relevance * 0.5 ** (age / RECENCY_HALF_LIFE_MS),
          time,
        };
      }

      const results: SearchMatch<T>[] = [];
      const narrowest = indexed.reduce((left, right) =>
        right.size < left.size ? right : left,
      );
      for (const index of narrowest.keys()) {
        const matches = indexed.map((termMatch) => termMatch.get(index));
        if (matches.some((match) => match === undefined)) continue;
        const document = documents[index]!;
        results.push(
          scored(
            document.item,
            document.time,
            document.text,
            document.length,
            matches as TermMatch[],
          ),
        );
      }
      for (const { extra, analyzed, matches } of analyzedExtras) {
        if (matches.some((match) => match === null)) continue;
        results.push(
          scored(
            extra.item,
            extra.time,
            extra.text,
            analyzed.length,
            matches as TermMatch[],
          ),
        );
      }
      return results.sort(compareMatches);
    },
  };
}

function wordPositions(word: string, term: string, kind: MatchKind): number[] {
  const range = (start: number, length: number) =>
    Array.from({ length }, (_, offset) => start + offset);
  if (kind === "exact" || kind === "prefix") return range(0, term.length);
  if (kind === "substring") return range(word.indexOf(term), term.length);
  if (kind === "abbreviation") return abbreviationPositions(word, term)!;
  return range(0, word.length);
}

export function matchPositions(text: string, query: string): number[] {
  const words = [...foldCase(text).matchAll(WORD)];
  const positions = new Set<number>();
  for (const term of queryTerms(query)) {
    let best: { start: number; word: string; kind: MatchKind } | null = null;
    for (const { 0: word, index: start } of words) {
      const kind = matchKind(word, term);
      if (
        kind !== null &&
        (best === null || MATCH_WEIGHTS[kind] > MATCH_WEIGHTS[best.kind])
      ) {
        best = { start, word, kind };
        if (kind === "exact") break;
      }
    }
    if (best === null) continue;
    for (const position of wordPositions(best.word, term, best.kind)) {
      positions.add(best.start + position);
    }
  }
  return [...positions].sort((left, right) => left - right);
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
