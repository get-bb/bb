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
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import RepeatIcon from "@hugeicons/core-free-icons/RepeatIcon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import Bug01Icon from "@hugeicons/core-free-icons/Bug01Icon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Edit04Icon from "@hugeicons/core-free-icons/Edit04Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import SortingNineOneIcon from "@hugeicons/core-free-icons/SortingNineOneIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import PlusMinusSquare01Icon from "@hugeicons/core-free-icons/PlusMinusSquare01Icon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import ExpandIcon from "@hugeicons/core-free-icons/ExpandIcon";
import FilterIcon from "@hugeicons/core-free-icons/FilterIcon";
import AiContentGenerator01Icon from "@hugeicons/core-free-icons/AiContentGenerator01Icon";
import RoboticIcon from "@hugeicons/core-free-icons/RoboticIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

import { trackLandingEvent } from "./analytics";
import { CommandButton } from "./command-button";
import { DesktopDownloadButton, DownloadLink } from "./cta";
import { useDesktopPlatform } from "./desktop-platform";
import {
  CATALOG_PLUGIN_COUNT,
  CATALOG_PLUGINS,
  CATALOG_VIEWS,
  type CatalogPlugin,
  type CatalogQuery,
} from "./plugin-catalog-snapshot";
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
  title: ReactNode;
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

type RailDestination = "home" | "plugins";

function NavRail({
  active = "home",
  children,
}: {
  active?: RailDestination | null;
  children?: ReactNode;
}) {
  const button = (destination: RailDestination) =>
    destination === active ? "bw-rail-btn is-on" : "bw-rail-btn";
  return (
    <nav className="bw-rail" aria-hidden>
      <span className={button("home")}>
        <HomeIcon className="bw-rail-ic" />
      </span>
      <span className={button("plugins")}>
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
  nav,
  children,
}: {
  rail?: ReactNode;
  nav?: RailDestination;
  children: ReactNode;
}) {
  return (
    <>
      <NavRail active={nav}>{rail}</NavRail>
      <aside className="side">
        <div className="side-act">
          <NewThreadIcon className="sa-ic" />
          New thread
        </div>
        {children}
        <div className="side-foot bw-side-foot" aria-hidden>
          <PhoneIcon className="bw-foot-ic" />
          <BugIcon className="bw-foot-ic" />
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

/* Make bb yours: bb's Plugins page, as the app draws it (BrowsePluginsTab with
   its PluginCollectionToolbar and PluginCatalogCard grid), browsing a snapshot
   of the BB Community catalog sorted by installs. The page scrolls slowly
   down the grid and back, then searches "linear" and "themes", typed one
   character at a time; the grid filters when the search commits, as bb's
   does 200 ms after the last keystroke, and the cards glide to their new
   places (FLIP) while the ones that no longer match fade out. */

/* The Plugins page's lede (PLUGINS_BROWSE_DESCRIPTION in the app). */
const PLUGINS_BROWSE_DESCRIPTION =
  "Discover plugins for bb. Install one, or describe your own and build it from a prompt.";

const DownloadGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Download01Icon} className={className} />
);
const SearchGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Search01Icon} className={className} />
);
const FilterGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SlidersHorizontalIcon} className={className} />
);
const SortGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={SortingNineOneIcon} className={className} />
);
const PlusGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={PlusSignIcon} className={className} />
);
const ClearGlyph = ({ className }: IconProps) => (
  <HugeiconsIcon icon={Cancel01Icon} className={className} />
);

type CatalogFrame = {
  scrolled: boolean;
  scrollMs: number;
  text: string;
  focused: boolean;
  selected: boolean;
  query: CatalogQuery;
};

const CATALOG_REST: CatalogFrame = {
  scrolled: false,
  scrollMs: 0,
  text: "",
  focused: false,
  selected: false,
  query: "",
};

const TYPE_MS = 115;
const SEARCH_COMMIT_MS = 200;
const FLIP_MS = 650;

type CatalogStep = { wait: number; frame: Partial<CatalogFrame> };

function typed(word: string, firstWait: number): CatalogStep[] {
  return [...word].map((_, index) => ({
    wait: index === 0 ? firstWait : TYPE_MS,
    frame: { text: word.slice(0, index + 1), selected: false },
  }));
}

/* Each step waits, then applies its frame. The last step returns to
   CATALOG_REST, so the loop starts over without a cut. */
const CATALOG_STEPS: readonly CatalogStep[] = [
  { wait: 1600, frame: { scrolled: true, scrollMs: 3400 } },
  { wait: 3400 + 900, frame: { scrolled: false, scrollMs: 1100 } },
  { wait: 1100 + 150, frame: { focused: true } },
  ...typed("linear", 350),
  { wait: SEARCH_COMMIT_MS, frame: { query: "linear" } },
  { wait: FLIP_MS + 1900, frame: { selected: true } },
  ...typed("themes", 450),
  { wait: SEARCH_COMMIT_MS, frame: { query: "themes" } },
  { wait: FLIP_MS + 2000, frame: { selected: true } },
  { wait: 350, frame: CATALOG_REST },
];

function useCatalogTimeline(ref: RefObject<Element | null>) {
  const [frame, setFrame] = useState(CATALOG_REST);
  const [inView, setInView] = useState(false);
  const next = useRef(0);
  useEffect(() => {
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
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    const schedule = () => {
      const step = CATALOG_STEPS[next.current]!;
      timer = window.setTimeout(() => {
        setFrame((current) => ({ ...current, ...step.frame }));
        next.current = (next.current + 1) % CATALOG_STEPS.length;
        schedule();
      }, step.wait);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [inView]);
  return { frame, paused: !inView };
}

type CardBox = { x: number; y: number; w: number };

/* FLIP for the catalog grid: every card stays mounted and the grid shows
   the current view's cards in order. After each change, cards that stay
   glide from where they were, cards that leave fade out where they were,
   and cards that arrive fade in once the others have moved. */
function useCatalogFlip(
  grid: RefObject<HTMLDivElement | null>,
  viewKey: string,
) {
  const boxes = useRef(new Map<string, CardBox>());
  const measure = useCallback(() => {
    const node = grid.current;
    if (!node) return new Map<string, CardBox>();
    const measured = new Map<string, CardBox>();
    for (const card of node.querySelectorAll<HTMLElement>("[data-plugin]")) {
      if (card.dataset.shown !== "true") continue;
      measured.set(card.dataset.plugin!, {
        x: card.offsetLeft,
        y: card.offsetTop,
        w: card.offsetWidth,
      });
    }
    return measured;
  }, [grid]);
  useEffect(() => {
    const node = grid.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      boxes.current = measure();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [grid, measure]);
  useLayoutEffect(() => {
    const node = grid.current;
    if (!node) return;
    const before = boxes.current;
    boxes.current = measure();
    if (
      before.size === 0 ||
      typeof node.animate !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const cards = [...node.querySelectorAll<HTMLElement>("[data-plugin]")];
    const moves = cards.some((card) => {
      const was = before.get(card.dataset.plugin!);
      const now = boxes.current.get(card.dataset.plugin!);
      return was && now && (was.x !== now.x || was.y !== now.y);
    });
    for (const card of cards) {
      const id = card.dataset.plugin!;
      const was = before.get(id);
      const now = boxes.current.get(id);
      if (now && was) {
        const dx = was.x - now.x;
        const dy = was.y - now.y;
        if (dx === 0 && dy === 0) continue;
        /* Gliding cards pass over the ones fading in. */
        card.style.zIndex = "1";
        const glide = card.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
          { duration: FLIP_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
        );
        glide.onfinish = () => card.style.removeProperty("z-index");
      } else if (now) {
        /* Arrivals start as the leavers finish fading, or once the gliding
           cards are under way. */
        card.animate(
          [
            { opacity: 0, transform: "scale(0.97)" },
            { opacity: 1, transform: "none" },
          ],
          {
            duration: 300,
            delay: moves ? 300 : 140,
            easing: "ease-out",
            fill: "backwards",
          },
        );
      } else if (was) {
        card.dataset.leaving = "";
        card.style.left = `${was.x}px`;
        card.style.top = `${was.y}px`;
        card.style.width = `${was.w}px`;
        const fade = card.animate(
          [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: "scale(0.97)" },
          ],
          { duration: 220, easing: "ease-in", fill: "forwards" },
        );
        fade.onfinish = () => {
          delete card.dataset.leaving;
          card.style.removeProperty("left");
          card.style.removeProperty("top");
          card.style.removeProperty("width");
          fade.cancel();
        };
      }
    }
  }, [grid, measure, viewKey]);
}

const INSTALLS_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function authorInitials(name: string) {
  return name
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase() ?? "")
    .join("");
}

/* PluginCatalogCard: the icon chip and name, two lines of description, then
   the author and the install control with the install count. */
function CatalogCard({
  plugin,
  order,
}: {
  plugin: CatalogPlugin;
  order: number;
}) {
  const shown = order >= 0;
  return (
    <div
      className="bw-pc"
      data-plugin={plugin.id}
      data-shown={shown}
      style={shown ? { order } : undefined}
    >
      <span className="bw-pc-head">
        <span className="bw-pc-chip">
          {"glyph" in plugin.icon ? (
            <HugeiconsIcon icon={plugin.icon.glyph} className="bw-pc-glyph" />
          ) : (
            <span
              className="bw-pc-glyph bw-pc-mask"
              style={{
                maskImage: `url(${JSON.stringify(plugin.icon.url)})`,
                WebkitMaskImage: `url(${JSON.stringify(plugin.icon.url)})`,
              }}
            />
          )}
        </span>
        <span className="bw-pc-name">{plugin.name}</span>
      </span>
      <span className="bw-pc-desc">{plugin.description}</span>
      <span className="bw-pc-foot">
        <span className="bw-pc-author">
          <span className="bw-pc-avatar">{authorInitials(plugin.author)}</span>
          <span className="bw-pc-author-name">{plugin.author}</span>
        </span>
        <span className="bw-pc-install">
          <DownloadGlyph className="bw-pc-install-ic" />
          {INSTALLS_FORMAT.format(plugin.installs)}
        </span>
      </span>
    </div>
  );
}

/* PluginCollectionToolbar: the search field, then the Category and Sort
   menus, with Sort on Installs. */
function CatalogToolbar({ frame }: { frame: CatalogFrame }) {
  const searchClass = ["bw-pc-search"];
  if (frame.focused) searchClass.push("is-focused");
  return (
    <div className="bw-pc-toolbar">
      <span className={searchClass.join(" ")}>
        <SearchGlyph className="bw-pc-search-ic" />
        {frame.text === "" ? (
          <span className="bw-pc-placeholder">
            {frame.focused ? <i className="bw-pc-caret" /> : null}
            Search plugins...
          </span>
        ) : (
          <span className="bw-pc-text">
            <span className={frame.selected ? "is-selected" : undefined}>
              {frame.text}
            </span>
            {frame.selected ? null : <i className="bw-pc-caret" />}
          </span>
        )}
        {frame.text === "" ? null : <ClearGlyph className="bw-pc-clear" />}
      </span>
      <span className="bw-pc-control">
        <FilterGlyph className="bw-pc-control-ic" />
        <span className="bw-pc-control-label">Category</span>
        <ChevronDown className="bw-pc-control-ic bw-pc-control-chev" />
      </span>
      <span className="bw-pc-control is-on">
        <SortGlyph className="bw-pc-control-ic" />
        <span className="bw-pc-control-label">Installs</span>
      </span>
    </div>
  );
}

export function PluginMap() {
  const ref = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useFitWindow(ref);
  const { frame, paused } = useCatalogTimeline(ref);
  const view: readonly string[] = CATALOG_VIEWS[frame.query];
  useCatalogFlip(grid, frame.query);
  const pageStyle = {
    "--bw-pc-scroll-ms": `${frame.scrollMs}ms`,
  } as CSSProperties;
  return (
    <div
      ref={ref}
      className={`bw bw-plugins${paused ? " fw-paused" : ""}`}
      role="img"
      aria-label={`bb's Plugins page, open from the nav rail: a grid of BB Community plugins sorted by installs, from ${CATALOG_PLUGIN_COUNT} plugins, starting with BB Sidebar, Usage Tracker, File Manager and Generative UI. The page scrolls through the grid, then a search for "linear" narrows it to Taskboard, Linear, Link Hovercards and Subscriptions, and a search for "themes" to Beautiful Chat, Aura, bb Monokai, Fonts, Ayu and Tokyo Night.`}
    >
      <div className="mock bw-window">
        <WindowBar title="Plugins" />
        <div className="mock-body bw-body">
          <Sidebar nav="plugins">
            <div className="side-label">Threads</div>
            <ThreadRow title="Signups by plan" status="done" />
            <ThreadRow title="Fix the checkout bug" status="done" />
            <ThreadRow title="Bump the SDK" status="done" />
            <ThreadRow title="Refactor auth" status="waiting" />
          </Sidebar>
          <div className="main bw-pc-main" aria-hidden>
            <div
              className={`bw-pc-page${frame.scrolled ? " is-scrolled" : ""}`}
              style={pageStyle}
            >
              <div className="bw-pc-header">
                <span className="bw-pc-title">Browse plugins</span>
                <span className="bw-pc-total">
                  {CATALOG_PLUGIN_COUNT} plugins
                </span>
                <span className="bw-pc-create">
                  <PlusGlyph className="bw-pc-control-ic" />
                  Create
                </span>
              </div>
              <p className="bw-pc-lede">{PLUGINS_BROWSE_DESCRIPTION}</p>
              <CatalogToolbar frame={frame} />
              <div ref={grid} className="bw-pc-grid">
                {CATALOG_PLUGINS.map((plugin) => (
                  <CatalogCard
                    key={plugin.id}
                    plugin={plugin}
                    order={view.indexOf(plugin.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type MorphScene = "stock" | "files" | "graph" | "taskboard" | "shelves";

const MORPH_SCENES: readonly MorphScene[] = [
  "stock",
  "files",
  "graph",
  "taskboard",
  "shelves",
];
const MORPH_STATIC_SCENE = MORPH_SCENES.indexOf("graph");
const MORPH_FIRST_HOLD_MS = 1500;
const MORPH_HOLD_MS = 2600;
const MORPH_CHANGE_MS = 1100;

type MorphCenter = "thread" | "files" | "taskboard";
type MorphSide = "threads" | "shelves" | null;

const MORPH_CENTER: Record<MorphScene, MorphCenter> = {
  stock: "thread",
  files: "files",
  graph: "thread",
  taskboard: "taskboard",
  shelves: "thread",
};

const MORPH_SIDE: Record<MorphScene, MorphSide> = {
  stock: "threads",
  files: null,
  graph: null,
  taskboard: null,
  shelves: "shelves",
};

const MORPH_THREAD = "Fix the checkout bug";

const MORPH_TITLES: Record<MorphCenter, string> = {
  thread: MORPH_THREAD,
  files: "Files",
  taskboard: "Taskboard",
};

type MorphState = { scene: number; previous: number | null };

function useMorphTimeline(ref: RefObject<Element | null>) {
  const [state, setState] = useState<MorphState>({
    scene: 0,
    previous: null,
  });
  const [inView, setInView] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
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
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  const active = inView && !hidden;
  useEffect(() => {
    if (!active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState({ scene: MORPH_STATIC_SCENE, previous: null });
      return;
    }
    let timer = 0;
    let first = true;
    const hold = () => {
      const wait = first ? MORPH_FIRST_HOLD_MS : MORPH_HOLD_MS;
      first = false;
      timer = window.setTimeout(() => {
        setState((current) => ({
          scene: (current.scene + 1) % MORPH_SCENES.length,
          previous: current.scene,
        }));
        timer = window.setTimeout(() => {
          setState((current) => ({ ...current, previous: null }));
          hold();
        }, MORPH_CHANGE_MS);
      }, wait);
    };
    hold();
    return () => window.clearTimeout(timer);
  }, [active]);
  return {
    scene: MORPH_SCENES[state.scene]!,
    previous: state.previous === null ? null : MORPH_SCENES[state.previous]!,
    paused: !active,
  };
}

function morphLayer<T extends string>(
  base: string,
  key: T,
  current: T | null,
  previous: T | null,
  changing: boolean,
) {
  if (key === current) {
    return changing && previous !== key
      ? `${base} mx-layer is-on is-entering`
      : `${base} mx-layer is-on`;
  }
  if (changing && key === previous) return `${base} mx-layer is-under`;
  return `${base} mx-layer`;
}

function PluginMark({ id, className }: { id: string; className: string }) {
  const plugin = CATALOG_PLUGINS.find((entry) => entry.id === id)!;
  if ("glyph" in plugin.icon) {
    return <HugeiconsIcon icon={plugin.icon.glyph} className={className} />;
  }
  const mask = `url(${JSON.stringify(plugin.icon.url)})`;
  return (
    <span
      className={`${className} bw-pc-mask`}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    />
  );
}

function MorphThreads() {
  return (
    <>
      <div className="side-act">
        <NewThreadIcon className="sa-ic" />
        New thread
      </div>
      <div className="side-label">Threads</div>
      <ThreadRow title={MORPH_THREAD} status="done" active />
      <ThreadRow title="Signups by plan" status="done" />
      <ThreadRow title="Bump the SDK" status="done" />
      <ThreadRow title="Refactor auth" status="waiting" />
      <ThreadRow title="Weekly changelog" status="done" />
      <div className="side-foot bw-side-foot" aria-hidden>
        <PhoneIcon className="bw-foot-ic" />
        <BugIcon className="bw-foot-ic" />
      </div>
    </>
  );
}

function ShelfCard({
  project,
  age,
  title,
  branch,
  active = false,
}: {
  project: string;
  age: string;
  title: string;
  branch: string;
  active?: boolean;
}) {
  return (
    <div className={active ? "mx-sh-card is-active" : "mx-sh-card"}>
      <span className="mx-sh-proj">
        {project}
        <span className="mx-sh-age">{age}</span>
      </span>
      <span className="mx-sh-title">{title}</span>
      <span className="mx-sh-branch">
        <GitBranchIcon className="mx-sh-branch-ic" />
        {branch}
      </span>
    </div>
  );
}

function MorphShelves() {
  return (
    <>
      <div className="side-act">
        <NewThreadIcon className="sa-ic" />
        New thread
      </div>
      <div className="mx-sh-scope">
        All projects
        <ChevronDown className="mx-sh-chev" />
      </div>
      <div className="mx-sh-shelf">
        Active
        <i />
      </div>
      <ShelfCard
        project="checkout-web"
        age="now"
        title={MORPH_THREAD}
        branch="fix/checkout-timeout"
        active
      />
      <div className="mx-sh-kids">
        <div className="mx-sh-kid">
          <i className="mx-dot is-ok" />
          <span className="mx-sh-kid-title">Plan the fix</span>
          <span className="mx-sh-badge is-run">Running</span>
        </div>
        <div className="mx-sh-kid">
          <i className="mx-dot is-red" />
          <span className="mx-sh-kid-title">Review the diff</span>
          <span className="mx-sh-badge is-ask">Needs you</span>
        </div>
      </div>
      <ShelfCard
        project="billing-api"
        age="59m"
        title="Retry failed webhooks"
        branch="fix/webhook-retry"
      />
      {["Inactive (2)", "Snoozed (3)", "Settled (23)"].map((shelf) => (
        <div key={shelf} className="mx-sh-shelf is-closed">
          {shelf}
          <i />
          <ChevronDown className="mx-sh-chev" />
        </div>
      ))}
      <div className="side-foot bw-side-foot" aria-hidden>
        <PhoneIcon className="bw-foot-ic" />
        <BugIcon className="bw-foot-ic" />
      </div>
    </>
  );
}

function MorphThread() {
  return (
    <>
      <div className="feed bw-feed mx-feed">
        <div className="msg-user">
          Checkout times out on slow networks. Find the cause and fix it.
        </div>
        <div className="msg-step">
          <ChevronRight className="step-chev" />
          Explored 4 files, ran 2 commands
        </div>
        <div className="msg-say">
          Found it: the payment request gives up after 5 seconds. I raised the
          timeout to 30 seconds, added one retry, and the checkout tests pass.
        </div>
      </div>
      <ComposerBox
        placeholder="Ask for a follow-up"
        model="Opus 5.5"
        modelIcon={ClaudeIcon}
      />
    </>
  );
}

type WorkState = "todo" | "progress" | "review" | "done";

function WorkGlyph({ state }: { state: WorkState }) {
  return (
    <svg className={`mx-state is-${state}`} viewBox="0 0 16 16" aria-hidden>
      {state === "progress" ? (
        <>
          <circle cx="8" cy="8" r="5.25" opacity="0.35" />
          <path d="M8 2.75a5.25 5.25 0 0 1 0 10.5" strokeWidth="2" />
        </>
      ) : state === "review" ? (
        <>
          <circle cx="8" cy="8" r="5.25" opacity="0.35" />
          <path d="M8 2.75a5.25 5.25 0 1 1-5.25 5.25" strokeWidth="2" />
        </>
      ) : state === "done" ? (
        <>
          <circle cx="8" cy="8" r="5.25" />
          <path d="m5.35 8.05 1.7 1.75 3.65-3.7" />
        </>
      ) : (
        <circle cx="8" cy="8" r="5.25" />
      )}
    </svg>
  );
}

type BoardCard = {
  key: string;
  title: string;
  labels: readonly string[];
  updated: string;
  who: string;
};

const BOARD_LANES: readonly {
  name: string;
  state: WorkState;
  cards: readonly BoardCard[];
}[] = [
  {
    name: "Todo",
    state: "todo",
    cards: [
      {
        key: "BB-231",
        title: "Add Apple Pay to checkout",
        labels: ["checkout", "feature"],
        updated: "Nov 2",
        who: "MC",
      },
      {
        key: "BB-229",
        title: "Show order history on the account page",
        labels: ["account"],
        updated: "Oct 31",
        who: "YA",
      },
    ],
  },
  {
    name: "In Progress",
    state: "progress",
    cards: [
      {
        key: "BB-224",
        title: "Checkout times out on slow networks",
        labels: ["bug", "checkout"],
        updated: "Nov 3",
        who: "BB",
      },
      {
        key: "BB-226",
        title: "Cache plan prices",
        labels: ["billing"],
        updated: "Nov 1",
        who: "SH",
      },
    ],
  },
  {
    name: "In Review",
    state: "review",
    cards: [
      {
        key: "BB-219",
        title: "Retry failed webhooks",
        labels: ["billing"],
        updated: "Nov 2",
        who: "VB",
      },
    ],
  },
  {
    name: "Done",
    state: "done",
    cards: [
      {
        key: "BB-214",
        title: "Bump the SDK",
        labels: ["chore"],
        updated: "Oct 30",
        who: "BB",
      },
    ],
  },
];

function MorphTaskboard() {
  return (
    <div className="mx-tb">
      <div className="mx-tb-bar">
        <span className="mx-seg">
          <span>List</span>
          <span className="is-on">Kanban</span>
        </span>
      </div>
      <div className="mx-tb-lanes">
        {BOARD_LANES.map((lane) => (
          <section key={lane.name} className="mx-tb-lane">
            <div className="mx-tb-head">
              <WorkGlyph state={lane.state} />
              <span className="mx-tb-name">{lane.name}</span>
              <span className="mx-tb-count">{lane.cards.length}</span>
            </div>
            {lane.cards.map((card) => (
              <div key={card.key} className="mx-tb-card">
                <span className="mx-tb-key">{card.key}</span>
                <span className="mx-tb-title">
                  <WorkGlyph state={lane.state} />
                  {card.title}
                </span>
                <span className="mx-tb-labels">
                  {card.labels.map((label) => (
                    <span key={label} className="mx-tb-label">
                      {label}
                    </span>
                  ))}
                </span>
                <span className="mx-tb-meta">
                  Updated {card.updated}
                  <span className="mx-avatar">{card.who}</span>
                </span>
                {lane.state === "done" ? null : (
                  <span className="mx-tb-start">
                    <HugeiconsIcon
                      icon={AiContentGenerator01Icon}
                      className="mx-tb-start-ic"
                    />
                    Start task
                  </span>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

type FileKind = "folder" | "ts" | "md" | "json" | "plain";

const FILE_TREE: readonly {
  name: string;
  kind: FileKind;
  depth: number;
  open?: boolean;
  active?: boolean;
}[] = [
  { name: ".github", kind: "folder", depth: 0 },
  { name: "src", kind: "folder", depth: 0, open: true },
  { name: "components", kind: "folder", depth: 1 },
  { name: "pay", kind: "folder", depth: 1, open: true },
  { name: "client.ts", kind: "ts", depth: 2 },
  { name: "retry.ts", kind: "ts", depth: 2 },
  { name: "app.tsx", kind: "ts", depth: 1 },
  { name: "tests", kind: "folder", depth: 0 },
  { name: ".gitignore", kind: "plain", depth: 0 },
  { name: "CONTRIBUTING.md", kind: "md", depth: 0 },
  { name: "package.json", kind: "json", depth: 0 },
  { name: "README.md", kind: "md", depth: 0, active: true },
];

const FILE_TABS = ["client.ts", "README.md", "CONTRIBUTING.md"] as const;

function MorphFiles() {
  return (
    <div className="mx-fe">
      <div className="mx-fe-tree">
        <span className="mx-fe-pick">
          <HugeiconsIcon icon={Folder01Icon} className="mx-fe-ic" />
          <span className="mx-fe-pick-text">checkout-web</span>
          <ChevronDown className="mx-fe-chev" />
        </span>
        <span className="mx-fe-pick">
          <GitBranchIcon className="mx-fe-ic" />
          <span className="mx-fe-pick-text">fix/checkout-timeout</span>
          <ChevronDown className="mx-fe-chev" />
        </span>
        <span className="mx-fe-pick mx-fe-search">
          <SearchIcon className="mx-fe-ic" />
          Search in files
        </span>
        <div className="mx-fe-rows">
          {FILE_TREE.map((row) => (
            <span
              key={`${row.depth}-${row.name}`}
              className={row.active ? "mx-fe-row is-active" : "mx-fe-row"}
              style={{ paddingLeft: 6 + row.depth * 14 }}
            >
              {row.kind === "folder" ? (
                <>
                  {row.open ? (
                    <ChevronDown className="mx-fe-twist" />
                  ) : (
                    <ChevronRight className="mx-fe-twist" />
                  )}
                  <HugeiconsIcon icon={Folder01Icon} className="mx-fe-ic" />
                </>
              ) : (
                <FileReadIcon
                  className={`mx-fe-ic mx-fe-file is-${row.kind}`}
                />
              )}
              {row.name}
            </span>
          ))}
        </div>
        <span className="mx-fe-foot">
          1,284 files · excluding .git, node_modules
        </span>
      </div>
      <div className="mx-fe-editor">
        <div className="mx-fe-tabs">
          {FILE_TABS.map((tab) => (
            <span
              key={tab}
              className={tab === "README.md" ? "mx-fe-tab is-on" : "mx-fe-tab"}
            >
              <FileReadIcon
                className={`mx-fe-ic mx-fe-file is-${tab.endsWith(".md") ? "md" : "ts"}`}
              />
              {tab}
              <ClearGlyph className="mx-fe-x" />
            </span>
          ))}
        </div>
        <div className="mx-fe-crumbs">
          <span className="mx-fe-path">
            checkout-web
            <ChevronRight className="mx-fe-sep" />
            <span className="mx-fe-here">README.md</span>
          </span>
          <span className="mx-fe-meta">Markdown · 42 lines</span>
          <span className="mx-seg">
            <span className="is-on">Preview</span>
            <span>Read</span>
            <span>Edit</span>
          </span>
        </div>
        <div className="mx-fe-doc">
          <span className="mx-fe-h1">checkout-web</span>
          <span className="mx-fe-p">
            The storefront checkout. Payment calls live in <code>src/pay</code>;
            the UI is in <code>src/components</code>.
          </span>
          <span className="mx-fe-h2">Getting started</span>
          <span className="mx-fe-pre">
            <span>
              <em>npm</em> install
            </span>
            <span>
              <em>npm</em> run dev
            </span>
          </span>
          <span className="mx-fe-h2">Timeouts</span>
          <span className="mx-fe-p">
            Payment requests wait 30 seconds and retry once before checkout
            shows an error.
          </span>
        </div>
      </div>
    </div>
  );
}

type GraphKind = "thread" | "turn" | "subagent" | "bash" | "read";

const GRAPH_ICONS: Record<GraphKind, IconSvgElement> = {
  thread: BubbleChatAddIcon,
  turn: ZapIcon,
  subagent: RoboticIcon,
  bash: ComputerTerminal01Icon,
  read: Search01Icon,
};

const GRAPH_NODES: readonly {
  kind: GraphKind;
  title: string;
  detail: string;
  x: number;
  y: number;
  running?: boolean;
}[] = [
  { kind: "thread", title: MORPH_THREAD, detail: "2 turns", x: 8, y: 196 },
  {
    kind: "turn",
    title: "Checkout times out on slow networks",
    detail: "12 steps",
    x: 120,
    y: 110,
  },
  {
    kind: "turn",
    title: "Ship it with a retry",
    detail: "5 steps",
    x: 120,
    y: 282,
    running: true,
  },
  {
    kind: "subagent",
    title: "Review the diff",
    detail: "Subagent · 8 steps",
    x: 258,
    y: 170,
  },
  {
    kind: "read",
    title: "client.ts",
    detail: "src/pay/client.ts",
    x: 258,
    y: 230,
  },
  {
    kind: "bash",
    title: "Bash",
    detail: "pnpm test checkout",
    x: 258,
    y: 290,
    running: true,
  },
  {
    kind: "bash",
    title: "Bash",
    detail: "git push",
    x: 258,
    y: 350,
  },
];

const GRAPH_EDGES: readonly [number, number][] = [
  [0, 1],
  [0, 2],
  [2, 3],
  [2, 4],
  [2, 5],
  [2, 6],
];

const GRAPH_NODE_H = 44;

function graphNodeWidth(x: number) {
  if (x < 100) return 100;
  if (x < 250) return 124;
  return 134;
}

function MorphAgentGraph() {
  return (
    <div className="mx-ag">
      <div className="mx-ag-tabs">
        <span className="mx-ag-tab">
          <PluginMark id="agent-graph" className="mx-ag-tab-ic" />
          Agent graph
        </span>
        <PlusGlyph className="mx-ag-plus" />
      </div>
      <div className="mx-ag-canvas">
        <div className="mx-ag-tools">
          <span className="mx-seg">
            <span className="is-on">This thread</span>
            <span>All threads</span>
          </span>
          <span className="mx-seg">
            <span>Active only</span>
            <span>Color: Type</span>
          </span>
        </div>
        <svg className="mx-ag-edges" viewBox="0 0 400 420" aria-hidden>
          {GRAPH_EDGES.map(([from, to]) => {
            const a = GRAPH_NODES[from]!;
            const b = GRAPH_NODES[to]!;
            const x1 = a.x + graphNodeWidth(a.x);
            const y1 = a.y + GRAPH_NODE_H / 2;
            const y2 = b.y + GRAPH_NODE_H / 2;
            const mid = (x1 + b.x) / 2;
            return (
              <path
                key={`${from}-${to}`}
                d={`M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${b.x} ${y2}`}
              />
            );
          })}
        </svg>
        {GRAPH_NODES.map((node, index) => (
          <div
            key={index}
            className={`mx-ag-node is-${node.kind}`}
            style={{
              left: node.x,
              top: node.y,
              width: graphNodeWidth(node.x),
            }}
          >
            <span className="mx-ag-chip">
              <HugeiconsIcon
                icon={GRAPH_ICONS[node.kind]}
                className="mx-ag-ic"
              />
            </span>
            <span className="mx-ag-text">
              <span className="mx-ag-title">{node.title}</span>
              <span className="mx-ag-detail">{node.detail}</span>
            </span>
            <i className={node.running ? "mx-dot is-run" : "mx-dot is-ok"} />
          </div>
        ))}
        <div className="mx-ag-foot">
          <span className="mx-ag-pill">
            <i className="mx-dot is-run" />
            Running 1
          </span>
          <span className="mx-ag-pill">
            <span>−</span>
            84%
            <span>+</span>
            Fit
          </span>
        </div>
      </div>
    </div>
  );
}

export function PluginMorph() {
  const ref = useRef<HTMLDivElement>(null);
  useFitWindow(ref);
  const { scene, previous, paused } = useMorphTimeline(ref);
  const changing = previous !== null;
  const center = MORPH_CENTER[scene];
  const side = MORPH_SIDE[scene];
  const before = previous === null ? null : MORPH_CENTER[previous];
  const sideBefore = previous === null ? null : MORPH_SIDE[previous];
  const titles = [...new Set(Object.values(MORPH_TITLES))];
  return (
    <div
      ref={ref}
      className={`bw bw-morph mx-${scene}${side === null ? " mx-collapsed" : ""}${paused ? " fw-paused" : ""}`}
      data-scene={scene}
      role="img"
      aria-label="One bb window that keeps rearranging itself as plugins and themes change it. It starts as a plain thread with the thread list in bb's default theme. The thread list folds away to the icon rail and the Files plugin opens its own file tree and a README preview in Tokyo Night. Then the window splits: the thread on the left and the Agent Graph plugin's node graph on the right, in bb Monokai. The split closes into the Taskboard plugin's full-width kanban board in Ayu Light. Then the sidebar comes back wider as BB Sidebar, with project shelves and child threads, in Ayu Mirage, before it starts over."
    >
      <div className="mock bw-window mx-window">
        <WindowBar
          panelOpen={scene === "graph"}
          title={
            <span className="mx-titles">
              {titles.map((title) => (
                <span
                  key={title}
                  className={
                    title === MORPH_TITLES[center]
                      ? "mx-title is-on"
                      : "mx-title"
                  }
                >
                  {title}
                </span>
              ))}
            </span>
          }
        />
        <div className="mock-body bw-body mx-body" aria-hidden>
          <NavRail active={center === "thread" ? "home" : null}>
            {(["files-editor", "taskboard"] as const).map((id) => (
              <span
                key={id}
                className={
                  center === (id === "files-editor" ? "files" : id)
                    ? "bw-rail-btn mx-rail-plugin is-on"
                    : "bw-rail-btn mx-rail-plugin"
                }
              >
                <PluginMark id={id} className="bw-rail-ic" />
              </span>
            ))}
          </NavRail>
          <div className="mx-side-slot">
            <aside
              className={morphLayer(
                "side mx-side-threads",
                "threads",
                side,
                sideBefore,
                changing,
              )}
            >
              <MorphThreads />
            </aside>
            <aside
              className={morphLayer(
                "side mx-side-shelves",
                "shelves",
                side,
                sideBefore,
                changing,
              )}
            >
              <MorphShelves />
            </aside>
          </div>
          <div className="mx-center">
            <div
              className={morphLayer("main", "thread", center, before, changing)}
            >
              <MorphThread />
            </div>
            <div
              className={morphLayer("main", "files", center, before, changing)}
            >
              <MorphFiles />
            </div>
            <div
              className={morphLayer(
                "main",
                "taskboard",
                center,
                before,
                changing,
              )}
            >
              <MorphTaskboard />
            </div>
          </div>
          <div className="mx-panel-slot">
            <div className="mx-panel">
              <MorphAgentGraph />
            </div>
          </div>
        </div>
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

const DiffTabIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={PlusMinusSquare01Icon} className={className} />
);
const InfoTabIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={InformationCircleIcon} className={className} />
);
const FullScreenIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={ExpandIcon} className={className} />
);
const DiffFilterIcon = ({ className }: IconProps) => (
  <HugeiconsIcon icon={FilterIcon} className={className} />
);

type DiffLine = { n: number; kind: "ctx" | "add" | "del"; text: string };

const START_PANEL_AT = 4.4;

const START_DIFF: readonly DiffLine[] = [
  { n: 9, kind: "ctx", text: 'const PAY_URL = "/api/pay";' },
  { n: 10, kind: "add", text: "const TIMEOUT_MS = 10_000;" },
  { n: 11, kind: "ctx", text: "" },
  { n: 12, kind: "ctx", text: "export function pay(order: Order) {" },
  { n: 13, kind: "del", text: "  return post(PAY_URL, order);" },
  { n: 13, kind: "add", text: "  return retry(1, () =>" },
  { n: 14, kind: "add", text: "    post(PAY_URL, order, {" },
  {
    n: 15,
    kind: "add",
    text: "      signal: AbortSignal.timeout(TIMEOUT_MS),",
  },
  { n: 16, kind: "add", text: "    })," },
  { n: 17, kind: "add", text: "  );" },
  { n: 18, kind: "ctx", text: "}" },
];

function DiffTally({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="bw-sp-tally">
      <span className="bw-sp-plus">+{added}</span>
      {removed > 0 ? <span className="bw-sp-minus">−{removed}</span> : null}
    </span>
  );
}

function DiffFileHeader({
  path,
  added,
  removed,
  open,
}: {
  path: string;
  added: number;
  removed: number;
  open: boolean;
}) {
  return (
    <div className="bw-sp-file-head">
      <ChevronRight className={open ? "bw-sp-chev is-open" : "bw-sp-chev"} />
      <span className="bw-sp-path">{path}</span>
      <DiffTally added={added} removed={removed} />
      <span className="bw-sp-viewed">
        <i />
        Viewed
      </span>
    </div>
  );
}

function DiffToolbar({
  selection,
  summary,
}: {
  selection: string;
  summary: ReactNode;
}) {
  return (
    <div className="bw-sp-toolbar">
      <span className="bw-sp-select">
        {selection}
        <ChevronDown className="bw-sp-select-chev" />
      </span>
      <span className="bw-sp-summary">{summary}</span>
      <SearchGlyph className="bw-sp-ic bw-sp-tool" />
      <DiffFilterIcon className="bw-sp-ic bw-sp-tool" />
    </div>
  );
}

function StartDiffPanel() {
  return (
    <div className="bw-sp-slot" aria-hidden>
      <div className="bw-sp">
        <div className="bw-sp-chrome">
          <span className="bw-sp-tab">
            <InfoTabIcon className="bw-sp-ic" />
          </span>
          <span className="bw-sp-tab is-on">
            <DiffTabIcon className="bw-sp-ic" />
          </span>
          <PlusGlyph className="bw-sp-ic bw-sp-new" />
          <FullScreenIcon className="bw-sp-ic bw-sp-full" />
        </div>
        <div className="bw-sp-views">
          <div className="bw-sp-view">
            <DiffToolbar selection="All changes" summary="No changes" />
            <div className="bw-sp-empty">No diff to display.</div>
          </div>
          <div className="bw-sp-view is-changes" style={at(START_PANEL_AT)}>
            <DiffToolbar
              selection="Uncommitted changes"
              summary={
                <>
                  2 files, <DiffTally added={24} removed={1} />
                </>
              }
            />
            <div className="bw-sp-files">
              <div className="bw-sp-card">
                <DiffFileHeader
                  path="src/checkout/pay.ts"
                  added={6}
                  removed={1}
                  open
                />
                <div className="bw-sp-diff">
                  {START_DIFF.map((line, index) => (
                    <div key={index} className={`bw-sp-line is-${line.kind}`}>
                      <span className="bw-sp-num">{line.n}</span>
                      <span className="bw-sp-code">{line.text}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bw-sp-card">
                <DiffFileHeader
                  path="src/checkout/pay.test.ts"
                  added={18}
                  removed={0}
                  open={false}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
      aria-label="The thread Fix the checkout bug plays step by step in the bb desktop app and, at the same time, in the bb mobile app on an iPhone: you ask bb to fix the checkout bug, it explores the code, reads src/checkout/pay.ts, explains that the payment call has no timeout, edits two files and runs the checkout tests. On the desktop, the Diff panel beside the thread starts with no changes, then shows the change: a 10 second timeout with one retry in src/checkout/pay.ts, plus a new test file."
    >
      <div
        className={stageClass("bw-start-stage", leaving, paused)}
        key={cycle}
      >
        <div className="mock bw-window">
          <WindowBar title="Fix the checkout bug" panelOpen />
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
              <ComposerBox
                placeholder="Ask for a follow-up"
                model="Codex"
                modelIcon={OpenAiIcon}
              />
            </div>
            <StartDiffPanel />
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
