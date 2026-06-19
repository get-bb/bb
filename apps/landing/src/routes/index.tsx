import {
  ArrowDown01Icon,
  ArrowExpand01Icon,
  ArrowLeft01Icon,
  ArrowMoveDownLeftIcon,
  ArrowRight01Icon,
  AttachmentIcon,
  BubbleChatAddIcon,
  Clock01Icon,
  DashedLineCircleIcon,
  FolderGitTwoIcon,
  FolderIcon as HiFolderIcon,
  GitBranchIcon as HiGitBranchIcon,
  GitMergeIcon as HiGitMergeIcon,
  LaptopIcon as HiLaptopIcon,
  Mic02Icon,
  MoreHorizontalIcon,
  PlusMinusSquare01Icon,
  Search01Icon,
  SentIcon,
  Settings01Icon,
  SidebarLeftIcon,
  SidebarRightIcon,
  Tick02Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { trackLandingEvent } from "../analytics";
import bbIcon from "../assets/bb-icon.png";
import vscodeIcon from "../assets/vscode.png";
import { ClaudeIcon, CursorIcon, OpenAiIcon, PiIcon } from "../icons";
import type { CtaPlacement } from "../site";
import { CLI_COMMAND, GITHUB_URL, downloadMacosHref } from "../site";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

/* ── CTAs ─────────────────────────────────────────────────────────── */

type CtaLinkProps = {
  placement: CtaPlacement;
  /** Omit for a plain inline link (nav/footer); set for button-styled CTAs. */
  className?: string;
  children: ReactNode;
};

function DownloadLink({ placement, className, children }: CtaLinkProps) {
  return (
    <a className={className} href={downloadMacosHref(placement)}>
      {children}
    </a>
  );
}

function GitHubLink({ placement, className, children }: CtaLinkProps) {
  return (
    <a
      className={className}
      href={GITHUB_URL}
      onClick={() =>
        trackLandingEvent({
          name: "landing_github_clicked",
          properties: { placement },
        })
      }
    >
      {children}
    </a>
  );
}

function InstallCommand({ placement }: { placement: CtaPlacement }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    // Track and show feedback first; the clipboard write can reject (no user
    // activation, permissions) and must not swallow the event.
    trackLandingEvent({
      name: "landing_cli_command_copied",
      properties: { placement, command: CLI_COMMAND },
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    navigator.clipboard.writeText(CLI_COMMAND).catch(() => {});
  };
  return (
    <div className="install mono">
      <span className="dollar">$</span>
      <span>{CLI_COMMAND}</span>
      <button
        type="button"
        className={copied ? "copied" : undefined}
        onClick={copy}
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
    </div>
  );
}

/* ── Scroll reveal ────────────────────────────────────────────────── */

/** Fade-up sections as they scroll into view. No-JS and prerender stay fully visible. */
function useScrollReveal() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const targets = Array.from(document.querySelectorAll("[data-reveal]"));
    for (const target of targets) {
      if (target.getBoundingClientRect().top > window.innerHeight * 0.9) {
        target.classList.add("reveal-pending");
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.remove("reveal-pending");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const target of targets) {
      observer.observe(target);
    }
    return () => observer.disconnect();
  }, []);
}

/* ── Shared bits ──────────────────────────────────────────────────── */

function ProviderChips() {
  return (
    <>
      <span className="chip">
        <ClaudeIcon className="chip-icon" />
        Claude Code
      </span>
      <span className="chip">
        <OpenAiIcon className="chip-icon" />
        Codex
      </span>
      <span className="chip">
        <CursorIcon className="chip-icon" />
        Cursor
      </span>
      <span className="chip">
        <PiIcon className="chip-icon" />
        Pi
      </span>
    </>
  );
}

/* ── Hero: interactive bb app mock ────────────────────────────────── */
// A faithful recreation of the bb app: icon rail + thread sidebar + a markdown
// conversation + the real composer (PR/diff bar, model picker, worktree row).
// Clicking a thread in the sidebar swaps the conversation and composer.

type IconProps = { className?: string };

// Real bb app icons (Hugeicons), matched to the app's own Icon map in
// apps/app/src/components/ui/icon.tsx — same glyphs the desktop app renders.
const PanelIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SidebarLeftIcon} className={className} />
);
const PanelRightIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SidebarRightIcon} className={className} />
);
const ChevronLeft = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowLeft01Icon} className={className} />
);
const ChevronRight = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowRight01Icon} className={className} />
);
const ChevronDown = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowDown01Icon} className={className} />
);
const Ellipsis = ({ className }: IconProps) => (
  <HugeiconsIcon icon={MoreHorizontalIcon} className={className} />
);
const SearchIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Search01Icon} className={className} />
);
const NewThreadIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={BubbleChatAddIcon} className={className} />
);
const ClockIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Clock01Icon} className={className} />
);
const GearIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Settings01Icon} className={className} />
);
const CheckIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Tick02Icon} className={className} />
);
const BoltIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ZapIcon} className={className} />
);
const PaperPlane = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SentIcon} className={className} />
);
const Paperclip = ({ className }: IconProps) => (
  <HugeiconsIcon icon={AttachmentIcon} className={className} />
);
const FolderIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={HiFolderIcon} className={className} />
);
const FolderGitIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={FolderGitTwoIcon} className={className} />
);
const GitBranchIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={HiGitBranchIcon} className={className} />
);
const GitMergeIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={HiGitMergeIcon} className={className} />
);
const Spinner = ({ className }: IconProps) => (
  <HugeiconsIcon icon={DashedLineCircleIcon} className={className} />
);
const Maximize2 = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowExpand01Icon} className={className} />
);
const MicIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Mic02Icon} className={className} />
);
const SendIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowMoveDownLeftIcon} className={className} />
);
const LaptopGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={HiLaptopIcon} className={className} />
);
const FileDiffIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={PlusMinusSquare01Icon} className={className} />
);

type Status = "running" | "done" | "waiting";
type Step =
  | { kind: "user"; text: string }
  | { kind: "step"; text: string }
  | { kind: "say"; text: ReactNode };
type MockThread = {
  id: string;
  title: string;
  status: Status;
  branch: string;
  pr?: number;
  change: { files: number; add: number; del: number };
  transcript: Step[];
};

const HERO_THREADS: MockThread[] = [
  {
    id: "sentry",
    title: "Triage the Sentry spike",
    status: "running",
    branch: "bb/triage-sentry-spike",
    change: { files: 6, add: 124, del: 18 },
    transcript: [
      { kind: "user", text: "Triage the Sentry spike on checkout." },
      { kind: "step", text: "Explored 4 files" },
      {
        kind: "say",
        text: (
          <>
            The spike is one error — 92% of volume: a null <code>cart</code> in{" "}
            <code>applyPromo</code>.
          </>
        ),
      },
      { kind: "step", text: "Edited 2 files" },
      {
        kind: "say",
        text: (
          <>
            Guarded the null case and added a regression test in{" "}
            <code>promo.test.ts</code>. Re-running the suite.
          </>
        ),
      },
    ],
  },
  {
    id: "changelog",
    title: "Nightly changelog",
    status: "done",
    branch: "bb/nightly-changelog",
    pr: 418,
    change: { files: 1, add: 96, del: 4 },
    transcript: [
      { kind: "step", text: "Explored 14 commits" },
      {
        kind: "say",
        text: "14 user-facing commits since yesterday. Grouped them by area.",
      },
      { kind: "step", text: "Edited 1 file" },
      {
        kind: "say",
        text: (
          <>
            Wrote <code>CHANGELOG.md</code> and opened PR #418.
          </>
        ),
      },
    ],
  },
  {
    id: "timeline",
    title: "Refactor the timeline cache",
    status: "waiting",
    branch: "bb/timeline-cache",
    change: { files: 3, add: 41, del: 67 },
    transcript: [
      {
        kind: "user",
        text: "Refactor the timeline cache to drop the duplicate fetch.",
      },
      { kind: "step", text: "Explored 3 files" },
      {
        kind: "say",
        text: (
          <>
            Two options: a shared in-flight promise, or a short TTL cache. The
            promise is simplest — want me to go with that?
          </>
        ),
      },
    ],
  },
  {
    id: "lin482",
    title: "Start on LIN-482",
    status: "running",
    branch: "bb/lin-482-debounce-search",
    change: { files: 2, add: 33, del: 5 },
    transcript: [
      { kind: "step", text: "Read LIN-482" },
      {
        kind: "say",
        text: (
          <>
            “Debounce the search input.” Adding a 200ms debounce in{" "}
            <code>SearchBar</code>.
          </>
        ),
      },
      { kind: "step", text: "Edited 1 file" },
      { kind: "say", text: "Added the debounce and a test. Verifying." },
    ],
  },
];

function ThreadStatus({ status }: { status: Status }) {
  if (status === "running") {
    return <Spinner className="trun" />;
  }
  if (status === "done") {
    return <CheckIcon className="tdone" />;
  }
  return <span className="twait" aria-hidden />;
}

type DiffLine = { t: "ctx" | "add" | "del"; text: string };
const DIFF_LINES: DiffLine[] = [
  { t: "ctx", text: 'it("applies a valid promo", () => {' },
  { t: "ctx", text: "  const cart = makeCart([item]);" },
  { t: "del", text: '  expect(applyPromo(cart, "SAVE10"))' },
  { t: "add", text: '  expect(applyPromo(cart, "SAVE10").total)' },
  { t: "add", text: "    .toBeCloseTo(8.99);" },
  { t: "ctx", text: "});" },
  { t: "ctx", text: "" },
  { t: "add", text: 'it("ignores a null cart", () => {' },
  { t: "add", text: '  expect(() => applyPromo(null, "SAVE10"))' },
  { t: "add", text: "    .not.toThrow();" },
  { t: "add", text: "});" },
];

// The prompt box — used for follow-ups (with a thread) and the new-thread page
// (no thread). Carries the full button set: expand, model picker, attach, mic,
// send, plus the project / environment / branch / permission context row.
function Composer({ thread }: { thread?: MockThread }) {
  const isNew = !thread;
  return (
    <div className={isNew ? "composer composer-new" : "composer"}>
      {thread ? (
        <div className="pr-bar">
          <GitMergeIcon className="pr-ic" />
          <span className="pr-strong">
            {thread.pr ? `PR #${thread.pr}` : "Working tree"}
          </span>
          <span className="pr-dim">
            · {thread.pr ? "Merged" : "Uncommitted"} · {thread.change.files}{" "}
            {thread.change.files === 1 ? "file" : "files"},
          </span>
          <span className="pr-add">+{thread.change.add}</span>
          <span className="pr-del">-{thread.change.del}</span>
          <ChevronDown className="pr-ic pr-chev" />
        </div>
      ) : null}
      <div className="composer-box">
        <div className="composer-top">
          <textarea
            className="composer-input"
            rows={1}
            placeholder={
              isNew
                ? "Ask anything. @ to mention files or folders"
                : "Ask for a follow-up. @ to mention files, folders, or threads"
            }
            aria-label={isNew ? "Start a new thread" : "Message this thread"}
          />
          <Maximize2 className="cb-expand" />
        </div>
        <div className="composer-row">
          <span className="model">
            <ClaudeIcon className="model-ic" />
            Opus 4.8 1M
            <ChevronDown className="chev-sm" />
          </span>
          <span className="composer-actions" aria-hidden>
            <Paperclip className="composer-clip" />
            <MicIcon className="composer-clip" />
            <span className="send-btn">
              <SendIcon className="send-ic" />
            </span>
          </span>
        </div>
      </div>
      <div className="context-row">
        <span className="ctx">
          <FolderIcon className="ctx-ic" />
          <span>{isNew ? "paper-ultra-slop" : "bb"}</span>
          <ChevronDown className="ctx-chev" />
        </span>
        <span className="ctx">
          {isNew ? (
            <LaptopGlyph className="ctx-ic" />
          ) : (
            <FolderGitIcon className="ctx-ic" />
          )}
          <span>{isNew ? "Work locally" : "Worktree"}</span>
          <ChevronDown className="ctx-chev" />
        </span>
        <span className="ctx">
          <GitBranchIcon className="ctx-ic" />
          <span className="ctx-branch">
            {isNew ? "Current (main)" : thread.branch}
          </span>
          <ChevronDown className="ctx-chev" />
        </span>
        <span className="ctx-perm">
          Full Access
          <ChevronDown className="ctx-chev" />
        </span>
        {thread && thread.status === "running" ? (
          <Spinner className="ctx-spin" />
        ) : null}
      </div>
    </div>
  );
}

// The diff / secondary panel that opens on the right.
function DiffPanel({
  thread,
  onClose,
}: {
  thread: MockThread;
  onClose: () => void;
}) {
  return (
    <aside className="diff-panel" aria-label="Changes">
      <div className="diff-head">
        <FileDiffIcon className="diff-ic" />
        <span className="diff-title">Changes</span>
        <span className="diff-stat pr-add">+{thread.change.add}</span>
        <span className="diff-stat pr-del">-{thread.change.del}</span>
        <button
          type="button"
          className="diff-close"
          aria-label="Hide changes"
          onClick={onClose}
        >
          <PanelRightIcon className="ri" />
        </button>
      </div>
      <div className="diff-file">
        <FolderGitIcon className="diff-file-ic" />
        promo.test.ts
      </div>
      <div className="diff-body">
        {DIFF_LINES.map((line, i) => (
          <div key={i} className={`dl dl-${line.t}`}>
            <span className="dl-sign">
              {line.t === "add" ? "+" : line.t === "del" ? "-" : " "}
            </span>
            <span className="dl-text">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function HeroAppMock() {
  const [activeId, setActiveId] = useState(HERO_THREADS[0].id);
  const [view, setView] = useState<"thread" | "new">("thread");
  const [diffOpen, setDiffOpen] = useState(false);
  // Mobile sidebar drawer (mirrors the app's openMobile nav). Inert on desktop,
  // where the sidebar is always in-flow.
  const [navOpen, setNavOpen] = useState(false);
  const thread =
    HERO_THREADS.find((candidate) => candidate.id === activeId) ??
    HERO_THREADS[0];

  const openThread = (id: string) => {
    setActiveId(id);
    setView("thread");
    setNavOpen(false);
  };

  return (
    <section className="mockup-wrap">
      <div className="mock" aria-label="Interactive preview of the bb app">
        <div className="mock-bar">
          <div className="bar-left">
            <span className="mock-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <button
              type="button"
              className="bar-menu"
              aria-label="Toggle sidebar"
              aria-expanded={navOpen}
              onClick={() => setNavOpen((open) => !open)}
            >
              <PanelIcon className="ri bar-ic" />
            </button>
            <span className="bar-nav" aria-hidden>
              <ChevronLeft className="ri" />
              <ChevronRight className="ri" />
            </span>
          </div>
          <div className="bar-main">
            {view === "thread" ? (
              <>
                <span className="bar-title">{thread.title}</span>
                <Ellipsis className="ri bar-kebab" />
                <span className="bar-actions">
                  <span className="editor-btn" aria-hidden>
                    <img src={vscodeIcon} alt="" className="editor-ic" />
                    <ChevronDown className="chev-xs" />
                  </span>
                  <span className="commit-btn" aria-hidden>
                    Commit
                  </span>
                  <button
                    type="button"
                    className={diffOpen ? "bar-toggle active" : "bar-toggle"}
                    aria-label={diffOpen ? "Hide changes" : "Show changes"}
                    aria-pressed={diffOpen}
                    onClick={() => setDiffOpen((open) => !open)}
                  >
                    <PanelRightIcon className="ri" />
                  </button>
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="mock-body">
          {navOpen ? (
            <button
              type="button"
              className="nav-backdrop"
              aria-label="Close sidebar"
              onClick={() => setNavOpen(false)}
            />
          ) : null}
          <aside className={navOpen ? "side nav-open" : "side"}>
            <div className="side-row">
              <button
                type="button"
                className={
                  view === "new"
                    ? "side-act side-new active-act"
                    : "side-act side-new"
                }
                aria-pressed={view === "new"}
                onClick={() => {
                  setView("new");
                  setNavOpen(false);
                }}
              >
                <NewThreadIcon className="sa-ic" />
                New thread
              </button>
              <SearchIcon className="side-search" />
            </div>
            <div className="side-act">
              <ClockIcon className="sa-ic" />
              Automations
            </div>
            <div className="side-label">Pinned</div>
            <div className="trow trow-pin">
              <span className="trow-title">Chief</span>
            </div>
            <div className="side-label">All Threads</div>
            <ul className="threads">
              {HERO_THREADS.map((candidate) => {
                const isActive =
                  view === "thread" && candidate.id === activeId;
                return (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      className={isActive ? "trow active" : "trow"}
                      aria-pressed={isActive}
                      onClick={() => openThread(candidate.id)}
                    >
                      <FolderGitIcon className="trow-glyph" />
                      <span className="trow-title">{candidate.title}</span>
                      <ThreadStatus status={candidate.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="side-foot" aria-hidden>
              <GearIcon className="sa-ic" />
            </div>
          </aside>

          {view === "thread" ? (
            <div className="main">
              <div className="feed">
                {thread.transcript.map((s, index) => {
                  if (s.kind === "user") {
                    return (
                      <div key={index} className="msg-user">
                        {s.text}
                      </div>
                    );
                  }
                  if (s.kind === "step") {
                    return (
                      <div key={index} className="msg-step">
                        <ChevronRight className="step-chev" />
                        {s.text}
                      </div>
                    );
                  }
                  return (
                    <div key={index} className="msg-say">
                      {s.text}
                    </div>
                  );
                })}
              </div>
              <Composer thread={thread} />
            </div>
          ) : (
            <div className="main main-new">
              <Composer />
            </div>
          )}

          {view === "thread" && diffOpen ? (
            <DiffPanel thread={thread} onClose={() => setDiffOpen(false)} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* ── Band layout ──────────────────────────────────────────────────── */

function Band({
  kicker,
  title,
  flip,
  visual,
  children,
}: {
  kicker: string;
  title: string;
  flip?: boolean;
  visual: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={flip ? "band band-flip" : "band"} data-reveal>
      <div className="band-grid">
        <div className="band-copy">
          <p className="kicker">{kicker}</p>
          <h2>{title}</h2>
          {children}
        </div>
        <div className="band-visual">{visual}</div>
      </div>
    </section>
  );
}

/* ── Band 1 visual: the one code block ────────────────────────────── */

function SpawnCode() {
  return (
    <div className="code mono" aria-label="Spawning a bb thread from the command line">
      <div className="stanza">
        <div>
          <span className="cm"># you, an agent, or any program</span>
        </div>
        <div>
          <span className="cmd">bb</span> <span className="verb">thread spawn</span>{" "}
          <span className="fl">--project</span> app <span className="pn">\</span>
        </div>
        <div>
          {"  "}
          <span className="fl">--prompt</span>{" "}
          <span className="st">"Triage the Sentry spike"</span>
        </div>
      </div>
      <div className="stanza">
        <div>
          <span className="cm"># → a thread you can open</span>
        </div>
        <div>
          <span className="out">Thread spawned: thr_a1b2c3</span>
        </div>
      </div>
    </div>
  );
}

/* ── Band 2 visual: text the bot, bb spawns the thread ────────────── */

// A Telegram-style chat with the bb bot. The user texts a request; the bot acks
// and a bb thread card appears, its status going spawning → running. Cycles via
// a keyed remount so the send → spawn sequence replays. CSS-only transitions.
function AgentChat() {
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const id = setInterval(() => setCycle((c) => c + 1), 7200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="tg" aria-label="Texting the Crunch bot, which spawns a bb thread">
      <div className="tg-bar">
        <ChevronLeft className="tg-back" />
        <span className="tg-contact">
          <span className="tg-name">Crunch</span>
          <span className="tg-sub">bot</span>
        </span>
        <span className="tg-av" aria-hidden>
          <img src={bbIcon} alt="" />
        </span>
      </div>
      <div className="tg-feed" key={cycle}>
        <div className="tg-msg tg-out" style={{ animationDelay: "0.3s" }}>
          <span className="tg-bubble">
            spawn a thread to fix the failing CI on main
            <span className="tg-time">9:41</span>
          </span>
        </div>
        <div className="tg-msg tg-in" style={{ animationDelay: "1.4s" }}>
          <span className="tg-bubble">
            On it — spawning a worker thread.
            <span className="tg-cmd mono">bb spawn "fix CI on main"</span>
          </span>
        </div>
        <div className="tg-msg tg-in" style={{ animationDelay: "2.4s" }}>
          <div className="tg-thread">
            <div className="tg-thread-top">
              <img src={bbIcon} alt="" className="tg-thread-mark" />
              <span className="tg-thread-eyebrow">Worker thread</span>
              <span className="tg-stat" aria-hidden>
                <span className="tg-stat-spawn" style={{ animationDelay: "3.5s" }}>
                  <Spinner className="tg-spin" />
                  spawning
                </span>
                <span className="tg-stat-run" style={{ animationDelay: "3.5s" }}>
                  <span className="tg-rdot" />
                  running
                </span>
              </span>
            </div>
            <div className="tg-thread-title">Fix CI on main</div>
            <div className="tg-thread-branch mono">bb/fix-ci-on-main</div>
          </div>
        </div>
      </div>
      <div className="tg-input">
        <Paperclip className="tg-attach" />
        <span className="tg-field">Message</span>
        <span className="tg-send" aria-hidden>
          <PaperPlane className="tg-send-ic" />
        </span>
      </div>
    </div>
  );
}

/* ── Band 3 visual: automation run receipt ───────────────────────── */

type Run = {
  title: string;
  trigger: string;
  triggerKind: "cron" | "event";
  steps: string[];
  output: string;
};

const RUNS: Run[] = [
  {
    title: "Nightly docs sync",
    trigger: "0 2 * * *",
    triggerKind: "cron",
    steps: ["spawned “sync docs”", "worker ran locally", "reviewed 14 files"],
    output: "PR #418 ready",
  },
  {
    title: "Issue triage",
    trigger: "on new issue",
    triggerKind: "event",
    steps: ["read the new issue", "spawned an agent thread", "drafted a summary"],
    output: "posted to Slack",
  },
  {
    title: "Watch failing jobs",
    trigger: "on job failed",
    triggerKind: "event",
    steps: ["inspected the CI logs", "found a flaky timeout", "pushed a fix"],
    output: "opened fix branch",
  },
];

// A compact, BB-native "run receipt": trigger + status pill + steps that check
// in one by one + final output. It cycles one automation at a time — the motion
// is text/status/checkmark reveals (CSS, restarted by the keyed remount), not a
// separate graphic. The principle: show work getting done while you're away.
function AutomationRun() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const id = setInterval(() => setIndex((prev) => (prev + 1) % RUNS.length), 4200);
    return () => clearInterval(id);
  }, []);
  const run = RUNS[index];
  const outAt = 0.25 + run.steps.length * 0.5;
  const doneAt = outAt + 0.2;
  return (
    <div className="runcard" key={index} aria-label="An automation run">
      <div className="run-head">
        <span className="run-title">{run.title}</span>
        <span className="run-status" aria-hidden>
          <span className="rs rs-run" style={{ animationDelay: `${doneAt}s` }}>
            <span className="rs-dot" />
            Running
          </span>
          <span className="rs rs-done" style={{ animationDelay: `${doneAt}s` }}>
            <CheckIcon className="rs-check" />
            Done
          </span>
        </span>
      </div>
      <div className="run-trigger">
        {run.triggerKind === "cron" ? (
          <ClockIcon className="tg-ic" />
        ) : (
          <BoltIcon className="tg-ic" />
        )}
        <span className="mono">{run.trigger}</span>
      </div>
      <div className="run-steps">
        {run.steps.map((step, i) => (
          <div
            className="run-step"
            key={step}
            style={{ animationDelay: `${0.25 + i * 0.5}s` }}
          >
            <CheckIcon className="st-check" />
            <span>{step}</span>
          </div>
        ))}
      </div>
      <div className="run-output" style={{ animationDelay: `${outAt}s` }}>
        <span className="out-arrow">→</span>
        <span>{run.output}</span>
      </div>
    </div>
  );
}

/* ── Band 5 visual: one agent runs another ────────────────────────── */

function ProviderTree() {
  return (
    <div className="ptree" aria-label="One agent spawning workers on other providers">
      <div className="pnode parent">
        <ClaudeIcon className="pn-icon" />
        <span className="pn-name">Claude Code</span>
        <span className="pn-task">Ship the release</span>
      </div>
      <div className="pbranch" aria-hidden>
        <span />
        <span />
      </div>
      <div className="pchildren">
        <div className="pnode">
          <OpenAiIcon className="pn-icon" />
          <span className="pn-name">Codex</span>
          <span className="pn-task">Port module to TS</span>
        </div>
        <div className="pnode">
          <PiIcon className="pn-icon" />
          <span className="pn-name">Pi</span>
          <span className="pn-task">Write release notes</span>
        </div>
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

function LandingPage() {
  useScrollReveal();
  return (
    <div className="wrap">
      <nav className="nav">
        <a className="logo" href="/">
          <img src={bbIcon} alt="bb" width={36} height={36} />
        </a>
        <div className="nav-links">
          <GitHubLink placement="nav">GitHub</GitHubLink>
          <DownloadLink placement="nav" className="btn btn-primary btn-sm">
            Download for macOS
          </DownloadLink>
        </div>
      </nav>

      <header className="hero">
        <h1>
          The IDE{" "}
          <span className="uline">
            anything
            <svg viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden>
              <path d="M3 9 C 60 3.5, 140 3.5, 197 7" />
            </svg>
          </span>{" "}
          can drive.
        </h1>
        <p className="sub">
          You drive it by hand. Your agents, your own scripts, and automations
          on a loop drive it through the CLI. Every thread lands in one place —
          local-first, on your machine, waiting for you.
        </p>

        <div className="cta-row">
          <DownloadLink placement="hero" className="btn btn-primary">
            Download for macOS
          </DownloadLink>
          <GitHubLink placement="hero" className="btn btn-ghost">
            Star on GitHub
          </GitHubLink>
        </div>

        <InstallCommand placement="hero" />
        <p className="fine">
          Free and open source · macOS (Apple Silicon) · runs anywhere with Node
          22 and Git
        </p>

        <div className="providers">
          <span className="label">Works with</span>
          <ProviderChips />
        </div>
      </header>

      <HeroAppMock />

      <Band
        kicker="# anything can drive it"
        title="Anything can kick off work."
        visual={<SpawnCode />}
      >
        <p>
          The same CLI your agents use is open to any program you write. A shell
          script, a cron job, your own hermes or openclaw — each can spawn a
          thread that&rsquo;s waiting in your sidebar when you are.
        </p>
        <div className="band-cta">
          <GitHubLink placement="cli" className="btn btn-ghost btn-sm">
            Browse the CLI →
          </GitHubLink>
        </div>
      </Band>

      <Band
        kicker="# bring your own agent"
        title="Text your agent. It works in bb."
        flip
        visual={<AgentChat />}
      >
        <p>
          Agents like Hermes and openclaw live in the apps you already chat in —
          Telegram, Signal, Slack. Give one a job from anywhere and it spawns a
          thread through the bb CLI.
        </p>
        <p>
          The work runs on your machine and is waiting for you when you&rsquo;re
          back.
        </p>
      </Band>

      <Band
        kicker="# loops that run themselves"
        title="Set it once. It runs without you."
        visual={<AutomationRun />}
      >
        <p>
          Schedule an automation to run an agent or a script on cron. Point one
          at your tracker and it kicks off a thread for every new issue — or run
          nightly docs, changelogs, error triage. All on your machine, not
          someone else&rsquo;s cloud.
        </p>
        <div className="band-cta">
          <GitHubLink placement="loops" className="btn btn-ghost btn-sm">
            How automations work →
          </GitHubLink>
        </div>
      </Band>

      <section className="statement" data-reveal>
        <p className="kicker"># your machine, your keys</p>
        <h2 className="sec-title">Local-first. Yours to keep.</h2>
        <p>
          bb is free and open source, and runs entirely on your machine using
          the provider subscriptions you already pay for. No cloud middleman, no
          lock-in, no per-seat bill.
        </p>
        <p className="facts">
          <span>Free</span>
          <span>MIT</span>
          <span>macOS (Apple Silicon)</span>
          <span>Node 22 + Git anywhere</span>
        </p>
        <div className="cta-row">
          <GitHubLink placement="local" className="btn btn-ghost">
            Star on GitHub →
          </GitHubLink>
        </div>
      </section>

      <Band
        kicker="# mix and match"
        title="Pick the right agent. Let them run each other."
        flip
        visual={<ProviderTree />}
      >
        <p>
          Claude Code, Codex, Cursor, and Pi all live in bb. Give a task to
          whichever fits — and have one agent spawn and manage another, each in
          its own thread.
        </p>
        <div className="providers">
          <ProviderChips />
        </div>
      </Band>

      <section className="closer" data-reveal>
        <h2 className="sec-title">Point anything at it. It&rsquo;s all here for you.</h2>
        <p>Free and open source. Install in under a minute.</p>
        <div className="cta-row">
          <DownloadLink placement="closer" className="btn btn-primary">
            Download for macOS
          </DownloadLink>
          <GitHubLink placement="closer" className="btn btn-ghost">
            View on GitHub
          </GitHubLink>
        </div>
      </section>

      <footer className="footer">
        <span>bb is free and open source (MIT)</span>
        <span>
          <GitHubLink placement="footer">GitHub</GitHubLink>
          {" · "}
          <DownloadLink placement="footer">Download</DownloadLink>
        </span>
      </footer>
    </div>
  );
}
