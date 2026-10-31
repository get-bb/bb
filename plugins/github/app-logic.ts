import type { PluginRpcResult } from "@get-bb/plugin-sdk/app";
import {
  assemblePullStatus,
  INBOX_COUNT_GROUPS,
  inPullView,
  PULL_GROUPS,
  pullGroup,
  stackChain,
  stackPosition,
  type PullGroup,
  type PullStateTarget,
  type PullStatus,
  type PullView,
} from "./pull-status.js";
import type { githubRpcContract } from "./server.js";

export type Item = PluginRpcResult<
  (typeof githubRpcContract)["listItems"]
>["items"][number];

export type Route =
  | { view: "issues" }
  | { view: "pulls"; tab: PullView }
  | { view: "new" }
  | { view: "issue"; repo: string; number: number }
  | { view: "pull"; repo: string; number: number };

const PULL_TABS: ReadonlySet<string> = new Set(["mine", "all", "merged"]);

export function parseSubPath(subPath: string): Route {
  const parts = subPath.split("/").filter((part) => part.length > 0);
  if (parts[0] === "pulls" && parts.length === 4) {
    const number = Number(parts[3]);
    if (Number.isFinite(number)) {
      return { view: "pull", repo: `${parts[1]}/${parts[2]}`, number };
    }
  }
  if (parts[0] === "pulls") {
    const tab = parts[1];
    return {
      view: "pulls",
      tab:
        tab !== undefined && PULL_TABS.has(tab) ? (tab as PullView) : "inbox",
    };
  }
  if (parts[0] === "new") return { view: "new" };
  if (parts[0] === "issues" && parts.length === 4) {
    const number = Number(parts[3]);
    if (Number.isFinite(number)) {
      return { view: "issue", repo: `${parts[1]}/${parts[2]}`, number };
    }
  }
  if (parts[0] === "issues") return { view: "issues" };
  return { view: "pulls", tab: "inbox" };
}

export function routeToSubPath(route: Route): string {
  switch (route.view) {
    case "issues":
      return "issues";
    case "pulls":
      return route.tab === "inbox" ? "pulls" : `pulls/${route.tab}`;
    case "new":
      return "new";
    case "issue":
      return `issues/${route.repo}/${route.number}`;
    case "pull":
      return `pulls/${route.repo}/${route.number}`;
  }
}

export interface ParsedQuery {
  states: string[];
  flags: string[];
  bases: string[];
  assignees: string[];
  authors: string[];
  labels: string[];
  repos: string[];
  noAssignee: boolean;
  noLabel: boolean;
  text: string[];
}

function tokenizeQuery(query: string): string[] {
  return query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

function unquote(value: string): string {
  return value.replace(/"/g, "");
}

function splitToken(token: string): { key: string; value: string } {
  const idx = token.indexOf(":");
  return idx > 0
    ? {
        key: token.slice(0, idx).toLowerCase(),
        value: unquote(token.slice(idx + 1)),
      }
    : { key: "", value: unquote(token) };
}

const STATE_VALUES: Record<string, string> = {
  open: "OPEN",
  closed: "CLOSED",
  merged: "MERGED",
};

const IS_FLAGS: Record<string, string> = {
  draft: "draft",
  ready: "ready",
  conflict: "conflict",
  conflicts: "conflict",
  failing: "failing",
  snoozed: "snoozed",
};

export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = {
    states: [],
    flags: [],
    bases: [],
    assignees: [],
    authors: [],
    labels: [],
    repos: [],
    noAssignee: false,
    noLabel: false,
    text: [],
  };
  for (const token of tokenizeQuery(query)) {
    const { key, value } = splitToken(token);
    const lower = value.toLowerCase();
    if (key !== "" && value.length === 0) continue;
    if (key === "is" || key === "state") {
      const flag = IS_FLAGS[lower];
      if (flag !== undefined) parsed.flags.push(flag);
      else parsed.states.push(STATE_VALUES[lower] ?? value.toUpperCase());
    } else if (key === "base") {
      parsed.bases.push(lower);
    } else if (key === "assignee") {
      parsed.assignees.push(lower === "me" ? "@me" : lower);
    } else if (key === "author") {
      parsed.authors.push(lower === "me" ? "@me" : lower);
    } else if (key === "label") {
      parsed.labels.push(lower);
    } else if (key === "repo") {
      parsed.repos.push(lower);
    } else if (key === "no") {
      if (lower === "assignee") parsed.noAssignee = true;
      if (lower === "label") parsed.noLabel = true;
    } else {
      parsed.text.push(unquote(token).toLowerCase());
    }
  }
  return parsed;
}

function matchesFlag(item: Item, flag: string): boolean {
  switch (flag) {
    case "draft":
      return item.pr?.state === "draft";
    case "ready":
      return item.pr?.attention === "ready_to_merge";
    case "conflict":
      return item.pr?.mergeability === "conflicts";
    case "failing":
      return item.pr?.checks.state === "failing";
    case "snoozed":
      return item.snooze !== null;
    default:
      return false;
  }
}

export function matchesQuery(
  item: Item,
  query: ParsedQuery,
  viewer: string | null,
): boolean {
  if (query.states.length > 0 && !query.states.includes(item.state)) {
    return false;
  }
  if (!query.flags.every((flag) => matchesFlag(item, flag))) return false;
  if (
    query.bases.length > 0 &&
    !query.bases.includes(item.pr?.baseRefName.toLowerCase() ?? "\u0000")
  ) {
    return false;
  }
  const me = viewer?.toLowerCase() ?? "\u0000";
  const wanted = (logins: string[]) =>
    logins.map((login) => (login === "@me" ? me : login));
  if (query.assignees.length > 0) {
    const logins = wanted(query.assignees);
    if (!item.assignees.some((login) => logins.includes(login.toLowerCase()))) {
      return false;
    }
  }
  if (
    query.authors.length > 0 &&
    !wanted(query.authors).includes(item.author.toLowerCase())
  ) {
    return false;
  }
  if (query.labels.length > 0) {
    const labels = item.labels.map((label) => label.toLowerCase());
    if (!query.labels.some((label) => labels.includes(label))) return false;
  }
  if (
    query.repos.length > 0 &&
    !query.repos.includes(item.repo.toLowerCase())
  ) {
    return false;
  }
  if (query.noAssignee && item.assignees.length > 0) return false;
  if (query.noLabel && item.labels.length > 0) return false;
  if (query.text.length > 0) {
    const haystack =
      `${item.title} #${item.number} ${item.repo} ${item.pr?.headRefName ?? ""}`.toLowerCase();
    if (!query.text.every((term) => haystack.includes(term))) return false;
  }
  return true;
}

export interface QueryChip {
  index: number;
  key: string;
  value: string;
}

const IS_CHIPS: Record<string, [key: string, value: string]> = {
  open: ["Is", "open"],
  closed: ["Is", "closed"],
  merged: ["Is", "merged"],
  draft: ["Is", "a draft"],
  ready: ["Is", "ready to merge"],
  conflict: ["Has", "conflicts"],
  conflicts: ["Has", "conflicts"],
  failing: ["Checks are", "failing"],
  snoozed: ["Is", "snoozed"],
};

const CHIP_KEYS: Record<string, string> = {
  author: "Author is",
  assignee: "Assignee is",
  base: "Base is",
  label: "Label is",
  repo: "Repo is",
  no: "No",
};

export function queryChips(query: string, viewer: string | null): QueryChip[] {
  return tokenizeQuery(query).flatMap((token, index) => {
    const { key, value } = splitToken(token);
    if (key !== "" && value.length === 0) return [];
    const lower = value.toLowerCase();
    if (key === "is" || key === "state") {
      const [chipKey, chipValue] = IS_CHIPS[lower] ?? ["Is", value];
      return [{ index, key: chipKey, value: chipValue }];
    }
    const label = CHIP_KEYS[key];
    if (label === undefined) {
      return [{ index, key: "Contains", value: unquote(token) }];
    }
    const me =
      (key === "author" || key === "assignee") &&
      (lower === "me" || lower === "@me");
    return [{ index, key: label, value: me ? (viewer ?? "you") : value }];
  });
}

export function removeQueryToken(query: string, index: number): string {
  const rest = tokenizeQuery(query).filter((_, at) => at !== index);
  return rest.length === 0 ? "" : `${rest.join(" ")} `;
}

export function addQueryToken(query: string, token: string): string {
  const trimmed = query.trim();
  return `${trimmed.length === 0 ? "" : `${trimmed} `}${token} `;
}

export type SuggestionIcon =
  | { kind: "state"; itemKind: "issue" | "pr"; state: string }
  | { kind: "avatar"; login: string };

export interface Suggestion {
  insert: string;
  label: string;
  hint?: string;
  icon?: SuggestionIcon;
}

export const NAMED_FILTERS: Record<
  "issue" | "pr",
  ReadonlyArray<{ token: string; label: string }>
> = {
  pr: [
    { token: "author:@me", label: "Opened by you" },
    { token: "is:failing", label: "Checks failing" },
    { token: "is:draft", label: "Drafts" },
    { token: "is:snoozed", label: "Snoozed" },
  ],
  issue: [
    { token: "assignee:@me", label: "Assigned to you" },
    { token: "author:@me", label: "Opened by you" },
    { token: "no:assignee", label: "Nobody assigned" },
    { token: "is:closed", label: "Closed" },
  ],
};

const QUALIFIER_KEYS: Array<{
  key: string;
  hint: string;
  kinds: ReadonlyArray<"issue" | "pr">;
}> = [
  { key: "is:", hint: "open, draft, ready, failing…", kinds: ["pr"] },
  { key: "is:", hint: "open, closed", kinds: ["issue"] },
  { key: "author:", hint: "opened by", kinds: ["issue", "pr"] },
  { key: "assignee:", hint: "assigned to", kinds: ["issue", "pr"] },
  { key: "label:", hint: "has the label", kinds: ["issue", "pr"] },
  { key: "base:", hint: "target branch", kinds: ["pr"] },
  { key: "repo:", hint: "in the repository", kinds: ["issue", "pr"] },
  { key: "no:", hint: "assignee, label", kinds: ["issue", "pr"] },
];

const PULL_IS_VALUES = [
  "open",
  "closed",
  "merged",
  "draft",
  "ready",
  "conflict",
  "failing",
  "snoozed",
];

const STATE_ICONS: Record<string, string> = {
  open: "OPEN",
  closed: "CLOSED",
  merged: "MERGED",
  draft: "DRAFT",
};

function quoteValue(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

export function buildSuggestions(
  token: string,
  vocab: {
    users: string[];
    labels: string[];
    repos: string[];
    bases: string[];
  },
  kind: "issue" | "pr",
  viewer: string | null,
): Suggestion[] {
  const idx = token.indexOf(":");
  if (idx <= 0) {
    const prefix = token.toLowerCase();
    return QUALIFIER_KEYS.filter(
      (entry) => entry.kinds.includes(kind) && entry.key.startsWith(prefix),
    ).map((entry) => ({
      insert: entry.key,
      label: entry.key,
      hint: entry.hint,
    }));
  }
  const key = token.slice(0, idx).toLowerCase();
  const partial = unquote(token.slice(idx + 1)).toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(partial);
  const plain = (values: string[]) =>
    values.filter(matches).map((value) => ({
      insert: `${key}:${quoteValue(value)} `,
      label: value,
    }));
  if (key === "is" || key === "state") {
    const states = kind === "pr" ? PULL_IS_VALUES : ["open", "closed"];
    return states.filter(matches).map((state) => {
      const icon = STATE_ICONS[state];
      const [chipKey, chipValue] = IS_CHIPS[state] ?? ["Is", state];
      return {
        insert: `${key}:${state} `,
        label: state,
        hint: `${chipKey.toLowerCase()} ${chipValue}`,
        ...(icon === undefined
          ? {}
          : { icon: { kind: "state" as const, itemKind: kind, state: icon } }),
      };
    });
  }
  if (key === "assignee" || key === "author") {
    return ["@me", ...vocab.users].filter(matches).map((login) => {
      const avatarLogin = login === "@me" ? viewer : login;
      return {
        insert: `${key}:${login} `,
        label: login === "@me" && viewer !== null ? `@me (${viewer})` : login,
        ...(avatarLogin === null
          ? {}
          : { icon: { kind: "avatar" as const, login: avatarLogin } }),
      };
    });
  }
  if (key === "label") return plain(vocab.labels);
  if (key === "repo") return plain(vocab.repos);
  if (kind === "pr" && key === "base") return plain(vocab.bases);
  if (key === "no") {
    return ["assignee", "label"].filter(matches).map((field) => ({
      insert: `no:${field} `,
      label: `no:${field}`,
    }));
  }
  return [];
}

export function splitTitle(title: string): {
  prefix: string | null;
  text: string;
} {
  const match = title.match(/^([a-z]+(?:\([^)]*\))?!?:)\s+(.+)$/);
  return { prefix: match?.[1] ?? null, text: match?.[2] ?? title };
}

export function middleTruncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

export type DiffBlock = "added" | "removed" | "empty";

export function diffSizeBlocks(
  additions: number,
  deletions: number,
): DiffBlock[] {
  const total = additions + deletions;
  const filled =
    total === 0
      ? 0
      : Math.min(5, Math.max(1, Math.ceil(Math.log10(total + 1) * 2)));
  const added = total === 0 ? 0 : Math.round((additions / total) * filled);
  return Array.from({ length: 5 }, (_, index) =>
    index < added ? "added" : index < filled ? "removed" : "empty",
  );
}

export type PullStateName = "OPEN" | "DRAFT" | "CLOSED" | "MERGED";

export interface PullStateAction {
  target: PullStateTarget;
  label: string;
}

export function pullStateActions(pull: {
  state: PullStateName;
  isDraft: boolean;
  viewerCanUpdate: boolean;
  viewerCanClose: boolean;
  viewerCanReopen: boolean;
}): PullStateAction[] {
  const close: PullStateAction[] = pull.viewerCanClose
    ? [{ target: "closed", label: "Close pull request" }]
    : [];
  switch (pull.state) {
    case "OPEN":
      return [
        ...(pull.viewerCanUpdate
          ? [{ target: "draft" as const, label: "Convert to draft" }]
          : []),
        ...close,
      ];
    case "DRAFT":
      return [
        ...(pull.viewerCanUpdate
          ? [{ target: "open" as const, label: "Mark ready" }]
          : []),
        ...close,
      ];
    case "CLOSED":
      return pull.viewerCanReopen
        ? [
            {
              target: pull.isDraft ? "draft" : "open",
              label: "Reopen pull request",
            },
          ]
        : [];
    case "MERGED":
      return [];
  }
}

export function stateNameOf(pr: PullStatus): PullStateName {
  switch (pr.state) {
    case "open":
      return "OPEN";
    case "draft":
      return "DRAFT";
    case "closed":
      return "CLOSED";
    case "merged":
      return "MERGED";
  }
}

export interface PullRowModel {
  key: string;
  item: Item;
  pr: PullStatus;
  group: PullGroup;
  stack: { index: number; size: number } | null;
  chain: number[] | null;
}

export function pullRowModels(
  items: readonly Item[],
  viewer: string | null,
): PullRowModel[] {
  const pulls = items.flatMap((item) =>
    item.pr === null
      ? []
      : [{ repo: item.repo, number: item.number, pr: item.pr, item }],
  );
  return pulls.map((pull) => {
    const chain = stackChain(pull, pulls);
    return {
      key: `${pull.repo}#${pull.number}`,
      item: pull.item,
      pr: pull.pr,
      group: pullGroup(pull.pr, pull.item.author, viewer, {
        snoozed: pull.item.snooze !== null,
      }),
      stack: stackPosition(pull, chain),
      chain: chain?.map((entry) => entry.number) ?? null,
    };
  });
}

export interface PullRowGroup {
  id: PullGroup;
  label: string;
  rows: PullRowModel[];
}

function mergedAtOf(row: PullRowModel): string {
  return row.pr.mergedAt ?? row.item.updatedAt;
}

export function pullViewGroups(
  rows: readonly PullRowModel[],
  view: PullView,
  query: ParsedQuery,
  viewer: string | null,
): PullRowGroup[] {
  const visible = rows.filter(
    (row) =>
      inPullView(
        view,
        { pr: row.pr, author: row.item.author, group: row.group },
        viewer,
      ) && matchesQuery(row.item, query, viewer),
  );
  if (view === "merged") {
    visible.sort((a, b) => mergedAtOf(b).localeCompare(mergedAtOf(a)));
  }
  return PULL_GROUPS.flatMap((group) => {
    const list = visible.filter((row) => row.group === group.id);
    return list.length === 0
      ? []
      : [{ id: group.id, label: group.label, rows: list }];
  });
}

export function inboxRows(
  rows: readonly PullRowModel[],
  viewer: string | null,
): PullRowModel[] {
  return pullViewGroups(rows, "inbox", parseQuery(""), viewer)
    .filter((group) => INBOX_COUNT_GROUPS.has(group.id))
    .flatMap((group) => group.rows);
}

export function inboxCount(
  rows: readonly PullRowModel[],
  viewer: string | null,
): number {
  return inboxRows(rows, viewer).length;
}

export type IssueGroupId = "open" | "closed";

export function issueGroups(
  items: readonly Item[],
  query: ParsedQuery,
  viewer: string | null,
): Array<{ id: IssueGroupId; label: string; rows: Item[] }> {
  const visible = items.filter((item) => matchesQuery(item, query, viewer));
  const open = visible.filter((item) => item.state === "OPEN");
  const closed = visible.filter((item) => item.state !== "OPEN");
  return [
    ...(open.length === 0
      ? []
      : [{ id: "open" as const, label: "Open", rows: open }]),
    ...(closed.length === 0
      ? []
      : [{ id: "closed" as const, label: "Closed", rows: closed }]),
  ];
}

export function parseCollapsed(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? new Set(
          value.filter((entry): entry is string => typeof entry === "string"),
        )
      : new Set();
  } catch {
    return new Set();
  }
}

export interface DetailCheck {
  status: "success" | "failure" | "pending" | "skipped";
}

export interface CheckCounts {
  passed: number;
  failed: number;
  pending: number;
  skipped: number;
}

export function checkCounts(checks: readonly DetailCheck[]): CheckCounts {
  const counts = { passed: 0, failed: 0, pending: 0, skipped: 0 };
  for (const check of checks) {
    if (check.status === "success") counts.passed += 1;
    else if (check.status === "failure") counts.failed += 1;
    else if (check.status === "pending") counts.pending += 1;
    else counts.skipped += 1;
  }
  return counts;
}

export interface DetailStatusInput {
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergedAt: string | null;
  mergeable: string;
  reviewDecision: string;
  isInMergeQueue: boolean;
  reviewRequests: string[];
  checksVerdict: string | null;
  checks: readonly DetailCheck[];
  stack: {
    number: number;
    position: number;
    entries: readonly unknown[];
  } | null;
}

const DETAIL_CHECK_STATES = {
  success: "SUCCESS",
  failure: "FAILURE",
  pending: "IN_PROGRESS",
  skipped: "SKIPPED",
} as const;

export function detailPullStatus(pull: DetailStatusInput): PullStatus {
  const counts = new Map<string, number>();
  for (const check of pull.checks) {
    const state = DETAIL_CHECK_STATES[check.status];
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return assemblePullStatus({
    state:
      pull.state === "MERGED"
        ? "MERGED"
        : pull.state === "CLOSED"
          ? "CLOSED"
          : "OPEN",
    isDraft: pull.isDraft || pull.state === "DRAFT",
    baseRefName: pull.baseRefName,
    headRefName: pull.headRefName,
    headRefOid: pull.headRefOid.length > 0 ? pull.headRefOid : null,
    isCrossRepository: pull.isCrossRepository,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changedFiles,
    mergedAt: pull.mergedAt,
    mergeable: pull.mergeable,
    reviewDecision: pull.reviewDecision.length > 0 ? pull.reviewDecision : null,
    isInMergeQueue: pull.isInMergeQueue,
    requestedReviewers: pull.reviewRequests,
    checkRunCounts: [...counts].map(([state, count]) => ({ state, count })),
    statusContextCounts: [],
    checksVerdict: pull.checksVerdict,
    stack:
      pull.stack === null
        ? null
        : {
            number: pull.stack.number,
            size: pull.stack.entries.length,
            position: pull.stack.position,
          },
    headOwner: null,
  });
}

export type PullEventKind =
  | "ready"
  | "draft"
  | "closed"
  | "reopened"
  | "merged"
  | "force_pushed"
  | "commit"
  | "base_changed"
  | "head_deleted";

export interface PullEventInput {
  kind: PullEventKind;
  actor: string;
  createdAt: string;
  detail: string | null;
}

export interface PullEventEntry extends PullEventInput {
  count: number;
}

export function openedAsDraft(
  events: readonly PullEventInput[],
  isDraft: boolean,
): boolean {
  const first = [...events]
    .filter((event) => event.kind === "ready" || event.kind === "draft")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (first === undefined) return isDraft;
  return first.kind === "ready";
}

export function groupPullEvents(
  events: readonly PullEventInput[],
): PullEventEntry[] {
  const sorted = [...events].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const merged = sorted.find((event) => event.kind === "merged");
  const grouped: PullEventEntry[] = [];
  for (const event of sorted) {
    if (
      event.kind === "closed" &&
      merged !== undefined &&
      merged.createdAt === event.createdAt
    ) {
      continue;
    }
    const last = grouped.at(-1);
    if (
      event.kind === "commit" &&
      last?.kind === "commit" &&
      last.actor === event.actor
    ) {
      last.count += 1;
      last.createdAt = event.createdAt;
      continue;
    }
    grouped.push({ ...event, count: 1 });
  }
  return grouped;
}

export function pullEventText(event: PullEventEntry): string {
  switch (event.kind) {
    case "ready":
      return "marked this pull request as ready for review";
    case "draft":
      return "marked this pull request as draft";
    case "closed":
      return "closed this pull request";
    case "reopened":
      return "reopened this pull request";
    case "merged":
      return "merged this pull request";
    case "force_pushed":
      return `force-pushed${event.detail === null ? "" : ` ${event.detail}`}`;
    case "commit":
      return event.count > 1
        ? `pushed ${event.count} commits`
        : `pushed ${event.detail ?? "a commit"}`;
    case "base_changed":
      return `changed the base${event.detail === null ? "" : ` ${event.detail}`}`;
    case "head_deleted":
      return "deleted the branch";
  }
}

export function linearLinkback(
  body: string,
): { key: string; title: string; url: string } | null {
  if (!body.includes("linear-linkback")) return null;
  const match = body.match(
    /<a href="([^"]+)">\s*([A-Z][A-Z0-9]+-\d+)\s+([^<]*)<\/a>/,
  );
  if (match === null) return null;
  return {
    url: match[1] ?? "",
    key: match[2] ?? "",
    title: (match[3] ?? "").trim(),
  };
}
