import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";

import { useExperiment } from "../experiments/use-experiment";
import FilesEditorIcon from "../assets/plugin-icons/files-editor.svg";
import TaskboardIcon from "../assets/plugin-icons/taskboard.svg";
import {
  BugIcon,
  ChevronDown,
  ChevronRight,
  CloseIcon as ClearGlyph,
  CommandIcon,
  EditFileIcon,
  FileReadIcon,
  Ellipsis as MoreIcon,
  GitBranchIcon,
  LaptopGlyph,
  Maximize2,
  MicIcon,
  MockBar,
  MockChildEvent,
  MockComposer,
  MockStepContent,
  MockStatusTrack,
  MockStepRow,
  MockThreadStatus,
  MockTurnHeader,
  MockUserBubble,
  MockWorkingRow,
  type IconProps,
  type MockRunPhase,
  type MockStep,
  type MockThreadStatusKind,
  type NavLabel,
  NavRail,
  NewThreadIcon,
  PanelIcon,
  PanelRightIcon,
  Paperclip,
  PhoneIcon,
  ReturnIcon,
  PlusIcon as PlusGlyph,
  SearchIcon,
  SendIcon,
  Spinner,
  useFitMock,
  MOCK_CHILD_REPORT_PAUSE_S,
  MOCK_FIRST_ROW_S,
  MOCK_LOOP_FADE_MS,
  MOCK_LOOP_IDLE_S,
  MOCK_LOOP_SCROLL_BACK_MS,
  MOCK_MUTE_AFTER_S,
  MOCK_PACE_S,
  MOCK_SIDEBAR_LAG_S,
  MOCK_SLIDE_FIRST_HOLD_MS,
  MOCK_SLIDE_HOLD_MS,
  MOCK_SLIDE_MS,
  MOCK_STATUS_LEAD_S,
  MOCK_TEST_RUN_S,
  MOCK_TIMER_AFTER_S,
  MOCK_TOAST_AFTER_S,
  MOCK_WAIT_DONE_LEAD_S,
  MOCK_WORKING_AFTER_PROMPT_S,
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

const AGENT_ROW_PHONE_COUNTS = [3, 4, 5, 6, 7, 8, 9, 10] as const;

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
  return (
    <div className="providers agent-row">
      <span className="label">Bring your own subscription</span>
      {AGENT_ROW.map(({ Icon }, i) => (
        <Icon key={i} className={`plogo agent-logo agent-logo-${i}`} />
      ))}
      {more ? (
        <span className="agent-more" aria-label={`${more} more agents`}>
          +{more} more
        </span>
      ) : null}
      {AGENT_ROW_PHONE_COUNTS.map((shown) => {
        const hidden = AGENT_ROW.length - shown + (more ?? 0);
        return hidden > 0 ? (
          <span
            key={shown}
            className={`agent-phone-more agent-phone-more-${shown}`}
            aria-label={`${hidden} more agents`}
          >
            +{hidden} more
          </span>
        ) : null;
      })}
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

type StatusStep = { status: MockThreadStatusKind; at: number };

function RowStatus({
  status,
  then = [],
}: {
  status: MockThreadStatusKind;
  then?: readonly StatusStep[];
}) {
  if (then.length === 0) return <MockThreadStatus status={status} />;
  return <MockStatusTrack phases={[{ status, at: 0 }, ...then]} />;
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
  fadeAt,
  until,
  className,
  children,
}: {
  at?: number;
  fadeAt?: number;
  until?: number;
  className?: string;
  children: ReactNode;
}) {
  const classes = ["bw-reveal"];
  if (seconds === undefined) classes.push("bw-reveal-still");
  if (until !== undefined) classes.push("bw-reveal-until");
  if (className) classes.push(className);
  const style =
    seconds === undefined
      ? undefined
      : until === undefined
        ? at(seconds)
        : ({
            "--fw-at": `${seconds}s`,
            "--fw-out": `${until}s`,
            "--fw-fade": `${fadeAt ?? until}s`,
          } as CSSProperties);
  return (
    <div className={classes.join(" ")} style={style}>
      <div className="bw-reveal-inner">{children}</div>
    </div>
  );
}

function WindowBar({
  title,
  panelOpen = false,
  menuInTitle = false,
}: {
  title: ReactNode;
  panelOpen?: boolean;
  menuInTitle?: boolean;
}) {
  return (
    <MockBar>
      <span className="bar-title">{title}</span>
      {menuInTitle ? null : <MoreIcon className="bar-kebab" />}
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
  status?: MockThreadStatusKind;
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

const FOLLOW_UP_PLACEHOLDER = "Ask a follow-up";

function WindowComposer({
  model,
  modelIcon,
  running = false,
}: {
  model: string;
  modelIcon: RowIcon;
  running?: boolean | MockRunPhase[];
}) {
  return (
    <MockComposer
      className="bw-dock"
      project="checkout-web"
      model={model}
      modelIcon={modelIcon}
      reasoning={null}
      running={running}
      input={<span className="rhb-placeholder">{FOLLOW_UP_PLACEHOLDER}</span>}
    />
  );
}

const MORPH_PROMPT_FORMS = [
  "Checkout times out on slow networks. Find the cause and fix it.",
  "Checkout times out on slow networks.\nFind the cause and fix it.",
  "Checkout times out on\nslow networks. Find the\ncause and fix it.",
] as const;

const LEAD_PROMPT_FORMS = [
  "Ship the checkout timeout fix. Plan it, build it and get it reviewed.",
  "Ship the checkout timeout fix.\nPlan it, build it and get it reviewed.",
  "Ship the checkout timeout\nfix. Plan it, build it\nand get it reviewed.",
] as const;

function BubbleForms({ forms }: { forms: readonly string[] }) {
  return forms.map((form, index) => (
    <span className={`bw-fit-form bw-fit-${index}`} key={form}>
      {form
        .split("\n")
        .flatMap((line, i) => (i === 0 ? [line] : [<br key={i} />, line]))}
    </span>
  ));
}

function FoldAway({
  foldAt,
  children,
}: {
  foldAt: number;
  children: ReactNode;
}) {
  return (
    <div className="bw-turn-fold bw-fold-away" style={at(foldAt)}>
      <div className="bw-turn-body">{children}</div>
    </div>
  );
}

function WaitStep({ id, doneAt }: { id: string; doneAt: number }) {
  const em = `bb thread wait ${id}`;
  return (
    <div className="rhb-work rhb-work-cmd bw-swap bw-wait">
      <span className="bw-swap-a" style={at(doneAt)}>
        <MockStepContent
          step={{ kind: "cmd", verb: "Running", em, spin: true }}
        />
      </span>
      <span className="bw-swap-b is-dim" style={at(doneAt)}>
        <MockStepContent step={{ kind: "cmd", verb: "Ran", em }} />
      </span>
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
const MORPH_FIRST_HOLD_MS = MOCK_SLIDE_FIRST_HOLD_MS;
const MORPH_SLIDE_MS = MOCK_SLIDE_MS;
const MORPH_HOLD_MS = MOCK_SLIDE_HOLD_MS;

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

type MorphState = {
  scene: number;
  previous: number | null;
  title: number;
  key: number;
};

function useMorphTimeline(active: boolean) {
  const [state, setState] = useState<MorphState>({
    scene: 0,
    previous: null,
    title: 0,
    key: 0,
  });
  useEffect(() => {
    if (!active) return;
    let timer = 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const cut = () => {
        timer = window.setTimeout(() => {
          setState((current) => {
            const scene = (current.scene + 1) % MORPH_SCENES.length;
            return {
              scene,
              previous: null,
              title: scene,
              key: current.key + 1,
            };
          });
          cut();
        }, MORPH_HOLD_MS);
      };
      cut();
      return () => window.clearTimeout(timer);
    }
    let first = true;
    const hold = () => {
      const wait = first ? MORPH_FIRST_HOLD_MS : MORPH_HOLD_MS;
      first = false;
      timer = window.setTimeout(() => {
        setState((current) => ({
          scene: (current.scene + 1) % MORPH_SCENES.length,
          previous: current.scene,
          title: current.scene,
          key: current.key + 1,
        }));
        timer = window.setTimeout(() => {
          setState((current) => ({ ...current, title: current.scene }));
          timer = window.setTimeout(() => {
            setState((current) => ({ ...current, previous: null }));
            hold();
          }, MORPH_SLIDE_MS / 2);
        }, MORPH_SLIDE_MS / 2);
      }, wait);
    };
    hold();
    return () => window.clearTimeout(timer);
  }, [active]);
  return {
    scene: MORPH_SCENES[state.scene]!,
    previous: state.previous === null ? null : MORPH_SCENES[state.previous]!,
    title: MORPH_SCENES[state.title]!,
    key: state.key,
    paused: !active,
  };
}

function MorphTitle({ scene, role }: { scene: MorphScene; role: string }) {
  return (
    <span className={`mx-title${role}`}>
      <span className="mx-title-text">{MORPH_TITLES[MORPH_CENTER[scene]]}</span>
      <MoreIcon className="bar-kebab" />
    </span>
  );
}

function MorphPane({
  scene,
  role,
}: {
  scene: MorphScene;
  role: "" | " is-entering" | " is-leaving";
}) {
  const center = MORPH_CENTER[scene];
  const side = MORPH_SIDE[scene];
  return (
    <div
      className={`mx-pane mx-${scene}${side === null ? " mx-collapsed" : ""}${role}`}
    >
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
        {side === "threads" ? (
          <aside className="side mx-side-threads mx-fill">
            <MorphThreads />
          </aside>
        ) : side === "shelves" ? (
          <aside className="side mx-side-shelves mx-fill">
            <MorphShelves />
          </aside>
        ) : null}
      </div>
      <div className="mx-center">
        <div className="main mx-fill">
          {center === "thread" ? (
            <MorphThread />
          ) : center === "files" ? (
            <MorphFiles />
          ) : (
            <MorphTaskboard />
          )}
        </div>
      </div>
      <div className="mx-panel-slot">
        {scene === "graph" ? (
          <div className="mx-panel">
            <MorphAgentGraph />
          </div>
        ) : null}
      </div>
    </div>
  );
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
      <ThreadRow title={MORPH_THREAD} icon={ClaudeIcon} active />
      <ThreadRow title="Signups by plan" icon={OpenAiIcon} />
      <ThreadRow title="Bump the SDK" icon={ClaudeIcon} />
      <ThreadRow title="Refactor auth" icon={CursorIcon} status="waiting" />
      <ThreadRow title="Weekly changelog" icon={OpenAiIcon} />
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
        <MockUserBubble className="bw-fit-morph">
          <BubbleForms forms={MORPH_PROMPT_FORMS} />
        </MockUserBubble>
        <MockTurnHeader worked="1m 4s" />
        <div className="msg-say">
          Found it: the payment request gives up after 5 seconds. I raised the
          timeout to 30 seconds, added one retry, and the checkout tests pass.
        </div>
      </div>
      <WindowComposer model="Opus 5.5" modelIcon={ClaudeIcon} />
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
  const { ref, active } = useMockWindow();
  const { scene, previous, title, key, paused } = useMorphTimeline(active);
  const side = MORPH_SIDE[scene];
  return (
    <div
      ref={ref}
      className={`bw bw-morph mx-${scene}${side === null ? " mx-collapsed" : ""}${paused ? " fw-paused" : ""}`}
      data-scene={scene}
      role="img"
      aria-label="One bb window that keeps rearranging itself as plugins and themes change it. It starts as a plain thread with the thread list in bb's default theme. The thread list folds away to the icon rail and the Files plugin opens its own file tree and a README preview in Tokyo Night. Then the window splits: the thread on the left and the Agent Graph plugin's node graph on the right, in bb Monokai. The split closes into the Taskboard plugin's full-width kanban board in Ayu Light. Then the sidebar comes back wider as BB Sidebar, with project shelves and child threads, in Ayu Mirage, before it starts over."
    >
      <div className="mock bw-window mx-window mock-ui">
        <WindowBar
          panelOpen={title === "graph"}
          menuInTitle
          title={
            <span className="mx-titles">
              {previous === null ? null : (
                <MorphTitle key={key - 1} scene={previous} role=" is-leaving" />
              )}
              <MorphTitle
                key={key}
                scene={scene}
                role={previous === null ? "" : " is-entering"}
              />
            </span>
          }
        />
        <div className="mock-body bw-body mx-body" aria-hidden>
          {previous === null ? null : (
            <MorphPane key={key - 1} scene={previous} role=" is-leaving" />
          )}
          <MorphPane
            key={key}
            scene={scene}
            role={previous === null ? "" : " is-entering"}
          />
        </div>
      </div>
    </div>
  );
}

const DELEGATION_LEAD = "Ship the checkout fix";

const CHILD_REPORT_WAIT = MOCK_CHILD_REPORT_PAUSE_S;
const SIDEBAR_LAG = MOCK_SIDEBAR_LAG_S;
const STATUS_LEAD = MOCK_STATUS_LEAD_S;
const WAIT_DONE_LEAD = MOCK_WAIT_DONE_LEAD_S;

const LEAD_AT = (() => {
  const spawnPlan = MOCK_FIRST_ROW_S;
  const planning = spawnPlan + MOCK_PACE_S;
  const waitPlan = planning + MOCK_PACE_S;
  const planDone = waitPlan + CHILD_REPORT_WAIT;
  const planSay = planDone + MOCK_PACE_S;
  const spawnBuild = planSay + MOCK_PACE_S;
  const waitBuild = spawnBuild + MOCK_PACE_S;
  const buildAsks = waitBuild + CHILD_REPORT_WAIT;
  const sentBuild = buildAsks + MOCK_PACE_S;
  const toldSay = sentBuild + MOCK_PACE_S;
  const waitBuildAgain = toldSay + MOCK_PACE_S;
  const buildDone = waitBuildAgain + CHILD_REPORT_WAIT;
  const spawnReview = buildDone + MOCK_PACE_S;
  const waitReview = spawnReview + MOCK_PACE_S;
  const reviewAsks = waitReview + CHILD_REPORT_WAIT;
  const reply = reviewAsks + MOCK_PACE_S;
  const end = reply + MOCK_PACE_S;
  return {
    spawnPlan,
    planning,
    waitPlan,
    planDone,
    planSay,
    spawnBuild,
    waitBuild,
    buildAsks,
    sentBuild,
    toldSay,
    waitBuildAgain,
    buildDone,
    spawnReview,
    waitReview,
    reviewAsks,
    reply,
    end,
  };
})();

const DELEGATION_CHILDREN = [
  {
    icon: ClaudeIcon,
    title: "Plan the fix",
    landsAt: LEAD_AT.spawnPlan + SIDEBAR_LAG,
    then: [{ status: "done", at: LEAD_AT.planDone - STATUS_LEAD }],
  },
  {
    icon: CursorIcon,
    title: "Build it",
    landsAt: LEAD_AT.spawnBuild + SIDEBAR_LAG,
    then: [
      { status: "done", at: LEAD_AT.buildAsks - STATUS_LEAD },
      { status: "running", at: LEAD_AT.sentBuild + SIDEBAR_LAG },
      { status: "done", at: LEAD_AT.buildDone - STATUS_LEAD },
    ],
  },
  {
    icon: OpenAiIcon,
    title: "Review the diff",
    landsAt: LEAD_AT.spawnReview + SIDEBAR_LAG,
    then: [{ status: "waiting", at: LEAD_AT.reviewAsks - STATUS_LEAD }],
  },
] as const;

function spawnStep(flags: string): MockStep {
  return {
    kind: "cmd",
    verb: "Ran",
    em: `bb thread spawn --project $BB_PROJECT_ID --parent-self ${flags}`,
  };
}

const PLAN_THREAD = { label: "Plan the fix" };
const BUILD_THREAD = { label: "Build it" };
const REVIEW_THREAD = { label: "Review the diff" };

const DELEGATION_PING = "Waiting for your input";

const LEAD_END = LEAD_AT.end;

const LEAD_STATUS: readonly StatusStep[] = [{ status: "done", at: LEAD_END }];

function NeedsAttention({ label }: { label: string }) {
  return (
    <div className="rhb-gen">
      <span className="rhb-gen-head">
        <HugeiconsIcon icon={Alert02Icon} className="rhb-gen-ic" />
        <span className="rhb-gen-subject">{label}</span>
        <span className="rhb-gen-verb">needs attention</span>
      </span>
    </div>
  );
}

export function DelegationTree() {
  const { ref, active } = useMockWindow();
  const { cycle, leaving, paused } = useCycle(
    Math.round((LEAD_END + MOCK_LOOP_IDLE_S) * 1000),
    MOCK_LOOP_SCROLL_BACK_MS,
    active,
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const view = scrollRef.current;
    const feed = view?.firstElementChild;
    if (!view || !(feed instanceof HTMLElement)) return;
    const overflow = leaving
      ? Math.max(0, feed.offsetHeight - view.clientHeight)
      : 0;
    view.style.setProperty("--bw-scroll-back", `${overflow}px`);
  }, [leaving]);
  return (
    <div
      ref={ref}
      className="bw bw-lead"
      role="img"
      aria-label="The bb app with the lead thread Ship the checkout fix, running in Grok Build. It starts Plan the fix in Claude Code, Build it in Cursor and Review the diff in Codex, which nest under it in the sidebar. Its timeline shows a short note from the lead between each child's update, and it answers a question from Build it on its own. One notification reaches you: Review the diff, waiting for your input."
    >
      <div className="mock bw-window mock-ui">
        <WindowBar title={DELEGATION_LEAD} />
        <div
          className={stageClass("mock-body bw-body", leaving, paused)}
          key={cycle}
        >
          <Sidebar>
            <div className="side-label">Threads</div>
            <ThreadRow title="Bump the SDK" icon={ClaudeIcon} />
            <ThreadRow
              title={DELEGATION_LEAD}
              icon={GrokIcon}
              status="running"
              then={LEAD_STATUS}
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
            <ThreadRow title="Weekly changelog" icon={OpenAiIcon} />
          </Sidebar>
          <div className="main">
            <div ref={scrollRef} className="bw-feed-scroll">
              <div className="feed bw-feed">
                <MockUserBubble className="bw-fit-lead">
                  <BubbleForms forms={LEAD_PROMPT_FORMS} />
                </MockUserBubble>
                <div className="bw-turn">
                  <MockTurnHeader
                    worked={`${Math.round(LEAD_END)}s`}
                    openAt={`${LEAD_END}s`}
                  />
                  <div className="bw-turn-stay">
                    <div className="bw-turn-body">
                      <Reveal at={LEAD_AT.spawnPlan}>
                        <FoldAway foldAt={LEAD_END}>
                          <MockStepRow
                            className="bw-spawn bw-mute"
                            style={
                              {
                                "--bw-mute-at": `${LEAD_AT.spawnPlan + MOCK_MUTE_AFTER_S}s`,
                              } as CSSProperties
                            }
                            step={spawnStep(
                              '--provider claude-code --prompt "Plan the checkout timeout fix"',
                            )}
                          />
                        </FoldAway>
                      </Reveal>
                      <Reveal at={LEAD_AT.planning}>
                        <div className="msg-say">
                          Claude Code is planning the fix.
                        </div>
                      </Reveal>
                      <Reveal at={LEAD_AT.waitPlan}>
                        <FoldAway foldAt={LEAD_END}>
                          <WaitStep
                            id="$PLAN_THREAD_ID"
                            doneAt={LEAD_AT.planDone - WAIT_DONE_LEAD}
                          />
                        </FoldAway>
                      </Reveal>
                      <Reveal at={LEAD_AT.planDone}>
                        <MockChildEvent
                          kind="finished"
                          thread={PLAN_THREAD}
                          body={
                            <>
                              three steps in <code>plan.md</code>
                            </>
                          }
                        />
                      </Reveal>
                      <Reveal at={LEAD_AT.planSay}>
                        <div className="msg-say">
                          The plan has three steps. Cursor is building it now.
                        </div>
                      </Reveal>
                      <Reveal at={LEAD_AT.spawnBuild}>
                        <FoldAway foldAt={LEAD_END}>
                          <MockStepRow
                            className="bw-spawn bw-mute"
                            style={
                              {
                                "--bw-mute-at": `${LEAD_AT.spawnBuild + MOCK_MUTE_AFTER_S}s`,
                              } as CSSProperties
                            }
                            step={spawnStep(
                              '--provider acp-cursor --prompt "Build the fix in plan.md"',
                            )}
                          />
                        </FoldAway>
                      </Reveal>
                      <Reveal at={LEAD_AT.waitBuild}>
                        <FoldAway foldAt={LEAD_END}>
                          <WaitStep
                            id="$BUILD_THREAD_ID"
                            doneAt={LEAD_AT.buildAsks - WAIT_DONE_LEAD}
                          />
                        </FoldAway>
                      </Reveal>
                      <Reveal at={LEAD_AT.buildAsks}>
                        <MockChildEvent
                          kind="message"
                          thread={BUILD_THREAD}
                          body="keep the 30s timeout, or make it configurable?"
                        />
                      </Reveal>
                      <Reveal at={LEAD_AT.sentBuild}>
                        <MockChildEvent
                          kind="sent"
                          thread={BUILD_THREAD}
                          body="Make it configurable, default 30s."
                        />
                      </Reveal>
                      <Reveal at={LEAD_AT.toldSay}>
                        <div className="msg-say">
                          Told Build it to make the timeout configurable.
                        </div>
                      </Reveal>
                      <Reveal at={LEAD_AT.waitBuildAgain}>
                        <FoldAway foldAt={LEAD_END}>
                          <WaitStep
                            id="$BUILD_THREAD_ID"
                            doneAt={LEAD_AT.buildDone - WAIT_DONE_LEAD}
                          />
                        </FoldAway>
                      </Reveal>
                      <Reveal at={LEAD_AT.buildDone}>
                        <MockChildEvent
                          kind="finished"
                          thread={BUILD_THREAD}
                          body="PR #482 is open"
                        />
                      </Reveal>
                      <Reveal at={LEAD_AT.spawnReview}>
                        <FoldAway foldAt={LEAD_END}>
                          <MockStepRow
                            className="bw-spawn bw-mute"
                            style={
                              {
                                "--bw-mute-at": `${LEAD_AT.spawnReview + MOCK_MUTE_AFTER_S}s`,
                              } as CSSProperties
                            }
                            step={spawnStep(
                              '--provider codex --prompt "Review PR #482"',
                            )}
                          />
                        </FoldAway>
                      </Reveal>
                      <Reveal at={LEAD_AT.waitReview}>
                        <FoldAway foldAt={LEAD_END}>
                          <WaitStep
                            id="$REVIEW_THREAD_ID"
                            doneAt={LEAD_AT.reviewAsks - WAIT_DONE_LEAD}
                          />
                        </FoldAway>
                      </Reveal>
                      <Reveal at={LEAD_AT.reviewAsks}>
                        <NeedsAttention label={REVIEW_THREAD.label} />
                      </Reveal>
                    </div>
                  </div>
                </div>
                <Reveal at={LEAD_AT.reply}>
                  <div className="msg-say">
                    The fix is in. Codex is reviewing the diff.
                  </div>
                </Reveal>
                <Reveal
                  at={MOCK_WORKING_AFTER_PROMPT_S}
                  fadeAt={LEAD_END}
                  until={LEAD_END}
                >
                  <MockWorkingRow />
                </Reveal>
              </div>
            </div>
            <WindowComposer
              model="Grok Build"
              modelIcon={GrokIcon}
              running={[
                { at: 0, running: true },
                ...LEAD_STATUS.map((step) => ({
                  at: step.at,
                  running: step.status === "running",
                })),
              ]}
            />
          </div>
        </div>
      </div>
      <div
        className={stageClass("bw-toast-layer", leaving, paused)}
        key={cycle}
      >
        <div className="bw-toast" style={at(LEAD_END + MOCK_TOAST_AFTER_S)}>
          <BbGlyph className="bw-toast-mark" />
          <span className="bw-toast-text">
            <span className="bw-toast-head">
              <span className="bw-toast-title">{REVIEW_THREAD.label}</span>
              <span className="bw-toast-time">now</span>
            </span>
            <span className="bw-toast-body">{DELEGATION_PING}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

const START_PROMPT_FORMS = [
  "Fix the checkout bug: payments hang on slow networks",
  "Fix the checkout bug:\npayments hang on slow networks",
  "Fix the checkout\nbug: payments hang\non slow networks",
] as const;

const START_DONE = "Checkout tests pass.";

const PHONE_PROMPT_LINES = [
  "Fix the checkout",
  "bug: payments hang",
  "on slow networks",
];

type StartWork = {
  at: number;
  say?: undefined;
  kind: MockStep["kind"];
  icon: RowIcon;
  verb: string;
  object: string;
  live?: boolean;
};

type StartStep = { at: number; say: string } | StartWork;

const START_FIRST_STEP = MOCK_FIRST_ROW_S;
const START_TESTS_AT = START_FIRST_STEP + 3 * MOCK_PACE_S;
const START_TESTS_DONE = START_TESTS_AT + MOCK_TEST_RUN_S;
const START_REPLY = START_TESTS_DONE + MOCK_PACE_S;
const START_END = START_REPLY + MOCK_PACE_S;
const START_TEST_TIME = "4s";

function StepRow({ step }: { step: StartWork }) {
  if (!step.live) {
    return (
      <div className="bw-step">
        <step.icon className="bw-step-ic" />
        <span>{step.verb}</span>
        <span className="bw-step-object">{step.object}</span>
      </div>
    );
  }
  return (
    <div className="bw-step is-live bw-swap">
      <span className="bw-swap-a" style={at(START_TESTS_DONE)}>
        <step.icon className="bw-step-ic" />
        <span>{step.verb}</span>
        <span className="bw-step-object">{step.object}</span>
        <span
          className="bw-step-timer"
          style={at(step.at + MOCK_TIMER_AFTER_S)}
        />
      </span>
      <span className="bw-swap-b is-dim" style={at(START_TESTS_DONE)}>
        <step.icon className="bw-step-ic" />
        <span>Ran</span>
        <span className="bw-step-object">{step.object}</span>
        <span className="bw-m-timer-done">{START_TEST_TIME}</span>
      </span>
    </div>
  );
}

function DesktopStep({ step }: { step: StartWork }) {
  const mock: MockStep = { kind: step.kind, verb: step.verb, em: step.object };
  if (!step.live) return <MockStepRow step={mock} className="is-past" />;
  return (
    <div className={`rhb-work rhb-work-${step.kind} bw-swap`}>
      <span className="bw-swap-a" style={at(START_TESTS_DONE)}>
        <MockStepContent step={mock} />
        <span
          className="rhb-dur bw-step-timer"
          style={at(step.at + MOCK_TIMER_AFTER_S)}
        />
        <Spinner className="trun rhb-work-spin" />
      </span>
      <span className="bw-swap-b is-dim" style={at(START_TESTS_DONE)}>
        <MockStepContent
          step={{ ...mock, verb: "Ran", dur: START_TEST_TIME }}
        />
      </span>
    </div>
  );
}

const START_STEPS: readonly StartStep[] = [
  {
    at: START_FIRST_STEP,
    kind: "work",
    icon: SearchIcon,
    verb: "Explored",
    object: "5 files, 1 search",
  },
  {
    at: START_FIRST_STEP + MOCK_PACE_S,
    say: "The payment call has no timeout, so slow networks hang checkout. Adding a 10s timeout with one retry.",
  },
  {
    at: START_FIRST_STEP + 2 * MOCK_PACE_S,
    kind: "file",
    icon: EditFileIcon,
    verb: "Edited",
    object: "2 files",
  },
  {
    at: START_FIRST_STEP + 3 * MOCK_PACE_S,
    kind: "cmd",
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
  const { cycle, leaving, paused } = useCycle(
    Math.round((START_END + MOCK_LOOP_IDLE_S) * 1000),
    MOCK_LOOP_FADE_MS,
    active,
  );
  return (
    <div
      ref={ref}
      className="bw bw-start"
      role="img"
      aria-label="The thread Fix the checkout bug plays step by step in the bb desktop app and, at the same time, in the bb mobile app on an iPhone: you ask bb to fix the checkout bug because payments hang on slow networks, it explores the code, reads src/checkout/pay.ts, explains that the payment call has no timeout, edits two files and runs the checkout tests. The same steps appear on both screens as they happen."
    >
      <div
        className={stageClass("bw-start-stage", leaving, paused)}
        key={cycle}
      >
        <div className="mock bw-window mock-ui">
          <WindowBar title="Fix the checkout bug" />
          <div className="mock-body bw-body">
            <Sidebar>
              <div className="side-label bw-group">
                <LinuxIcon className="bw-group-ic" />
                linux-box
                <span className="bw-chip">server</span>
              </div>
              <ThreadRow
                title="Fix the checkout bug"
                icon={OpenAiIcon}
                status="running"
                then={[{ status: "done", at: START_END }]}
                active
              />
              <Reveal at={START_TESTS_AT + MOCK_PACE_S}>
                <ThreadRow
                  title="Fix CI on main"
                  icon={ClaudeIcon}
                  status="running"
                />
              </Reveal>
              <Reveal at={START_TESTS_AT + 2 * MOCK_PACE_S}>
                <ThreadRow
                  title="Daily changelog"
                  icon={OpenAiIcon}
                  status="running"
                />
              </Reveal>
              <div className="side-label bw-group">
                <LaptopGlyph className="bw-group-ic" />
                MacBook
              </div>
              <ThreadRow
                title="Refactor auth"
                icon={CursorIcon}
                status="waiting"
              />
              <ThreadRow title="Fix flaky login test" icon={ClaudeIcon} />
            </Sidebar>
            <div className="main">
              <div className="feed bw-feed">
                <Reveal>
                  <MockUserBubble className="bw-fit-start">
                    <BubbleForms forms={START_PROMPT_FORMS} />
                  </MockUserBubble>
                </Reveal>
                <div className="bw-turn">
                  <MockTurnHeader worked="9s" openAt={`${START_END}s`} />
                  <div className="bw-turn-fold" style={at(START_END)}>
                    <div className="bw-turn-body">
                      {START_STEPS.map((step) => (
                        <Reveal key={step.at} at={step.at}>
                          {step.say !== undefined ? (
                            <div className="msg-say">{step.say}</div>
                          ) : (
                            <DesktopStep step={step} />
                          )}
                        </Reveal>
                      ))}
                    </div>
                  </div>
                </div>
                <Reveal at={START_REPLY}>
                  <div className="msg-say">{START_DONE}</div>
                </Reveal>
                <Reveal
                  at={MOCK_WORKING_AFTER_PROMPT_S}
                  fadeAt={START_END}
                  until={START_END}
                >
                  <MockWorkingRow />
                </Reveal>
              </div>
              <WindowComposer
                model="Codex"
                modelIcon={OpenAiIcon}
                running={[
                  { at: 0, running: true },
                  { at: START_END, running: false },
                ]}
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
              <div className="bw-m-feed mock-ui">
                <Reveal>
                  <div className="bw-m-user">
                    {PHONE_PROMPT_LINES.map((line, index) => (
                      <span key={line}>
                        {index > 0 ? <br /> : null}
                        {line}
                      </span>
                    ))}
                  </div>
                </Reveal>
                <div className="bw-turn">
                  <MockTurnHeader worked="9s" openAt={`${START_END}s`} />
                  <div className="bw-turn-fold" style={at(START_END)}>
                    <div className="bw-turn-body">
                      {START_STEPS.map((step) => (
                        <Reveal key={step.at} at={step.at}>
                          {step.say !== undefined ? (
                            <div className="bw-m-say">{step.say}</div>
                          ) : (
                            <StepRow step={step} />
                          )}
                        </Reveal>
                      ))}
                    </div>
                  </div>
                </div>
                <Reveal at={START_REPLY}>
                  <div className="bw-m-say">{START_DONE}</div>
                </Reveal>
                <Reveal
                  at={MOCK_WORKING_AFTER_PROMPT_S}
                  fadeAt={START_END}
                  until={START_END}
                >
                  <div className="bw-m-working">Working...</div>
                </Reveal>
              </div>
              <div className="bw-m-composer">
                <span className="bw-m-placeholder">Ask a follow-up</span>
                <MicIcon className="bw-m-mic" />
                <span className="bw-m-action">
                  <span className="bw-m-stop" style={at(START_END)}>
                    <i />
                  </span>
                  <span className="bw-m-send" style={at(START_END)}>
                    <ReturnIcon className="bw-m-send-ic" />
                  </span>
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
