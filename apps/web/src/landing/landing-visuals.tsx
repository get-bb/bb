import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowExpand01Icon from "@hugeicons/core-free-icons/ArrowExpand01Icon";
import ArrowMoveDownLeftIcon from "@hugeicons/core-free-icons/ArrowMoveDownLeftIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import AttachmentIcon from "@hugeicons/core-free-icons/AttachmentIcon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon";
import GitBranchIcon_ from "@hugeicons/core-free-icons/GitBranchIcon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import MessageQuestionIcon from "@hugeicons/core-free-icons/MessageQuestionIcon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import SidebarRightIcon from "@hugeicons/core-free-icons/SidebarRightIcon";
import Plug02Icon from "@hugeicons/core-free-icons/Plug02Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import Mic02Icon from "@hugeicons/core-free-icons/Mic02Icon";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import RepeatIcon from "@hugeicons/core-free-icons/RepeatIcon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import Bug01Icon from "@hugeicons/core-free-icons/Bug01Icon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Edit04Icon from "@hugeicons/core-free-icons/Edit04Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import PlusMinus01Icon from "@hugeicons/core-free-icons/PlusMinus01Icon";
import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
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
  stacked,
  section,
  visual,
  children,
}: {
  title: ReactNode;
  flip?: boolean;
  stacked?: boolean;
  section?: string;
  visual: ReactNode;
  children: ReactNode;
}) {
  const classes = ["band"];
  if (flip) classes.push("band-flip");
  if (stacked) classes.push("band-stacked");
  return (
    <section className={classes.join(" ")} data-reveal data-section={section}>
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

export function SpawnSidebar() {
  const { cycle, leaving } = useCycle(5600, 500);
  return (
    <div
      className="spawnbar"
      aria-label="bb spawns and manages a worker thread for each provider"
    >
      <div className="sb-head">
        <span aria-hidden="true" className="bb-mark sb-mark" />
        <span className="sb-title">Threads</span>
        <span className="sb-active">5 active</span>
      </div>
      <div className={leaving ? "sb-list leaving" : "sb-list"} key={cycle}>
        <SpawnRow
          parent
          icon={<ClaudeIcon className="sb-ic" />}
          name="Claude Code"
          task="Ship the release"
          status="managing"
          at={0.1}
          doneAt={4}
        />
        <div className="sb-kids">
          <SpawnRow
            icon={<OpenAiIcon className="sb-ic" />}
            name="Codex"
            task="Port module to TS"
            status="running"
            at={0.6}
            doneAt={2.3}
          />
          <SpawnRow
            icon={<CursorIcon className="sb-ic" />}
            name="Cursor"
            task="Refactor the auth flow"
            status="running"
            at={1}
            doneAt={3}
          />
          <SpawnRow
            icon={<PiIcon className="sb-ic" />}
            name="Pi"
            task="Write release notes"
            status="running"
            at={1.4}
            doneAt={3.7}
          />
          <SpawnRow
            icon={<OpencodeIcon className="sb-ic" />}
            name="OpenCode"
            task="Add integration tests"
            status="running"
            at={1.8}
            doneAt={3.4}
          />
        </div>
      </div>
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
const PhoneIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SmartPhone01Icon} className={className} />
);
const LaptopGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={LaptopIcon} className={className} />
);
const CheckGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Tick02Icon} className={className} />
);
const ChevronLeft = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowLeft01Icon} className={className} />
);
const MoreIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={MoreHorizontalIcon} className={className} />
);
const NewThreadIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={BubbleChatAddIcon} className={className} />
);
const PanelRightIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SidebarRightIcon} className={className} />
);
const PluginIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Plug02Icon} className={className} />
);
const SubagentIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={UserAdd01Icon} className={className} />
);
const MicIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Mic02Icon} className={className} />
);
const HomeIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Home01Icon} className={className} />
);
const SkillsIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ZapIcon} className={className} />
);
const AutomationsIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={RepeatIcon} className={className} />
);
const SettingsIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Settings01Icon} className={className} />
);
const BugIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Bug01Icon} className={className} />
);
const BbGlyph = ({ className }: IconProps) => (
  <span aria-hidden className={`bb-mark ${className ?? ""}`} />
);

type ThreadState = "running" | "done" | "waiting";

function StatusGlyph({ status }: { status: ThreadState }) {
  if (status === "running") return <Spinner className="trun" />;
  if (status === "done") return <DoneIcon className="tdone" />;
  return <WaitingIcon className="twait" />;
}

type StatusStep = { status: ThreadState; at: number };

function ThreadStatus({
  status,
  then = [],
}: {
  status: ThreadState;
  then?: readonly StatusStep[];
}) {
  if (then.length === 0) {
    return (
      <span className="tstatus" aria-hidden>
        <StatusGlyph status={status} />
      </span>
    );
  }
  const phases = [{ status, at: 0 }, ...then];
  return (
    <span className="tstatus bw-phases" aria-hidden>
      {phases.map((phase, index) => {
        const next = phases[index + 1];
        const role =
          index === 0 ? "first" : next === undefined ? "last" : "mid";
        return (
          <span
            key={index}
            className={`bw-phase bw-phase-${role}`}
            style={phaseStyle(phase.at, next?.at)}
          >
            <StatusGlyph status={phase.status} />
          </span>
        );
      })}
    </span>
  );
}

function phaseStyle(start: number, end?: number): CSSProperties {
  return {
    "--fw-at": `${start}s`,
    "--fw-out": `${end ?? start}s`,
  } as CSSProperties;
}

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

function useFitWindow(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = ref.current;
    const frame = node?.parentElement;
    if (!node || !frame || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const windowStyle = getComputedStyle(node);
      const frameStyle = getComputedStyle(frame);
      const width = Number.parseFloat(
        windowStyle.getPropertyValue("--bw-width"),
      );
      const visible = Number.parseFloat(
        windowStyle.getPropertyValue("--bw-visible-width"),
      );
      const room =
        frame.clientWidth -
        Number.parseFloat(frameStyle.paddingLeft) -
        Number.parseFloat(frameStyle.paddingRight);
      if (!width || !visible || !room) return;
      const scale = Math.min(1, room / visible);
      const slice = Math.min(width, room / scale);
      node.style.setProperty("--bw-scale", String(scale));
      node.style.setProperty("--bw-slice", `${slice}px`);
      node.style.setProperty("--bw-slice-ratio", String(slice / width));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [ref]);
}

function stageClass(base: string, leaving: boolean, paused: boolean) {
  return `${base}${leaving ? " leaving" : ""}${paused ? " fw-paused" : ""}`;
}

function Reveal({
  at: seconds,
  className,
  children,
}: {
  at: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className ? `bw-reveal ${className}` : "bw-reveal"}
      style={at(seconds)}
    >
      <div className="bw-reveal-inner">{children}</div>
    </div>
  );
}

function WindowBar({
  title,
  panelOpen = false,
}: {
  title: string;
  panelOpen?: boolean;
}) {
  return (
    <div className="mock-bar">
      <div className="bar-left">
        <WindowDots />
        <span className="bar-menu" aria-hidden>
          <PanelIcon className="ri bar-ic" />
        </span>
        <span className="bar-nav" aria-hidden>
          <ChevronLeft className="ri" />
          <ChevronRight className="ri" />
        </span>
      </div>
      <div className="bar-main">
        <span className="bar-title">{title}</span>
        <MoreIcon className="bar-kebab" />
        <span className="bar-actions" aria-hidden>
          <span className={panelOpen ? "bar-toggle active" : "bar-toggle"}>
            <PanelRightIcon className="ri" />
          </span>
        </span>
      </div>
    </div>
  );
}

function NavRail({ children }: { children?: ReactNode }) {
  return (
    <nav className="bw-rail" aria-hidden>
      <span className="bw-rail-btn is-on">
        <HomeIcon className="bw-rail-ic" />
      </span>
      <span className="bw-rail-btn">
        <PluginIcon className="bw-rail-ic" />
      </span>
      <span className="bw-rail-btn">
        <SkillsIcon className="bw-rail-ic" />
      </span>
      <span className="bw-rail-btn">
        <AutomationsIcon className="bw-rail-ic" />
      </span>
      {children}
      <span className="bw-rail-btn">
        <MoreIcon className="bw-rail-ic" />
      </span>
      <span className="bw-rail-btn bw-rail-settings">
        <SettingsIcon className="bw-rail-ic" />
      </span>
    </nav>
  );
}

function Sidebar({
  rail,
  foot,
  children,
}: {
  rail?: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <NavRail>{rail}</NavRail>
      <aside className="side">
        <div className="side-act">
          <NewThreadIcon className="sa-ic" />
          New thread
        </div>
        {children}
        <div className="side-foot bw-side-foot" aria-hidden>
          <PhoneIcon className="bw-foot-ic" />
          <BugIcon className="bw-foot-ic" />
          {foot}
        </div>
      </aside>
    </>
  );
}

type RowIcon = (props: IconProps) => ReactNode;

function ThreadRow({
  title,
  status,
  then,
  icon: Icon,
  active = false,
  kid = false,
  meta,
}: {
  title: string;
  status?: ThreadState;
  then?: readonly StatusStep[];
  icon?: RowIcon;
  active?: boolean;
  kid?: boolean;
  meta?: ReactNode;
}) {
  const classes = ["trow", "bw-row"];
  if (active) classes.push("active");
  if (kid) classes.push("trow-kid");
  if (meta) classes.push("bw-row-meta");
  return (
    <div className={classes.join(" ")}>
      {Icon ? <Icon className="bw-row-ic" /> : null}
      <span className="bw-row-text">
        <span className="trow-title">{title}</span>
        {meta ? <span className="bw-meta">{meta}</span> : null}
      </span>
      {status ? <ThreadStatus status={status} then={then} /> : null}
    </div>
  );
}

function ComposerBox({
  placeholder,
  model,
  modelIcon: ModelIcon,
  banner,
}: {
  placeholder: string;
  model: string;
  modelIcon: RowIcon;
  banner?: ReactNode;
}) {
  return (
    <div className="composer">
      {banner}
      <div className="composer-box">
        <div className="composer-top">
          <span className="composer-input bw-placeholder">{placeholder}</span>
          <Maximize2 className="cb-expand" />
        </div>
        <div className="composer-row">
          <span className="model">
            <ModelIcon className="model-ic" />
            {model}
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
    </div>
  );
}

/* Four real BB Community plugins, in install order. Names and descriptions
   are the marketplace's own (getbb.app/marketplace); each piece below is what
   that plugin draws in bb, per its listing, README and screenshots. */
const PLUGIN_INSTALLS = [
  {
    id: "usage-tracker",
    name: "Usage Tracker",
    description: "See subscription limits without leaving BB.",
    icon: UsageTrackerGlyph,
  },
  {
    id: "bb-recap",
    name: "Recap",
    description:
      "Generates concise, display-only summaries for BB threads on demand or after they become idle.",
    icon: RecapGlyph,
  },
  {
    id: "genui",
    name: "Generative UI",
    description:
      "Turns agent replies into charts, diagrams, maps, plans and forms you can use, right in the chat.",
    icon: GenUiGlyph,
  },
  {
    id: "burn",
    name: "Burn",
    description:
      "See what every agent thread costs in dollars while it runs, per prompt and across all your threads.",
    icon: BurnGlyph,
  },
] as const;

/* One plugin every INSTALL_STEP seconds: the Install press, Installing… for
   INSTALL_BUSY seconds, Installed, then its piece eases into the window. */
const INSTALL_START = 0.8;
const INSTALL_STEP = 3.2;
const INSTALL_PRESS = 0.2;
const INSTALL_BUSY = 1.4;
const PIECE_DELAY = 0.15;
const PIECE_SETTLE = 0.65;
const FINAL_HOLD = 2;

function installAt(index: number) {
  return INSTALL_START + index * INSTALL_STEP;
}

function pieceAt(id: (typeof PLUGIN_INSTALLS)[number]["id"]) {
  const index = PLUGIN_INSTALLS.findIndex((plugin) => plugin.id === id);
  return installAt(index) + INSTALL_PRESS + INSTALL_BUSY + PIECE_DELAY;
}

const PLUGIN_LOOP_MS = Math.round(
  (pieceAt("burn") + PIECE_SETTLE + FINAL_HOLD) * 1000,
);

function UsageTrackerGlyph({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="3" y="4" width="4" height="10" rx="2" fill="#7c3aed" />
      <rect x="10" y="4" width="4" height="16" rx="2" fill="#7c3aed" />
      <rect x="17" y="4" width="4" height="6" rx="2" fill="#7c3aed" />
    </svg>
  );
}

function RecapGlyph({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6.25 4.75h11.5A2.25 2.25 0 0 1 20 7v7.25a2.25 2.25 0 0 1-2.25 2.25h-6.5L7 19.75V16.5H6.25A2.25 2.25 0 0 1 4 14.25V7a2.25 2.25 0 0 1 2.25-2.25Z" />
      <path d="M8.25 9h7.5M8.25 12h5.25" />
    </svg>
  );
}

function GenUiGlyph({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 13v-2" />
      <path d="M12 13V7" />
      <path d="M16 13v-4" />
    </svg>
  );
}

function BurnGlyph({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

function SparkGlyph({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M12 4c.5 4.4 3.6 7.5 8 8-4.4.5-7.5 3.6-8 8-.5-4.4-3.6-7.5-8-8 4.4-.5 7.5-3.6 8-8Z"
        fill="currentColor"
      />
    </svg>
  );
}

const DownloadGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Download04Icon} className={className} />
);
const SearchGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Search01Icon} className={className} />
);
const InfoGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={InformationCircleIcon} className={className} />
);
const DiffGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={PlusMinus01Icon} className={className} />
);
const ArrowUpGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ArrowUp02Icon} className={className} />
);

/* bb's catalog install control (PluginCatalogInstallControl, with its label):
   Install, then Installing… while the install job runs, then Installed. */
function InstallButton({ at: start }: { at: number }) {
  const busyAt = start + INSTALL_PRESS;
  const doneAt = busyAt + INSTALL_BUSY;
  return (
    <span className="bw-inst" aria-hidden>
      <span
        className="bw-inst-phase bw-inst-idle"
        style={phaseStyle(start, busyAt)}
      >
        <DownloadGlyph className="bw-inst-ic" />
        Install
      </span>
      <span
        className="bw-inst-phase bw-inst-busy"
        style={phaseStyle(busyAt, doneAt)}
      >
        <Spinner className="bw-inst-ic bw-inst-spin" />
        Installing…
      </span>
      <span className="bw-inst-phase bw-inst-done" style={at(doneAt)}>
        <CheckGlyph className="bw-inst-ic" />
        Installed
      </span>
    </span>
  );
}

function PluginCatalogCard() {
  return (
    <div className="bw-catalog" aria-hidden>
      <div className="bw-cat-head">
        <span className="bw-cat-title">Plugins</span>
        <span className="bw-cat-search">
          <SearchGlyph className="bw-cat-search-ic" />
          Search plugins...
        </span>
      </div>
      <div className="bw-cat-list">
        {PLUGIN_INSTALLS.map((plugin, index) => (
          <div key={plugin.id} className="bw-cat-row">
            <span className="bw-cat-chip">
              <plugin.icon className="bw-cat-chip-ic" />
            </span>
            <span className="bw-cat-name">{plugin.name}</span>
            <InstallButton at={installAt(index)} />
            <span className="bw-cat-desc">{plugin.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const USAGE_READINGS = [
  { provider: "claude", icon: ClaudeIcon, percent: 62 },
] as const;

/* Usage Tracker's compact strip beside the sidebar's footer icons: a mark, a
   progress rail and the weekly reading for each provider shown. */
function UsageStrip() {
  return (
    <span className="bw-usage" style={at(pieceAt("usage-tracker"))}>
      <span className="bw-usage-inner">
        {USAGE_READINGS.map((reading) => (
          <span key={reading.provider} className="bw-usage-prov">
            <reading.icon
              className={`bw-usage-mark bw-usage-mark-${reading.provider}`}
            />
            <span className="bw-usage-rail">
              <i style={{ width: `${reading.percent}%` }} />
            </span>
            <span className="bw-usage-pct">{reading.percent}%</span>
          </span>
        ))}
      </span>
    </span>
  );
}

/* Recap's compact banner in the composer. */
function RecapBanner() {
  return (
    <Reveal at={pieceAt("bb-recap")} className="bw-recap-reveal">
      <div className="bw-recap">
        <span className="bw-recap-ic">
          <SparkGlyph className="bw-recap-spark" />
        </span>
        <span className="bw-recap-text">
          <span className="bw-recap-head">
            <b>Recap</b>
            Automatic · 5:11 PM
          </span>
          <span className="bw-recap-sum">
            Loaded six weeks of signups, explained the Pro dip and charted them
            by plan: up 38%, mostly Team.
          </span>
        </span>
        <span className="bw-recap-expand">
          Expand
          <ArrowUpGlyph className="bw-recap-arrow" />
        </span>
        <span className="bw-recap-btn">Refresh</span>
      </div>
    </Reveal>
  );
}

const SIGNUP_WEEKS = [
  { team: 34, pro: 40 },
  { team: 40, pro: 42 },
  { team: 38, pro: 46 },
  { team: 52, pro: 47 },
  { team: 61, pro: 50 },
  { team: 72, pro: 52 },
];

/* Generative UI's Chart component in the agent's reply, with the source line
   its charts carry. */
function SignupsChart() {
  return (
    <Reveal at={pieceAt("genui")}>
      <div className="bw-chart">
        <div className="bw-chart-head">
          <span>Weekly signups by plan</span>
          <span className="bw-legend">
            <i className="bw-key bw-key-team" />
            Team
            <i className="bw-key bw-key-pro" />
            Pro
          </span>
        </div>
        <div className="bw-bars">
          {SIGNUP_WEEKS.map((week, index) => (
            <span
              key={index}
              className="bw-bar-col"
              style={{ "--bw-bar-i": index } as CSSProperties}
            >
              <span
                className="bw-bar bw-bar-team"
                style={{ height: `${week.team * 0.8}%` }}
              />
              <span
                className="bw-bar bw-bar-pro"
                style={{ height: `${week.pro * 0.4}%` }}
              />
            </span>
          ))}
        </div>
        <div className="bw-chart-source">Source: analytics.signups</div>
      </div>
    </Reveal>
  );
}

const BURN_STATS = [
  { label: "This thread", value: "$1.84", note: "No budget" },
  { label: "Per call", value: "$0.11", note: "17 calls · 41s" },
  { label: "Cache", value: "94%", note: "hit rate" },
  { label: "Speed", value: "1.1k tok/s", note: "output, timed calls" },
] as const;

const BURN_TURNS = [
  {
    n: 4,
    time: "17:09",
    prompt: "Chart weekly signups by plan for the last six weeks.",
    cost: "$0.52",
    share: 62,
  },
  {
    n: 3,
    time: "17:06",
    prompt: "Split the funnel by acquisition channel",
    cost: "$0.84",
    share: 100,
  },
  {
    n: 2,
    time: "17:03",
    prompt: "Why did Pro dip in week three?",
    cost: "$0.31",
    share: 37,
  },
  {
    n: 1,
    time: "16:58",
    prompt: "Load the signups table from analytics",
    cost: "$0.17",
    share: 20,
  },
] as const;

/* Burn's tab in the thread's side panel: cost cards and the cost of each
   prompt. */
function BurnPanel() {
  return (
    <div className="bw-burn" style={at(pieceAt("burn"))}>
      <div className="bw-burn-inner">
        <div className="bw-burn-tabs">
          <span className="bw-burn-tab">
            <InfoGlyph className="bw-burn-tab-ic" />
          </span>
          <span className="bw-burn-tab">
            <DiffGlyph className="bw-burn-tab-ic" />
          </span>
          <span className="bw-burn-tab is-on">
            <BurnGlyph className="bw-burn-tab-ic" />
            Burn
          </span>
        </div>
        <div className="bw-burn-stats">
          {BURN_STATS.map((stat) => (
            <span key={stat.label} className="bw-burn-stat">
              <span className="bw-burn-label">{stat.label}</span>
              <span className="bw-burn-value">{stat.value}</span>
              <span className="bw-burn-note">{stat.note}</span>
            </span>
          ))}
        </div>
        <div className="bw-burn-head">
          <span>Turns</span>
          <span className="bw-burn-seg">
            <span className="is-on">Newest</span>
            <span>Costliest</span>
          </span>
        </div>
        <div className="bw-burn-turns">
          {BURN_TURNS.map((turn) => (
            <span key={turn.n} className="bw-burn-turn">
              <span className="bw-burn-n">{turn.n}</span>
              <span className="bw-burn-prompt">{turn.prompt}</span>
              <span className="bw-burn-cost">{turn.cost}</span>
              <span className="bw-burn-rail">
                <i style={{ width: `${turn.share}%` }} />
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PluginMap() {
  const ref = useRef<HTMLDivElement>(null);
  useFitWindow(ref);
  const { cycle, leaving, paused } = useCycle(PLUGIN_LOOP_MS, 700, ref);
  const stageStyle = {
    "--bw-panel-at": `${pieceAt("burn")}s`,
  } as CSSProperties;
  return (
    <div
      ref={ref}
      className="bw bw-plugins"
      role="img"
      aria-label="A bb window next to its Plugins list. Four community plugins install one at a time, and each one's piece appears in bb: Usage Tracker adds Claude usage to the sidebar footer, Recap adds a summary of the thread above the composer, Generative UI draws a chart of weekly signups in the agent's reply, and Burn opens a panel with the thread's cost per prompt."
    >
      <div
        className={stageClass("bw-plugins-stage", leaving, paused)}
        key={cycle}
        style={stageStyle}
      >
        <div className="mock bw-window">
          <WindowBar title="Signups by plan" panelOpen />
          <div className="mock-body bw-body">
            <Sidebar foot={<UsageStrip />}>
              <div className="side-label">Threads</div>
              <ThreadRow title="Signups by plan" status="done" active />
              <ThreadRow title="Fix the checkout bug" status="done" />
              <ThreadRow title="Bump the SDK" status="done" />
              <ThreadRow title="Refactor auth" status="waiting" />
            </Sidebar>
            <div className="main">
              <div className="feed bw-feed bw-feed-live">
                <div className="msg-user">Why did Pro dip in week three?</div>
                <div className="msg-say">
                  A pricing-page test ran that week. Pro trials fell 12% while
                  it was live, then recovered.
                </div>
                <div className="msg-user">
                  Chart weekly signups by plan for the last six weeks.
                </div>
                <div className="msg-step">
                  <ChevronRight className="step-chev" />
                  Queried <code>analytics.signups</code>
                </div>
                <div className="msg-say">
                  Signups are up 38% in six weeks, and Team drove most of it.
                </div>
                <SignupsChart />
              </div>
              <ComposerBox
                placeholder="Ask for a follow-up"
                model="Opus 5.5"
                modelIcon={ClaudeIcon}
                banner={<RecapBanner />}
              />
            </div>
            <BurnPanel />
          </div>
        </div>
        <PluginCatalogCard />
      </div>
    </div>
  );
}

const DELEGATION_LEAD = "Ship the checkout fix";

const DELEGATION_CHILDREN = [
  {
    icon: ClaudeIcon,
    title: "Plan the fix",
    landsAt: 0.8,
    then: [{ status: "done", at: 2.2 }],
  },
  {
    icon: CursorIcon,
    title: "Build it",
    landsAt: 3.4,
    then: [
      { status: "waiting", at: 4.8 },
      { status: "running", at: 6.4 },
      { status: "done", at: 7.8 },
    ],
  },
  {
    icon: OpenAiIcon,
    title: "Review the diff",
    landsAt: 9,
    then: [{ status: "waiting", at: 10.4 }],
  },
] as const;

function SpawnLine({ title, provider }: { title: string; provider: string }) {
  return (
    <div className="msg-step msg-spawn">
      <SubagentIcon className="step-chev" />
      Started <strong>{title}</strong> in {provider}
    </div>
  );
}

function ChildUpdate({
  icon: Icon,
  children,
}: {
  icon: RowIcon;
  children: ReactNode;
}) {
  return (
    <div className="bw-update">
      <span className="bw-update-head">Child thread updates</span>
      <span className="bw-update-body">
        <Icon className="bw-update-ic" />
        <span>{children}</span>
      </span>
    </div>
  );
}

const DELEGATION_PING = "Review the diff needs your approval";

export function DelegationTree() {
  const ref = useRef<HTMLDivElement>(null);
  useFitWindow(ref);
  const { cycle, leaving, paused } = useCycle(14800, 700, ref);
  return (
    <div
      ref={ref}
      className="bw bw-lead"
      role="img"
      aria-label="The bb app with the lead thread Ship the checkout fix, running in Grok Build. It starts Plan the fix in Claude Code, Build it in Cursor and Review the diff in Codex, which nest under it in the sidebar. Its timeline shows each Child thread update, and it answers a question from Build it on its own. One notification reaches you: Review the diff needs your approval."
    >
      <div className="mock bw-window">
        <WindowBar title={DELEGATION_LEAD} />
        <div
          className={stageClass("mock-body bw-body", leaving, paused)}
          key={cycle}
        >
          <Sidebar>
            <div className="side-label">Threads</div>
            <ThreadRow title="Bump the SDK" icon={ClaudeIcon} status="done" />
            <ThreadRow
              title={DELEGATION_LEAD}
              icon={GrokIcon}
              status="running"
              active
            />
            <div className="thread-kids bw-kids">
              {DELEGATION_CHILDREN.map((child) => (
                <Reveal key={child.title} at={child.landsAt}>
                  <ThreadRow
                    title={child.title}
                    icon={child.icon}
                    status="running"
                    then={child.then}
                    kid
                  />
                </Reveal>
              ))}
            </div>
            <ThreadRow
              title="Refactor auth"
              icon={CursorIcon}
              status="waiting"
            />
            <ThreadRow
              title="Weekly changelog"
              icon={OpenAiIcon}
              status="done"
            />
          </Sidebar>
          <div className="main">
            <div className="feed bw-feed bw-feed-live">
              <div className="msg-user">
                Ship the checkout timeout fix. Plan it, build it and get it
                reviewed.
              </div>
              <Reveal at={0.6}>
                <SpawnLine title="Plan the fix" provider="Claude Code" />
              </Reveal>
              <Reveal at={2.4}>
                <ChildUpdate icon={ClaudeIcon}>
                  <strong>Plan the fix</strong> finished: three steps in{" "}
                  <code>plan.md</code>
                </ChildUpdate>
              </Reveal>
              <Reveal at={3.2}>
                <SpawnLine title="Build it" provider="Cursor" />
              </Reveal>
              <Reveal at={5}>
                <ChildUpdate icon={CursorIcon}>
                  <strong>Build it</strong> asked: keep the 30s timeout, or make
                  it configurable?
                </ChildUpdate>
              </Reveal>
              <Reveal at={6.2}>
                <div className="msg-say">
                  Replied to <strong>Build it</strong>: make it configurable,
                  default 30s.
                </div>
              </Reveal>
              <Reveal at={8}>
                <ChildUpdate icon={CursorIcon}>
                  <strong>Build it</strong> finished: PR #482 is open
                </ChildUpdate>
              </Reveal>
              <Reveal at={8.8}>
                <SpawnLine title="Review the diff" provider="Codex" />
              </Reveal>
              <Reveal at={10.6}>
                <ChildUpdate icon={OpenAiIcon}>
                  <strong>Review the diff</strong> is waiting on your approval
                </ChildUpdate>
              </Reveal>
            </div>
            <ComposerBox
              placeholder="Ask for a follow-up"
              model="Grok Build"
              modelIcon={GrokIcon}
            />
          </div>
          <div className="bw-toast" style={at(11.4)}>
            <BbGlyph className="bw-toast-mark" />
            <span className="bw-toast-text">
              <span className="bw-toast-app">bb · now</span>
              <span className="bw-toast-body">{DELEGATION_PING}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const START_PROMPT = "Hand this off to bb: fix the checkout bug";

const FileReadIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={File01Icon} className={className} />
);
const SearchIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Search01Icon} className={className} />
);
const EditFileIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Edit04Icon} className={className} />
);
const CommandIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ComputerTerminal01Icon} className={className} />
);

type StartStep =
  | { at: number; say: string }
  | {
      at: number;
      say?: undefined;
      icon: RowIcon;
      verb: string;
      object: string;
      live?: boolean;
    };

const START_STEPS: readonly StartStep[] = [
  { at: 2.4, icon: SearchIcon, verb: "Explored", object: "4 files, 1 search" },
  { at: 2.9, icon: FileReadIcon, verb: "Read", object: "src/checkout/pay.ts" },
  {
    at: 3.5,
    say: "The payment call has no timeout, so slow networks hang checkout. Adding a 10s timeout with one retry.",
  },
  { at: 4.4, icon: EditFileIcon, verb: "Edited", object: "2 files" },
  {
    at: 5.2,
    icon: CommandIcon,
    verb: "Running",
    object: "pnpm test checkout",
    live: true,
  },
];

function PhoneStatusBar() {
  return (
    <div className="bw-phone-status">
      <span>9:41</span>
      <span className="bw-phone-sys">
        <svg viewBox="0 0 18 12" width="18" height="12">
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
          <rect x="10" y="3" width="3" height="9" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" />
        </svg>
        <svg viewBox="0 0 16 12" width="16" height="12">
          <path d="M8 2.6c2.2 0 4.2.8 5.7 2.2l1.2-1.3A10 10 0 0 0 8 .8a10 10 0 0 0-6.9 2.7l1.2 1.3A8.2 8.2 0 0 1 8 2.6Z" />
          <path d="M8 6.2c1.2 0 2.3.4 3.2 1.2l1.2-1.3A6.5 6.5 0 0 0 8 4.4a6.5 6.5 0 0 0-4.4 1.7l1.2 1.3c.9-.8 2-1.2 3.2-1.2Z" />
          <path d="M8 9.7 10 7.6a3 3 0 0 0-4 0Z" />
        </svg>
        <svg viewBox="0 0 27 12" width="27" height="12">
          <rect
            x="0.5"
            y="0.5"
            width="23"
            height="11"
            rx="3.5"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.4"
          />
          <rect x="2" y="2" width="16" height="8" rx="2" />
          <path d="M25 4v4a2 2 0 0 0 0-4Z" fillOpacity="0.4" />
        </svg>
      </span>
    </div>
  );
}

export function StartAnywhere() {
  const ref = useRef<HTMLDivElement>(null);
  useFitWindow(ref);
  const { cycle, leaving, paused } = useCycle(11800, 700, ref);
  return (
    <div
      ref={ref}
      className="bw bw-start"
      role="img"
      aria-label="A ChatGPT chat says Hand this off to bb: fix the checkout bug and Used Control bb, with Claude and Grok behind it. The thread lands in the bb sidebar, grouped by machine under linux-box, the server, next to a thread from CI and one from a schedule. An iPhone shows the same thread in the bb mobile app, still working: it explored the code, edited two files and is running the tests."
    >
      <div
        className={stageClass("bw-start-stage", leaving, paused)}
        key={cycle}
      >
        <div className="mock bw-window">
          <WindowBar title="Fix the checkout bug" />
          <div className="mock-body bw-body">
            <Sidebar>
              <div className="side-label bw-group">
                <LinuxIcon className="bw-group-ic" />
                linux-box
                <span className="bw-chip">server</span>
              </div>
              <Reveal at={1.4}>
                <ThreadRow
                  title="Fix the checkout bug"
                  icon={OpenAiIcon}
                  status="running"
                  active
                />
              </Reveal>
              <Reveal at={6.4}>
                <ThreadRow
                  title="Fix CI on main"
                  icon={TerminalIcon}
                  status="running"
                />
              </Reveal>
              <Reveal at={7.6}>
                <ThreadRow
                  title="Daily changelog"
                  icon={ClockIcon}
                  status="running"
                />
              </Reveal>
              <div className="side-label bw-group">
                <LaptopGlyph className="bw-group-ic" />
                MacBook
              </div>
              <ThreadRow
                title="Refactor auth"
                icon={BbGlyph}
                status="waiting"
              />
              <ThreadRow
                title="Fix flaky login test"
                icon={PhoneIcon}
                status="done"
              />
            </Sidebar>
            <div className="main">
              <div className="feed bw-feed">
                <Reveal at={1.8}>
                  <div className="msg-user">{START_PROMPT}</div>
                </Reveal>
                {START_STEPS.map((step) => (
                  <Reveal key={step.at} at={step.at}>
                    {step.say !== undefined ? (
                      <div className="msg-say">{step.say}</div>
                    ) : (
                      <div className="msg-step">
                        <ChevronRight className="step-chev" />
                        {step.verb} {step.object}
                      </div>
                    )}
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="bw-chat-stack">
          <div className="bw-chat-back bw-chat-back-2">
            <GrokIcon className="bw-chat-back-ic" />
            Grok
          </div>
          <div className="bw-chat-back bw-chat-back-1">
            <ClaudeIcon className="bw-chat-back-ic" />
            Claude
          </div>
          <div className="bw-chat">
            <div className="bw-chat-head">
              <OpenAiIcon className="bw-chat-ic" />
              ChatGPT
            </div>
            <div className="bw-chat-body">
              <span className="bw-bubble">{START_PROMPT}</span>
              <span className="bw-used bw-fade" style={at(0.8)}>
                <BbGlyph className="bw-used-mark" />
                Used <b>Control bb</b>
                <CheckGlyph className="bw-used-check" />
              </span>
              <span className="bw-chat-say bw-fade" style={at(1.2)}>
                Started <b>Fix the checkout bug</b> in bb on linux-box.
              </span>
            </div>
          </div>
        </div>
        <div className="bw-phone" aria-hidden>
          <div className="bw-phone-screen">
            <div className="bw-phone-ui">
              <PhoneStatusBar />
              <div className="bw-m-head">
                <PanelIcon className="bw-m-head-ic" />
                <span className="bw-m-title">Fix the checkout bug</span>
                <MoreIcon className="bw-m-head-ic" />
                <PanelRightIcon className="bw-m-head-ic bw-m-head-end" />
              </div>
              <div className="bw-m-feed">
                <Reveal at={1.8}>
                  <div className="bw-m-user">{START_PROMPT}</div>
                </Reveal>
                {START_STEPS.map((step) => (
                  <Reveal key={step.at} at={step.at}>
                    {step.say !== undefined ? (
                      <div className="bw-m-say">{step.say}</div>
                    ) : (
                      <div
                        className={step.live ? "bw-m-row is-live" : "bw-m-row"}
                      >
                        <step.icon className="bw-m-row-ic" />
                        <span className="bw-m-verb">{step.verb}</span>
                        <span className="bw-m-object">{step.object}</span>
                        {step.live ? (
                          <span className="bw-m-timer">14s</span>
                        ) : null}
                        <ChevronRight className="bw-m-chev" />
                      </div>
                    )}
                  </Reveal>
                ))}
                <div className="bw-m-working bw-fade" style={at(5.6)}>
                  Working...
                </div>
              </div>
              <div className="bw-m-composer">
                <span className="bw-m-placeholder">Ask a follow-up</span>
                <MicIcon className="bw-m-mic" />
                <span className="bw-m-stop">
                  <i />
                </span>
              </div>
              <span className="bw-phone-home" />
            </div>
            <span className="bw-phone-island" />
          </div>
        </div>
      </div>
    </div>
  );
}
