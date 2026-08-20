// Synthetic timelines for the demo threads.
//
// The row shapes are copied from a real `GET /api/v1/threads/:id/timeline`
// response; the content is invented. Nothing here comes from a real thread,
// because this server is public and a real capture would publish whatever the
// captured machine was working on.
//
// `timeline.test.ts` parses every row with the contract's own schema, so a
// change to @bb/server-contract fails the build instead of reaching a
// reviewer as a blank screen.

import { DEMO_HOST_ID, DEMO_NOW, DEMO_PROJECT_ID } from "./ids.js";

export interface DemoThreadSeed {
  id: string;
  title: string;
  minutesAgo: number;
}

export const DEMO_THREADS: DemoThreadSeed[] = [
  { id: "thr_demo00000001", title: "Add a dark mode toggle", minutesAgo: 12 },
  {
    id: "thr_demo00000002",
    title: "Fix the flaky checkout test",
    minutesAgo: 90,
  },
  {
    id: "thr_demo00000003",
    title: "Speed up the search index",
    minutesAgo: 240,
  },
];

const CWD = "/home/demo/demo-app";

function baseRow(
  threadId: string,
  index: number,
  startedAt: number,
): {
  threadId: string;
  turnId: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  startedAt: number;
  createdAt: number;
} {
  return {
    threadId,
    turnId: `${threadId}-t1`,
    sourceSeqStart: index,
    sourceSeqEnd: index,
    startedAt,
    createdAt: startedAt,
  };
}

/**
 * A conversation row. The two roles are not symmetric, and getting that wrong
 * crashes the thread screen rather than degrading:
 *
 * - user: carries `mentions`, an attachments object, and a `turnRequest`.
 *   `mentions: undefined` reaches `mentions.reduce`; `attachments: []` reaches
 *   `attachments.imageUrls.map`; `turnRequest: null` reaches `.status`.
 * - assistant: carries `attachments: null` and `turnRequest: null`, and none
 *   of the user-only fields.
 *
 * Shapes verified against a real `GET /threads/:id/timeline` capture.
 */
export function conversationRow(
  threadId: string,
  index: number,
  startedAt: number,
  role: "user" | "assistant",
  text: string,
): Record<string, unknown> {
  const common = {
    ...baseRow(threadId, index, startedAt),
    id: `${threadId}:conversation:${index}`,
    kind: "conversation",
    role,
    text,
  };

  if (role === "assistant") {
    return { ...common, attachments: null, turnRequest: null };
  }

  return {
    ...common,
    turnId: null,
    mentions: [],
    attachments: {
      webImages: 0,
      localImages: 0,
      localFiles: 0,
      imageUrls: [],
      localImagePaths: [],
      localFilePaths: [],
    },
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
  };
}

export function commandRow(
  threadId: string,
  index: number,
  startedAt: number,
  command: string,
  output: string,
): Record<string, unknown> {
  return {
    ...baseRow(threadId, index, startedAt),
    id: `${threadId}:command:${index}`,
    kind: "work",
    workKind: "command",
    status: "completed",
    callId: `${threadId}-i${index}`,
    command,
    cwd: CWD,
    source: null,
    output,
    exitCode: 0,
    completedAt: startedAt + 1_200,
    approvalStatus: null,
    activityIntents: [],
  };
}

const ASSISTANT_INTRO = [
  "I looked at how the theme is applied today.",
  "",
  "The palette is set once at startup from `settings.theme`, so a toggle needs",
  "two things: a stored preference, and a listener that re-applies the palette",
  "without a reload.",
  "",
  "## Plan",
  "",
  "1. Persist the choice next to the other user preferences.",
  "2. Re-apply the palette when the value changes.",
  "3. Follow the system setting when the user has not chosen.",
  "",
  "```ts",
  "export function useTheme() {",
  '  const [mode, setMode] = usePreference("theme", "system");',
  "  useEffect(() => applyPalette(resolve(mode)), [mode]);",
  "  return { mode, setMode };",
  "}",
  "```",
  "",
  "Want me to make the change?",
].join("\n");

/** Rows for one demo thread, oldest first. */
export function timelineRows(threadId: string): Record<string, unknown>[] {
  const start = DEMO_NOW - 30 * 60_000;

  if (threadId === DEMO_THREADS[0].id) {
    return [
      conversationRow(
        threadId,
        1,
        start,
        "user",
        "Add a dark mode toggle to the settings screen.",
      ),
      commandRow(
        threadId,
        2,
        start + 2_000,
        "rg -n 'theme' src --type ts",
        [
          'src/settings/appearance.ts:14:export const THEME_KEY = "theme";',
          "src/settings/appearance.ts:22:  applyPalette(resolveTheme(stored));",
          "src/app/boot.ts:41:  applyPalette(readTheme());",
        ].join("\n"),
      ),
      conversationRow(threadId, 3, start + 6_000, "assistant", ASSISTANT_INTRO),
    ];
  }

  if (threadId === DEMO_THREADS[1].id) {
    return [
      conversationRow(
        threadId,
        1,
        start,
        "user",
        "The checkout test fails about one run in five. Find out why.",
      ),
      commandRow(
        threadId,
        2,
        start + 3_000,
        "pnpm test checkout --repeat 20",
        [
          "✓ checkout > applies a discount code (18 runs)",
          "✗ checkout > applies a discount code (2 runs)",
          "  expected 1 request, received 2",
        ].join("\n"),
      ),
      conversationRow(
        threadId,
        3,
        start + 9_000,
        "assistant",
        [
          "The test does not wait for the first request to settle, so a retry",
          "sometimes lands inside the assertion window.",
          "",
          "The fix is to await the pending request instead of a fixed delay.",
        ].join("\n"),
      ),
    ];
  }

  return [
    conversationRow(
      threadId,
      1,
      start,
      "user",
      "Search takes about two seconds on the large fixture. Where does the time go?",
    ),
    conversationRow(
      threadId,
      2,
      start + 5_000,
      "assistant",
      [
        "Almost all of it is in `buildIndex`, which re-reads every document on",
        "each query. Caching the index and invalidating it on write brings a",
        "warm query under 50ms.",
      ].join("\n"),
    ),
  ];
}

export const DEMO_IDS = { DEMO_PROJECT_ID, DEMO_HOST_ID };
