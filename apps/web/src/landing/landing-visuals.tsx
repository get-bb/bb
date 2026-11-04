import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import AiContentGenerator01Icon from "@hugeicons/core-free-icons/AiContentGenerator01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import RoboticIcon from "@hugeicons/core-free-icons/RoboticIcon";
import WorkflowCircle03Icon from "@hugeicons/core-free-icons/WorkflowCircle03Icon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { useExperiment } from "../experiments/use-experiment";
import FilesEditorIcon from "../assets/plugin-icons/files-editor.svg";
import TaskboardIcon from "../assets/plugin-icons/taskboard.svg";
import {
  BugIcon,
  ChevronDown,
  ChevronRight,
  ClockIcon,
  CloseIcon as ClearGlyph,
  CommandIcon,
  ComposerBox,
  EditFileIcon,
  FileReadIcon,
  Ellipsis as MoreIcon,
  GitBranchIcon,
  LaptopGlyph,
  Maximize2,
  MicIcon,
  MockBar,
  type IconProps,
  type NavLabel,
  type ThreadState,
  NavRail,
  NewThreadIcon,
  PanelIcon,
  PanelRightIcon,
  Paperclip,
  PhoneIcon,
  PlusIcon as PlusGlyph,
  SearchIcon,
  SendIcon,
  Spinner,
  StatusGlyph,
  SubagentIcon,
  TerminalIcon,
  useFitMock,
} from "./app-mock-parts";
import { trackLandingEvent } from "./analytics";
import { CommandButton } from "./command-button";
import { DownloadLink, GitHubLink } from "./cta";
import { useDesktopPlatform } from "./desktop-platform";
import { DesktopInstallChoice } from "./install-choice";
import {
  ClaudeIcon,
  CopilotIcon,
  CursorIcon,
  GeminiIcon,
  GrokIcon,
  HermesAgentIcon,
  LinuxIcon,
  OmpIcon,
  OpenAiIcon,
  OpencodeIcon,
  PiIcon,
} from "./icons";
import type { CtaPlacement, DesktopPlatform } from "./site";
import { CLI_COMMAND, DESKTOP_DOWNLOADS, DOWNLOAD_PAGE_PATH } from "./site";
import { useActiveWhileVisible, usePageHidden } from "./visibility";

export function InstallOptions({ placement }: { placement: CtaPlacement }) {
  const simple = useExperiment("homepage-download-path") === "test";
  const platform = useDesktopPlatform();
  const download = DESKTOP_DOWNLOADS[platform];
  const otherPlatform: DesktopPlatform =
    platform === "macos" ? "linux" : "macos";
  const simpleLinks = (
    <>
      <OpenSourceLink placement={placement} />
      {" · "}
      <a className="install-note-link" href={DOWNLOAD_PAGE_PATH}>
        Other platforms
      </a>
    </>
  );
  return (
    <div className="install-options">
      <div className="install-actions">
        <DesktopInstallChoice
          placement={placement}
          platform={platform}
          note={
            simple ? (
              <>
                {download.shortNote ? `${download.shortNote} · ` : null}
                {simpleLinks}
              </>
            ) : (
              <>
                {download.note}
                {" · "}
                <DownloadLink
                  placement={placement}
                  platform={otherPlatform}
                  className="install-note-link"
                >
                  Also for {DESKTOP_DOWNLOADS[otherPlatform].label}
                </DownloadLink>
              </>
            )
          }
          touchNote={simple ? simpleLinks : undefined}
        />
        {simple ? null : (
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
        )}
      </div>
    </div>
  );
}

function OpenSourceLink({ placement }: { placement: CtaPlacement }) {
  return (
    <GitHubLink placement={placement} className="install-note-link oss-link">
      <HugeiconsIcon icon={GithubIcon} className="oss-ic" aria-hidden />
      Open source
    </GitHubLink>
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

declare const __ACP_AGENT_IDS__: string[] | null | undefined;

const AGENT_ROW = [
  { Icon: ClaudeIcon, registry: ["claude-acp"] },
  { Icon: OpenAiIcon, registry: ["codex-acp"] },
  { Icon: GeminiIcon, registry: ["gemini"] },
  { Icon: CursorIcon, registry: ["cursor"] },
  { Icon: CopilotIcon, registry: ["github-copilot-cli"] },
  { Icon: PiIcon, registry: ["pi-acp"] },
  { Icon: OpencodeIcon, registry: ["opencode", "opencode-v2"] },
  { Icon: GrokIcon, registry: ["grok-build"] },
  { Icon: OmpIcon, registry: [] },
  { Icon: HermesAgentIcon, registry: [] },
] as const;

export function moreRegistryAgents(
  ids: readonly string[] | null | undefined,
): number | null {
  if (!ids) return null;
  const shown = new Set<string>(AGENT_ROW.flatMap((agent) => agent.registry));
  return ids.filter((id) => !shown.has(id)).length;
}

export function AgentRow({
  registryIds = typeof __ACP_AGENT_IDS__ === "undefined"
    ? null
    : __ACP_AGENT_IDS__,
}: {
  registryIds?: readonly string[] | null;
}) {
  const more = moreRegistryAgents(registryIds);
  const mobileMore =
    AGENT_ROW.length - PROVIDER_ICONS_MOBILE_VISIBLE + (more ?? 0);
  return (
    <div className="providers agent-row">
      <span className="label">Bring your own subscription</span>
      {AGENT_ROW.map(({ Icon }, i) => (
        <Icon
          key={i}
          className={
            i >= PROVIDER_ICONS_MOBILE_VISIBLE ? "plogo plogo-more" : "plogo"
          }
        />
      ))}
      {more ? (
        <span className="agent-more" aria-label={`${more} more agents`}>
          +{more} more
        </span>
      ) : null}
      <span className="pmore" aria-label={`${mobileMore} more agents`}>
        +{mobileMore} more
      </span>
    </div>
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

export function useCycle(holdMs: number, fadeMs: number, active?: boolean) {
  const [cycle, setCycle] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const hidden = usePageHidden();
  const gated = active !== undefined;
  const running = (active ?? true) && !hidden;
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    if (!running) return;
    if (gated) {
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
  }, [holdMs, fadeMs, running, gated]);
  return { cycle, leaving, paused: !running };
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

const BbGlyph = ({ className }: IconProps) => (
  <span aria-hidden className={`bb-mark ${className ?? ""}`} />
);

type StatusStep = { status: ThreadState; at: number };

function RowStatus({
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

function useMockWindow() {
  const fitRef = useRef<HTMLDivElement | null>(null);
  useFitMock(fitRef, { shrinkOnly: true });
  const { ref: watch, active } = useActiveWhileVisible<HTMLDivElement>();
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      fitRef.current = el;
      watch(el);
    },
    [watch],
  );
  return { ref, active };
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
    <MockBar>
      <span className="bar-title">{title}</span>
      <MoreIcon className="bar-kebab" />
      <span className="bar-actions" aria-hidden>
        <span className={panelOpen ? "bar-toggle active" : "bar-toggle"}>
          <PanelRightIcon className="ri" />
        </span>
      </span>
    </MockBar>
  );
}

function Sidebar({
  rail,
  nav,
  children,
}: {
  rail?: ReactNode;
  nav?: NavLabel;
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
      {status ? <RowStatus status={status} then={then} /> : null}
    </div>
  );
}

function WindowComposer({
  placeholder,
  model,
  modelIcon,
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
      <ComposerBox model={model} modelIcon={modelIcon}>
        <span className="composer-input bw-placeholder">{placeholder}</span>
        <Maximize2 className="cb-expand" />
      </ComposerBox>
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

function useMorphTimeline(active: boolean) {
  const [state, setState] = useState<MorphState>({
    scene: 0,
    previous: null,
  });
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

const PLUGIN_MARKS = {
  "agent-graph": { glyph: WorkflowCircle03Icon },
  "files-editor": { url: FilesEditorIcon },
  taskboard: { url: TaskboardIcon },
} as const;

function PluginMark({
  id,
  className,
}: {
  id: keyof typeof PLUGIN_MARKS;
  className: string;
}) {
  const icon: { glyph: IconSvgElement } | { url: string } = PLUGIN_MARKS[id];
  if ("glyph" in icon) {
    return <HugeiconsIcon icon={icon.glyph} className={className} />;
  }
  const mask = `url(${JSON.stringify(icon.url)})`;
  return (
    <span
      className={`${className} mx-plugin-mask`}
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
      <ThreadRow title={MORPH_THREAD} status="running" active />
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
          <span className="mx-sh-badge is-ok">Done</span>
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
          Found it: the payment call gives up after 5 seconds. I raised it to
          30s with one idempotent retry, and the checkout tests pass.
        </div>
        <div className="msg-user">Open a PR for it</div>
        <div className="msg-step">
          <ChevronRight className="step-chev" />
          Ran 2 commands
        </div>
      </div>
      <WindowComposer
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
        key: "CHK-46",
        title: "Add Apple Pay to checkout",
        labels: ["checkout", "feature"],
        updated: "Nov 2",
        who: "MC",
      },
      {
        key: "CHK-44",
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
        key: "CHK-41",
        title: "Checkout times out on slow networks",
        labels: ["bug", "checkout"],
        updated: "Nov 3",
        who: "BB",
      },
      {
        key: "CHK-43",
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
        key: "CHK-38",
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
        key: "CHK-35",
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
    title: "Open a PR for it",
    detail: "5 steps",
    x: 120,
    y: 282,
    running: true,
  },
  {
    kind: "subagent",
    title: "Trace the timeout",
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
  },
  {
    kind: "bash",
    title: "Bash",
    detail: "git push",
    x: 258,
    y: 350,
    running: true,
  },
];

const GRAPH_EDGES: readonly [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [1, 4],
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
            Running 2
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
  const { ref, active } = useMockWindow();
  const { scene, previous, paused } = useMorphTimeline(active);
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
          <NavRail active={center === "thread" ? "Home" : null}>
            {(["files-editor", "taskboard"] as const).map((id) => (
              <span
                key={id}
                className={
                  center === (id === "files-editor" ? "files" : id)
                    ? "rail-btn mx-rail-plugin is-on"
                    : "rail-btn mx-rail-plugin"
                }
              >
                <PluginMark id={id} className="rail-ic" />
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
    then: [{ status: "done", at: 10.4 }],
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

const DELEGATION_PING = "PR #482 is ready for you to merge";

export function DelegationTree() {
  const { ref, active } = useMockWindow();
  const { cycle, leaving, paused } = useCycle(14800, 700, active);
  return (
    <div
      ref={ref}
      className="bw bw-lead"
      role="img"
      aria-label="The bb app with the lead thread Ship the checkout fix, running in Grok Build. It starts Plan the fix in Claude Code, Build it in Cursor and Review the diff in Codex, which nest under it in the sidebar. Its timeline shows each Child thread update, and it answers a question from Build it on its own. When Review the diff finds no blocking issues, one notification reaches you: PR #482 is ready for you to merge."
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
              then={[{ status: "waiting", at: 11.2 }]}
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
                Fix CHK-41. Have Claude Code plan it, Cursor build it and Codex
                review it.
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
                  <strong>Review the diff</strong> finished: no blocking issues
                </ChildUpdate>
              </Reveal>
            </div>
            <WindowComposer
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

const START_PROMPT = "Fix CHK-41: checkout hangs on slow networks";

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
  { at: 2.9, icon: FileReadIcon, verb: "Read", object: "src/pay/client.ts" },
  {
    at: 3.5,
    say: "The payment call gives up after 5s on slow networks. Raising it to 30s with one idempotent retry.",
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
  const { ref, active } = useMockWindow();
  const { cycle, leaving, paused } = useCycle(11800, 700, active);
  return (
    <div
      ref={ref}
      className="bw bw-start"
      role="img"
      aria-label="The thread Fix the checkout bug plays step by step in the bb desktop app and, at the same time, in the bb mobile app on an iPhone: you ask bb to fix CHK-41, checkout hanging on slow networks, it explores the code, reads src/pay/client.ts, explains that the payment call gives up after 5 seconds and raises it to 30 with one retry, edits two files and runs the checkout tests. The same steps appear on both screens as they happen."
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
              <WindowComposer
                placeholder="Ask for a follow-up"
                model="Codex"
                modelIcon={OpenAiIcon}
              />
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
