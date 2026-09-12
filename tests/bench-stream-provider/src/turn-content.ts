import {
  type DeltaItemShape,
  type DeltaPresentation,
  type ThreadDelta,
  experimental_REASONING_PRESENTATION as REASONING_PRESENTATION,
  experimental_fileReadPresentation as fileReadPresentation,
  experimental_searchPresentation as searchPresentation,
  experimental_webSearchPresentation as webSearchPresentation,
} from "@get-bb/plugin-sdk/provider-bridge";
import { FIXTURE_NAMES, getFixture } from "./fixtures/index.js";
import {
  agentMessageClose,
  agentMessageOpen,
  commandPresentation,
  fileChangePresentation,
  mcpToolPresentation,
  taskUpdatePresentation,
} from "./presentation.js";

const HISTORY_FIXTURE_NAMES = FIXTURE_NAMES.filter(
  (name) => name !== "pathological",
);

export const HISTORY_LIMITS = {
  reasoningDeltas: { min: 3, max: 6 },
  reasoningChars: { min: 400, max: 900 },
  toolResultBytes: { min: 1_000, max: 4_096 },
  commandLines: { min: 20, max: 120 },
  diffHunks: { min: 2, max: 4 },
  messageChars: { min: 2_000, max: 16_000 },
  messageDeltas: { min: 8, max: 40 },
  messageNotifications: { min: 1, max: 4 },
} as const;

interface Random {
  int(min: number, max: number): number;
  pick<T>(values: readonly T[]): T;
  shuffle<T>(values: readonly T[]): T[];
}

const RANDOM_STREAMS = {
  reasoning: 1,
  activities: 2,
  message: 3,
  messageSplit: 4,
} as const;

function createRandom(seed: number, stream: number): Random {
  let state =
    ((seed % 0x1_0000_0000) ^
      Math.imul(Math.floor(seed / 0x1_0000_0000), 0x9e3779b9) ^
      Math.imul(stream, 0x85ebca6b)) >>>
    0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  const int = (min: number, max: number): number =>
    min + Math.floor(next() * (max - min + 1));
  return {
    int,
    pick: (values) => values[int(0, values.length - 1)],
    shuffle: (values) => {
      const copy = [...values];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = int(0, index);
        [copy[index], copy[swap]] = [copy[swap], copy[index]];
      }
      return copy;
    },
  };
}

function splitText(text: string, parts: number, random: Random): string[] {
  const count = Math.max(1, Math.min(parts, text.length));
  const base = text.length / count;
  const pieces: string[] = [];
  let start = 0;
  for (let index = 1; index < count; index += 1) {
    const jitter = Math.floor(base * 0.3);
    let cut = Math.round(base * index) + random.int(-jitter, jitter);
    cut = Math.max(start + 1, Math.min(cut, text.length - (count - index)));
    pieces.push(text.slice(start, cut));
    start = cut;
  }
  pieces.push(text.slice(start));
  return pieces;
}

function groupContiguous<T>(values: readonly T[], groups: number): T[][] {
  const count = Math.max(1, Math.min(groups, values.length));
  const size = Math.ceil(values.length / count);
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size));
  }
  return result;
}

interface ResultLimits {
  maxBytes: number;
  targetBytes: number;
}

function fillJsonArray(
  limits: ResultLimits,
  entry: (index: number) => Record<string, string | number | boolean | null>,
): string {
  const entries: ReturnType<typeof entry>[] = [];
  let text = "[]";
  for (
    let index = 0;
    Buffer.byteLength(text) < limits.targetBytes;
    index += 1
  ) {
    const next = JSON.stringify([...entries, entry(index)], null, 2);
    if (Buffer.byteLength(next) > limits.maxBytes) {
      break;
    }
    entries.push(entry(index));
    text = next;
  }
  return text;
}

function fillLines(
  limits: ResultLimits,
  args: {
    header: readonly string[];
    footer: readonly string[];
    line: (index: number) => string;
  },
): string {
  const lineBytes = (line: string): number => Buffer.byteLength(line) + 1;
  const footerBytes = args.footer.reduce(
    (total, line) => total + lineBytes(line),
    0,
  );
  const lines = [...args.header];
  let bytes = lines.reduce((total, line) => total + lineBytes(line), 0);
  for (let index = 0; bytes + footerBytes < limits.targetBytes; index += 1) {
    const next = args.line(index);
    if (bytes + lineBytes(next) + footerBytes > limits.maxBytes) {
      break;
    }
    lines.push(next);
    bytes += lineBytes(next);
  }
  return [...lines, ...args.footer].join("\n");
}

const REASONING_SENTENCES = [
  "The user wants the regression explained, so I should start from the measurements rather than from the code.",
  "Before touching anything I need to know which module owns this behavior and who else calls it.",
  "The test output mentions a timeout, which could be the fixture being slow rather than the code under test.",
  "I should check whether this path is covered by an existing test before I change it.",
  "Reading the store first will tell me whether the selector returns a new array on every call.",
  "If the index is missing, the query plan will show a full scan, and that would explain the latency on large threads.",
  "The diff should stay small, so I will change the scheduler and leave the public API alone.",
  "There are two plausible causes here, and the logs should tell them apart without guessing.",
  "Let me look at the route handler to see whether it loads every event before slicing the page.",
  "A quick search for the helper name will show whether other packages depend on the old behavior.",
  "The migration has to be reversible, so I need to confirm the down step restores the previous schema.",
  "I will run the focused test file first, then the package suite once the change looks right.",
  "The numbers in the summary need to match the command output exactly, so I will copy them from the run.",
  "It is worth checking the task list so the follow-up items do not get lost after this change.",
  "The simplest fix is to memoize the formatter, but I want to confirm it is actually hot in the profile.",
  "I should explain the tradeoff clearly, since caching would add an invalidation problem we do not have today.",
  "The error only appears under load, which points at contention rather than at a logic bug.",
  "After the edit I will rerun the type checker to make sure the new signature did not break any caller.",
];

const TS_LINES = [
  'import { createHash } from "node:crypto";',
  'import type { RetryJob } from "./types.js";',
  "",
  "const BASE_DELAY_MS = 2_000;",
  "const MAX_DELAY_MS = 15 * 60_000;",
  "",
  "export interface RetryQueueOptions {",
  "  now: () => number;",
  "  maxInFlightPerHost: number;",
  "  onDue: (jobs: RetryJob[]) => void;",
  "}",
  "",
  "export class RetryQueue {",
  "  private heap: HeapEntry[] = [];",
  "  private nextSeq = 0;",
  "  private timer: NodeJS.Timeout | null = null;",
  "",
  "  constructor(private readonly options: RetryQueueOptions) {}",
  "",
  "  schedule(job: RetryJob): void {",
  "    const entry = { at: job.nextAttemptAt, seq: this.nextSeq++, job };",
  "    this.heap.push(entry);",
  "    this.siftUp(this.heap.length - 1);",
  "    this.wake();",
  "  }",
  "",
  "  private wake(): void {",
  "    if (this.timer !== null) {",
  "      clearTimeout(this.timer);",
  "    }",
  "    const next = this.heap[0];",
  "    if (next === undefined) {",
  "      return;",
  "    }",
  "    const delay = Math.max(0, next.at - this.options.now());",
  "    this.timer = setTimeout(() => this.drain(), delay);",
  "  }",
  "",
  "  private drain(): void {",
  "    const due = this.takeDue(this.options.now());",
  "    if (due.length > 0) {",
  "      this.options.onDue(due);",
  "    }",
  "    this.wake();",
  "  }",
  "}",
];

const TSX_LINES = [
  'import { createContext, useContext, type ReactNode } from "react";',
  'import { useCart } from "../../stores/cart.js";',
  'import { useShippingEstimate } from "../../queries/shipping.js";',
  "",
  "const CartContext = createContext<Cart | null>(null);",
  "const EstimateContext = createContext<ShippingEstimate | null>(null);",
  "",
  "export function CheckoutProvider({ children }: { children: ReactNode }) {",
  "  const cart = useCart();",
  "  const estimate = useShippingEstimate(cart.address);",
  "  return (",
  "    <CartContext.Provider value={cart}>",
  "      <EstimateContext.Provider value={estimate}>{children}</EstimateContext.Provider>",
  "    </CartContext.Provider>",
  "  );",
  "}",
  "",
  "export function CartSummary() {",
  "  const cart = useCartContext();",
  "  const estimate = useEstimateContext();",
  "  const formatter = currencyFormatter(cart.locale, cart.currency);",
  "  return (",
  '    <section className="flex flex-col gap-2">',
  '      <Row label="Subtotal" value={formatter.format(cart.subtotalCents / 100)} />',
  '      <Row label="Shipping" value={formatter.format(estimate.totalCents / 100)} />',
  '      <Row label="Total" value={formatter.format(cart.totalCents / 100)} strong />',
  "    </section>",
  "  );",
  "}",
];

const SOURCE_FILES = [
  { path: "packages/webhooks/src/retry-queue.ts", lines: TS_LINES },
  { path: "packages/webhooks/src/delivery-worker.ts", lines: TS_LINES },
  { path: "apps/api/src/session/store.ts", lines: TS_LINES },
  { path: "apps/web/src/routes/checkout/CheckoutPage.tsx", lines: TSX_LINES },
  { path: "apps/web/src/routes/checkout/CartSummary.tsx", lines: TSX_LINES },
] as const;

const SEARCH_PATTERNS = [
  "schedule(",
  "useCheckout",
  "nextAttemptAt",
  "sessionKey",
  "Intl.NumberFormat",
];

const SEARCH_SCOPES = [
  "packages/webhooks/src",
  "apps/api/src",
  "apps/web/src/routes/checkout",
  "packages",
];

const GLOB_PATTERNS = [
  "**/*.test.ts",
  "packages/webhooks/src/**/*.ts",
  "apps/web/src/routes/checkout/**/*.tsx",
  "**/drizzle/*.sql",
];

const ISSUE_STATES = ["Todo", "In Progress", "In Review", "Backlog", "Done"];

const PEOPLE = ["maya", "devon", "priya", "sam", "lena", "omar"];

const MCP_TOOLS = [
  { server: "linear", tool: "list_issues" },
  { server: "github", tool: "list_pull_requests" },
] as const;

const WEB_RESULTS = [
  {
    title: "Binary heap - priority queue implementation notes",
    url: "https://en.wikipedia.org/wiki/Binary_heap",
    snippet:
      "A binary heap is a heap data structure that takes the form of a binary tree. Insertion and removal of the minimum element both run in logarithmic time.",
  },
  {
    title: "Exponential backoff and jitter",
    url: "https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/",
    snippet:
      "Adding jitter to exponential backoff spreads retries out over time and avoids synchronized retry storms when many clients fail at the same moment.",
  },
  {
    title: "useSyncExternalStore - React reference",
    url: "https://react.dev/reference/react/useSyncExternalStore",
    snippet:
      "useSyncExternalStore lets a component subscribe to an external store. The snapshot function must return the same value until the store changes.",
  },
  {
    title: "Context - splitting values to avoid re-renders",
    url: "https://react.dev/reference/react/useContext#optimizing-re-renders-when-passing-objects-and-functions",
    snippet:
      "When a context value is a new object on every render, every consumer re-renders. Split the context or memoize the value to limit the update scope.",
  },
  {
    title: "Intl.NumberFormat constructor cost",
    url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat",
    snippet:
      "Creating an Intl.NumberFormat object is relatively expensive. Reuse formatter instances when formatting many numbers with the same locale and options.",
  },
  {
    title: "SELECT ... FOR UPDATE SKIP LOCKED",
    url: "https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE",
    snippet:
      "With SKIP LOCKED, any selected rows that cannot be immediately locked are skipped, which makes the clause useful for queue-like tables with many workers.",
  },
  {
    title: "Partial indexes",
    url: "https://www.postgresql.org/docs/current/indexes-partial.html",
    snippet:
      "A partial index is built over a subset of a table. It can make queries over the subset faster and keeps the index smaller than a full index.",
  },
  {
    title: "k6 thresholds and percentiles",
    url: "https://grafana.com/docs/k6/latest/using-k6/thresholds/",
    snippet:
      "Thresholds define pass or fail criteria for a load test, for example requiring that the 95th percentile of request duration stays below a limit.",
  },
  {
    title: "Problem Details for HTTP APIs",
    url: "https://www.rfc-editor.org/rfc/rfc9457",
    snippet:
      "This document defines a problem detail as a way to carry machine-readable details of errors in HTTP response content.",
  },
  {
    title: "Keyset pagination instead of offsets",
    url: "https://use-the-index-luke.com/no-offset",
    snippet:
      "Offset pagination gets slower the further you page and can skip or repeat rows when data changes. Keyset pagination uses the last seen key instead.",
  },
  {
    title: "Node.js timers and the event loop",
    url: "https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick",
    snippet:
      "Timers specify a threshold after which a callback may be executed rather than an exact time. Long synchronous work delays every pending timer.",
  },
  {
    title: "Zod safeParse and error formatting",
    url: "https://zod.dev/basics#handling-errors",
    snippet:
      "safeParse returns a discriminated result instead of throwing. The issues array describes every validation failure with a path and a message.",
  },
  {
    title: "SQLite query planner overview",
    url: "https://www.sqlite.org/optoverview.html",
    snippet:
      "The query planner chooses between full table scans and index lookups. EXPLAIN QUERY PLAN shows which index, if any, a statement will use.",
  },
  {
    title: "Measuring long animation frames",
    url: "https://developer.chrome.com/docs/web-platform/long-animation-frames",
    snippet:
      "The Long Animation Frames API reports frames that took longer than 50 milliseconds to render, with attribution for the scripts that ran during them.",
  },
];

const TASK_SUBJECTS = [
  "Reproduce the slow checkout confirm request locally",
  "Profile the retry scheduler under a 40k job burst",
  "Replace the sorted array with a binary heap",
  "Add stable ordering tests for equal timestamps",
  "Fix the jitter clamp so delays never exceed the maximum",
  "Remove the double JSON parse in the session store",
  "Update admin tooling callers of the removed helper",
  "Split the checkout context into cart and estimate contexts",
  "Cache Intl.NumberFormat instances per locale and currency",
  "Run the k6 checkout scenario against the branch",
  "Compare CPU profiles before and after the change",
  "Check the claim query plan for the retry worker",
  "Write the rollout plan and monitoring checklist",
  "Draft the pull request description",
  "Add a property test for heap interleavings",
  "Investigate dropping delivered webhook partitions",
  "Pause the shipping estimate poll in background tabs",
  "Switch cart tax math to a decimal type",
  "Review the deprecation of useCheckout",
  "Confirm no out-of-tree scripts use isValidSessionJson",
  "Add the slow receiver scenario to the load test",
  "Show deploy markers on the delivery dashboard",
  "Lower the webhook lag alert threshold",
  "Rewrite the delivery lag runbook",
];

const TASK_NOTES = [
  "Blocked on nothing; the fixture data is already seeded.",
  "Needs a second reviewer from the platform team.",
  "Numbers should come from the same machine as the baseline.",
  "Keep the change behind the existing feature flag.",
  "Covered by the new unit tests in the webhooks package.",
  "Follow up separately so the main change stays small.",
];

const TEST_NAMES = [
  "RetryQueue > keeps insertion order for equal timestamps",
  "RetryQueue > drains due jobs in timestamp order",
  "RetryQueue > does not return a job rescheduled during a drain",
  "RetryQueue > wakes when an earlier job is scheduled",
  "backoff > never exceeds maxDelayMs",
  "backoff > applies jitter to the clamped value",
  "SessionStore > returns null for a missing session",
  "SessionStore > deletes a session that fails validation",
  "SessionStore > parses the session exactly once",
  "currencyFormatter > reuses formatters per locale and currency",
  "CheckoutProvider > estimate refresh does not re-render line items",
  "CartSummary > renders subtotal, shipping and total",
];

const COMMIT_SUBJECTS = [
  "Replace retry queue array with a binary heap",
  "Keep insertion order for equal retry timestamps",
  "Clamp backoff before applying jitter",
  "Parse session JSON once at the boundary",
  "Split checkout context into cart and estimate",
  "Cache currency formatters per locale",
  "Add k6 checkout confirm scenario",
  "Document retry backoff policy",
  "Fix flaky delivery worker shutdown test",
  "Bump zod to 4.3.6",
  "Show delivery lag on the webhooks dashboard",
  "Add partial index for pending deliveries",
  "Remove unused isValidSessionJson helper",
  "Log caller user agent on deprecated endpoints",
  "Pause estimate polling while the tab is hidden",
];

const DIRECTORY_FILES = [
  "retry-queue.ts",
  "retry-queue.test.ts",
  "delivery-worker.ts",
  "delivery-worker.test.ts",
  "backoff.ts",
  "backoff.test.ts",
  "types.ts",
  "outbox.ts",
  "outbox.test.ts",
  "partner-limits.ts",
  "metrics.ts",
  "index.ts",
];

const REMOVED_LINES = [
  "    this.pending.sort(byNextAttempt);",
  "    return this.pending.shift()!;",
  "  const jitter = 1 + (random() * 0.4 - 0.2);",
  "  return Math.round(base * jitter);",
  "    if (!isValidSessionJson(raw)) {",
  "    return sessionSchema.parse(JSON.parse(raw));",
  "    <CheckoutContext.Provider value={{ cart, estimate }}>",
  "  const formatter = new Intl.NumberFormat(line.locale, {",
];

const ADDED_LINES = [
  "    this.siftUp(this.heap.length - 1);",
  "    return this.pop().job;",
  "  const spread = Math.max(MIN_JITTER_MS, base * 0.2);",
  "  return Math.round(base + (random() * 2 - 1) * spread);",
  "    const parsed = parseSessionJson(raw);",
  "    if (parsed === null) {",
  "    return parsed;",
  "    <CartContext.Provider value={cart}>",
  "  const formatter = currencyFormatter(line.locale, line.currency);",
  "    this.inFlightByHost.set(job.host, (this.inFlightByHost.get(job.host) ?? 0) + 1);",
];

type Activity =
  | {
      kind: "item";
      item: DeltaItemShape;
      presentation: DeltaPresentation;
      resultText: string | null;
    }
  | {
      kind: "command";
      command: string;
      output: string;
      durationMs: number;
    };

type ActivityKind = "tool" | "command" | "fileChange";

const GENERIC_TOOL_KINDS = [
  "read",
  "read",
  "grep",
  "glob",
  "edit",
  "webSearch",
  "mcp",
  "taskUpdate",
] as const;

function numberedLines(
  lines: readonly string[],
  startLine: number,
  index: number,
): string {
  const line = lines[(startLine - 1 + index) % lines.length];
  return `${String(startLine + index).padStart(6)}\t${line}`;
}

function isoMinute(index: number): string {
  const day = String(4 + (index % 20)).padStart(2, "0");
  const minute = String((index * 13) % 60).padStart(2, "0");
  return `2026-03-${day}T14:${minute}:00.000Z`;
}

function buildMcpResult(
  random: Random,
  limits: ResultLimits,
  mcp: (typeof MCP_TOOLS)[number],
): { args: Record<string, string | number>; resultText: string } {
  const offset = random.int(0, TASK_SUBJECTS.length - 1);
  if (mcp.server === "linear") {
    return {
      args: {
        team: "Platform",
        query: random.pick(SEARCH_PATTERNS),
        limit: 25,
      },
      resultText: fillJsonArray(limits, (index) => {
        const number = 380 + ((offset + index) % 90);
        return {
          identifier: `PLAT-${number}`,
          title: TASK_SUBJECTS[(offset + index) % TASK_SUBJECTS.length],
          state: ISSUE_STATES[(offset + index) % ISSUE_STATES.length],
          assignee: PEOPLE[(offset + index * 5) % PEOPLE.length],
          priority: 1 + ((offset + index) % 4),
          url: `https://linear.app/acme/issue/PLAT-${number}`,
          updatedAt: isoMinute(offset + index),
        };
      }),
    };
  }
  return {
    args: { owner: "acme", repo: "storefront", state: "open", per_page: 30 },
    resultText: fillJsonArray(limits, (index) => {
      const number = 2100 + ((offset + index) % 400);
      return {
        number,
        title: COMMIT_SUBJECTS[(offset + index) % COMMIT_SUBJECTS.length],
        user: PEOPLE[(offset + index * 3) % PEOPLE.length],
        head: `fix/${number}`,
        draft: (offset + index) % 5 === 0,
        html_url: `https://github.com/acme/storefront/pull/${number}`,
        updated_at: isoMinute(offset + index),
      };
    }),
  };
}

function buildGenericTool(random: Random, cwd: string): Activity {
  const limits: ResultLimits = {
    maxBytes: HISTORY_LIMITS.toolResultBytes.max,
    targetBytes: random.int(1_100, 3_900),
  };
  const file = random.pick(SOURCE_FILES);
  const filePath = `${cwd}/${file.path}`;
  switch (random.pick(GENERIC_TOOL_KINDS)) {
    case "read":
      return {
        kind: "item",
        item: { type: "fileRead", path: filePath },
        presentation: fileReadPresentation(filePath),
        resultText: null,
      };
    case "grep": {
      const query = random.pick(SEARCH_PATTERNS);
      return {
        kind: "item",
        item: {
          type: "search",
          mode: "content",
          query,
          path: `${cwd}/${random.pick(SEARCH_SCOPES)}`,
        },
        presentation: searchPresentation({ mode: "content", query }),
        resultText: null,
      };
    }
    case "glob": {
      const query = random.pick(GLOB_PATTERNS);
      return {
        kind: "item",
        item: { type: "search", mode: "path", query, path: cwd },
        presentation: searchPresentation({ mode: "path", query }),
        resultText: null,
      };
    }
    case "webSearch": {
      const lead = random.pick(WEB_RESULTS);
      const query = `${lead.title} best practices`;
      const offset = random.int(0, WEB_RESULTS.length - 1);
      return {
        kind: "item",
        item: { type: "webSearch", queries: [query] },
        presentation: webSearchPresentation(query),
        resultText: fillLines(limits, {
          header: [`Web search results for query: "${query}"`, ""],
          footer: [],
          line: (index) => {
            const result = WEB_RESULTS[(offset + index) % WEB_RESULTS.length];
            return `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}\n`;
          },
        }),
      };
    }
    case "edit": {
      const at = random.int(1, file.lines.length - 2);
      const before = file.lines[at - 1];
      const after = file.lines[at + 1];
      const added = random.shuffle(ADDED_LINES).slice(0, random.int(1, 3));
      return {
        kind: "item",
        item: {
          type: "fileChange",
          changes: [
            {
              path: filePath,
              kind: "update",
              oldText: [before, random.pick(REMOVED_LINES), after].join("\n"),
              newText: [before, ...added, after].join("\n"),
            },
          ],
        },
        presentation: fileChangePresentation(filePath),
        resultText: fillLines(limits, {
          header: [
            `The file ${filePath} has been updated. Here's the result of running \`cat -n\` on a snippet of the edited file:`,
          ],
          footer: [],
          line: (index) => {
            const addedIndex = index - 1;
            return addedIndex >= 0 && addedIndex < added.length
              ? `${String(at + index).padStart(6)}\t${added[addedIndex]}`
              : numberedLines(file.lines, at, index);
          },
        }),
      };
    }
    case "mcp": {
      const mcp = random.pick(MCP_TOOLS);
      const { args, resultText } = buildMcpResult(random, limits, mcp);
      return {
        kind: "item",
        item: { type: "tool", tool: mcp.tool, server: mcp.server, args },
        presentation: mcpToolPresentation(mcp),
        resultText,
      };
    }
    case "taskUpdate": {
      const taskId = random.int(1, 12);
      const subject = TASK_SUBJECTS[(taskId - 1) % TASK_SUBJECTS.length];
      return {
        kind: "item",
        item: {
          type: "tool",
          tool: "TaskUpdate",
          args: { taskId: String(taskId), status: "in_progress", subject },
        },
        presentation: taskUpdatePresentation(subject),
        resultText: fillLines(limits, {
          header: [
            `Updated task #${taskId} status to in_progress.`,
            "",
            "Current tasks:",
          ],
          footer: ["", "Use TaskUpdate to change a task status."],
          line: (index) => {
            const id = index + 1;
            const status =
              id < taskId
                ? "completed"
                : id === taskId
                  ? "in_progress"
                  : "pending";
            return `#${id} [${status}] ${TASK_SUBJECTS[index % TASK_SUBJECTS.length]}\n    ${TASK_NOTES[index % TASK_NOTES.length]}`;
          },
        }),
      };
    }
  }
}

function hexHash(random: Random, length: number): string {
  let hash = "";
  while (hash.length < length) {
    hash += random.int(0, 15).toString(16);
  }
  return hash;
}

function buildCommand(random: Random): Extract<Activity, { kind: "command" }> {
  const lineCount = random.int(
    HISTORY_LIMITS.commandLines.min,
    HISTORY_LIMITS.commandLines.max,
  );
  const durationMs = random.int(300, 9_000);
  const bodyLines = (count: number, line: (index: number) => string) =>
    Array.from({ length: count }, (_, index) => line(index));
  switch (random.int(0, 4)) {
    case 0: {
      const testCount = lineCount - 8;
      const lines = [
        " RUN  v4.1.1 /workspace/acme",
        "",
        ...bodyLines(
          testCount,
          (index) =>
            ` ✓ packages/webhooks/src/retry-queue.test.ts > ${TEST_NAMES[index % TEST_NAMES.length]} ${1 + ((index * 7) % 23)}ms`,
        ),
        "",
        ` Test Files  1 passed (1)`,
        `      Tests  ${testCount} passed (${testCount})`,
        "   Start at  14:02:11",
        `   Duration  ${(durationMs / 1_000).toFixed(2)}s (transform 120ms, setup 0ms, collect 310ms, tests 212ms, environment 0ms, prepare 88ms)`,
        "",
      ];
      return {
        kind: "command",
        command:
          "pnpm exec vitest run packages/webhooks/src/retry-queue.test.ts",
        output: `${lines.join("\n")}\n`,
        durationMs,
      };
    }
    case 1: {
      const lines = bodyLines(
        lineCount,
        (index) =>
          `${hexHash(random, 9)} ${COMMIT_SUBJECTS[index % COMMIT_SUBJECTS.length]}`,
      );
      return {
        kind: "command",
        command: `git log --oneline -n ${lineCount}`,
        output: `${lines.join("\n")}\n`,
        durationMs,
      };
    }
    case 2: {
      const pattern = random.pick(SEARCH_PATTERNS);
      const lines = bodyLines(lineCount, (index) => {
        const source = SOURCE_FILES[(index * 3) % SOURCE_FILES.length];
        const lineNumber = 1 + ((index * 11) % source.lines.length);
        return `${source.path}:${lineNumber}:${source.lines[lineNumber - 1]}`;
      });
      return {
        kind: "command",
        command: `rg -n ${JSON.stringify(pattern)} apps packages`,
        output: `${lines.join("\n")}\n`,
        durationMs,
      };
    }
    case 3: {
      const lines = [
        `total ${lineCount * 8}`,
        ...bodyLines(lineCount - 1, (index) => {
          const name = DIRECTORY_FILES[index % DIRECTORY_FILES.length];
          const round = Math.floor(index / DIRECTORY_FILES.length);
          const size = 400 + ((index * 977) % 9_000);
          return `-rw-r--r--  1 dev  staff  ${String(size).padStart(5)} Mar  4 14:${String(10 + (index % 50)).padStart(2, "0")} ${round === 0 ? name : `${round}-${name}`}`;
        }),
      ];
      return {
        kind: "command",
        command: "ls -la packages/webhooks/src",
        output: `${lines.join("\n")}\n`,
        durationMs,
      };
    }
    default: {
      const lines = [
        "• Packages in scope: @acme/webhooks",
        "• Running test in 1 packages",
        ...bodyLines(
          lineCount - 4,
          (index) =>
            `@acme/webhooks:test:  ✓ ${TEST_NAMES[index % TEST_NAMES.length]} (${1 + ((index * 5) % 17)}ms)`,
        ),
        "",
        ` Tasks:    1 successful, 1 total`,
      ];
      return {
        kind: "command",
        command: "pnpm exec turbo run test --filter=@acme/webhooks",
        output: `${lines.join("\n")}\n`,
        durationMs,
      };
    }
  }
}

function buildFileChange(random: Random, cwd: string): Activity {
  const file = random.pick(SOURCE_FILES);
  const hunkCount = random.int(
    HISTORY_LIMITS.diffHunks.min,
    HISTORY_LIMITS.diffHunks.max,
  );
  const lines = [`--- a/${file.path}`, `+++ b/${file.path}`];
  let oldStart = random.int(4, 20);
  let lineShift = 0;
  for (let hunk = 0; hunk < hunkCount; hunk += 1) {
    const removedCount = random.int(1, 4);
    const addedCount = random.int(1, 5);
    const context = (offset: number) =>
      ` ${file.lines[(oldStart + offset) % file.lines.length]}`;
    lines.push(
      `@@ -${oldStart},${6 + removedCount} +${oldStart + lineShift},${6 + addedCount} @@ ${file.lines[(oldStart - 1) % file.lines.length]}`,
      context(0),
      context(1),
      context(2),
      ...Array.from(
        { length: removedCount },
        (_, index) =>
          `-${REMOVED_LINES[(hunk + index) % REMOVED_LINES.length]}`,
      ),
      ...Array.from(
        { length: addedCount },
        (_, index) =>
          `+${ADDED_LINES[(hunk * 2 + index) % ADDED_LINES.length]}`,
      ),
      context(3 + removedCount),
      context(4 + removedCount),
      context(5 + removedCount),
    );
    lineShift += addedCount - removedCount;
    oldStart += 6 + removedCount + random.int(8, 40);
  }
  const path = `${cwd}/${file.path}`;
  return {
    kind: "item",
    item: {
      type: "fileChange",
      changes: [{ path, kind: "update", diff: `${lines.join("\n")}\n` }],
    },
    presentation: fileChangePresentation(path),
    resultText: null,
  };
}

function planActivityKinds(random: Random, count: number): ActivityKind[] {
  if (count >= 3) {
    return random.shuffle<ActivityKind>([
      "command",
      "fileChange",
      ...Array.from({ length: count - 2 }, (): ActivityKind => "tool"),
    ]);
  }
  return Array.from({ length: count }, () =>
    random.pick<ActivityKind>(["tool", "tool", "command", "fileChange"]),
  );
}

function activityDeltas(
  activity: Activity,
  cwd: string,
  providerItemId: string,
): ThreadDelta[] {
  const key = { providerItemId };
  switch (activity.kind) {
    case "item":
      return [
        {
          kind: "item.open",
          key,
          item: activity.item,
          presentation: activity.presentation,
        },
        {
          kind: "item.close",
          key,
          status: "completed",
          ...(activity.resultText === null
            ? {}
            : { resultText: activity.resultText }),
          item: activity.item,
          presentation: activity.presentation,
        },
      ];
    case "command": {
      const presentation = commandPresentation(activity.command);
      const outputLines = activity.output.split("\n").slice(0, -1);
      const chunks = groupContiguous(outputLines, 3).map(
        (group) => `${group.join("\n")}\n`,
      );
      return [
        {
          kind: "item.open",
          key,
          item: { type: "command", command: activity.command, cwd },
          presentation,
        },
        ...chunks.map((text): ThreadDelta => ({
          kind: "item.outputDelta",
          key,
          channel: "command",
          text,
        })),
        {
          kind: "item.close",
          key,
          status: "completed",
          exitCode: 0,
          aggregatedOutput: activity.output,
          item: {
            type: "command",
            command: activity.command,
            cwd,
            aggregatedOutput: activity.output,
            exitCode: 0,
            durationMs: activity.durationMs,
          },
          presentation,
        },
      ];
    }
  }
}

function reasoningDeltas(
  providerItemId: string,
  text: string,
  parts: readonly string[],
): ThreadDelta[] {
  const key = { providerItemId };
  return [
    {
      kind: "item.open",
      key,
      item: { type: "reasoning", summary: [], content: [] },
      presentation: REASONING_PRESENTATION,
    },
    ...parts.map((part): ThreadDelta => ({
      kind: "item.textDelta",
      key,
      channel: "reasoningText",
      text: part,
    })),
    {
      kind: "item.close",
      key,
      status: "completed",
      item: { type: "reasoning", summary: [], content: [text] },
      presentation: REASONING_PRESENTATION,
    },
  ];
}

function buildReasoning(random: Random): { text: string; parts: string[] } {
  const target = random.int(420, 760);
  const sentences: string[] = [];
  let length = 0;
  for (const sentence of random.shuffle(REASONING_SENTENCES)) {
    if (length >= target) {
      break;
    }
    sentences.push(sentence);
    length += sentence.length + 1;
  }
  const text = sentences.join(" ");
  const parts = splitText(
    text,
    random.int(
      HISTORY_LIMITS.reasoningDeltas.min,
      HISTORY_LIMITS.reasoningDeltas.max,
    ),
    random,
  );
  return { text, parts };
}

function splitMarkdownSections(text: string): string[] {
  const sections: string[] = [];
  let sectionStart = 0;
  let offset = 0;
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(?:`{3,}|~{3,})/u.test(line)) {
      inFence = !inFence;
    } else if (!inFence && line.startsWith("## ") && offset > sectionStart) {
      sections.push(text.slice(sectionStart, offset));
      sectionStart = offset;
    }
    offset += line.length + 1;
  }
  sections.push(text.slice(sectionStart));
  return sections;
}

function assembleHistoryMessage(seed: number): string {
  const random = createRandom(seed, RANDOM_STREAMS.message);
  const sections = splitMarkdownSections(
    getFixture(random.pick(HISTORY_FIXTURE_NAMES)),
  );
  const { min, max } = HISTORY_LIMITS.messageChars;
  const target = random.int(min, max);
  let first = random.int(0, sections.length - 1);
  let last = first;
  const measure = (from: number, to: number): number =>
    sections
      .slice(from, to + 1)
      .join("")
      .trim().length;
  for (;;) {
    if (last + 1 < sections.length && measure(first, last + 1) <= target) {
      last += 1;
    } else if (first > 0 && measure(first - 1, last) <= target) {
      first -= 1;
    } else {
      break;
    }
  }
  while (measure(first, last) < min) {
    if (first > 0 && measure(first - 1, last) <= max) {
      first -= 1;
    } else if (last + 1 < sections.length && measure(first, last + 1) <= max) {
      last += 1;
    } else {
      break;
    }
  }
  return sections
    .slice(first, last + 1)
    .join("")
    .trim();
}

export function buildHistoryTurn(args: {
  seed: number;
  tools: number;
  cwd: string;
  idPrefix: string;
}): ThreadDelta[][] {
  const reasoningRandom = createRandom(args.seed, RANDOM_STREAMS.reasoning);
  const reasoning = buildReasoning(reasoningRandom);
  const batches: ThreadDelta[][] = [
    reasoningDeltas(
      `${args.idPrefix}-reasoning`,
      reasoning.text,
      reasoning.parts,
    ),
  ];

  const activityRandom = createRandom(args.seed, RANDOM_STREAMS.activities);
  planActivityKinds(activityRandom, args.tools).forEach((kind, index) => {
    const activity =
      kind === "tool"
        ? buildGenericTool(activityRandom, args.cwd)
        : kind === "command"
          ? buildCommand(activityRandom)
          : buildFileChange(activityRandom, args.cwd);
    batches.push(
      activityDeltas(activity, args.cwd, `${args.idPrefix}-activity-${index}`),
    );
  });

  const message = assembleHistoryMessage(args.seed);
  const messageRandom = createRandom(args.seed, RANDOM_STREAMS.messageSplit);
  const parts = splitText(
    message,
    messageRandom.int(
      HISTORY_LIMITS.messageDeltas.min,
      HISTORY_LIMITS.messageDeltas.max,
    ),
    messageRandom,
  );
  const key = { providerItemId: `${args.idPrefix}-message` };
  const groups = groupContiguous(
    parts,
    messageRandom.int(
      HISTORY_LIMITS.messageNotifications.min,
      HISTORY_LIMITS.messageNotifications.max,
    ),
  );
  groups.forEach((group, index) => {
    batches.push([
      ...(index === 0 ? [agentMessageOpen(key)] : []),
      ...group.map((text): ThreadDelta => ({
        kind: "item.textDelta",
        key,
        channel: "agentMessage",
        text,
      })),
    ]);
  });
  batches.push([agentMessageClose(key, message)]);
  return batches;
}

const PRELUDE_MCP_TOOL = { server: "linear", tool: "get_issue" } as const;

const PRELUDE_ISSUE = {
  identifier: "PLAT-412",
  title: "Checkout confirm p95 regressed after the webhook retry change",
  state: "In Progress",
  assignee: "maya",
  priority: 1,
  labels: ["performance", "checkout"],
  url: "https://linear.app/acme/issue/PLAT-412",
};

export function buildStreamPrelude(args: {
  cwd: string;
  idPrefix: string;
}): ThreadDelta[] {
  const reasoningText = REASONING_SENTENCES.slice(0, 3).join(" ");
  const toolKey = { providerItemId: `${args.idPrefix}-prelude-tool` };
  const item: DeltaItemShape = {
    type: "tool",
    ...PRELUDE_MCP_TOOL,
    args: { id: PRELUDE_ISSUE.identifier },
  };
  const presentation = mcpToolPresentation(PRELUDE_MCP_TOOL);
  return [
    ...reasoningDeltas(`${args.idPrefix}-prelude-reasoning`, reasoningText, [
      REASONING_SENTENCES[0],
      ` ${REASONING_SENTENCES[1]}`,
      ` ${REASONING_SENTENCES[2]}`,
    ]),
    { kind: "item.open", key: toolKey, item, presentation },
    {
      kind: "item.close",
      key: toolKey,
      status: "completed",
      resultText: JSON.stringify(PRELUDE_ISSUE, null, 2),
      item,
      presentation,
    },
  ];
}
