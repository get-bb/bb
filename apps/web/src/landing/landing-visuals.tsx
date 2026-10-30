import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowExpand01Icon from "@hugeicons/core-free-icons/ArrowExpand01Icon";
import ArrowMoveDownLeftIcon from "@hugeicons/core-free-icons/ArrowMoveDownLeftIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import AttachmentIcon from "@hugeicons/core-free-icons/AttachmentIcon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon";
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import GitBranchIcon_ from "@hugeicons/core-free-icons/GitBranchIcon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import MessageQuestionIcon from "@hugeicons/core-free-icons/MessageQuestionIcon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import ArrowDown02Icon from "@hugeicons/core-free-icons/ArrowDown02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

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
  LinuxIcon,
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
    const observer = new IntersectionObserver((entries) => {
      const latest = entries[entries.length - 1];
      if (latest) setInView(latest.isIntersecting);
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

const HomeGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Home01Icon} className={className} />
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
const GitHubMark = ({ className }: IconProps) => (
  <HugeiconsIcon icon={GithubIcon} className={className} />
);
const SettingsGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Settings01Icon} className={className} />
);
const PhoneIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SmartPhone01Icon} className={className} />
);
const LaptopGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={LaptopIcon} className={className} />
);
const ArrowDownGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowDown02Icon} className={className} />
);
const CheckGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Tick02Icon} className={className} />
);

type ThreadState = "running" | "done" | "waiting";

function StatusGlyph({ status }: { status: ThreadState }) {
  if (status === "running") return <Spinner className="trun" />;
  if (status === "done") return <DoneIcon className="tdone" />;
  return <WaitingIcon className="twait" />;
}

function ThreadStatus({
  status,
  next,
}: {
  status: ThreadState;
  next?: { status: ThreadState; at: number };
}) {
  if (next === undefined) {
    return (
      <span className="tstatus" aria-hidden>
        <StatusGlyph status={status} />
      </span>
    );
  }
  return (
    <span className="tstatus fw-swap" aria-hidden>
      <span className="fw-swap-from" style={at(next.at)}>
        <StatusGlyph status={status} />
      </span>
      <span className="fw-swap-to" style={at(next.at)}>
        <StatusGlyph status={next.status} />
      </span>
    </span>
  );
}

function at(seconds: number): CSSProperties {
  return { "--fw-at": `${seconds}s` } as CSSProperties;
}

function between(start: number, end: number): CSSProperties {
  return { "--fw-at": `${start}s`, "--fw-out": `${end}s` } as CSSProperties;
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

const PLUGIN_MAP_REGIONS = [
  "Your own pages",
  "PR status on every thread",
  "Charts in replies",
  "Controls in the composer",
] as const;

const CHART_BARS = [38, 52, 46, 64, 72, 90];

function MapChip({ n }: { n: number }) {
  return (
    <span className="fw-map-chip" aria-hidden>
      {n}
    </span>
  );
}

export function PluginMap() {
  const ref = useRef<HTMLDivElement>(null);
  const { cycle, paused } = useCycle(2400, 300, ref);
  const lit = cycle % PLUGIN_MAP_REGIONS.length;
  const region = (index: number, base: string) =>
    `${base} fw-map-region${index === lit ? " is-lit" : ""}`;
  return (
    <div
      ref={ref}
      className={`fw-map${paused ? " fw-paused" : ""}`}
      role="img"
      aria-label="A map of the bb window showing what plugins add: 1, a GitHub page with a badge in the navigation rail. 2, pull request 482 with passing checks on a thread row. 3, a bar chart inside an agent reply. 4, a Send later banner in the composer."
    >
      <div className="fw-win fw-map-win">
        <div className="fw-band">
          <WindowDots />
        </div>
        <div className="fw-map-body">
          <div className="fw-map-rail">
            <span className="fw-map-rail-btn is-current">
              <HomeGlyph className="fw-ic fw-ic-ink" />
            </span>
            <span className={region(0, "fw-map-rail-btn")}>
              <GitHubMark className="fw-ic fw-ic-ink" />
              <span className="fw-map-badge" />
              <MapChip n={1} />
            </span>
            <span className="fw-map-rail-btn">
              <ClockIcon className="fw-ic" />
            </span>
            <span className="fw-map-rail-fill" />
            <span className="fw-map-rail-btn">
              <SettingsGlyph className="fw-ic" />
            </span>
          </div>
          <div className="fw-map-side">
            <div className="fw-label">Threads</div>
            <div className="fw-row is-active">
              <span className="fw-row-title">Signups</span>
              <ThreadStatus status="running" />
            </div>
            <div className={region(1, "fw-map-pr")}>
              <span className="fw-row-title">Checkout fix</span>
              <span className="fw-map-meta">
                #482
                <CheckGlyph className="fw-map-check" />
                checks
              </span>
              <MapChip n={2} />
            </div>
            <div className="fw-row">
              <span className="fw-row-title">SDK bump</span>
              <ThreadStatus status="done" />
            </div>
          </div>
          <div className="fw-map-main">
            <div className="fw-map-say">Signups by week</div>
            <div className={region(2, "fw-map-chart")}>
              {CHART_BARS.map((height, index) => (
                <span
                  key={index}
                  className="fw-map-bar"
                  style={{ height: `${height}%` }}
                />
              ))}
              <MapChip n={3} />
            </div>
            <div className="fw-map-composer">
              <div className={region(3, "fw-map-banner")}>
                <ClockIcon className="fw-ic" />
                <span className="fw-row-title">Send later · 9:00</span>
                <MapChip n={4} />
              </div>
              <div className="fw-map-input">Ask anything</div>
            </div>
          </div>
        </div>
      </div>
      <ol className="fw-map-key">
        {PLUGIN_MAP_REGIONS.map((label, index) => (
          <li
            key={label}
            className={
              index === lit ? "fw-map-key-item is-lit" : "fw-map-key-item"
            }
          >
            <MapChip n={index + 1} />
            <span>{label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const DELEGATION_LEAD = "Ship the checkout fix";

const DELEGATION_CHILDREN = [
  {
    icon: ClaudeIcon,
    provider: "Claude Code",
    title: "Plan the fix",
    landsAt: 0.6,
    status: "running",
    next: { status: "done", at: 2 },
  },
  {
    icon: CursorIcon,
    provider: "Cursor",
    title: "Build it",
    landsAt: 3,
    status: "running",
    next: { status: "done", at: 6.8 },
  },
  {
    icon: OpenAiIcon,
    provider: "Codex",
    title: "Review the diff",
    landsAt: 7.8,
    status: "running",
    next: { status: "waiting", at: 9.2 },
  },
] as const;

const DELEGATION_UPDATES = [
  { text: "Started Plan the fix", from: 0.6, to: 2.4 },
  { text: "Plan the fix finished → started Build it", from: 2.4, to: 4.8 },
  {
    text: "Build it asked a question → answered by the lead",
    from: 4.8,
    to: 7.2,
  },
  { text: "Build it finished → started Review the diff", from: 7.2 },
] as const;

const DELEGATION_PING = "Review the diff · needs your approval";

export function DelegationTree() {
  const ref = useRef<HTMLDivElement>(null);
  const { cycle, leaving, paused } = useCycle(13400, 600, ref);
  return (
    <div
      ref={ref}
      className="fw-win fw-lead"
      role="img"
      aria-label="bb sidebar: the lead thread Ship the checkout fix, running in Grok Build, starts Plan the fix in Claude Code, Build it in Cursor and Review the diff in Codex, one after another. Its Child thread updates say what finished and what started, and that the lead answered a question from Build it. Only one notification reaches you: Review the diff needs your approval."
    >
      <div className="fw-band">
        <WindowDots />
      </div>
      <div
        className={stageClass("fw-card fw-lead-stage", leaving, paused)}
        key={cycle}
      >
        <div className="fw-label">Threads</div>
        <div className="fw-row fw-lead-row is-active">
          <GrokIcon className="fw-prov" />
          <span className="fw-row-title">{DELEGATION_LEAD}</span>
          <span className="fw-lead-prov">Grok Build</span>
          <span className="fw-tag">Lead</span>
          <ThreadStatus status="running" />
        </div>
        <div className="fw-updates">
          <span className="fw-updates-head">Child thread updates</span>
          <span className="fw-updates-lines">
            {DELEGATION_UPDATES.map((update) => (
              <span
                key={update.text}
                className={
                  "to" in update ? "fw-update fw-update-out" : "fw-update"
                }
                style={
                  "to" in update
                    ? between(update.from, update.to)
                    : at(update.from)
                }
              >
                {update.text}
              </span>
            ))}
          </span>
        </div>
        <div className="fw-kids">
          {DELEGATION_CHILDREN.map((child) => (
            <div
              key={child.title}
              className="fw-row fw-grow"
              style={at(child.landsAt)}
            >
              <child.icon className="fw-prov" />
              <span className="fw-kid-text">
                <span className="fw-row-title">{child.title}</span>
                <span className="fw-kid-prov">{child.provider}</span>
              </span>
              <ThreadStatus status={child.status} next={child.next} />
            </div>
          ))}
        </div>
        <div className="fw-ping fw-rise" style={at(9.8)}>
          <span aria-hidden className="bb-mark fw-ping-mark" />
          <span className="fw-ping-text">
            <span className="fw-ping-app">bb</span>
            <span className="fw-ping-body">{DELEGATION_PING}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

const START_COMMAND = 'bb thread spawn --prompt "Fix CI on main"';

type StartRow = {
  icon: (props: IconProps) => ReactNode;
  title: string;
  landsAt: number;
};

const LINUX_ROWS: StartRow[] = [
  { icon: OpenAiIcon, title: "Fix the checkout bug", landsAt: 1.6 },
  { icon: TerminalIcon, title: "Fix CI on main", landsAt: 6.1 },
  { icon: ClockIcon, title: "Daily changelog", landsAt: 8.1 },
];

const MACBOOK_ROWS: StartRow[] = [
  { icon: PhoneIcon, title: "Fix flaky login test", landsAt: 4.3 },
];

function StartRows({ rows }: { rows: StartRow[] }) {
  return rows.map((row) => (
    <div key={row.title} className="fw-row fw-grow" style={at(row.landsAt)}>
      <row.icon className="fw-src-ic" />
      <span className="fw-row-title">{row.title}</span>
      <ThreadStatus status="running" />
    </div>
  ));
}

export function StartAnywhere() {
  const ref = useRef<HTMLDivElement>(null);
  const { cycle, leaving, paused } = useCycle(12000, 600, ref);
  return (
    <div
      ref={ref}
      className="fw-start"
      role="img"
      aria-label="Work starts from many places and lands in one bb sidebar. From ChatGPT: Hand this off to bb, fix the checkout bug, then Used Control bb. Grok and Claude cards sit behind it. The same running thread, Fix the checkout bug, shows up on a phone, which also sends Fix flaky login test. A failed CI run on main runs bb thread spawn with the prompt Fix CI on main. Automations run Daily changelog on weekdays at 9:00 and Bump dependencies on Fridays. Each lands as a running thread in the sidebar, grouped by machine: linux-box, the server, and a MacBook."
    >
      <div className={stageClass("fw-doors", leaving, paused)} key={cycle}>
        <div className="fw-apps">
          <div className="fw-app fw-app-3">
            <div className="fw-app-head">
              <GrokIcon className="fw-src-ic" />
              Grok
            </div>
          </div>
          <div className="fw-app fw-app-2">
            <div className="fw-app-head">
              <ClaudeIcon className="fw-src-ic" />
              Claude
            </div>
          </div>
          <div className="fw-app fw-app-1">
            <div className="fw-app-head">
              <OpenAiIcon className="fw-src-ic" />
              ChatGPT
            </div>
            <div className="fw-app-body">
              <span className="fw-bubble">
                Hand this off to bb: fix the checkout bug
              </span>
              <span className="fw-used fw-land" style={at(0.9)}>
                <span aria-hidden className="bb-mark fw-used-mark" />
                Used <b>Control bb</b>
                <CheckGlyph className="fw-used-check" />
              </span>
            </div>
          </div>
        </div>
        <div className="fw-phone">
          <div className="fw-phone-head">
            <span aria-hidden className="bb-mark fw-phone-mark" />
            bb
          </div>
          <div className="fw-phone-row fw-land" style={at(2.4)}>
            <span className="fw-phone-state">
              <Spinner className="trun" />
              Working
            </span>
            <span>Fix the checkout bug</span>
          </div>
          <div className="fw-phone-feed">
            <span className="fw-phone-msg fw-land" style={at(3.6)}>
              Fix flaky login test
            </span>
          </div>
          <div className="fw-phone-input" />
        </div>
        <div className="fw-src fw-ci">
          <div className="fw-src-head">
            <TerminalIcon className="fw-src-ic" />
            <span>CI · main failed</span>
          </div>
          <div className="fw-term">
            <span className="fw-tline fw-tcmd" style={at(5.4)}>
              <span className="fw-prompt">$</span> {START_COMMAND}
            </span>
          </div>
        </div>
        <div className="fw-autos">
          <div className="fw-src fw-auto fw-auto-fire" style={at(7.4)}>
            <ClockIcon className="fw-src-ic" />
            <span className="fw-auto-text">
              <span className="fw-auto-when">Weekdays 9:00</span>
              <span>Daily changelog</span>
            </span>
          </div>
          <div className="fw-src fw-auto">
            <ClockIcon className="fw-src-ic" />
            <span className="fw-auto-text">
              <span className="fw-auto-when">Fridays</span>
              <span>Bump dependencies</span>
            </span>
          </div>
        </div>
        <div className="fw-arrows" aria-hidden>
          <ArrowDownGlyph className="fw-arrow" />
          <ArrowDownGlyph className="fw-arrow" />
          <ArrowDownGlyph className="fw-arrow" />
        </div>
        <div className="fw-side fw-machines">
          <div className="fw-group">
            <LinuxIcon className="fw-group-ic" />
            <span className="fw-group-name">linux-box</span>
            <span className="fw-tag">server</span>
          </div>
          <StartRows rows={LINUX_ROWS} />
          <div className="fw-group">
            <LaptopGlyph className="fw-group-ic" />
            <span className="fw-group-name">MacBook</span>
          </div>
          <StartRows rows={MACBOOK_ROWS} />
        </div>
      </div>
    </div>
  );
}
