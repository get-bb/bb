import {
  DOCS_SEARCH_INDEX_FILE,
  docsSearchIndexSchema,
} from "@bb/domain/docs-search-index";
import type { SkillSummary } from "@bb/server-contract";
import type { SkillsArea } from "./skills.js";

export const DEFAULT_GUIDE_SEARCH_LIMIT = 10;
export const MAX_GUIDE_SEARCH_LIMIT = 50;
export const MAX_GUIDE_SEARCH_QUERY_LENGTH = 500;
export const DEFAULT_GUIDE_SEARCH_DOCS_TIMEOUT_MS = 5_000;

const MAX_SKILL_CONTENT_CHARS = 256 * 1024;
const MAX_DOCS_INDEX_BYTES = 32 * 1024 * 1024;
const SKILL_CONTENT_CONCURRENCY = 8;
const SNIPPET_LENGTH = 200;

export type GuideSearchSource = "docs" | "guide" | "skill";

export interface GuideSearchDocument {
  source: GuideSearchSource;
  title: string;
  section: string | null;
  location: string;
  text: string;
}

export interface GuideSearchResult {
  source: GuideSearchSource;
  title: string;
  section: string | null;
  location: string;
  snippet: string;
}

export interface GuideSearchDocsStatus {
  url: string;
  ok: boolean;
  error: string | null;
}

export interface GuideSearchSkillsStatus {
  ok: boolean;
  error: string | null;
}

export interface GuideSearchResponse {
  query: string;
  results: GuideSearchResult[];
  docs: GuideSearchDocsStatus;
  skills: GuideSearchSkillsStatus;
}

export type GuideSkillSource = Pick<SkillsArea, "list" | "getContent">;

export interface GuideChapterText {
  chapter: string | null;
  content: string;
}

export interface GuideSearchQuery {
  query: string;
  limit: number;
}

const STOPWORDS = new Set(
  "a an and are as at be bb by can do does for from how i if in into is it its me my of on or so that the their them then there these this to use using via was what when where which who why will with you your".split(
    " ",
  ),
);

export function tokenizeGuideSearchText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stemToken);
}

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies"))
    return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (
    token.length > 3 &&
    token.endsWith("es") &&
    /(?:ch|sh|x|ss)es$/u.test(token)
  ) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

export function parseGuideSearchQuery(input: {
  query: string;
  limit?: number;
}): GuideSearchQuery {
  const query = input.query.trim().replace(/\s+/gu, " ");
  if (query.length === 0) {
    throw new Error("Search query must not be empty.");
  }
  if (query.length > MAX_GUIDE_SEARCH_QUERY_LENGTH) {
    throw new Error(
      `Search query must be at most ${MAX_GUIDE_SEARCH_QUERY_LENGTH} characters.`,
    );
  }
  if (tokenizeGuideSearchText(query).length === 0) {
    throw new Error(
      `Search query '${query}' has no searchable words; name the feature or command you are asking about.`,
    );
  }
  const limit = input.limit ?? DEFAULT_GUIDE_SEARCH_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_GUIDE_SEARCH_LIMIT
  ) {
    throw new Error(
      `Search limit must be an integer from 1 to ${MAX_GUIDE_SEARCH_LIMIT}.`,
    );
  }
  return { query, limit };
}

function humanizeChapter(chapter: string): string {
  const words = chapter.replace(/-/gu, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function isPlainHeading(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (line.length === 0 || line.length > 60 || /^\s/u.test(line)) return false;
  if (/^[`\-*|>#]/u.test(line) || /[.:,;]$/u.test(line)) return false;
  const previous = lines[index - 1];
  const next = lines[index + 1];
  return (
    (previous === undefined || previous.trim().length === 0) &&
    next !== undefined &&
    (next.trim().length === 0 || /^\s/u.test(next))
  );
}

interface TextSection {
  heading: string | null;
  text: string;
}

function splitPlainSections(content: string): TextSection[] {
  const lines = content.split("\n");
  const sections: TextSection[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  const flush = () => {
    const text = body.join("\n").trim();
    if (text.length > 0 || heading !== null) sections.push({ heading, text });
  };
  lines.forEach((line, index) => {
    if (isPlainHeading(lines, index)) {
      flush();
      heading = line.trim();
      body = [];
      return;
    }
    body.push(line);
  });
  flush();
  return sections;
}

function splitMarkdownSections(content: string): TextSection[] {
  const sections: TextSection[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  let fenced = false;
  const flush = () => {
    const text = body.join("\n").trim();
    if (text.length > 0 || heading !== null) sections.push({ heading, text });
  };
  for (const line of content.split("\n")) {
    if (/^\s*(?:```|~~~)/u.test(line)) fenced = !fenced;
    const match = fenced ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (match?.[1] !== undefined) {
      flush();
      heading = match[1];
      body = [];
      continue;
    }
    body.push(line);
  }
  flush();
  return sections;
}

export function guideChapterDocuments(
  chapters: readonly GuideChapterText[],
): GuideSearchDocument[] {
  return chapters.flatMap(({ chapter, content }) => {
    const title = chapter === null ? "Overview" : humanizeChapter(chapter);
    const location = chapter === null ? "bb guide" : `bb guide ${chapter}`;
    return splitPlainSections(content).map((section) => ({
      source: "guide" as const,
      title,
      section: section.heading,
      location,
      text: section.text,
    }));
  });
}

function skillBody(raw: string): string {
  const lines = raw.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") return raw;
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  return end === -1 ? raw : lines.slice(end + 1).join("\n");
}

export function skillDocuments(
  skill: Pick<SkillSummary, "name" | "description" | "filePath">,
  content: string | null,
): GuideSearchDocument[] {
  const sections =
    content === null
      ? []
      : splitMarkdownSections(
          skillBody(content.slice(0, MAX_SKILL_CONTENT_CHARS)),
        );
  const documents: GuideSearchDocument[] = sections.map((section) => ({
    source: "skill",
    title: skill.name,
    section: section.heading,
    location: skill.filePath,
    text: section.text,
  }));
  documents.unshift({
    source: "skill",
    title: skill.name,
    section: null,
    location: skill.filePath,
    text: skill.description ?? "",
  });
  return documents;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export interface LoadSkillDocumentsResult {
  documents: GuideSearchDocument[];
  status: GuideSearchSkillsStatus;
}

export async function loadSkillDocuments(args: {
  skills: GuideSkillSource | null;
  projectId: string;
  environmentId: string | null;
}): Promise<LoadSkillDocumentsResult> {
  if (args.skills === null) {
    return {
      documents: [],
      status: { ok: false, error: "no bb server configured" },
    };
  }
  const skills = args.skills;
  const workspace = {
    projectId: args.projectId,
    environmentId: args.environmentId,
  };
  let listed: SkillSummary[];
  try {
    listed = (await skills.list(workspace)).skills;
  } catch (error) {
    return {
      documents: [],
      status: { ok: false, error: errorMessage(error) },
    };
  }
  const documents = await mapWithConcurrency(
    listed,
    SKILL_CONTENT_CONCURRENCY,
    async (skill) => {
      const content = await skills
        .getContent({ ...workspace, skillId: skill.id, path: "SKILL.md" })
        .then((response) => response.content)
        .catch(() => null);
      return skillDocuments(skill, content);
    },
  );
  return { documents: documents.flat(), status: { ok: true, error: null } };
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  return cause instanceof Error && cause.message.length > 0
    ? `${error.message}: ${cause.message}`
    : error.message;
}

export function docsIndexDocuments(
  index: unknown,
  docsBaseUrl: string,
): GuideSearchDocument[] {
  const parsed = docsSearchIndexSchema.parse(index);
  const origin = new URL(docsBaseUrl);
  return parsed.pages.flatMap((page) => {
    const hasIntro = page.sections.some((section) => section.heading === null);
    const sections = hasIntro
      ? page.sections
      : [{ heading: null, anchor: null, text: "" }, ...page.sections];
    return sections.map((section) => ({
      source: "docs" as const,
      title: page.title,
      section: section.heading,
      location: new URL(
        section.anchor === null ? page.url : `${page.url}#${section.anchor}`,
        origin,
      ).toString(),
      text:
        section.heading === null
          ? [page.description, section.text]
              .filter((part) => part.length > 0)
              .join("\n")
          : section.text,
    }));
  });
}

export function docsSearchIndexUrl(docsBaseUrl: string): string {
  return `${docsBaseUrl.replace(/\/+$/u, "")}/${DOCS_SEARCH_INDEX_FILE}`;
}

export type GuideSearchIndexFetcher = (
  url: string,
  timeoutMs: number,
) => Promise<unknown>;

async function readCappedText(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("search index is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export const fetchGuideSearchIndex: GuideSearchIndexFetcher = async (
  url,
  timeoutMs,
) => {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "accept-encoding": "gzip" },
      redirect: "manual",
      signal,
    });
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    if (response.body === null) throw new Error("search index is empty");
    const text = await readCappedText(response.body, MAX_DOCS_INDEX_BYTES);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("search index is not JSON");
    }
  } catch (error) {
    if (signal.aborted) throw new Error(`timed out after ${timeoutMs} ms`);
    throw new Error(errorMessage(error));
  }
};

export interface FetchDocsDocumentsResult {
  documents: GuideSearchDocument[];
  status: GuideSearchDocsStatus;
}

export async function fetchDocsDocuments(args: {
  docsBaseUrl: string;
  timeoutMs: number;
  fetchIndex: GuideSearchIndexFetcher;
}): Promise<FetchDocsDocumentsResult> {
  const url = docsSearchIndexUrl(args.docsBaseUrl);
  const failed = (error: string): FetchDocsDocumentsResult => ({
    documents: [],
    status: { url, ok: false, error },
  });
  let body: unknown;
  try {
    body = await args.fetchIndex(url, args.timeoutMs);
  } catch (error) {
    return failed(errorMessage(error));
  }
  try {
    return {
      documents: docsIndexDocuments(body, args.docsBaseUrl),
      status: { url, ok: true, error: null },
    };
  } catch {
    return failed("unrecognized search index format");
  }
}

const FIELD_WEIGHTS = { title: 3, section: 2, text: 1 } as const;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const HEADING_MATCH_BONUS = 1.5;
const SOURCE_ORDER: Record<GuideSearchSource, number> = {
  docs: 0,
  guide: 1,
  skill: 2,
};

interface IndexedDocument {
  document: GuideSearchDocument;
  termWeights: Map<string, number>;
  headingTerms: Set<string>;
  length: number;
}

function indexDocument(document: GuideSearchDocument): IndexedDocument {
  const termWeights = new Map<string, number>();
  let length = 0;
  const add = (text: string, weight: number) => {
    for (const token of tokenizeGuideSearchText(text)) {
      termWeights.set(token, (termWeights.get(token) ?? 0) + weight);
      length += weight;
    }
  };
  add(document.title, FIELD_WEIGHTS.title);
  add(document.section ?? "", FIELD_WEIGHTS.section);
  add(document.text, FIELD_WEIGHTS.text);
  const headingTerms = new Set(
    tokenizeGuideSearchText(`${document.title} ${document.section ?? ""}`),
  );
  return { document, termWeights, headingTerms, length };
}

function snippetFor(text: string, terms: ReadonlySet<string>): string {
  const lines = text
    .split(/\n+/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line.length > 0);
  let best = lines[0] ?? "";
  let bestHits = -1;
  for (const line of lines) {
    const hits = new Set(
      tokenizeGuideSearchText(line).filter((token) => terms.has(token)),
    ).size;
    if (hits > bestHits) {
      best = line;
      bestHits = hits;
    }
  }
  return best.length > SNIPPET_LENGTH
    ? `${best.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…`
    : best;
}

export function rankGuideSearchDocuments(
  query: string,
  documents: readonly GuideSearchDocument[],
  limit: number,
): GuideSearchResult[] {
  const terms = [...new Set(tokenizeGuideSearchText(query))];
  if (terms.length === 0 || documents.length === 0) return [];
  const indexed = documents.map(indexDocument);
  const averageLength =
    indexed.reduce((total, entry) => total + entry.length, 0) /
      indexed.length || 1;
  const documentFrequency = new Map<string, number>(
    terms.map((term) => [
      term,
      indexed.filter((entry) => entry.termWeights.has(term)).length,
    ]),
  );
  const scored = indexed.flatMap((entry, position) => {
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      const frequency = entry.termWeights.get(term);
      if (frequency === undefined) continue;
      matched += 1;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (indexed.length - df + 0.5) / (df + 0.5));
      if (entry.headingTerms.has(term)) score += idf * HEADING_MATCH_BONUS;
      score +=
        (idf * frequency * (BM25_K1 + 1)) /
        (frequency +
          BM25_K1 * (1 - BM25_B + (BM25_B * entry.length) / averageLength));
    }
    if (matched === 0) return [];
    const coverage = matched / terms.length;
    return [{ entry, position, score: score * coverage * coverage }];
  });
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      SOURCE_ORDER[left.entry.document.source] -
        SOURCE_ORDER[right.entry.document.source] ||
      left.position - right.position,
  );
  const termSet = new Set(terms);
  return scored.slice(0, limit).map(({ entry: { document } }) => ({
    source: document.source,
    title: document.title,
    section: document.section,
    location: document.location,
    snippet: snippetFor(document.text, termSet),
  }));
}
