import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { MARKETPLACE_OVERVIEW_MAX_CHARS } from "@bb/domain";

export const LISTING_TOPIC = "bb-plugin";
export const LISTING_KEYWORD = "bb-plugin";
export const LISTING_MAX_TAGS = 10;
export const LISTING_TAG_MAX_LENGTH = 32;
export const LISTING_MAX_SECONDARY_CATEGORIES = 3;
export const LISTING_MAX_SCREENSHOTS = 6;
export const LISTING_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const LISTING_SCREENSHOT_MIN_WIDTH = 1200;
export const LISTING_ICON_MAX_BYTES = 256 * 1024;
export const LISTING_OVERVIEW_MAX_BYTES = MARKETPLACE_OVERVIEW_MAX_CHARS * 4;

const OPT_IN_KEYWORDS: ReadonlySet<string> = new Set([
  "bb-plugin",
  "bb",
  "bb-plugins",
]);
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BB_ICON_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/u;
const BB_MARKETPLACE_KEYS: ReadonlySet<string> = new Set([
  "category",
  "secondaryCategories",
  "screenshots",
]);

export interface ListingTags {
  tags: string[];
  dropped: string[];
}

export function keywordsToTags(keywords: readonly unknown[]): ListingTags {
  const tags: string[] = [];
  const dropped: string[] = [];
  for (const keyword of keywords) {
    if (typeof keyword !== "string") {
      dropped.push(String(keyword));
      continue;
    }
    const tag = keyword.toLowerCase();
    if (OPT_IN_KEYWORDS.has(tag)) continue;
    if (tag.length > LISTING_TAG_MAX_LENGTH || !TAG_PATTERN.test(tag)) {
      dropped.push(keyword);
      continue;
    }
    if (tags.includes(tag)) continue;
    if (tags.length >= LISTING_MAX_TAGS) {
      dropped.push(keyword);
      continue;
    }
    tags.push(tag);
  }
  return { tags, dropped };
}

export type ListingIcon =
  | { kind: "name"; name: string }
  | { kind: "file"; path: string };

export function classifyListingIcon(icon: string): ListingIcon | null {
  if (BB_ICON_NAME_PATTERN.test(icon)) return { kind: "name", name: icon };
  if (/^\.\/[^\s]+\.(?:svg|png|webp)$/iu.test(icon)) {
    return { kind: "file", path: icon };
  }
  return null;
}

export type ListingProblemCode =
  | "invalid-manifest"
  | "missing-category"
  | "unknown-category"
  | "invalid-screenshot";

export interface ListingProblem {
  severity: "error" | "warning";
  code: ListingProblemCode;
  message: string;
}

export interface BbMarketplaceFields {
  category: string | null;
  secondaryCategories: string[];
  screenshots: string[];
  problems: ListingProblem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter(
    (item): item is string => typeof item === "string",
  );
  return strings.length === value.length ? strings : null;
}

function categoryList(categoryIds: ReadonlySet<string>): string {
  return [...categoryIds].sort().join(", ");
}

export function parseBbMarketplace(
  value: unknown,
  categoryIds: ReadonlySet<string>,
): BbMarketplaceFields {
  const problems: ListingProblem[] = [];
  const empty = {
    category: null,
    secondaryCategories: [],
    screenshots: [],
  };
  if (value === undefined) {
    return {
      ...empty,
      problems: [
        {
          severity: "warning",
          code: "missing-category",
          message: `package.json has no "bbMarketplace" object, so the plugin is listed without a category (or keeps the category of the entry it replaces). Add "bbMarketplace": { "category": "<id>" } with one of: ${categoryList(categoryIds)}.`,
        },
      ],
    };
  }
  if (!isRecord(value)) {
    return {
      ...empty,
      problems: [
        {
          severity: "error",
          code: "invalid-manifest",
          message: `"bbMarketplace" must be an object.`,
        },
      ],
    };
  }
  for (const key of Object.keys(value)) {
    if (!BB_MARKETPLACE_KEYS.has(key)) {
      problems.push({
        severity: "error",
        code: "invalid-manifest",
        message: `"bbMarketplace.${key}" is not a known field. The fields are category, secondaryCategories, and screenshots.`,
      });
    }
  }

  let category: string | null = null;
  const rawCategory = value.category;
  if (
    rawCategory === undefined ||
    (typeof rawCategory === "string" && rawCategory.trim().length === 0)
  ) {
    problems.push({
      severity: "warning",
      code: "missing-category",
      message: `"bbMarketplace.category" is not set, so the plugin is listed without a category (or keeps the category of the entry it replaces). Set it to one of: ${categoryList(categoryIds)}.`,
    });
  } else if (typeof rawCategory !== "string") {
    problems.push({
      severity: "error",
      code: "invalid-manifest",
      message: `"bbMarketplace.category" must be a string.`,
    });
  } else if (!categoryIds.has(rawCategory)) {
    problems.push({
      severity: "error",
      code: "unknown-category",
      message: `"bbMarketplace.category" is "${rawCategory}", which is not a marketplace category. Use one of: ${categoryList(categoryIds)}.`,
    });
  } else {
    category = rawCategory;
  }

  const secondaryCategories: string[] = [];
  if (value.secondaryCategories !== undefined) {
    const raw = stringArray(value.secondaryCategories);
    if (raw === null) {
      problems.push({
        severity: "error",
        code: "invalid-manifest",
        message: `"bbMarketplace.secondaryCategories" must be an array of category ids.`,
      });
    } else {
      if (raw.length > LISTING_MAX_SECONDARY_CATEGORIES) {
        problems.push({
          severity: "error",
          code: "invalid-manifest",
          message: `"bbMarketplace.secondaryCategories" has ${raw.length} ids. The maximum is ${LISTING_MAX_SECONDARY_CATEGORIES}.`,
        });
      }
      for (const id of raw) {
        if (!categoryIds.has(id)) {
          problems.push({
            severity: "error",
            code: "unknown-category",
            message: `"bbMarketplace.secondaryCategories" has "${id}", which is not a marketplace category.`,
          });
        } else if (id === rawCategory) {
          problems.push({
            severity: "error",
            code: "invalid-manifest",
            message: `"bbMarketplace.secondaryCategories" repeats the main category "${id}".`,
          });
        } else if (secondaryCategories.includes(id)) {
          problems.push({
            severity: "error",
            code: "invalid-manifest",
            message: `"bbMarketplace.secondaryCategories" lists "${id}" twice.`,
          });
        } else {
          secondaryCategories.push(id);
        }
      }
    }
  }

  let screenshots: string[] = [];
  if (value.screenshots !== undefined) {
    const raw = stringArray(value.screenshots);
    if (raw === null) {
      problems.push({
        severity: "error",
        code: "invalid-screenshot",
        message: `"bbMarketplace.screenshots" must be an array of relative paths.`,
      });
    } else {
      if (raw.length > LISTING_MAX_SCREENSHOTS) {
        problems.push({
          severity: "error",
          code: "invalid-screenshot",
          message: `"bbMarketplace.screenshots" has ${raw.length} paths. The maximum is ${LISTING_MAX_SCREENSHOTS}.`,
        });
      }
      screenshots = raw;
    }
  }

  return { category, secondaryCategories, screenshots, problems };
}

export type ImageFormat = "png" | "jpeg" | "webp";

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 24 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    buffer.toString("ascii", 12, 16) === "IHDR"
  );
}

const JPEG_START_OF_FRAME_MARKERS: ReadonlySet<number> = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegWidth(buffer: Buffer): number | undefined {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[2] !== 0xff
  ) {
    return undefined;
  }
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset] ?? 0;
    const markerStart = offset - 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 1;
      continue;
    }
    if (markerStart + 4 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(markerStart + 2);
    if (segmentLength < 2 || markerStart + 2 + segmentLength > buffer.length) {
      break;
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker) && segmentLength >= 7) {
      return buffer.readUInt16BE(markerStart + 7);
    }
    offset = markerStart + 2 + segmentLength;
  }
  return undefined;
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return (
    (buffer[offset] ?? 0) |
    ((buffer[offset + 1] ?? 0) << 8) |
    ((buffer[offset + 2] ?? 0) << 16)
  );
}

function webpWidth(buffer: Buffer): number | undefined {
  if (
    buffer.length < 21 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return undefined;
  }
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return readUInt24LE(buffer, 24) + 1;
  }
  if (
    chunk === "VP8 " &&
    buffer.length >= 30 &&
    buffer[23] === 0x9d &&
    buffer[24] === 0x01 &&
    buffer[25] === 0x2a
  ) {
    return buffer.readUInt16LE(26) & 0x3fff;
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    return 1 + (buffer[21] ?? 0) + (((buffer[22] ?? 0) & 0x3f) << 8);
  }
  return undefined;
}

export function inspectImage(
  buffer: Buffer,
): { format: ImageFormat; width: number } | undefined {
  if (isPng(buffer)) return { format: "png", width: buffer.readUInt32BE(16) };
  const jpeg = jpegWidth(buffer);
  if (jpeg !== undefined) return { format: "jpeg", width: jpeg };
  const webp = webpWidth(buffer);
  if (webp !== undefined) return { format: "webp", width: webp };
  return undefined;
}

export function imageFormatForPath(path: string): ImageFormat | null {
  const extension = path.toLowerCase().split(".").at(-1);
  if (extension === "png") return "png";
  if (extension === "jpg" || extension === "jpeg") return "jpeg";
  if (extension === "webp") return "webp";
  return null;
}

export function screenshotDataProblems(path: string, data: Buffer): string[] {
  const problems: string[] = [];
  if (data.length > LISTING_SCREENSHOT_MAX_BYTES) {
    problems.push(`${path} is larger than 2 MiB.`);
  }
  const expected = imageFormatForPath(path);
  const image = inspectImage(data);
  if (image === undefined) {
    problems.push(`${path} is not a PNG, JPEG, or WebP image.`);
    return problems;
  }
  if (expected !== image.format) {
    problems.push(
      `${path} holds ${image.format.toUpperCase()} data, which does not match its extension.`,
    );
  }
  if (image.width < LISTING_SCREENSHOT_MIN_WIDTH) {
    problems.push(
      `${path} is ${image.width} px wide. The minimum is ${LISTING_SCREENSHOT_MIN_WIDTH} px.`,
    );
  }
  return problems;
}

const OVERVIEW_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const OVERVIEW_NODE_TYPES: ReadonlySet<string> = new Set([
  "root",
  "paragraph",
  "heading",
  "text",
  "emphasis",
  "strong",
  "delete",
  "inlineCode",
  "code",
  "blockquote",
  "list",
  "listItem",
  "thematicBreak",
  "break",
  "link",
  "linkReference",
  "definition",
]);
const OVERVIEW_NODE_LABELS: Readonly<Record<string, string>> = {
  html: "raw HTML",
  image: "an image",
  imageReference: "an image",
  table: "a table",
  footnoteDefinition: "a footnote",
  footnoteReference: "a footnote",
};

interface MarkdownNode {
  type: string;
  url?: string;
  checked?: boolean | null;
  position?: { start: { line: number } };
  children?: MarkdownNode[];
}

export function normalizeOverviewText(text: string): string {
  return `${text
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/^\n+/u, "")
    .replace(/\n+$/u, "")}\n`;
}

function overviewLinkProblem(url: string | undefined): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    return `The link "${url ?? ""}" must be an absolute https URL.`;
  }
  if (parsed.protocol !== "https:") return `The link "${url}" must use https.`;
  return undefined;
}

function walkMarkdown(
  node: MarkdownNode,
  visit: (node: MarkdownNode) => boolean,
): void {
  if (!visit(node)) return;
  for (const child of node.children ?? []) walkMarkdown(child, visit);
}

export function overviewMarkdownProblems(text: string): string[] {
  if (text.trim().length === 0) return ["PLUGIN_OVERVIEW.md is empty."];
  const problems = new Set<string>();
  const length = [...text.replace(/\n$/u, "")].length;
  if (length > MARKETPLACE_OVERVIEW_MAX_CHARS) {
    problems.add(
      `PLUGIN_OVERVIEW.md has ${length} characters. The maximum is ${MARKETPLACE_OVERVIEW_MAX_CHARS}.`,
    );
  }
  if (OVERVIEW_CONTROL_CHARACTER_PATTERN.test(text)) {
    problems.add("PLUGIN_OVERVIEW.md has a control character.");
  }
  const tree: MarkdownNode = fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  walkMarkdown(tree, (node) => {
    const line = node.position?.start.line ?? 0;
    if (!OVERVIEW_NODE_TYPES.has(node.type)) {
      const label =
        OVERVIEW_NODE_LABELS[node.type] ??
        `an unsupported "${node.type}" element`;
      problems.add(`PLUGIN_OVERVIEW.md uses ${label} at line ${line}.`);
      return false;
    }
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      problems.add(`PLUGIN_OVERVIEW.md uses a task list at line ${line}.`);
    }
    if (node.type === "link" || node.type === "definition") {
      const problem = overviewLinkProblem(node.url);
      if (problem !== undefined) {
        problems.add(`PLUGIN_OVERVIEW.md: ${problem} Line ${line}.`);
      }
    }
    return true;
  });
  return [...problems];
}

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export interface ReleaseTag {
  tag: string;
  version: string;
}

export function releaseTagVersion(
  tag: string,
  prefix: string,
  form: "release" | "bare" = "release",
): string | null {
  const head = form === "release" ? `${prefix}v` : prefix;
  if (!tag.startsWith(head)) return null;
  const rest = tag.slice(head.length);
  const match = STABLE_VERSION_PATTERN.exec(rest);
  if (match === null) return null;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function releaseTags(
  tags: readonly string[],
  prefix: string,
  form: "release" | "bare" = "release",
): ReleaseTag[] {
  return tags
    .flatMap((tag) => {
      const version = releaseTagVersion(tag, prefix, form);
      return version === null ? [] : [{ tag, version }];
    })
    .sort((left, right) => compareVersions(right.version, left.version));
}

export interface GitHubRepository {
  owner: string;
  repo: string;
}

export function parseGitHubRemote(url: string): GitHubRepository | null {
  const trimmed = url.trim();
  const patterns = [
    /^(?:git\+)?https:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/iu,
    /^(?:git\+)?ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/iu,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/iu,
    /^git:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/iu,
    /^github:([^/]+)\/([^/]+?)$/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { owner: match[1], repo: match[2] };
    }
  }
  return null;
}

export function normalizeGitHubSourceUrl(url: string): string | null {
  const repository = parseGitHubRemote(url);
  if (repository === null) return null;
  return `https://github.com/${repository.owner}/${repository.repo}.git`.toLowerCase();
}
