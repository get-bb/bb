import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import linearLogo from "../assets/company-logos/linear.svg";
import { ClaudeIcon, OpenAiIcon } from "./icons";
import {
  ChevronDown,
  ChevronRight,
  CircleCheckIcon,
  CloseIcon,
  ComposerBox,
  ContextRow,
  EditorButton,
  Ellipsis,
  FileCodeGlyph as FileIcon,
  FileEditGlyph as EditIcon,
  FolderGitIcon,
  GitBranchIcon as BranchIcon,
  MessageIcon,
  MicIcon,
  NAV_ITEMS,
  NavRail,
  NewThreadIcon,
  PanelRightIcon,
  PaperPlane as SentGlyph,
  PhoneIcon,
  PinGlyph,
  PluginsIcon,
  PullRequestIcon as PrIcon,
  SearchIcon,
  Spinner,
  TerminalIcon as TermIcon,
  TestIcon,
  ThreadStatus,
  BugIcon,
  QuestionIcon,
  type MockIcon as IconComp,
  type ThreadState as Status,
} from "./app-mock-parts";

const LinearGlyph: IconComp = ({ className }) => (
  <img src={linearLogo} alt="" className={className} />
);
const SentryGlyph: IconComp = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    aria-hidden
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path d="M13.9 4.2a2.2 2.2 0 0 0-3.8 0L3.4 15.8a2.2 2.2 0 0 0 1.9 3.3h2.2a7.5 7.5 0 0 0-3.5-6.2M8.3 9.2a12.6 12.6 0 0 1 6 9.9h4.4a2.2 2.2 0 0 0 1.9-3.3l-6.7-11.6" />
  </svg>
);

type Flag =
  | "sentry"
  | "split"
  | "spawn"
  | "messages"
  | "panel"
  | "chart"
  | "composer"
  | "strip"
  | "grouped";

type StepKind = "plugin" | "cmd" | "file" | "work";
type Step = {
  kind: StepKind;
  plugin?: string;
  verb: string;
  em?: string;
  file?: string;
  diff?: [number, number];
  dur?: string;
  spin?: boolean;

  doneAs?: Step;
};
type Post = { step: Step } | { reply: ReactNode };
type Scene = {
  id: string;
  title: string;

  prompt?: string;

  context?: { prompt: string; worked: string; reply: ReactNode };
  steps: Step[];

  post?: Post[];
  worked: string;

  running?: boolean;
  flags: Flag[];
  sideView?: boolean;

  then?: { id: string; worked: string; reply: ReactNode };

  hold: number;
  beat?: number;

  replyFirst?: boolean;

  follow?: Follow;
};
type Follow = {
  prompt: string;
  steps: Step[];
  worked: string;
  reply: ReactNode;
  fixes: { title: string; sub: string }[];

  clicks: number[];
};

const SCENES: Scene[] = [
  {
    id: "sentry",
    hold: 2.5,
    beat: 1.3,
    title: "Sentry errors",
    prompt: "Chart my Sentry errors for checkout-web next to this thread",
    steps: [
      { kind: "work", verb: "Explored", em: "4 files, 1 search" },
      {
        kind: "cmd",
        verb: "Ran",
        em: "bb plugin new sentry-charts",
        dur: "0.4s",
      },
      { kind: "file", verb: "Created", file: "page.tsx", diff: [142, 0] },
      {
        kind: "cmd",
        verb: "Ran",
        em: "bb plugin install ./bb-plugin-sentry-charts",
        dur: "2.2s",
      },
    ],
    post: [
      {
        step: {
          kind: "plugin",
          verb: "Read the top issues from",
          em: "Sentry",
        },
      },
      {
        reply: (
          <>
            It&rsquo;s open beside this thread. Errors jump at <b>v2.14.0</b>:{" "}
            <code>Cannot read properties of null</code> in the cart summary, 642
            events. Fixing it now.
          </>
        ),
      },
    ],
    worked: "1m 12s",
    running: true,
    flags: ["sentry", "split"],
  },
  {
    id: "spawn",
    hold: 2.5,
    title: "CSV export",
    prompt:
      "Add CSV export to the reports page. Have Codex write the tests in parallel.",
    steps: [
      { kind: "work", verb: "Explored", em: "5 files, 1 search" },
      {
        kind: "cmd",
        verb: "Ran",
        em: 'bb thread spawn --provider codex --prompt "Write tests for CSV export on the reports page"',
        dur: "0.8s",
      },
      { kind: "file", verb: "Edited", file: "ReportsPage.tsx", diff: [18, 2] },
      { kind: "file", verb: "Edited", file: "exportCsv.ts", diff: [41, 0] },
    ],
    worked: "52s",
    flags: ["spawn"],
    then: {
      id: "messages",
      worked: "52s",
      reply: (
        <>CSV export is in. Codex is writing the tests in its own thread.</>
      ),
    },
  },
  {
    id: "linear",
    hold: 2,
    title: "Linear issues panel",
    prompt: "Add a side panel with my open Linear issues",
    steps: [
      {
        kind: "cmd",
        verb: "Ran",
        em: "bb plugin new linear-issues",
        dur: "0.4s",
      },
      { kind: "file", verb: "Created", file: "panel.tsx", diff: [96, 0] },
      { kind: "file", verb: "Created", file: "server.ts", diff: [54, 0] },
      {
        kind: "cmd",
        verb: "Ran",
        em: "bb plugin install ./bb-plugin-linear-issues",
        dur: "2.1s",
      },
    ],
    post: [
      {
        step: {
          kind: "plugin",
          verb: "Fetched",
          em: "6 open issues from Linear",
        },
      },
      { reply: <>Your 6 open issues are ready in the side panel.</> },
    ],
    worked: "58s",
    flags: ["panel"],
  },
  {
    id: "chart",
    hold: 2.5,
    title: "Chart flaky tests",
    prompt: "Chart flaky tests by package",
    steps: [
      { kind: "work", verb: "Explored", em: "38 files" },
      {
        kind: "plugin",
        plugin: "Generative UI",
        verb: "rendered",
        em: "a bar chart",
      },
    ],
    post: [
      {
        reply: (
          <>
            checkout has 9 of the 22 flaky runs this week, most of them timeouts
            on CI.
          </>
        ),
      },
    ],
    worked: "21s",
    flags: ["chart"],
    follow: {
      prompt: "Which of these should we fix first?",
      steps: [
        { kind: "work", verb: "Explored", em: "12 files, 2 searches" },
        {
          kind: "plugin",
          plugin: "Impromptu UI",
          verb: "rendered",
          em: "2 fixes",
        },
      ],
      worked: "16s",
      reply: (
        <>
          Start with uploads and auth: 10 flaky runs. Checkout’s 9 are CI
          timeouts.
        </>
      ),
      fixes: [
        {
          title: "Retry dropped upload requests",
          sub: "All 4 upload flakes are dropped network calls",
        },
        {
          title: "Reset auth test data",
          sub: "Leftover rows break 6 auth tests",
        },
      ],
      clicks: [0, 1],
    },
  },
  {
    id: "composer",
    replyFirst: true,
    hold: 2,
    title: "Mention GitHub issues",
    prompt: "Let me type # to mention GitHub issues from this repo",
    steps: [
      {
        kind: "cmd",
        verb: "Ran",
        em: "bb plugin new github-issues",
        dur: "0.4s",
      },
      {
        kind: "file",
        verb: "Created",
        file: "issue-mentions.ts",
        diff: [74, 0],
      },
      {
        kind: "cmd",
        verb: "Ran",
        em: "bb plugin install ./bb-plugin-github-issues",
        dur: "1.9s",
      },
    ],
    post: [
      {
        step: {
          kind: "plugin",
          verb: "Loaded open issues from",
          em: "get-bb/bb",
        },
      },
      {
        reply: (
          <>Done. Type # and a few letters of an issue title to mention it.</>
        ),
      },
    ],
    worked: "47s",
    flags: ["composer"],
  },
  {
    id: "nav",
    hold: 2,
    title: "Tidy the navigation",
    prompt: "Move my navigation icons into the top of the sidebar",
    steps: [
      {
        kind: "cmd",
        verb: "Ran",
        em: "bb plugin install collapsible-navigation",
        dur: "5.1s",
      },
    ],
    post: [
      {
        reply: (
          <>
            Your navigation icons now sit in a strip at the top of the sidebar.
          </>
        ),
      },
    ],
    worked: "9s",
    flags: ["strip"],
    sideView: true,
  },
  {
    id: "grouped",
    hold: 2,
    title: "Group sidebar by status",
    prompt: "Group my sidebar by status: needs my input, running, unread, done",
    steps: [
      {
        kind: "cmd",
        verb: "Ran",
        em: "bb plugin new status-sidebar",
        dur: "0.4s",
      },
      { kind: "file", verb: "Created", file: "sidebar.tsx", diff: [88, 0] },
      {
        kind: "cmd",
        verb: "Ran",
        em: "bb plugin install ./bb-plugin-status-sidebar",
        dur: "2.0s",
      },
    ],
    post: [
      {
        reply: (
          <>
            Your sidebar is grouped by status now. Switch back in Settings →
            Sidebar thread list.
          </>
        ),
      },
    ],
    worked: "41s",
    flags: ["grouped"],
    sideView: true,
  },
];

const PERSIST = new Set<string>(["spawn", "composer", "strip", "grouped"]);
const RAIL: Record<string, string> = {
  sentry: "rail-sentry",
  linear: "rail-linear",
};
const CLOSES = new Set<string>(["sentry", "linear"]);

const FINAL_STATUS: Record<string, Status> = { sentry: "running" };

const USER_AT = 0.35;
const ROW_GAP = 0.65;
const WORK_ROW_GAP = 0.38;
const FIRST_ROW = 0.6;

const REST = 1.1;
const REST_AFTER_CLOSE = 1.4;

const MUTE_AFTER = 0.35;
const MUTE_FOR = 0.35;
const SWAP_FOR = 0.3;
const FURL_GAP = 0.2;
const FURL_FOR = 0.3;
const FURL_BEAT = 0.6;
const ARRIVE_FOR = 0.3;

type TurnRow = { step: Step; at: number; muteAt: number | null };
type TurnPlan = { rows: TurnRow[]; furlAt: number | null; readyAt: number };

function planTurn(
  rows: { step: Step; at: number }[],
  done: number | null,
  arrivals: number[] = [],
): TurnPlan {
  const planned = rows.map(({ step, at }) => {
    const muteAt = step.spin
      ? done == null
        ? null
        : done + (step.doneAs ? SWAP_FOR : 0)
      : done == null
        ? at + MUTE_AFTER
        : Math.min(at + MUTE_AFTER, Math.max(at, done));
    return { step, at, muteAt };
  });
  const greyAt =
    Math.max(...planned.map((r) => r.muteAt ?? Infinity)) + MUTE_FOR;
  let furlAt =
    done == null || !Number.isFinite(greyAt)
      ? null
      : Math.max(greyAt, done + SWAP_FOR) + FURL_GAP;
  for (const at of [...arrivals].sort((a, b) => a - b))
    if (furlAt != null && at > furlAt - ARRIVE_FOR && at < furlAt + FURL_FOR)
      furlAt = at + ARRIVE_FOR + 0.05;
  return {
    rows: planned,
    furlAt,
    readyAt: furlAt == null ? greyAt : furlAt + FURL_FOR,
  };
}

function timing(scene: Scene, tablet = false) {
  const posts = scene.post ?? [];
  const userAt = scene.prompt ? USER_AT : 0;
  const stepAt = scene.steps.map(
    (_, i) => userAt + FIRST_ROW + i * WORK_ROW_GAP,
  );
  const lastStep = stepAt.at(-1) ?? userAt;
  let changeAt: number;
  let postAt: number[];
  const replyFirst = scene.replyFirst;
  if (replyFirst) {
    postAt = posts.map((_, i) => lastStep + ROW_GAP + i * ROW_GAP);
    changeAt = (postAt.at(-1) ?? lastStep) + ROW_GAP;
  } else {
    changeAt = scene.prompt ? lastStep + ROW_GAP + (scene.beat ?? 0) : 0.6;
    const settle = scene.id === "sentry" ? (SENTRY_OPEN_MS - 650) / 1000 : 0;
    postAt = posts.map((_, i) => changeAt + settle + ROW_GAP + i * ROW_GAP);
  }
  const collapseAt = scene.id === "linear" && tablet ? changeAt : null;
  if (collapseAt !== null) {
    changeAt += 1;
    if (!replyFirst) postAt = postAt.map((at) => at + 1);
  }
  const lastAt = replyFirst ? changeAt : Math.max(changeAt, postAt.at(-1) ?? 0);

  const replyIdx = posts.findIndex((p) => "reply" in p);
  let doneAt: number | null = scene.running
    ? null
    : replyIdx >= 0
      ? postAt[replyIdx]
      : changeAt;
  let end = lastAt + scene.hold;
  if (scene.id === "composer") end = Math.max(end, changeAt + 5.1);

  let then: null | { at: number; notes: number[] } = null;
  if (scene.then) {
    const at = lastAt + ROW_GAP;
    const notes = [0, 1, 2].map((i) => at + 1.0 + i * 1.0);
    doneAt = at;
    end = (notes.at(-1) ?? at) + scene.hold;
    then = { at, notes };
  }
  const turn = planTurn(
    [
      ...scene.steps.map((step, i) => ({ step, at: stepAt[i] })),
      ...posts.flatMap((p, i) =>
        "step" in p ? [{ step: p.step, at: postAt[i] }] : [],
      ),
    ],
    doneAt,
    [
      changeAt,
      ...postAt,
      ...(then ? [then.at, ...then.notes] : []),
      ...(scene.flags.includes("chart")
        ? [(postAt.at(-1) ?? changeAt) + ROW_GAP]
        : []),
    ],
  );
  let f: null | {
    user: number;
    steps: number[];
    reply: number;
    cards: number[];
    clicks: number[];
    turn: TurnPlan;
  } = null;
  if (scene.follow) {
    const F = scene.follow;

    const user = (postAt.at(-1) ?? changeAt) + ROW_GAP + 2.8;
    const steps = F.steps.map((_, i) => user + FIRST_ROW + i * WORK_ROW_GAP);
    const reply = (steps.at(-1) ?? user) + ROW_GAP;
    const cards = F.fixes.map((_, i) => reply + ROW_GAP + i * ROW_GAP);
    const lastCard = cards.at(-1) ?? reply;
    const clicks = F.clicks.map((_, i) => lastCard + 1.0 + i * 1.0);
    end = (clicks.at(-1) ?? lastCard) + scene.hold;
    const fTurn = planTurn(
      F.steps.map((step, i) => ({ step, at: steps[i] })),
      reply,
      cards,
    );
    f = { user, steps, reply, cards, clicks, turn: fTurn };
  }
  const ready = Math.max(turn.readyAt, f?.turn.readyAt ?? 0);
  const leavesAtEnd = CLOSES.has(scene.id) || scene === SCENES.at(-1);
  const leaves = end + (leavesAtEnd ? 0 : REST);
  if (Number.isFinite(ready) && leaves < ready + FURL_BEAT)
    end += ready + FURL_BEAT - leaves;
  return {
    collapseAt,
    userAt,
    stepAt,
    changeAt,
    postAt,
    doneAt,
    end,
    f,
    then,
    turn,
  };
}

const THREADS: { title: string; status: Status }[] = [
  { title: "Triage the Sentry spike", status: "running" },
  { title: "Nightly changelog", status: "done" },
  { title: "Refactor the timeline cache", status: "waiting" },
];

const CHILD = { icon: OpenAiIcon, title: "CSV export tests" };

const LINEAR_TASKS = [
  {
    key: "APP-1",
    title: "Fix the login redirect loop",
    status: "in_progress",
    priority: "high",
  },
  {
    key: "APP-2",
    title: "Rate-limit file uploads",
    status: "todo",
    priority: "medium",
  },
  {
    key: "APP-3",
    title: "Add filters to search",
    status: "todo",
    priority: "low",
  },
  {
    key: "APP-4",
    title: "Draft the release notes",
    status: "in_progress",
    priority: "medium",
  },
  {
    key: "APP-5",
    title: "Triage flaky checkout tests",
    status: "backlog",
    priority: "high",
  },
  {
    key: "APP-6",
    title: "Port the billing page",
    status: "backlog",
    priority: "low",
  },
];

const FLAKY = [
  { name: "checkout", n: 9 },
  { name: "auth", n: 6 },
  { name: "uploads", n: 4 },
  { name: "search", n: 2 },
  { name: "billing", n: 1 },
];

const SENTRY_EVENTS = [
  14, 16, 13, 18, 15, 17, 16, 19, 18, 21, 64, 118, 142, 131, 112, 104, 96, 91,
  88, 84, 86, 82, 79, 80,
];
const RELEASE_AT = 9.6;
const SENTRY_ISSUES = [
  {
    title: "TypeError: Cannot read properties of null",
    where: "CartSummary.tsx",
    events: "642",
    users: "188",
    spark: [1, 1, 2, 1, 2, 9, 14, 12, 10, 9],
  },
  {
    title: "504 Gateway Timeout: POST /api/checkout",
    where: "api",
    events: "211",
    users: "74",
    spark: [3, 4, 3, 5, 4, 5, 6, 5, 6, 5],
  },
  {
    title: "ChunkLoadError: Loading chunk failed",
    where: "web",
    events: "96",
    users: "51",
    spark: [2, 3, 2, 2, 3, 2, 3, 2, 3, 3],
  },
];

function linePath(
  values: number[],
  w: number,
  h: number,
  max: number,
  pad = 2,
) {
  const step = w / (values.length - 1);
  const pts = values.map(
    (v, i) => [i * step, h - pad - (v / max) * (h - pad * 2)] as const,
  );
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

function SentryChart() {
  const w = 400;
  const h = 96;
  const max = 150;
  const line = linePath(SENTRY_EVENTS, w, h, max);
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const rx = (RELEASE_AT / (SENTRY_EVENTS.length - 1)) * w;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="rhb-sentry-svg"
      aria-hidden
    >
      <defs>
        <clipPath id="rhb-after-release">
          <rect x={rx} y="0" width={w - rx} height={h} />
        </clipPath>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0"
          x2={w}
          y1={h * f}
          y2={h * f}
          className="rhb-grid"
        />
      ))}
      <path d={area} className="rhb-area" />
      <path
        d={area}
        className="rhb-area is-after"
        clipPath="url(#rhb-after-release)"
      />
      <path d={line} className="rhb-line" />
      <path
        d={line}
        className="rhb-line is-after"
        clipPath="url(#rhb-after-release)"
      />
      <line x1={rx} x2={rx} y1="0" y2={h} className="rhb-release" />
    </svg>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values) * 1.1;
  return (
    <svg
      viewBox="0 0 60 16"
      preserveAspectRatio="none"
      className="rhb-spark"
      aria-hidden
    >
      <path d={linePath(values, 60, 16, max, 1.5)} />
    </svg>
  );
}

function PanelBar({ name, meta }: { name: string; meta?: string }) {
  return (
    <div className="plugin-panel-bar">
      <span className="plugin-panel-name">{name}</span>
      <span className="plugin-panel-badge">Plugin</span>
      {meta ? <span className="rhb-bar-meta">{meta}</span> : null}
    </div>
  );
}

function StepIcon({ kind }: { kind: StepKind }) {
  if (kind === "plugin")
    return <PluginsIcon className="rhb-step-ic is-plugin" />;
  if (kind === "cmd") return <TermIcon className="rhb-step-ic" />;
  if (kind === "file") return <EditIcon className="rhb-step-ic" />;
  return <SearchIcon className="rhb-step-ic" />;
}

function WorkRowContent({ step }: { step: Step }) {
  return (
    <>
      <StepIcon kind={step.kind} />
      <span className="rhb-work-text">
        {step.plugin ? <span className="rhb-em">{step.plugin} </span> : null}
        <span className={step.spin ? "rhb-verb rhb-shimmer-text" : "rhb-verb"}>
          {step.verb}
        </span>
        {step.em ? <span className="rhb-em"> {step.em}</span> : null}
        {step.file ? <span className="rhb-file"> {step.file}</span> : null}
      </span>
      {step.diff ? (
        <span className="rhb-diff">
          <span className="is-add">+{step.diff[0]}</span>
          {step.diff[1] ? (
            <span className="is-del">-{step.diff[1]}</span>
          ) : null}
        </span>
      ) : null}
      {step.dur ? <span className="rhb-dur">{step.dur}</span> : null}
      {step.spin ? <Spinner className="trun rhb-work-spin" /> : null}
    </>
  );
}

function Swap({
  at,
  a,
  b,
  className,
}: {
  at: number;
  a: ReactNode;
  b: ReactNode;
  className?: string;
}) {
  return (
    <span className={["rhb-swap", className].filter(Boolean).join(" ")}>
      <span className="rhb-swap-a" style={{ animationDelay: `${at}s` }}>
        {a}
      </span>
      <span className="rhb-swap-b" style={{ animationDelay: `${at}s` }}>
        {b}
      </span>
    </span>
  );
}

function WorkRow({
  step,
  style,
  doneAt,
  muteAt,
}: {
  step: Step;
  style?: CSSProperties;
  doneAt?: number | null;
  muteAt: number | null;
}) {
  return (
    <div
      className={`rhb-work rhb-work-${step.kind} customize-msg${
        muteAt === null ? "" : " is-muting"
      }`}
      style={
        muteAt === null
          ? style
          : ({ ...style, "--rhb-mute-at": `${muteAt}s` } as CSSProperties)
      }
    >
      {step.doneAs && doneAt ? (
        <Swap
          className="rhb-work-swap"
          at={doneAt}
          a={<WorkRowContent step={step} />}
          b={<WorkRowContent step={step.doneAs} />}
        />
      ) : (
        <WorkRowContent step={step} />
      )}
    </div>
  );
}

function TurnHeader({
  worked,
  doneAt,
  furlAt = null,
  style,
}: {
  worked: string;
  doneAt: number | null;
  furlAt?: number | null;
  style?: CSSProperties;
}) {
  const stackRef = useRef<HTMLSpanElement>(null);
  const swaps = doneAt != null && doneAt !== 0;
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack || !swaps) return;
    const [a, b] = Array.from(stack.children);
    const measure = () => {
      const wa = box(a).width;
      if (!wa) return;
      stack.style.setProperty("--rhb-wa", `${wa}px`);
      stack.style.setProperty("--rhb-wb", `${box(b).width}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(a);
    ro.observe(b);
    return () => ro.disconnect();
  }, [swaps]);
  return (
    <div
      className={
        furlAt == null
          ? "rhb-turn customize-msg"
          : "rhb-turn customize-msg is-furling"
      }
      style={
        furlAt == null
          ? style
          : ({ ...style, "--rhb-furl-at": `${furlAt}s` } as CSSProperties)
      }
    >
      <span
        ref={stackRef}
        className={swaps ? "rhb-turn-stack is-swap" : "rhb-turn-stack"}
        style={swaps ? { animationDelay: `${doneAt}s` } : undefined}
      >
        {doneAt === 0 ? null : (
          <span
            className={doneAt == null ? "rhb-turn-w is-live" : "rhb-turn-w"}
            style={
              doneAt == null ? undefined : { animationDelay: `${doneAt}s` }
            }
          >
            <span className="rhb-turn-label rhb-shimmer-text">Working</span>
          </span>
        )}
        {doneAt == null ? null : (
          <span
            className="rhb-turn-d"
            style={
              doneAt ? { animationDelay: `${doneAt}s` } : { animation: "none" }
            }
          >
            <span className="rhb-turn-label">Worked for</span>
            <span className="rhb-dur">{worked}</span>
          </span>
        )}
      </span>
      <ChevronDown className="rhb-chev" />
    </div>
  );
}

function CursorGlyph({ style }: { style?: CSSProperties }) {
  return (
    <svg className="rhb-cursor" style={style} viewBox="0 0 16 20" aria-hidden>
      <path
        d="M1.5 1.5v14.2l3.6-3.4 2.4 5.6 2.4-1-2.4-5.5h5z"
        fill="#fff"
        stroke="#111"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ThreadPill({ icon: Icon, label }: { icon: IconComp; label: string }) {
  return (
    <span className="rhb-pill">
      <Icon className="rhb-pill-ic" />
      <span className="rhb-pill-text">{label}</span>
    </span>
  );
}

const TABLET_QUERY = "(min-width: 721px) and (max-width: 860px)";

function useMedia(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const EASE_OUT = "cubic-bezier(0.22, 0.61, 0.36, 1)";
const SENTRY_OPEN_MS = 1050;
const SENTRY_CLOSE_MS = 850;
const TOP = ".rhb-col-main, .rhb-col-page, .rhb-col-panel, .rhb-side";
const KIDS =
  ".rhb-side > :not(.rhb-xf), .rail > *, .rhb-feed, .rhb-dock-wrap, .rhb-col > .rhb-band > *";
const XF = ".rhb-side > *, .rhb-feed, .rhb-dock-wrap";
type Snap = {
  rects: Map<
    Element,
    { r: DOMRect; p?: DOMRect; clone?: HTMLElement; pad?: number }
  >;
  left?: DOMRect;
  root: DOMRect;
};

function cssZoom(el: Element): number {
  const win = el.closest<HTMLElement>(".rhb-win");
  if (!win || !win.offsetWidth) return 1;
  const zoom = win.getBoundingClientRect().width / win.offsetWidth;
  return Math.abs(zoom - 1) < 0.01 ? 1 : zoom;
}

function box(el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  const zoom = cssZoom(el);
  return zoom === 1
    ? r
    : new DOMRect(r.x / zoom, r.y / zoom, r.width / zoom, r.height / zoom);
}

function boxOf(el: Element | null | undefined): DOMRect | undefined {
  return el ? box(el) : undefined;
}

function freeze(src: HTMLElement): HTMLElement {
  const clone = src.cloneNode(true) as HTMLElement;
  clone.classList.add("rhb-frozen");
  const rootStyle = getComputedStyle(src);
  clone.style.display = rootStyle.display;
  clone.style.visibility = rootStyle.visibility;
  clone.style.opacity = rootStyle.opacity;
  clone.style.padding = rootStyle.padding;
  clone.style.boxSizing = rootStyle.boxSizing;

  const sel =
    ".rhb-page, .plugin-panel-bar, .plugin-task, .customize-msg, .rhb-reveal, .rhb-swap-a, .rhb-swap-b, .rhb-turn-stack, .rhb-turn-w, .rhb-turn-d, .rhb-typing, .rhb-kids, .rhb-turn-fold, .rhb-turn > .rhb-chev, .rhb-work.is-muting";
  const from = src.querySelectorAll<HTMLElement>(sel);
  const to = clone.querySelectorAll<HTMLElement>(sel);
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const c = to[i];
    if (!c) return;
    if (cs.display === "none") c.style.display = "none";
    c.style.opacity = cs.opacity;
    if (el.matches(".rhb-turn-stack")) c.style.width = cs.width;
    if (el.matches(".rhb-turn-fold"))
      Object.assign(c.style, {
        gridTemplateRows: cs.gridTemplateRows,
        marginBottom: cs.marginBottom,
        clipPath: cs.clipPath,
      });
    if (el.matches(".rhb-chev")) c.style.rotate = cs.rotate;
    const part = el.matches(".rhb-work") ? el.firstElementChild : null;
    if (part)
      c.style.setProperty(
        "--rhb-m",
        getComputedStyle(part).getPropertyValue("--rhb-m"),
      );
  });
  return clone;
}

function pin(el: HTMLElement, r: DOMRect, root: DOMRect, z: string) {
  Object.assign(el.style, {
    position: "absolute",
    left: `${r.left - root.left}px`,
    top: `${r.top - root.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: z,
  });
}

function glide(el: Element, keyframes: Keyframe[], duration = 650) {
  (el as HTMLElement).animate(keyframes, { duration, easing: EASE_OUT });
}

function solidBg(el: Element | null): string {
  for (let node = el; node; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(bg))
      return bg;
  }
  return "transparent";
}

function nearest(...deltas: number[]) {
  return deltas.reduce((m, d) => (Math.abs(d) < Math.abs(m) ? d : m));
}

function dissolve(
  el: HTMLElement,
  clone: HTMLElement,
  a: DOMRect,
  b: DOMRect,
  bp: DOMRect,
  t: { x: number; y: number },
  pad?: number,
  seq = false,
  dur = 650,
) {
  const host = el.parentElement;
  if (!host) return;
  let ax =
    pad !== undefined
      ? a.left + pad - b.left - parseFloat(getComputedStyle(el).paddingLeft)
      : el.parentElement?.matches(".rhb-side")
        ? a.left - b.left
        : nearest(
            a.left - b.left,
            a.right - b.right,
            (a.left + a.right - b.left - b.right) / 2,
          );
  if (b.left + ax < bp.left + t.x - 1) ax = a.left - b.left;
  const ay = nearest(a.top - b.top, a.bottom - b.bottom);
  const cx = a.left - (b.left + ax);
  const cy = a.top - (b.top + ay);
  const dx = ax - t.x;
  const dy = ay - t.y;
  const ul = Math.min(0, cx);
  const ut = Math.min(0, cy);
  const ur = Math.max(b.width, cx + a.width);
  const ub = Math.max(b.height, cy + a.height);
  const wrap = document.createElement("div");
  wrap.className = "rhb-xf rhb-frozen";
  Object.assign(wrap.style, {
    position: "absolute",
    left: `${b.left - bp.left - host.clientLeft + ul}px`,
    top: `${b.top - bp.top - host.clientTop + ut}px`,
    width: `${ur - ul}px`,
    height: `${ub - ut}px`,
    margin: "0",
    padding: "0",
    border: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "3",
    background: solidBg(host),
  });
  Object.assign(clone.style, {
    position: "absolute",
    left: `${cx - ul}px`,
    top: `${cy - ut}px`,
    width: `${a.width}px`,
    height: `${a.height}px`,
    margin: "0",
    maxWidth: "none",
  });
  wrap.appendChild(clone);
  if (
    host.dataset.rhbPos === undefined &&
    getComputedStyle(host).position === "static"
  ) {
    host.dataset.rhbPos = host.style.position;
    host.style.position = "relative";
  }
  host.appendChild(wrap);
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    const move = [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: "none" },
    ];
    glide(el, move, dur);
    glide(wrap, move, dur);
  }
  let lift: (() => void) | undefined;
  if (seq) {
    const was = {
      position: el.style.position,
      zIndex: el.style.zIndex,
      background: el.style.background,
    };
    if (getComputedStyle(el).position === "static")
      el.style.position = "relative";
    el.style.zIndex = "4";
    el.style.background = solidBg(host);
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 260,
      fill: "backwards",
      easing: "ease-out",
    });
    lift = () => Object.assign(el.style, was);
  }
  const anim = wrap.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 150,
    delay: seq ? 260 : 0,
    easing: "cubic-bezier(0.7, 0, 0.3, 1)",
    fill: "forwards",
  });
  anim.onfinish = () => {
    lift?.();
    wrap.remove();
    if (
      host.dataset.rhbPos !== undefined &&
      !host.querySelector(":scope > .rhb-xf")
    ) {
      host.style.position = host.dataset.rhbPos;
      delete host.dataset.rhbPos;
    }
  };
}

function snapLayout(root: HTMLElement, reshapes: boolean): Snap {
  const rects = new Map<
    Element,
    { r: DOMRect; p?: DOMRect; clone?: HTMLElement; pad?: number }
  >();
  root.querySelectorAll(TOP).forEach((el) => {
    if (el.classList.contains("rhb-frozen")) return;
    const r =
      getComputedStyle(el).visibility === "hidden" ? new DOMRect() : box(el);

    const clone =
      reshapes && r.width >= 2 && el.matches(".rhb-col-page, .rhb-col-panel")
        ? freeze(el as HTMLElement)
        : undefined;
    rects.set(el, { r, clone });
  });
  root.querySelectorAll(KIDS).forEach((el) => {
    if (el.closest(".rhb-frozen")) return;
    const r = box(el);
    const clone =
      r.width >= 2 &&
      r.height >= 2 &&
      el.matches(XF) &&
      !el.closest(".is-pre, .is-out")
        ? freeze(el as HTMLElement)
        : undefined;
    const pad = el.matches(".rhb-band")
      ? parseFloat(getComputedStyle(el).paddingLeft)
      : undefined;
    rects.set(el, { r, p: boxOf(el.parentElement), clone, pad });
  });
  const left = boxOf(root.querySelector(".rhb-left-body"));
  return { rects, left, root: box(root) };
}

function flipLayout(root: HTMLElement, first: Snap) {
  const sentryOpens = root.matches(".rhb-scene-sentry.rhb-has-sentry");
  const sentryCloses = root.matches(".rhb-scene-sentry:not(.rhb-has-sentry)");
  const drawer =
    (sentryOpens || sentryCloses) && !window.matchMedia(TABLET_QUERY).matches;
  const dur = sentryOpens
    ? SENTRY_OPEN_MS
    : sentryCloses
      ? SENTRY_CLOSE_MS
      : 650;
  const finals = new Map<Element, { b: DOMRect; pb?: DOMRect }>();
  root.querySelectorAll(KIDS).forEach((el) => {
    if (!el.closest(".rhb-frozen"))
      finals.set(el, { b: box(el), pb: boxOf(el.parentElement) });
  });
  const moved = new Map<Element, { x: number; y: number }>();
  const entering = new Set<Element>();
  root.querySelectorAll(TOP).forEach((el) => {
    const s = first.rects.get(el);
    const a = s?.r;
    const b =
      getComputedStyle(el).visibility === "hidden" ? new DOMRect() : box(el);
    if (!a) return;
    if (a.width >= 2 && b.width < 2 && s?.clone) {
      const old = s.clone;
      pin(old, a, first.root, "4");
      root.appendChild(old);
      const dx = el.matches(".rhb-col-panel")
        ? a.width
        : sentryCloses
          ? first.root.left - a.right
          : -a.width;
      const anim = old.animate(
        [
          { opacity: 1, transform: "none" },
          { opacity: 1, transform: `translateX(${dx}px)` },
        ],
        {
          duration: dur,
          easing: EASE_OUT,
          fill: "forwards",
        },
      );
      anim.onfinish = () => old.remove();
      return;
    }
    if (
      (a.width < 2 || a.height < 2) &&
      b.width >= 2 &&
      b.height >= 2 &&
      sentryOpens &&
      el.matches(".rhb-col-page")
    ) {
      const dx = first.root.left - b.right;
      moved.set(el, { x: dx, y: 0 });
      glide(
        el,
        [{ transform: `translateX(${dx}px)` }, { transform: "none" }],
        dur,
      );
    } else if (
      (a.width < 2 || a.height < 2) &&
      b.width >= 2 &&
      b.height >= 2 &&
      el.matches(".rhb-col-panel")
    ) {
      const dx = first.root.right - b.left;
      moved.set(el, { x: dx, y: 0 });
      entering.add(el);
      glide(
        el,
        [{ transform: `translateX(${dx}px)` }, { transform: "none" }],
        dur,
      );
    } else if ((a.width < 2 || a.height < 2) && b.width >= 2 && b.height >= 2) {
      const dx = -28;
      moved.set(el, { x: dx, y: 0 });
      entering.add(el);
      glide(el, [
        { opacity: 0, transform: `translateX(${dx}px)` },
        { opacity: 1, transform: "none" },
      ]);
    } else if (Math.abs(a.left - b.left) > 1 || Math.abs(a.top - b.top) > 1) {
      const dx = a.left - b.left;
      moved.set(el, { x: dx, y: a.top - b.top });
      glide(
        el,
        [
          { transform: `translate(${dx}px, ${a.top - b.top}px)` },
          { transform: "none" },
        ],
        dur,
      );
      const gap = a.right - (b.right + dx);
      const card = el.querySelector<HTMLElement>(":scope > .rhb-card");
      if (gap > 2 && card) {
        const fill = document.createElement("div");
        fill.className = "rhb-frozen";
        Object.assign(fill.style, {
          position: "absolute",
          left: `${card.offsetLeft + card.offsetWidth - 8}px`,
          top: `${card.offsetTop}px`,
          width: `${gap + 8}px`,
          height: `${card.offsetHeight}px`,
          background: getComputedStyle(card).backgroundColor,
          pointerEvents: "none",
        });
        el.insertBefore(fill, card);
        if (drawer) {
          const cs = getComputedStyle(card);
          Object.assign(fill.style, {
            borderTop: cs.borderTop,
            borderRight: cs.borderRight,
            borderBottom: cs.borderBottom,
            borderRadius: `0 ${cs.borderTopRightRadius} ${cs.borderBottomRightRadius} 0`,
          });
          Object.assign(card.style, {
            borderRightColor: "transparent",
            borderTopRightRadius: "0",
            borderBottomRightRadius: "0",
          });
          window.setTimeout(() => {
            [
              "border-right-color",
              "border-top-right-radius",
              "border-bottom-right-radius",
            ].forEach((x) => card.style.removeProperty(x));
          }, dur + 30);
        }
        const clips = [
          ...el.querySelectorAll<HTMLElement>(".rhb-scroll, .rhb-feed-layer"),
        ];
        clips.forEach((c) =>
          Object.assign(c.style, {
            overflow: "visible",
            clipPath: "inset(0 -2000px)",
          }),
        );
        window.setTimeout(() => {
          fill.remove();
          clips.forEach((c) =>
            Object.assign(c.style, { overflow: "", clipPath: "" }),
          );
        }, dur + 30);
      }
    }
  });
  root.querySelectorAll(KIDS).forEach((el) => {
    if (el.closest(".rhb-frozen")) return;
    if (drawer && el.closest(".rhb-col-page")) return;
    const col = el.closest(TOP);
    if (col && entering.has(col)) return;
    const s = first.rects.get(el);
    const fin = finals.get(el);
    const b = fin?.b ?? box(el);
    const pb = fin?.pb ?? boxOf(el.parentElement);
    if (!pb || b.height === 0) return;
    if (!s || !s.p || s.r.height === 0) {
      if (el.matches(".rhb-strip")) return;
      glide(
        el,
        [
          { opacity: 0, transform: "translateY(-6px)" },
          { opacity: 1, transform: "none" },
        ],
        450,
      );
      return;
    }
    const dx = s.r.left - s.p.left - (b.left - pb.left);
    const dy = s.r.top - s.p.top - (b.top - pb.top);
    const repad =
      s.pad !== undefined &&
      Math.abs(s.pad - parseFloat(getComputedStyle(el).paddingLeft)) > 1;
    const inBand = !!el.parentElement?.matches(".rhb-band");
    if (el.matches(".rhb-dock-wrap") && Math.abs(s.r.width - b.width) > 1) {
      const top = el.closest(TOP);
      const t = (top && moved.get(top)) || { x: 0, y: 0 };
      const ml = parseFloat(getComputedStyle(el).marginLeft);
      const inset = b.left - pb.left - ml;
      glide(
        el,
        [
          {
            marginLeft: `${s.r.left - s.p.left - inset}px`,
            width: `${s.r.width}px`,
            transform: `translate(${s.p.left - pb.left - t.x}px, ${s.r.top - b.top - t.y}px)`,
          },
          { marginLeft: `${ml}px`, width: `${b.width}px`, transform: "none" },
        ],
        dur,
      );
      return;
    }
    if (!inBand && (Math.abs(s.r.width - b.width) > 1 || repad)) {
      const top = el.closest(TOP);
      if (s.clone)
        dissolve(
          el as HTMLElement,
          s.clone,
          s.r,
          b,
          pb,
          (top && moved.get(top)) || { x: 0, y: 0 },
          s.pad,
          drawer,
          dur,
        );
      else if (s.r.width < 2) glide(el, [{ opacity: 0 }, { opacity: 1 }], 250);
    } else if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      glide(
        el,
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        dur,
      );
    }
  });

  const leftBody = root.querySelector<HTMLElement>(".rhb-left-body");
  const now = boxOf(leftBody);
  if (leftBody && first.left && now && first.left.width - now.width > 40) {
    const side = leftBody.querySelector<HTMLElement>(":scope > .rhb-side");
    const sideWas = side ? first.rects.get(side)?.r : undefined;
    const keep = now.width >= 2 && !!sideWas && sideWas.width >= 2;
    const ghost = freeze(keep && side ? side : leftBody);
    pin(ghost, keep && sideWas ? sideWas : first.left, first.root, "0");
    root.appendChild(ghost);
    const out = drawer ? first.root.left - first.left.right : 0;
    const a = ghost.animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: drawer ? 1 : 0, transform: `translateX(${out}px)` },
      ],
      {
        duration: drawer ? dur : 450,
        easing: EASE_OUT,
        fill: "forwards",
      },
    );
    a.onfinish = () => ghost.remove();
  } else if (
    leftBody &&
    first.left &&
    now &&
    now.width - first.left.width > 40
  ) {
    const side = leftBody.querySelector(":scope > .rhb-side");
    if (drawer)
      glide(
        leftBody,
        [
          { transform: `translateX(${first.root.left - now.right}px)` },
          { transform: "none" },
        ],
        dur,
      );
    else if (first.left.width >= 2 && side)
      glide(side, [{ opacity: 0 }, { opacity: 1 }], 450);
    else
      glide(
        leftBody,
        [
          { opacity: 0, transform: "translateX(-24px)" },
          { opacity: 1, transform: "none" },
        ],
        500,
      );
  }
}

type RowSnap = Map<
  string,
  { top: number; h: number; status?: HTMLElement; bg: string }
>;

function snapRows(root: HTMLElement): RowSnap {
  const rows: RowSnap = new Map();
  root
    .querySelectorAll<HTMLElement>(".rhb-list-grouped [data-k]")
    .forEach((el) => {
      const st = el.querySelector<HTMLElement>(":scope > .tstatus");
      const r = box(el);
      rows.set(el.dataset.k!, {
        top: r.top,
        h: r.height,
        status: st ? (st.cloneNode(true) as HTMLElement) : undefined,
        bg: getComputedStyle(el).backgroundColor,
      });
    });
  return rows;
}

const ROW_SWAP = 160;
const ROW_MOVE = 420;
function slideRows(root: HTMLElement, first: RowSnap) {
  const ease = "cubic-bezier(0.65, 0, 0.35, 1)";
  const timing = {
    duration: ROW_MOVE,
    delay: ROW_SWAP,
    easing: ease,
    fill: "backwards" as const,
  };
  const items = [
    ...root.querySelectorAll<HTMLElement>(".rhb-list-grouped [data-k]"),
  ].flatMap((el) => {
    const was = first.get(el.dataset.k!);
    if (!was) return [];
    const r = box(el);
    return [{ el, was, dy: was.top - r.top, h: r.height }];
  });
  const far = items.reduce<(typeof items)[number] | undefined>(
    (m, x) => (!m || Math.abs(x.dy) > Math.abs(m.dy) ? x : m),
    undefined,
  );
  const mover = far && Math.abs(far.dy) > 60 ? far : undefined;
  const path = mover ? -mover.dy : 0;
  const from = mover ? mover.was.top + mover.was.h / 2 : 0;
  items.forEach(({ el, was, dy, h }) => {
    if (Math.abs(dy) < 1) return;
    const shift = `translateY(${dy}px)`;
    if (el !== mover?.el) {
      if (!mover || Math.abs(path) < 1) {
        el.animate([{ transform: shift }, { transform: "none" }], timing);
        return;
      }
      const at = Math.min(1, Math.max(0, (was.top + was.h / 2 - from) / path));
      const w = Math.min(0.5, (0.75 * h) / Math.abs(path));
      const a = Math.max(0, at - w);
      const b = Math.min(1, at + w);
      el.animate(
        [
          { transform: shift, offset: 0 },
          { transform: shift, offset: a },
          { transform: "none", offset: b },
          { transform: "none", offset: 1 },
        ],
        { ...timing, easing: ease },
      );
      return;
    }
    el.style.position = "relative";
    el.style.zIndex = "2";
    const st = el.querySelector<HTMLElement>(":scope > .tstatus");
    if (st && was.status) {
      st.style.position = "relative";
      Object.assign(was.status.style, { position: "absolute", inset: "0" });
      st.appendChild(was.status);
      was.status.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 100,
        delay: ROW_SWAP,
        easing: "ease-out",
        fill: "forwards",
      });
      const fresh = [...st.children].filter(
        (c) => c !== was.status,
      ) as HTMLElement[];
      fresh.forEach((c) => {
        Object.assign(c.style, { position: "relative", zIndex: "1" });
        c.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: ROW_SWAP,
          easing: "ease-out",
        });
      });
      window.setTimeout(
        () =>
          fresh.forEach((c) => {
            c.style.removeProperty("position");
            c.style.removeProperty("z-index");
          }),
        ROW_SWAP + 120,
      );
    }
    const bg = solidBg(el.parentElement);
    const tint = (c: string) => `inset 0 0 0 999px ${c}`;
    el.animate(
      [
        { backgroundColor: bg, boxShadow: tint(was.bg) },
        { backgroundColor: bg, boxShadow: tint(was.bg), offset: 0.75 },
        { backgroundColor: bg, boxShadow: tint("rgba(0, 0, 0, 0)") },
      ],
      { duration: ROW_SWAP + ROW_MOVE },
    );
    el.animate([{ transform: shift }, { transform: "none" }], timing);
    window.setTimeout(
      () => {
        st?.style.removeProperty("position");
        was.status?.remove();
        el.style.removeProperty("position");
        el.style.removeProperty("z-index");
      },
      ROW_SWAP + ROW_MOVE + 20,
    );
  });
}

const SentryPage = memo(function SentryPage() {
  return (
    <div className="rhb-col rhb-col-page">
      <div className="rhb-band">
        <SentryGlyph className="rhb-ic rhb-page-ic" />
        <span className="rhb-title">Sentry</span>
        <span className="plugin-panel-badge">Plugin</span>
        <span className="rhb-band-end">
          <CloseIcon className="rhb-ic" />
        </span>
      </div>
      <div className="rhb-card rhb-card-page">
        <div className="rhb-page">
          <div className="rhb-page-head">
            <span className="rhb-page-title">checkout-web</span>
            <span className="rhb-bar-meta">Last 24h · production</span>
          </div>
          <div className="rhb-sentry-stats">
            <span className="rhb-stat">
              <span className="rhb-stat-label">Events</span>
              <span className="rhb-stat-value">1,284</span>
            </span>
            <span className="rhb-stat">
              <span className="rhb-stat-label">Users</span>
              <span className="rhb-stat-value">312</span>
            </span>
            <span className="rhb-stat">
              <span className="rhb-stat-label">Crash-free</span>
              <span className="rhb-stat-value">99.2%</span>
            </span>
          </div>
          <div className="rhb-sentry-chart">
            <span className="rhb-chart-legend">
              <span>Events</span>
              <span className="rhb-release-tag">v2.14.0</span>
            </span>
            <SentryChart />
            <span className="rhb-axis">
              <span>00:00</span>
              <span>12:00</span>
              <span>now</span>
            </span>
          </div>
          <div className="rhb-issues">
            <div className="rhb-issue rhb-issue-head">
              <span className="rhb-issue-main">Issue</span>
              <span className="rhb-issue-spark-h" />
              <span className="rhb-issue-n">Events</span>
              <span className="rhb-issue-n">Users</span>
            </div>
            {SENTRY_ISSUES.map((x, i) => (
              <div
                className={i === 0 ? "rhb-issue is-top" : "rhb-issue"}
                key={x.title}
              >
                <span className="rhb-issue-main">
                  <span className="rhb-issue-title">{x.title}</span>
                  <span className="rhb-issue-where">{x.where}</span>
                </span>
                <Spark values={x.spark} />
                <span className="rhb-issue-n">{x.events}</span>
                <span className="rhb-issue-n">{x.users}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

const LinearPanel = memo(function LinearPanel() {
  return (
    <div className="rhb-col rhb-col-panel">
      <div className="rhb-band rhb-tabs">
        <span className="rhb-tab is-on">
          <LinearGlyph className="rhb-tab-ic rhb-logo" />
          Linear issues
        </span>
        <span className="rhb-band-end">
          <PanelRightIcon className="rhb-ic" />
        </span>
      </div>
      <div className="rhb-card rhb-card-panel">
        <div className="plugin-panel rhb-side-panel">
          <PanelBar name="Linear issues" meta="bb · 6 open" />
          <div className="plugin-panel-rows">
            {LINEAR_TASKS.map((task) => (
              <div className="plugin-task" key={task.key}>
                <span className={`plugin-task-status is-${task.status}`} />
                <span className="plugin-task-key">{task.key}</span>
                <span className="plugin-task-title">{task.title}</span>
                <span className={`plugin-task-prio is-${task.priority}`}>
                  {task.priority}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

const GLIDE_RATE = 0.02;
const ROOM_RATE = 0.011;

type FeedProps = {
  scene: Scene;
  reduced: boolean;
  out?: boolean;
  pre?: boolean;
  onIn?: () => void;
};

function FeedLayer({ scene, reduced, out, pre, onIn }: FeedProps) {
  const tablet = useMedia(TABLET_QUERY);
  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || reduced || out || pre) return;

    type Off = { top: number; off: number; v: number; w: number };
    const offs = new Map<HTMLElement, Off>();
    const self: Off = { top: feed.offsetTop, off: 0, v: 0, w: GLIDE_RATE };
    let raf = 0;
    let last = 0;
    const apply = (el: HTMLElement, off: number) => {
      el.style.translate = Math.abs(off) < 0.3 ? "" : `0 ${off}px`;
    };
    const settle = (o: Off, dt: number) => {
      const e = Math.exp(-o.w * dt);
      const c = o.v + o.w * o.off;
      o.off = (o.off + c * dt) * e;
      o.v = (o.v - o.w * c * dt) * e;
      return Math.abs(o.off) >= 0.3 || Math.abs(o.v) * 16 >= 0.3;
    };
    const tick = (ts: number) => {
      const dt = Math.min(last ? ts - last : 16, 64);
      last = ts;
      let live = settle(self, dt);
      apply(feed, self.off);
      offs.forEach((o, el) => {
        if (settle(o, dt)) live = true;
        apply(el, o.off);
      });
      if (live) raf = requestAnimationFrame(tick);
      else {
        self.off = self.v = 0;
        self.w = GLIDE_RATE;
        apply(feed, 0);
        offs.forEach((o, el) => {
          o.off = o.v = 0;
          apply(el, 0);
        });
        raf = 0;
        last = 0;
      }
    };

    const seen = new WeakSet<Element>();
    let primed = false;
    let growing = 0;
    let furling = 0;
    const visible = (el: Element | null) =>
      !!el && (el as HTMLElement).offsetParent !== null;
    const roomOf = (el: HTMLElement) => {
      const parent = el.parentElement;
      if (!parent) return 0;
      let prev = el.previousElementSibling;
      while (prev && !visible(prev)) prev = prev.previousElementSibling;
      const cs = getComputedStyle(el);
      const gap = prev ? parseFloat(getComputedStyle(parent).rowGap) || 0 : 0;
      return (
        el.offsetHeight +
        (parseFloat(cs.marginTop) || 0) +
        (parseFloat(cs.marginBottom) || 0) +
        gap
      );
    };
    const grow = (el: HTMLElement, room: number) => {
      const mb = parseFloat(getComputedStyle(el).marginBottom) || 0;
      if (room < 1) return false;
      growing++;
      const anim = el.animate(
        [{ marginBottom: `${mb - room}px` }, { marginBottom: `${mb}px` }],
        { duration: 300, easing: EASE_OUT },
      );
      const done = () => {
        growing--;
        self.top = feed.offsetTop;
      };
      anim.onfinish = done;
      anim.oncancel = done;
      return true;
    };
    const ITEMS = ":scope > *, .rhb-turn-body > *, .rhb-notes > *";
    const layer = feed.parentElement;
    const observe = () => {
      ro.observe(feed);
      if (layer) ro.observe(layer);
    };
    let resume = 0;
    const ro = new ResizeObserver(() => {
      const fresh: HTMLElement[] = [];
      for (const el of feed.querySelectorAll<HTMLElement>(ITEMS)) {
        if (!visible(el) || seen.has(el)) continue;
        seen.add(el);
        if (primed) fresh.push(el);
      }
      primed = true;
      let run = 0;
      let grew = false;
      for (const el of fresh) {
        if (fresh.some((p) => p !== el && p.contains(el))) continue;
        run += roomOf(el);
        let next = el.nextElementSibling;
        while (next && !visible(next)) next = next.nextElementSibling;
        if (next && fresh.includes(next as HTMLElement)) continue;
        if (grow(el, run)) grew = true;
        run = 0;
      }
      let moved = false;
      const ft = feed.offsetTop;
      const fd = growing || furling ? 0 : self.top - ft;
      self.top = ft;
      if (Math.abs(fd) >= 0.5) {
        self.off += fd;
        apply(feed, self.off);
        moved = true;
      }
      for (const child of Array.from(feed.children) as HTMLElement[]) {
        if (!child.offsetParent) {
          offs.delete(child);
          continue;
        }

        const top =
          child.offsetParent === feed ? child.offsetTop : child.offsetTop - ft;
        const o = offs.get(child);
        if (!o) {
          offs.set(child, { top, off: 0, v: 0, w: GLIDE_RATE });
          continue;
        }
        const d = furling ? 0 : o.top - top;
        o.top = top;
        if (Math.abs(d) >= 0.5) {
          o.off += d;
          apply(child, o.off);
          moved = true;
        }
      }
      if (moved && !raf) raf = requestAnimationFrame(tick);
      if (grew && !resume) {
        ro.disconnect();
        resume = requestAnimationFrame(() => {
          resume = 0;
          observe();
        });
      }
    });
    const makeRoom = (start: HTMLElement) => {
      const host = feed.parentElement;
      if (!host) return;
      const ghost = feed.cloneNode(true);
      if (!(ghost instanceof HTMLElement)) return;
      ghost.classList.add("is-measure");
      ghost.style.width = `${feed.offsetWidth}px`;
      host.appendChild(ghost);
      const mark = ghost.querySelector("[data-room]");
      const extent = mark
        ? ghost.getBoundingClientRect().bottom -
          mark.getBoundingClientRect().top
        : 0;
      ghost.remove();
      const at =
        start.getBoundingClientRect().top - feed.getBoundingClientRect().top;
      feed.style.minHeight = `${Math.ceil(at + extent)}px`;
      const ft = feed.offsetTop;
      const fd = self.top - ft;
      self.top = ft;
      if (Math.abs(fd) < 0.5) return;
      self.off += fd;
      self.w = ROOM_RATE;
      apply(feed, self.off);
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onAnimation = (e: AnimationEvent) => {
      if (
        e.type === "animationstart" &&
        e.animationName === "rhb-reveal" &&
        e.target instanceof HTMLElement &&
        e.target.hasAttribute("data-room")
      ) {
        makeRoom(e.target);
        return;
      }
      if (e.animationName !== "rhb-furl") return;
      furling = Math.max(0, furling + (e.type === "animationstart" ? 1 : -1));
    };
    const animationEvents = [
      "animationstart",
      "animationend",
      "animationcancel",
    ] as const;
    animationEvents.forEach((type) => feed.addEventListener(type, onAnimation));
    observe();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(resume);
      animationEvents.forEach((type) =>
        feed.removeEventListener(type, onAnimation),
      );
      cancelAnimationFrame(raf);
    };
  }, [reduced, out, pre]);

  return (
    <div
      className={`rhb-feed-layer rhb-fl-${scene.id}${pre ? " is-pre" : out ? " is-out" : ""}`}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && e.animationName === "rhb-feed-in")
          onIn?.();
      }}
    >
      <div className="rhb-feed" ref={feedRef}>
        <FeedBody scene={scene} reduced={reduced} tablet={tablet} />
      </div>
    </div>
  );
}

function Turn({
  worked,
  plan,
  head,
  doneAt,
  reduced,
}: {
  worked: string;
  plan: TurnPlan;
  head: number;
  doneAt: number | null;
  reduced: boolean;
}) {
  const sec = (s: number) => (reduced ? "0s" : `${s}s`);
  const furlAt = plan.furlAt;
  return (
    <>
      <TurnHeader
        worked={worked}
        doneAt={
          reduced
            ? doneAt == null
              ? null
              : 0
            : doneAt == null
              ? null
              : Math.max(0.01, doneAt - head)
        }
        furlAt={furlAt == null ? null : reduced ? 0 : furlAt - head}
        style={{ animationDelay: sec(head) }}
      />
      <div
        className={
          furlAt == null
            ? "rhb-turn-fold rhb-reveal"
            : "rhb-turn-fold rhb-reveal is-furling"
        }
        style={{
          animationDelay:
            furlAt == null ? sec(head) : `${sec(head)}, ${sec(furlAt)}`,
        }}
      >
        <div className="rhb-turn-body">
          {plan.rows.map((row, i) => (
            <WorkRow
              step={row.step}
              key={i}
              style={{ animationDelay: sec(row.at - head) }}
              doneAt={
                reduced
                  ? 0.001
                  : doneAt == null
                    ? null
                    : Math.max(0.01, doneAt - row.at)
              }
              muteAt={
                row.muteAt == null ? null : reduced ? 0 : row.muteAt - row.at
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}

const FeedBody = memo(function FeedBody({
  scene,
  reduced,
  tablet,
}: {
  scene: Scene;
  reduced: boolean;
  tablet: boolean;
}) {
  const t = timing(scene, tablet);
  const f = scene.follow && t.f ? { ...scene.follow, at: t.f } : null;
  const then = scene.then && t.then ? { ...scene.then, ...t.then } : null;
  const delay = (sec: number) => ({
    animationDelay: reduced ? "0s" : `${sec}s`,
  });
  const head = t.stepAt[0] ?? t.userAt + 0.4;
  return (
    <>
      {scene.context ? (
        <>
          <div className="rhb-user">{scene.context.prompt}</div>
          <TurnHeader
            worked={scene.context.worked}
            doneAt={0}
            style={{ animation: "none", opacity: 1 }}
          />
          <div className="rhb-say">{scene.context.reply}</div>
        </>
      ) : null}
      {scene.prompt ? (
        <div className="rhb-user customize-msg" style={delay(t.userAt)}>
          {scene.prompt}
        </div>
      ) : null}
      {scene.steps.length > 0 ? (
        <Turn
          worked={then ? then.worked : scene.worked}
          plan={t.turn}
          head={head}
          doneAt={t.doneAt}
          reduced={reduced}
        />
      ) : null}
      {(scene.post ?? []).map((p, i) =>
        "reply" in p ? (
          <div
            className="rhb-say customize-msg"
            key={`r${i}`}
            style={delay(t.postAt[i])}
          >
            {p.reply}
          </div>
        ) : null,
      )}

      {then ? (
        <>
          <div className="rhb-say customize-msg" style={delay(then.at)}>
            {then.reply}
          </div>
          <div className="rhb-notes">
            <div className="rhb-gen customize-msg" style={delay(then.notes[0])}>
              <span className="rhb-gen-head">
                <CircleCheckIcon className="rhb-gen-ic" />
                <span className="rhb-gen-subject">{CHILD.title}</span>
                <span className="rhb-gen-verb">finished</span>
              </span>
              <span className="rhb-gen-body">
                Tests are in. 2 fail on the old build.
              </span>
            </div>
            <div className="rhb-gen customize-msg" style={delay(then.notes[1])}>
              <span className="rhb-gen-head">
                <SentGlyph className="rhb-gen-ic" />
                <span className="rhb-gen-verb">Sent to</span>
                <ThreadPill icon={CHILD.icon} label={CHILD.title} />
              </span>
              <span className="rhb-gen-body">
                Export is in. Run the suite again.
              </span>
            </div>
            <div className="rhb-gen customize-msg" style={delay(then.notes[2])}>
              <span className="rhb-gen-head">
                <MessageIcon className="rhb-gen-ic" />
                <span className="rhb-gen-verb">Message from</span>
                <ThreadPill icon={CHILD.icon} label={CHILD.title} />
              </span>
              <span className="rhb-gen-body">All 8 pass.</span>
            </div>
          </div>
        </>
      ) : null}

      {scene.flags.includes("chart") ? (
        <div
          className="customize-msg rhb-chart"
          style={delay((t.postAt.at(-1) ?? t.changeAt) + ROW_GAP)}
        >
          <span className="rhb-chart-head">
            <span className="rhb-chart-title">Flaky tests by package</span>
            <span className="rhb-plugin-tag">
              <PluginsIcon className="rhb-tag-ic" />
              Generative UI
            </span>
          </span>
          <span className="rhb-chart-sub">Last 7 days · 22 flaky runs</span>
          <span className="rhb-chart-rows">
            {FLAKY.map((row, i) => (
              <span className="rhb-chart-row" key={row.name}>
                <span className="rhb-chart-label">{row.name}</span>
                <span className="rhb-chart-track">
                  <span
                    className="rhb-chart-bar"
                    style={{
                      width: `${(row.n / FLAKY[0].n) * 100}%`,
                      ...delay(0.45 + i * 0.06),
                    }}
                  />
                </span>
                <span className="rhb-chart-value">{row.n}</span>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {f ? (
        <>
          <div
            className="rhb-user customize-msg"
            data-room=""
            style={delay(f.at.user)}
          >
            {f.prompt}
          </div>
          <Turn
            worked={f.worked}
            plan={f.at.turn}
            head={f.at.steps[0]}
            doneAt={f.at.reply}
            reduced={reduced}
          />
          <div className="rhb-say customize-msg" style={delay(f.at.reply)}>
            {f.reply}
          </div>
          {f.fixes.map((x, i) => {
            const k = f.clicks.indexOf(i);
            const at = k >= 0 ? f.at.clicks[k] - f.at.cards[i] : 0;
            return (
              <div
                className="rhb-fix-card customize-msg"
                key={x.title}
                style={delay(f.at.cards[i])}
              >
                <span className="rhb-fix-text">
                  <span className="rhb-fix-head">
                    <span className="rhb-fix-title">{x.title}</span>
                    <span className="rhb-plugin-tag">
                      <PluginsIcon className="rhb-tag-ic" />
                      Impromptu UI
                    </span>
                  </span>
                  <span className="rhb-fix-sub">{x.sub}</span>
                </span>
                <span className="rhb-fix-btn">
                  {k < 0 ? (
                    <span className="rhb-fix-idle">Start thread</span>
                  ) : (
                    <>
                      <span
                        className="rhb-fix-idle is-timed"
                        style={{ animationDelay: `${at}s` }}
                      >
                        Start thread
                      </span>
                      <span
                        className="rhb-fix-run"
                        style={{ animationDelay: `${at}s` }}
                      >
                        <Spinner className="trun rhb-work-spin" />
                        Running
                      </span>
                      <CursorGlyph style={{ animationDelay: `${at - 0.7}s` }} />
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </>
      ) : null}
    </>
  );
});

const IssueGlyph: IconComp = ({ className }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden fill="none">
    <circle cx="8" cy="8" r="6.1" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="8" cy="8" r="1.6" fill="currentColor" />
  </svg>
);

const ISSUES: { n: number; title: string; csv?: boolean }[] = [
  { n: 503, title: "Dark mode flicker on launch" },
  { n: 491, title: "CSV export times out", csv: true },
  { n: 482, title: "Login redirect loop" },
  { n: 468, title: "CSV import drops header row", csv: true },
];

function ComposerText({ demo, leaving }: { demo: boolean; leaving: boolean }) {
  return (
    <>
      {demo ? null : (
        <span
          className={leaving ? "rhb-placeholder is-back" : "rhb-placeholder"}
        >
          Ask for a follow-up. @ to mention files, folders, sections, or threads
        </span>
      )}
      {demo || leaving ? (
        <div className={demo ? "rhb-issue-demo" : "rhb-issue-demo is-leaving"}>
          <span className="rhb-placeholder rhb-issue-ph">
            Ask for a follow-up. @ to mention files, folders, sections, or
            threads
          </span>
          <span className="rhb-issue-q">
            <span className="rhb-issue-q1">#</span>
            <span className="rhb-issue-q2">#csv</span>
            <i className="rhb-caret" />
          </span>
          <div className="rhb-issue-picker">
            <div className="rhb-issue-head">GitHub issues</div>
            <div className="rhb-issue-list">
              {ISSUES.map((x, i) => (
                <div
                  key={x.n}
                  className={[
                    "rhb-issue-option",
                    i === 0 && "is-first",
                    !x.csv && "is-drop",
                    x.n === 491 && "is-pick",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <IssueGlyph className="rhb-issue-ic" />
                  <span className="rhb-issue-num">#{x.n}</span>
                  <span className="rhb-issue-title">{x.title}</span>
                  <span className="rhb-issue-meta">open</span>
                </div>
              ))}
            </div>
          </div>
          <span className="rhb-issue-draft">
            <span className="rhb-issue-chip">
              <IssueGlyph className="rhb-issue-chip-ic" />
              <span className="rhb-issue-chip-text">
                #491 CSV export times out
              </span>
            </span>
            <span className="rhb-issue-rest">fix this</span>
          </span>
        </div>
      ) : null}
    </>
  );
}

type ShellProps = {
  idx: number;
  n: number;
  reduced: boolean;
  ghost?: boolean;
  pre?: boolean;
  frozen?: boolean;
  nextFeed?: number | null;
};

function Shell({ idx, n, reduced, ghost, pre, frozen, nextFeed }: ShellProps) {
  const scene = SCENES[idx];
  const tablet = useMedia(TABLET_QUERY);
  const t = timing(scene, tablet);
  const f = scene.follow && t.f ? { ...scene.follow, at: t.f } : null;
  const then = scene.then && t.then ? { ...scene.then, ...t.then } : null;
  const delay = (sec: number) => ({
    animationDelay: reduced ? "0s" : `${sec}s`,
  });

  const hasSet = new Set<string>();
  const usesSet = new Set<string>();
  SCENES.forEach((sc, k) => {
    const lasting = [
      ...sc.flags.filter((x) => PERSIST.has(x)),
      ...(RAIL[sc.id] ? [RAIL[sc.id]] : []),
    ];
    if (k < idx || (k === idx && n >= 1))
      lasting.forEach((x) => (hasSet.add(x), usesSet.add(x)));
    if (k === idx) {
      sc.flags.forEach((x) => usesSet.add(x));
      if (n >= 1 && n !== 3 && n !== 5 && n !== 6)
        sc.flags.forEach((x) => hasSet.add(x));
    }
  });
  if (scene.id === "sentry" && (n === 5 || n === 1)) hasSet.add("collapsed");
  if (scene.id === "linear" && tablet && (n === 5 || n === 1 || n === 3))
    hasSet.add("panel-collapsed");
  const uses = (x: string) => usesSet.has(x);
  const spawnIdx = SCENES.findIndex((x) => x.id === "spawn");
  const chartIdx = SCENES.findIndex((x) => x.id === "chart");
  const chart = SCENES[chartIdx];
  const chartF =
    chart.follow && timing(chart).f
      ? { ...chart.follow, at: timing(chart).f! }
      : null;

  const rootRef = useRef<HTMLDivElement>(null);

  const stripItems: { icon: IconComp; label: string }[] = [
    { icon: NewThreadIcon, label: "New thread" },
    NAV_ITEMS[0],
    ...(hasSet.has("rail-sentry")
      ? [{ icon: SentryGlyph as IconComp, label: "Sentry" }]
      : []),
    ...(hasSet.has("rail-linear")
      ? [{ icon: LinearGlyph as IconComp, label: "Linear" }]
      : []),
    { icon: SearchIcon, label: "Search" },
    ...NAV_ITEMS.slice(1),
  ];
  const stripRef = useRef<HTMLSpanElement>(null);
  const [stripFit, setStripFit] = useState(stripItems.length);
  const hasStrip = usesSet.has("strip");
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => {
      const per = 15 + 6;
      setStripFit(Math.max(1, Math.floor((el.clientWidth + 6) / per)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasStrip]);
  const stripMore = stripItems.length > stripFit;
  const stripShown = stripMore ? stripItems.slice(0, stripFit - 1) : stripItems;

  const lastPhase = useRef({ idx, n });
  const firstSnap = useRef<Snap | null>(null);
  const flips = lastPhase.current.idx === idx && lastPhase.current.n !== n;
  const rowSnap = useRef<RowSnap | null>(null);
  if (flips && rootRef.current && !firstSnap.current) {
    firstSnap.current = snapLayout(
      rootRef.current,
      scene.flags.includes("split") || scene.flags.includes("panel"),
    );
    rowSnap.current = snapRows(rootRef.current);
  }
  useLayoutEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = { idx, n };
    const first = firstSnap.current;
    firstSnap.current = null;
    const rows = rowSnap.current;
    rowSnap.current = null;
    if (was.idx !== idx || was.n === n || !first || reduced || !rootRef.current)
      return;
    flipLayout(rootRef.current, first);
    if (rows) slideRows(rootRef.current, rows);
  }, [idx, n, reduced]);

  const [outIdx, setOutIdx] = useState<number | null>(null);
  const prevIdx = useRef(idx);
  useLayoutEffect(() => {
    if (prevIdx.current === idx) return;
    const from = prevIdx.current;
    prevIdx.current = idx;
    if (reduced) return;
    setOutIdx(from);
  }, [idx, reduced]);

  const titleRef = useRef<HTMLSpanElement>(null);
  const titleW = useRef({ idx, w: 0 });
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const was = titleW.current;
    const w = el.offsetWidth;
    titleW.current = { idx, w };
    if (reduced || was.idx === idx || !was.w || Math.abs(was.w - w) <= 1)
      return;
    const titles = Array.from(el.children) as HTMLElement[];
    el.style.overflow = "hidden";
    titles.forEach((t) => (t.style.textOverflow = "clip"));
    const anim = el.animate([{ width: `${was.w}px` }, { width: `${w}px` }], {
      duration: 300,
      easing: EASE_OUT,
    });
    anim.onfinish = anim.oncancel = () => {
      el.style.removeProperty("overflow");
      titles.forEach((t) => t.style.removeProperty("text-overflow"));
    };
  }, [idx, n, reduced]);

  const clearOut = () => setOutIdx(null);
  const outgoing = prevIdx.current < idx ? prevIdx.current : outIdx;
  const shellClass = [
    "rhb-stage",
    `rhb-scene-${n === 2 && then ? then.id : scene.id}`,
    n >= 1 && "rhb-on",
    n === 4 && "rhb-final",
    reduced && "rhb-still",
    ghost && "rhb-stage-out",
    pre && "rhb-stage-pre",
    frozen && "rhb-stage-held",
    ...[...hasSet].map((x) => `rhb-has-${x}`),
    ...[...usesSet].map((x) => `rhb-uses-${x}`),
    (n >= 1 && scene.sideView) || n === 4 ? "rhb-side-view" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sceneRows = SCENES.slice(0, idx + 1)
    .map((sc, k) => ({ sc, k }))
    .reverse();
  const statusOf = (k: number): Status => FINAL_STATUS[SCENES[k].id] ?? "done";

  const groups: {
    name: string;
    rows: {
      title: string;
      sub: string;
      age: string;
      status: Status | "unread";
      active?: boolean;
    }[];
  }[] = [
    {
      name: "Needs my input",
      rows: [
        {
          title: "Refactor the timeline cache",
          sub: "bb · main",
          age: "5m",
          status: "waiting",
        },
      ],
    },
    {
      name: "Running",
      rows: [
        ...(n === 4
          ? []
          : [
              {
                title: scene.title,
                sub: "bb · main",
                age: "now",
                status: "running" as Status,
                active: true,
              },
            ]),
        ...(chartF
          ? chartF.clicks.map((fi) => ({
              title: chartF.fixes[fi].title,
              sub: "bb · ci",
              age: "3m",
              status: "running" as Status,
            }))
          : []),
        {
          title: "Sentry errors",
          sub: "checkout-web",
          age: "9m",
          status: "running",
        },
      ],
    },
    {
      name: "Unread",
      rows: [
        {
          title: "Nightly changelog",
          sub: "site · main",
          age: "1h",
          status: "unread",
        },
      ],
    },
    {
      name: "Done",
      rows: SCENES.slice(0, n === 4 ? idx + 1 : idx)
        .filter((sc) => statusOf(SCENES.indexOf(sc)) === "done")
        .reverse()
        .map((sc) => ({
          title: sc.title,
          sub: "bb · main",
          age: "8m",
          status: "done" as Status,
        })),
    },
  ];

  return (
    <div className={shellClass} ref={rootRef} aria-hidden>
      <div className="rhb-body">
        <div className="rhb-left">
          <div className="rhb-band rhb-chrome-space" />
          <div className="rhb-left-body">
            <NavRail>
              <span className="rail-btn rhb-rail-new rhb-rail-sentry">
                <SentryGlyph className="rail-ic" />
              </span>
              <span className="rail-btn rhb-rail-new rhb-rail-linear">
                <LinearGlyph className="rail-ic rhb-logo" />
              </span>
            </NavRail>
            <aside className="rhb-side">
              {uses("strip") ? (
                <div className="rhb-strip">
                  <ChevronRight className="rhb-chev" />
                  <span className="rhb-strip-label">Navigation</span>
                  <span className="rhb-strip-icons" ref={stripRef}>
                    {stripShown.map(({ icon: Icon, label }) => (
                      <Icon
                        className={
                          label === "Linear" ? "rhb-ic rhb-logo" : "rhb-ic"
                        }
                        key={label}
                      />
                    ))}
                    {stripMore ? <Ellipsis className="rhb-ic" /> : null}
                  </span>
                </div>
              ) : null}
              <div className="rhb-row rhb-row-new">
                <NewThreadIcon className="rhb-ic" />
                New thread
              </div>
              <div className="rhb-lists">
                <div className="rhb-list rhb-list-plain">
                  <div className="rhb-label">
                    Pinned
                    <ChevronDown className="rhb-chev" />
                  </div>
                  <div className="rhb-row">
                    <span className="rhb-row-title">Chief</span>
                  </div>
                  <div className="rhb-label">
                    Threads
                    <ChevronDown className="rhb-chev" />
                  </div>
                  {sceneRows.map(({ sc, k }) => (
                    <div className="rhb-thread" key={sc.id}>
                      <div
                        className={
                          k === idx && n !== 4
                            ? "rhb-row rhb-row-scene is-active"
                            : "rhb-row rhb-row-scene"
                        }
                      >
                        <span className="rhb-row-title">{sc.title}</span>
                        {k === idx && !reduced ? (
                          (() => {
                            const tk = timing(sc, tablet);
                            return tk.doneAt == null ||
                              FINAL_STATUS[sc.id] === "running" ? (
                              <ThreadStatus status="running" />
                            ) : (
                              <Swap
                                className="rhb-status-swap"
                                at={tk.doneAt}
                                a={<ThreadStatus status="running" />}
                                b={<ThreadStatus status="done" />}
                              />
                            );
                          })()
                        ) : (
                          <ThreadStatus status={statusOf(k)} />
                        )}
                      </div>
                      {k === spawnIdx ? (
                        <div
                          className={
                            k === idx ? "rhb-kids rhb-kids-late" : "rhb-kids"
                          }
                          style={
                            k === idx
                              ? delay((t.stepAt[1] ?? t.changeAt) + 0.35)
                              : undefined
                          }
                        >
                          <div className="rhb-row rhb-kid">
                            <CHILD.icon className="rhb-kid-ic" />
                            <span className="rhb-row-title">{CHILD.title}</span>
                            {k === idx && then && !reduced ? (
                              <Swap
                                className="rhb-status-swap"
                                at={
                                  then.notes[0] -
                                  ((t.stepAt[1] ?? t.changeAt) + 0.35)
                                }
                                a={<ThreadStatus status="running" />}
                                b={<ThreadStatus status="done" />}
                              />
                            ) : (
                              <ThreadStatus status="done" />
                            )}
                          </div>
                        </div>
                      ) : null}
                      {k === chartIdx && chartF
                        ? chartF.clicks.map((fi, c) => (
                            <div
                              className={
                                k === idx
                                  ? "rhb-kids rhb-kids-late"
                                  : "rhb-kids"
                              }
                              key={fi}
                              style={
                                k === idx && f
                                  ? delay(f.at.clicks[c] + 0.3)
                                  : undefined
                              }
                            >
                              <div className="rhb-row rhb-kid">
                                <ClaudeIcon className="rhb-kid-ic" />
                                <span className="rhb-row-title">
                                  {chartF.fixes[fi].title}
                                </span>
                                <ThreadStatus status="running" />
                              </div>
                            </div>
                          ))
                        : null}
                    </div>
                  ))}
                  {THREADS.map((x) => (
                    <div className="rhb-row" key={x.title}>
                      <span className="rhb-row-title">{x.title}</span>
                      <ThreadStatus status={x.status} />
                    </div>
                  ))}
                </div>
                {uses("grouped") ? (
                  <div className="rhb-list rhb-list-grouped">
                    <div className="rhb-plugin-tag">
                      <PluginsIcon className="rhb-tag-ic" />
                      Grouped by status
                    </div>
                    {groups.map((g) => (
                      <div key={g.name}>
                        <div className="rhb-label" data-k={`g:${g.name}`}>
                          {g.name}
                        </div>
                        {g.rows.map((r) => (
                          <div
                            className={
                              r.active && n !== 4
                                ? "rhb-row rhb-row2 is-active"
                                : "rhb-row rhb-row2"
                            }
                            key={r.title}
                            data-k={`r:${r.title}`}
                          >
                            <ThreadStatus
                              status={r.active && n === 4 ? "done" : r.status}
                            />
                            <span className="rhb-row2-text">
                              <span className="rhb-row-title">{r.title}</span>
                              <span className="rhb-row2-sub">{r.sub}</span>
                            </span>
                            <span className="rhb-age">{r.age}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="rhb-foot">
                <PhoneIcon className="rhb-ic" />
                <BugIcon className="rhb-ic" />
              </div>
            </aside>
          </div>
        </div>

        <SentryPage />

        <div className="rhb-col rhb-col-main">
          <div className="rhb-band">
            <span className="rhb-title-stack" ref={titleRef}>
              {outIdx != null && outIdx < idx ? (
                <span className="rhb-title is-out" key={`t${outIdx}`}>
                  {SCENES[outIdx].title}
                </span>
              ) : null}
              <span className="rhb-title rhb-title-swap" key={`t${idx}`}>
                {scene.title}
              </span>
            </span>
            <Ellipsis className="rhb-ic" />
            <span className="rhb-band-end">
              <EditorButton />
              <PanelRightIcon className="rhb-ic rhb-panel-toggle" />
            </span>
          </div>
          <div className="rhb-card rhb-card-main">
            <div className="rhb-scroll">
              {[
                ...new Set([
                  ...(outgoing != null && outgoing < idx ? [outgoing] : []),
                  idx,
                  ...(nextFeed != null && nextFeed > idx ? [nextFeed] : []),
                ]),
              ].map((k) => (
                <FeedLayer
                  key={k}
                  scene={SCENES[k]}
                  reduced={reduced}
                  out={k < idx}
                  pre={k > idx}
                  onIn={k === idx ? clearOut : undefined}
                />
              ))}
            </div>

            <div className="rhb-dock-wrap">
              <ComposerBox
                attach="plus"
                model={
                  <>
                    <span className="rhb-model-name">Opus 5.5</span>{" "}
                    <span className="rhb-model-sub">Medium</span>
                  </>
                }
              >
                <ComposerText
                  demo={scene.id === "composer" && n === 1}
                  leaving={
                    outgoing != null && SCENES[outgoing].id === "composer"
                  }
                />
              </ComposerBox>
              <ContextRow
                project="bb"
                place={{ icon: FolderGitIcon, label: "Worktree" }}
                branch="main"
              />
            </div>
          </div>
        </div>

        <LinearPanel />
      </div>
    </div>
  );
}

const FINAL_HOLD = 4.7;
const RESTART_FADE = 0.7;

type Clock = {
  at: (sec: number, fn: () => void) => () => void;
  setPaused: (paused: boolean) => void;
};

function createClock(startPaused: boolean): Clock {
  type Timer = { fn: () => void; left: number; from: number; id: number };
  let paused = startPaused;
  const timers = new Set<Timer>();
  const arm = (timer: Timer) => {
    timer.from = performance.now();
    timer.id = window.setTimeout(() => {
      timers.delete(timer);
      timer.fn();
    }, timer.left);
  };
  return {
    at(sec, fn) {
      const timer: Timer = { fn, left: sec * 1000, from: 0, id: 0 };
      timers.add(timer);
      if (!paused) arm(timer);
      return () => {
        window.clearTimeout(timer.id);
        timers.delete(timer);
      };
    },
    setPaused(next) {
      if (next === paused) return;
      paused = next;
      for (const timer of timers) {
        if (paused) {
          window.clearTimeout(timer.id);
          timer.left -= performance.now() - timer.from;
        } else {
          arm(timer);
        }
      }
    },
  };
}

export default function HeroWindowStage({ paused }: { paused: boolean }) {
  const tablet = useMedia(TABLET_QUERY);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const last = SCENES.length - 1;
  const [clock] = useState(() => createClock(paused));
  useEffect(() => clock.setPaused(paused), [clock, paused]);

  const [loop, setLoop] = useState(0);
  const [pos, setPos] = useState<{ idx: number; n: number }>({ idx: 0, n: 0 });

  const [nextFeed, setNextFeed] = useState<number | null>(null);
  const [ghost, setGhost] = useState<number | null>(null);
  const [pre, setPre] = useState<number | null>(null);
  const ghostRef = useRef(ghost);
  useLayoutEffect(() => {
    ghostRef.current = ghost;
  }, [ghost]);
  useEffect(() => {
    if (reduced) return;
    const idx = pos.idx;
    const scene = SCENES[idx];
    const t = timing(scene, tablet);
    const lead = idx === 0 && ghostRef.current != null ? RESTART_FADE : 0;
    const at = (sec: number, fn: () => void) => clock.at(sec + lead, fn);
    const ids = [at(t.changeAt, () => setPos({ idx, n: 1 }))];
    if (t.collapseAt !== null)
      ids.push(at(t.collapseAt, () => setPos({ idx, n: 5 })));
    if (t.then) ids.push(at(t.then.at, () => setPos({ idx, n: 2 })));
    const closes = CLOSES.has(scene.id);
    if (closes) ids.push(at(t.end, () => setPos({ idx, n: 3 })));
    const sequentialClose = scene.id === "linear" && tablet;
    if (sequentialClose) ids.push(at(t.end + 1, () => setPos({ idx, n: 6 })));
    const next =
      t.end + (closes ? REST_AFTER_CLOSE : REST) + (sequentialClose ? 1 : 0);
    if (lead) ids.push(clock.at(lead, () => setGhost(null)));
    if (idx < last) {
      ids.push(
        at(next - 0.8, () => startTransition(() => setNextFeed(idx + 1))),
      );
      ids.push(at(next, () => setPos({ idx: idx + 1, n: 0 })));
    } else {
      ids.push(at(t.end, () => setPos({ idx, n: 4 })));
      ids.push(
        at(t.end + FINAL_HOLD - 1.6, () =>
          startTransition(() => setPre(loop + 1)),
        ),
      );
      ids.push(
        at(t.end + FINAL_HOLD, () => {
          setGhost(loop);
          setPre(null);
          setNextFeed(null);
          setLoop((l) => l + 1);
          setPos({ idx: 0, n: 0 });
        }),
      );
    }
    return () => ids.forEach((cancel) => cancel());
  }, [clock, loop, pos.idx, reduced, last, tablet]);

  if (reduced) {
    return <Shell key="still" idx={last} n={4} reduced />;
  }
  return (
    <>
      {ghost != null ? (
        <Shell key={ghost} idx={last} n={4} reduced={false} ghost />
      ) : null}
      <Shell
        key={loop}
        idx={pos.idx}
        n={pos.n}
        reduced={false}
        nextFeed={nextFeed}
        frozen={ghost != null}
      />
      {pre != null ? (
        <Shell key={pre} idx={0} n={0} reduced={false} pre />
      ) : null}
    </>
  );
}
