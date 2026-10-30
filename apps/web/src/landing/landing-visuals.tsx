import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowExpand01Icon from "@hugeicons/core-free-icons/ArrowExpand01Icon";
import ArrowMoveDownLeftIcon from "@hugeicons/core-free-icons/ArrowMoveDownLeftIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import AttachmentIcon from "@hugeicons/core-free-icons/AttachmentIcon";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon";
import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import GitBranchIcon_ from "@hugeicons/core-free-icons/GitBranchIcon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import MessageQuestionIcon from "@hugeicons/core-free-icons/MessageQuestionIcon";
import Plug02Icon from "@hugeicons/core-free-icons/Plug02Icon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

import linearLogo from "../assets/company-logos/linear.svg";
import { trackLandingEvent } from "./analytics";
import { CommandButton } from "./command-button";
import { DesktopDownloadButton, DownloadLink } from "./cta";
import { useDesktopPlatform } from "./desktop-platform";
import { SendToComputerButton } from "./send-to-computer-button";
import {
  ClaudeIcon,
  CursorIcon,
  GrokIcon,
  HermesAgentIcon,
  OmpIcon,
  OpenAiIcon,
  OpencodeIcon,
  PiIcon,
} from "./icons";
import type { CtaPlacement, DesktopPlatform } from "./site";
import { CLI_COMMAND, DESKTOP_DOWNLOADS } from "./site";

export function InstallOptions({ placement }: { placement: CtaPlacement }) {
  const platform = useDesktopPlatform();
  const download = DESKTOP_DOWNLOADS[platform];
  const otherPlatform: DesktopPlatform =
    platform === "macos" ? "linux" : "macos";
  return (
    <div className="install-options">
      <div className="install-actions">
        <span className="install-choice">
          <DesktopDownloadButton
            placement={placement}
            platform={platform}
            className="btn btn-primary btn-install install-download"
          />
          <SendToComputerButton placement={placement} />
          <span className="install-note install-note-desktop">
            {download.note}
            {" · "}
            <DownloadLink
              placement={placement}
              platform={otherPlatform}
              className="install-note-link"
            >
              Also for {DESKTOP_DOWNLOADS[otherPlatform].label}
            </DownloadLink>
          </span>
          <span className="install-note install-note-touch">
            bb runs on macOS, Windows, and Linux
          </span>
        </span>
        <span className="install-choice">
          <CommandButton
            command={CLI_COMMAND}
            label={`Copy browser install command: ${CLI_COMMAND}`}
            size="hero"
            onCopy={() =>
              trackLandingEvent({
                name: "landing_cli_command_copied",
                properties: { placement, command: CLI_COMMAND },
              })
            }
          />
          <span className="install-note">
            {platform !== "windows" && (
              <>
                <DownloadLink
                  placement={placement}
                  platform="windows"
                  className="install-note-link"
                >
                  {DESKTOP_DOWNLOADS.windows.label}
                </DownloadLink>
                ,{" "}
              </>
            )}
            Intel Macs &amp; remote machines
          </span>
        </span>
      </div>
    </div>
  );
}

export function useScrollReveal() {
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

const PROVIDER_ICONS = [
  ClaudeIcon,
  OpenAiIcon,
  CursorIcon,
  PiIcon,
  OpencodeIcon,
  GrokIcon,
  OmpIcon,
  HermesAgentIcon,
] as const;

const PROVIDER_ICONS_MOBILE_VISIBLE = 3;

export function ProviderChips() {
  const extra = PROVIDER_ICONS.length - PROVIDER_ICONS_MOBILE_VISIBLE;
  return (
    <>
      {PROVIDER_ICONS.map((Icon, i) => (
        <Icon
          key={i}
          className={
            i >= PROVIDER_ICONS_MOBILE_VISIBLE ? "plogo plogo-more" : "plogo"
          }
        />
      ))}
      {extra > 0 ? (
        <span className="pmore" aria-label={`${extra} more providers`}>
          +{extra} more
        </span>
      ) : null}
    </>
  );
}

export function Band({
  title,
  flip,
  section,
  visual,
  children,
}: {
  title: ReactNode;
  flip?: boolean;
  section?: string;
  visual: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={flip ? "band band-flip" : "band"}
      data-reveal
      data-section={section}
    >
      <div className="band-grid">
        <div className="band-copy">
          <h2>{title}</h2>
          {children}
        </div>
        <div className="band-visual">{visual}</div>
      </div>
    </section>
  );
}

/**
 * Drives a looping visual: `cycle` changes each loop (use it as a `key` to
 * replay CSS animations) and `leaving` is true during the fade-out.
 *
 * With `ref`, the loop only runs while that element is on screen: it starts
 * from the first frame when the element enters view and stops and resets when
 * it leaves, and `paused` is true while it's offscreen. Without `ref`, it
 * loops from mount, as before.
 */
export function useCycle(
  holdMs: number,
  fadeMs: number,
  ref?: RefObject<Element | null>,
) {
  const [cycle, setCycle] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [inView, setInView] = useState(ref === undefined);
  useEffect(() => {
    if (!ref) return;
    const target = ref.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry?.isIntersecting ?? false);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [ref]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    if (!inView) return;
    if (ref) {
      setCycle((c) => c + 1);
      setLeaving(false);
    }
    let holdTimer = 0;
    let fadeTimer = 0;
    const schedule = () => {
      holdTimer = window.setTimeout(() => {
        setLeaving(true);
        fadeTimer = window.setTimeout(() => {
          setCycle((c) => c + 1);
          setLeaving(false);
          schedule();
        }, fadeMs);
      }, holdMs);
    };
    schedule();
    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(fadeTimer);
    };
  }, [holdMs, fadeMs, inView, ref]);
  return { cycle, leaving, paused: !inView };
}

export function SpawnRow({
  icon,
  name,
  task,
  status,
  at,
  doneAt,
  parent,
}: {
  icon: ReactNode;
  name: string;
  task: string;
  status: string;
  at: number;
  doneAt: number;
  parent?: boolean;
}) {
  return (
    <div
      className={parent ? "sb-thread sb-parent" : "sb-thread"}
      style={{ animationDelay: `${at}s` }}
    >
      <span className="sb-prov" aria-hidden>
        {icon}
      </span>
      <span className="sb-body">
        <span className="sb-name">{name}</span>
        <span className="sb-task">{task}</span>
      </span>
      <span className="sb-stat" aria-hidden>
        <span className="sb-run" style={{ animationDelay: `${doneAt}s` }}>
          <span className="sb-dot" />
          {status}
        </span>
        <span className="sb-done" style={{ animationDelay: `${doneAt}s` }}>
          <HugeiconsIcon icon={Tick02Icon} className="sb-check" />
          done
        </span>
      </span>
    </div>
  );
}

type IconProps = { className?: string };

const PanelIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SidebarLeftIcon} className={className} />
);
const ChevronRight = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowRight01Icon} className={className} />
);
const ChevronDown = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowDown01Icon} className={className} />
);
const Maximize2 = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowExpand01Icon} className={className} />
);
const Paperclip = ({ className }: IconProps) => (
  <HugeiconsIcon icon={AttachmentIcon} className={className} />
);
const SendIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowMoveDownLeftIcon} className={className} />
);
const GitBranchIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={GitBranchIcon_} className={className} />
);
const Spinner = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Loading03Icon} className={className} />
);

type CustomizeMessage = {
  role: "user" | "agent" | "tool";
  text: string;
};

type CustomizeTask = {
  key: string;
  title: string;
  status: "in_progress" | "todo" | "backlog";
  priority: "urgent" | "high" | "medium" | "low";
};

type CustomizeScenario = {
  title: string;
  prompt: string;
  promptWidth: string;
  branch: string;
  messages: CustomizeMessage[];
  panel: {
    name: string;
    tasks: CustomizeTask[];
  };
};

const CUSTOMIZE_SCENARIO: CustomizeScenario = {
  title: "Build a Linear plugin",
  prompt: "Bring my Linear issues to bb",
  promptWidth: "210px",
  branch: "bb/linear-plugin",
  messages: [
    { role: "user", text: "Bring my Linear issues to bb" },
    {
      role: "agent",
      text: "I'll build it as a bb plugin and mount it in your sidebar.",
    },
    { role: "tool", text: "wrote plugin: linear" },
    { role: "tool", text: "registered panel + bb linear CLI" },
    {
      role: "agent",
      text: "Done. Linear is live, and your agents can use it.",
    },
  ],
  panel: {
    name: "Linear",
    tasks: [
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
      {
        key: "APP-7",
        title: "Document the public API",
        status: "backlog",
        priority: "medium",
      },
    ],
  },
};

export function CustomizeBuild() {
  const { cycle, leaving } = useCycle(10600, 500);
  const run = CUSTOMIZE_SCENARIO;
  const promptStyle = {
    "--customize-prompt-width": run.promptWidth,
  } as CSSProperties;
  return (
    <div className="mockup-wrap mockup-wrap-customize">
      <div
        className="mock mock-customize-mobile"
        aria-label="Mobile bb preview: a prompt asks for Linear issues, and the agent builds a Linear plugin"
      >
        <div className="mock-bar">
          <div className="bar-left">
            <span className="bar-menu" aria-hidden>
              <PanelIcon className="ri bar-ic" />
            </span>
          </div>
          <div className="bar-main">
            <span className="bar-title">{run.title}</span>
          </div>
        </div>

        <div
          className={
            leaving
              ? "mock-body customize-body leaving"
              : "mock-body customize-body"
          }
          key={cycle}
        >
          <div className="main">
            <div className="feed feed-live customize-feed">
              {run.messages.map((message, i) => {
                const style = { animationDelay: `${3.2 + i * 0.68}s` };
                if (message.role === "user") {
                  return (
                    <div
                      className="msg-user customize-msg"
                      key={`${message.role}-${message.text}`}
                      style={style}
                    >
                      {message.text}
                    </div>
                  );
                }
                if (message.role === "tool") {
                  return (
                    <div
                      className="msg-step customize-msg customize-tool"
                      key={`${message.role}-${message.text}`}
                      style={style}
                    >
                      <ChevronRight className="step-chev" />
                      {message.text}
                    </div>
                  );
                }
                return (
                  <div
                    className="msg-say customize-msg"
                    key={`${message.role}-${message.text}`}
                    style={style}
                  >
                    {message.text}
                  </div>
                );
              })}
            </div>

            <div className="composer customize-composer">
              <div className="composer-box customize-composer-box">
                <div className="composer-top">
                  <span className="composer-input customize-typeahead">
                    <span className="customize-type-text" style={promptStyle}>
                      {run.prompt}
                    </span>
                    <span className="customize-caret" aria-hidden />
                  </span>
                  <Maximize2 className="cb-expand" />
                </div>
                <div className="composer-row">
                  <span className="model">
                    <OpenAiIcon className="model-ic" />
                    Codex
                    <ChevronDown className="chev-sm" />
                  </span>
                  <span className="composer-actions" aria-hidden>
                    <Paperclip className="composer-clip" />
                    <span className="send-btn customize-send">
                      <SendIcon className="send-ic" />
                    </span>
                  </span>
                </div>
              </div>
              <div className="context-row customize-context">
                <span className="ctx">
                  <GitBranchIcon className="ctx-ic" />
                  <span className="ctx-branch">{run.branch}</span>
                </span>
                <Spinner className="ctx-spin" />
              </div>
            </div>
          </div>

          {}
          <div className="plugin-panel" aria-hidden>
            <div className="plugin-panel-bar">
              <span className="plugin-panel-name">{run.panel.name}</span>
              <span className="plugin-panel-badge">Plugin</span>
            </div>
            <div className="plugin-panel-rows">
              {run.panel.tasks.map((task, i) => (
                <div
                  className="plugin-task"
                  key={task.key}
                  style={{ animationDelay: `${8.3 + i * 0.14}s` }}
                >
                  <span
                    className={`plugin-task-status is-${task.status}`}
                    aria-hidden
                  />
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
    </div>
  );
}

/* ── Feature windows: small bb windows in the hero window's style ──────── */

const PluginsIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Plug02Icon} className={className} />
);
const ClockIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Clock01Icon} className={className} />
);
const TerminalIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={CommandLineIcon} className={className} />
);
const DoneIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={CheckmarkCircle02Icon} className={className} />
);
const WaitingIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={MessageQuestionIcon} className={className} />
);
const ComposerIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Message01Icon} className={className} />
);
const GitHubMark = ({ className }: IconProps) => (
  <HugeiconsIcon icon={GithubIcon} className={className} />
);
const MemoryIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={BrainIcon} className={className} />
);
const LinearMark = ({ className }: IconProps) => (
  <img src={linearLogo} alt="" className={`${className ?? ""} fw-logo`} />
);
const SentryMark = ({ className }: IconProps) => (
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
const NewThreadIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={BubbleChatAddIcon} className={className} />
);
const SubagentIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={UserAdd01Icon} className={className} />
);

type ThreadState = "running" | "done" | "waiting";

function StatusGlyph({ status }: { status: ThreadState }) {
  if (status === "running") return <Spinner className="trun" />;
  if (status === "done") return <DoneIcon className="tdone" />;
  return <WaitingIcon className="twait" />;
}

/** A thread's status glyph; with `doneAt`, it turns from running to done. */
function ThreadStatus({
  status,
  doneAt,
}: {
  status: ThreadState;
  doneAt?: number;
}) {
  if (doneAt === undefined) {
    return (
      <span className="tstatus" aria-hidden>
        <StatusGlyph status={status} />
      </span>
    );
  }
  return (
    <span className="tstatus fw-swap" aria-hidden>
      <span className="fw-swap-from" style={at(doneAt)}>
        <StatusGlyph status="running" />
      </span>
      <span className="fw-swap-to" style={at(doneAt)}>
        <StatusGlyph status="done" />
      </span>
    </span>
  );
}

/** Animation delay, in seconds from the start of the loop. */
function at(seconds: number): CSSProperties {
  return { "--fw-at": `${seconds}s` } as CSSProperties;
}

function WindowDots() {
  return (
    <span className="mock-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

function stageClass(base: string, leaving: boolean, paused: boolean) {
  return `${base}${leaving ? " leaving" : ""}${paused ? " fw-paused" : ""}`;
}

type PluginEntry = {
  icon: (props: IconProps) => ReactNode;
  name: string;
  description: string;
};

const BUILT_IN_PLUGINS: PluginEntry[] = [
  { icon: PanelIcon, name: "Sidebar", description: "Threads, sections, and pins" },
  {
    icon: ComposerIcon,
    name: "Composer",
    description: "Mentions, slash commands, voice",
  },
  { icon: GitHubMark, name: "GitHub", description: "Pull requests and checks" },
  {
    icon: MemoryIcon,
    name: "Memory",
    description: "Durable memory for every agent",
  },
  {
    icon: ClockIcon,
    name: "Automations",
    description: "Scheduled and one-shot runs",
  },
];

const YOUR_PLUGINS: PluginEntry[] = [
  { icon: SentryMark, name: "Sentry", description: "Errors beside your threads" },
  {
    icon: LinearMark,
    name: "Linear issues",
    description: "Your issues in a side panel",
  },
  {
    icon: PanelIcon,
    name: "Status sidebar",
    description: "Threads grouped by what needs you",
  },
];

function PluginRow({
  plugin,
  badge,
}: {
  plugin: PluginEntry;
  badge: string;
}) {
  return (
    <div className="fw-plugin">
      <span className="fw-plugin-frame">
        <plugin.icon className="fw-plugin-ic" />
      </span>
      <span className="fw-plugin-text">
        <span className="fw-plugin-name">{plugin.name}</span>
        <span className="fw-plugin-desc">{plugin.description}</span>
      </span>
      <span className="fw-tag">{badge}</span>
      <span className="fw-switch" />
    </div>
  );
}

/**
 * bb's Plugins page: the built-in plugins beside ones you added. Static, so
 * there is nothing to reduce for reduced motion.
 */
export function PluginsSheet() {
  return (
    <div
      className="fw-win fw-plugins"
      role="img"
      aria-label="bb's Plugins page. Built-in plugins: Sidebar, Composer, GitHub, Memory and Automations. Plugins you added: Sentry, Linear issues and Status sidebar. All are switched on."
    >
      <div className="fw-band">
        <WindowDots />
        <span className="fw-crumb">
          <PluginsIcon className="fw-ic fw-ic-ink" />
          Plugins
        </span>
      </div>
      <div className="fw-card fw-sheet">
        <div className="fw-label">Built-in</div>
        {BUILT_IN_PLUGINS.map((plugin) => (
          <PluginRow key={plugin.name} plugin={plugin} badge="Built-in" />
        ))}
        <div className="fw-label">Yours</div>
        {YOUR_PLUGINS.map((plugin) => (
          <PluginRow key={plugin.name} plugin={plugin} badge="Yours" />
        ))}
      </div>
    </div>
  );
}

/** The GitHub mark, for buttons that link to the repo. */
export function GitHubButtonMark() {
  return <GitHubMark className="btn-ic" />;
}

const HANDOFF_PARENT = "Fix checkout timeout";
const HANDOFF_CHILDREN = [
  {
    icon: OpenAiIcon,
    title: "Write the tests",
    landsAt: 0.8,
    doneAt: 4.6,
    note: "6 tests added. All pass with the fix.",
  },
  {
    icon: PiIcon,
    title: "Changelog entry",
    landsAt: 1.5,
    doneAt: 7,
    note: "Added under Fixes for 0.42.",
  },
  { icon: ClaudeIcon, title: "Review the fix", landsAt: 2.2 },
] as const;

/**
 * A Claude thread starts Codex, Pi and Claude child threads; as each child
 * finishes, its note lands in the parent. Children land at 0.8s, 1.5s and
 * 2.2s, Codex finishes at 4.6s and Pi at 7s, then a 4s hold.
 */
export function DelegationTree() {
  const ref = useRef<HTMLDivElement>(null);
  const { cycle, leaving, paused } = useCycle(11000, 600, ref);
  return (
    <div
      ref={ref}
      className="fw-win fw-handoff"
      role="img"
      aria-label="bb sidebar: the Claude thread Fix checkout timeout starts three child threads, Codex writing the tests, Pi writing the changelog entry, and Claude reviewing the fix. When Codex and Pi finish, a finished note lands in the parent thread."
    >
      <div className="fw-band">
        <WindowDots />
        <PanelIcon className="fw-ic fw-band-end" />
      </div>
      <div className={stageClass("fw-split", leaving, paused)} key={cycle}>
        <div className="fw-side">
          <div className="fw-row">
            <NewThreadIcon className="fw-ic fw-ic-ink" />
            New thread
          </div>
          <div className="fw-label">Threads</div>
          <div className="fw-row">
            <span className="fw-row-title">Bump the SDK</span>
            <ThreadStatus status="done" />
          </div>
          <div className="fw-row">
            <span className="fw-row-title">Refactor auth</span>
            <ThreadStatus status="waiting" />
          </div>
          <div className="fw-row is-active">
            <span className="fw-row-title">{HANDOFF_PARENT}</span>
            <ThreadStatus status="running" />
          </div>
          <div className="fw-kids">
            {HANDOFF_CHILDREN.map((child) => (
              <div
                className="fw-row fw-kid fw-land"
                key={child.title}
                style={at(child.landsAt)}
              >
                <child.icon className="fw-kid-ic" />
                <span className="fw-row-title">{child.title}</span>
                <ThreadStatus
                  status="running"
                  doneAt={"doneAt" in child ? child.doneAt : undefined}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="fw-main">
          <div className="fw-main-head">
            <ClaudeIcon className="fw-kid-ic" />
            <span className="fw-row-title">{HANDOFF_PARENT}</span>
          </div>
          <div className="fw-feed">
            <div className="fw-say">
              I&rsquo;ll write the fix. Handing off the tests and the
              changelog.
            </div>
            {HANDOFF_CHILDREN.map((child) => (
              <div
                className="fw-work fw-land"
                key={child.title}
                style={at(child.landsAt)}
              >
                <SubagentIcon className="fw-step-ic" />
                <span className="fw-work-verb">Started</span>
                <span className="fw-pill">
                  <child.icon className="fw-pill-ic" />
                  <span className="fw-pill-text">{child.title}</span>
                </span>
              </div>
            ))}
            {HANDOFF_CHILDREN.map((child) =>
              "note" in child ? (
                <div
                  className="fw-note fw-land"
                  key={child.title}
                  style={at(child.doneAt)}
                >
                  <span className="fw-note-head">
                    <DoneIcon className="fw-note-ic" />
                    <span className="fw-note-subject">{child.title}</span>
                    <span className="fw-note-verb">finished</span>
                  </span>
                  <span className="fw-note-body">{child.note}</span>
                </div>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// `--project` is required and the prompt is a flag
// (apps/cli/src/commands/thread/spawn.ts); the command prints
// "Thread spawned: <id>".
const SPAWN_COMMAND = 'bb thread spawn --project web --prompt "Fix CI on main"';
const SPAWN_OUTPUT = "Thread spawned: thr_7q2m9xk4";

/**
 * A CI step runs `bb thread spawn` and an Automations schedule fires; each
 * lands as a new thread in the sidebar. Command at 0.6s, output at 1.5s, the
 * CI thread at 2s and the scheduled thread at 4.6s, then a 5s hold.
 */
export function StartAnywhere() {
  const ref = useRef<HTMLDivElement>(null);
  const { cycle, leaving, paused } = useCycle(9600, 600, ref);
  return (
    <div
      ref={ref}
      className="fw-start"
      role="img"
      aria-label="A CI step runs bb thread spawn with the prompt Fix CI on main, and an Automations schedule, every weekday at 9:00, runs the Nightly changelog. Each lands as a new thread in the bb sidebar."
    >
      <div className={stageClass("fw-stage", leaving, paused)} key={cycle}>
        <div className="fw-src">
          <div className="fw-src-head">
            <TerminalIcon className="fw-ic" />
            <span>CI step</span>
            <span className="fw-src-meta">main · checks failed</span>
          </div>
          <div className="fw-term">
            <span className="fw-tline fw-tcmd" style={at(0.6)}>
              <span className="fw-prompt">$</span> {SPAWN_COMMAND}
            </span>
            <span className="fw-tline fw-tout" style={at(1.5)}>
              {SPAWN_OUTPUT}
            </span>
          </div>
        </div>
        <div className="fw-src fw-sched">
          <ClockIcon className="fw-ic" />
          <span className="fw-sched-text">
            <span className="fw-sched-when">Every weekday 9:00</span>
            <span className="fw-sched-sep"> · </span>
            <span>Nightly changelog</span>
          </span>
          <span className="fw-tag">
            <PluginsIcon className="fw-tag-ic" />
            Automations
          </span>
        </div>
        <div className="fw-win">
          <div className="fw-band">
            <WindowDots />
            <PanelIcon className="fw-ic fw-band-end" />
          </div>
          <div className="fw-card fw-side fw-side-solo">
            <div className="fw-label">Threads</div>
            {/* New rows land at the top and push the rest down a row. */}
            <div className="fw-rows">
              <div className="fw-row fw-land" style={at(4.6)}>
                <span className="fw-row-title">Nightly changelog</span>
                <ThreadStatus status="running" />
              </div>
              <div className="fw-push" style={at(4.6)}>
                <div className="fw-row fw-land" style={at(2)}>
                  <span className="fw-row-title">Fix CI on main</span>
                  <ThreadStatus status="running" />
                </div>
                <div className="fw-push" style={at(2)}>
                  <div className="fw-row">
                    <span className="fw-row-title">
                      Refactor the timeline cache
                    </span>
                    <ThreadStatus status="waiting" />
                  </div>
                  <div className="fw-row">
                    <span className="fw-row-title">Ship the CSV export</span>
                    <ThreadStatus status="done" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
