import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowExpand01Icon from "@hugeicons/core-free-icons/ArrowExpand01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowMoveDownLeftIcon from "@hugeicons/core-free-icons/ArrowMoveDownLeftIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import AttachmentIcon from "@hugeicons/core-free-icons/AttachmentIcon";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import Bug01Icon from "@hugeicons/core-free-icons/Bug01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import CornerDownLeftIcon from "@hugeicons/core-free-icons/CornerDownLeftIcon";
import Edit04Icon from "@hugeicons/core-free-icons/Edit04Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import FileEditIcon from "@hugeicons/core-free-icons/FileEditIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import FolderGit2Icon from "@hugeicons/core-free-icons/FolderGit2Icon";
import GitBranchGlyph from "@hugeicons/core-free-icons/GitBranchIcon";
import GitMergeGlyph from "@hugeicons/core-free-icons/GitMergeIcon";
import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import MessageQuestionIcon from "@hugeicons/core-free-icons/MessageQuestionIcon";
import Mic02Icon from "@hugeicons/core-free-icons/Mic02Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import Plug02Icon from "@hugeicons/core-free-icons/Plug02Icon";
import PlusMinusSquare01Icon from "@hugeicons/core-free-icons/PlusMinusSquare01Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import RepeatIcon from "@hugeicons/core-free-icons/RepeatIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import SentIcon from "@hugeicons/core-free-icons/SentIcon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import SidebarRightIcon from "@hugeicons/core-free-icons/SidebarRightIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import SquareGlyph from "@hugeicons/core-free-icons/SquareIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import UserGlyph from "@hugeicons/core-free-icons/UserIcon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

import vscodeIcon from "../assets/vscode.png";
import { ClaudeIcon } from "./icons";

export type IconProps = { className?: string };
export type MockIcon = (props: IconProps) => ReactNode;

function glyph(icon: IconSvgElement): MockIcon {
  return function Glyph({ className }: IconProps) {
    return <HugeiconsIcon icon={icon} className={className} />;
  };
}

export const PanelIcon = glyph(SidebarLeftIcon);
export const PanelRightIcon = glyph(SidebarRightIcon);
export const ChevronLeft = glyph(ArrowLeft01Icon);
export const ChevronRight = glyph(ArrowRight01Icon);
export const ChevronDown = glyph(ArrowDown01Icon);
export const Ellipsis = glyph(MoreHorizontalIcon);
export const NewThreadIcon = glyph(BubbleChatAddIcon);
export const HomeIcon = glyph(Home01Icon);
export const SearchIcon = glyph(Search01Icon);
export const PluginsIcon = glyph(Plug02Icon);
export const SkillsIcon = glyph(ZapIcon);
export const AutomationsIcon = glyph(RepeatIcon);
const CircleQuestionIcon = glyph(HelpCircleIcon);
const UserRoundIcon = glyph(UserGlyph);
const StopSquareIcon = glyph(SquareGlyph);
export const ClockIcon = glyph(Clock01Icon);
export const ReturnIcon = glyph(CornerDownLeftIcon);
export const GearIcon = glyph(Settings01Icon);
export const PhoneIcon = glyph(SmartPhone01Icon);
export const BugIcon = glyph(Bug01Icon);
export const CheckIcon = glyph(Tick02Icon);
export const CircleCheckIcon = glyph(CheckmarkCircle02Icon);
export const QuestionIcon = glyph(MessageQuestionIcon);
export const PaperPlane = glyph(SentIcon);
export const Paperclip = glyph(AttachmentIcon);
export const PlusIcon = glyph(PlusSignIcon);
export const FolderIcon = glyph(Folder01Icon);
export const FolderGitIcon = glyph(FolderGit2Icon);
export const GitBranchIcon = glyph(GitBranchGlyph);
export const GitMergeIcon = glyph(GitMergeGlyph);
export const Spinner = glyph(Loading03Icon);
export const Maximize2 = glyph(ArrowExpand01Icon);
export const MicIcon = glyph(Mic02Icon);
export const SendIcon = glyph(ArrowMoveDownLeftIcon);
export const LaptopGlyph = glyph(LaptopIcon);
export const FileDiffIcon = glyph(PlusMinusSquare01Icon);
export const CloseIcon = glyph(Cancel01Icon);
export const TerminalIcon = glyph(CommandLineIcon);
export const FileEditGlyph = glyph(FileEditIcon);
export const MessageIcon = glyph(Message01Icon);
export const FileReadIcon = glyph(File01Icon);
export const EditFileIcon = glyph(Edit04Icon);
export const CommandIcon = glyph(ComputerTerminal01Icon);

export type ThreadState = "running" | "done" | "waiting";

export function StatusGlyph({ status }: { status: ThreadState | "unread" }) {
  if (status === "running") return <Spinner className="trun" />;
  if (status === "done") return <CircleCheckIcon className="tdone" />;
  if (status === "waiting") return <QuestionIcon className="twait" />;
  return <span className="tunread" />;
}

export function ThreadStatus({ status }: { status: ThreadState | "unread" }) {
  return (
    <span className="tstatus" aria-hidden>
      <StatusGlyph status={status} />
    </span>
  );
}

export function WindowDots() {
  return (
    <span className="mock-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

export function WindowControls() {
  return (
    <>
      <WindowDots />
      <span className="bar-menu" aria-hidden>
        <PanelIcon className="ri bar-ic" />
      </span>
      <span className="bar-nav" aria-hidden>
        <ChevronLeft className="ri" />
        <ChevronRight className="ri" />
      </span>
    </>
  );
}

export function MockBar({ children }: { children: ReactNode }) {
  return (
    <div className="mock-bar">
      <div className="bar-left">
        <WindowControls />
      </div>
      <div className="bar-main">{children}</div>
    </div>
  );
}

export function EditorButton() {
  return (
    <span className="editor-btn" aria-hidden>
      <img src={vscodeIcon} alt="" className="editor-ic" />
      <ChevronDown className="chev-xs" />
    </span>
  );
}

export function ComposerBox({
  children,
  model,
  modelIcon: ModelIcon = ClaudeIcon,
  attach = "clip",
}: {
  children: ReactNode;
  model: ReactNode;
  modelIcon?: MockIcon;
  attach?: "clip" | "plus";
}) {
  return (
    <div className="composer-box">
      <div className="composer-top">{children}</div>
      <div className="composer-row">
        {attach === "plus" ? <PlusIcon className="composer-clip" /> : null}
        <span className="model">
          <ModelIcon className="model-ic" />
          {model}
          <ChevronDown className="chev-sm" />
        </span>
        <span className="composer-actions" aria-hidden>
          {attach === "clip" ? <Paperclip className="composer-clip" /> : null}
          <MicIcon className="composer-clip" />
          <span className="send-btn">
            <SendIcon className="send-ic" />
          </span>
        </span>
      </div>
    </div>
  );
}

export function ContextRow({
  project,
  place,
  branch,
  running = false,
}: {
  project: string;
  place: { icon: MockIcon; label: string };
  branch: string;
  running?: boolean;
}) {
  const PlaceIcon = place.icon;
  return (
    <div className="context-row">
      <span className="ctx">
        <FolderIcon className="ctx-ic" />
        <span>{project}</span>
        <ChevronDown className="ctx-chev" />
      </span>
      <span className="ctx">
        <PlaceIcon className="ctx-ic" />
        <span>{place.label}</span>
        <ChevronDown className="ctx-chev" />
      </span>
      <span className="ctx">
        <GitBranchIcon className="ctx-ic" />
        <span className="ctx-branch">{branch}</span>
        <ChevronDown className="ctx-chev" />
      </span>
      <span className="ctx-perm">
        Full Access
        <ChevronDown className="ctx-chev" />
      </span>
      {running ? <Spinner className="ctx-spin" /> : null}
    </div>
  );
}

export const NAV_ITEMS = [
  { icon: HomeIcon, label: "Home" },
  { icon: PluginsIcon, label: "Plugins" },
  { icon: SkillsIcon, label: "Skills" },
  { icon: AutomationsIcon, label: "Automations" },
] as const satisfies readonly { icon: MockIcon; label: string }[];

export type NavLabel = (typeof NAV_ITEMS)[number]["label"];

export function NavRail({
  active = "Home",
  children,
}: {
  active?: NavLabel | null;
  children?: ReactNode;
}) {
  return (
    <nav className="rail" aria-hidden>
      {NAV_ITEMS.map(({ icon: Icon, label }) => (
        <span
          key={label}
          className={label === active ? "rail-btn is-on" : "rail-btn"}
        >
          <Icon className="rail-ic" />
        </span>
      ))}
      {children}
      <span className="rail-btn">
        <Ellipsis className="rail-ic" />
      </span>
      <span className="rail-btn rail-settings">
        <GearIcon className="rail-ic" />
      </span>
    </nav>
  );
}

export function useFitMock(
  ref: RefObject<HTMLElement | null>,
  { shrinkOnly = false }: { shrinkOnly?: boolean } = {},
) {
  useEffect(() => {
    const mock = ref.current;
    const wrap = mock?.parentElement;
    if (!mock || !wrap || typeof ResizeObserver === "undefined") {
      return;
    }
    const fit = () => {
      const mockStyle = getComputedStyle(mock);
      const wrapStyle = getComputedStyle(wrap);
      if (
        getComputedStyle(mock).getPropertyValue("--mock-fill").trim() === "1"
      ) {
        const fill = Math.floor(
          wrap.clientWidth -
            Number.parseFloat(wrapStyle.paddingLeft) -
            Number.parseFloat(wrapStyle.paddingRight),
        );
        mock.style.setProperty("--mock-scale", "1");
        mock.style.setProperty("--mock-fill-width", `${fill}px`);
        mock.style.setProperty("--mock-slice", `${fill}px`);
        mock.style.setProperty("--mock-slice-ratio", "1");
        return;
      }
      mock.style.removeProperty("--mock-fill-width");
      const visibleWidth = Number.parseFloat(
        mockStyle.getPropertyValue("--mock-visible-width"),
      );
      if (!visibleWidth) {
        mock.style.removeProperty("--mock-scale");
        return;
      }
      const room =
        wrap.clientWidth -
        Number.parseFloat(wrapStyle.paddingLeft) -
        Number.parseFloat(wrapStyle.paddingRight);
      if (shrinkOnly && !room) return;
      const scale = shrinkOnly
        ? Math.min(1, room / visibleWidth)
        : room / visibleWidth;
      mock.style.setProperty("--mock-scale", String(scale));
      const width = Number.parseFloat(
        mockStyle.getPropertyValue("--mock-width"),
      );
      if (!width) return;
      const slice = Math.min(width, room / scale);
      mock.style.setProperty("--mock-slice", `${slice}px`);
      mock.style.setProperty("--mock-slice-ratio", String(slice / width));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [ref, shrinkOnly]);
}

export function MockBubbleLines({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={className}>
      {text
        .split("\n")
        .flatMap((line, i) => (i === 0 ? [line] : [<br key={i} />, line]))}
    </span>
  );
}

export function MockUserBubble({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className ? `rhb-user ${className}` : "rhb-user"}
      style={style}
    >
      {typeof children === "string"
        ? children
            .split("\n")
            .flatMap((line, i) => (i === 0 ? [line] : [<br key={i} />, line]))
        : children}
    </div>
  );
}

export type MockStepKind = "plugin" | "cmd" | "file" | "work";

export type MockStep = {
  kind: MockStepKind;
  plugin?: string;
  verb: string;
  em?: string;
  file?: string;
  diff?: [number, number];
  dur?: string;
  spin?: boolean;
};

export function MockStepIcon({ kind }: { kind: MockStepKind }) {
  if (kind === "plugin")
    return <PluginsIcon className="rhb-step-ic is-plugin" />;
  if (kind === "cmd") return <TerminalIcon className="rhb-step-ic" />;
  if (kind === "file") return <FileEditGlyph className="rhb-step-ic" />;
  return <SearchIcon className="rhb-step-ic" />;
}

export function MockStepContent({ step }: { step: MockStep }) {
  return (
    <>
      <MockStepIcon kind={step.kind} />
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

export function MockStepRow({
  step,
  className,
  style,
}: {
  step: MockStep;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`rhb-work rhb-work-${step.kind}${className ? ` ${className}` : ""}`}
      style={style}
    >
      <MockStepContent step={step} />
    </div>
  );
}

export type MockRunPhase = { at: number; running: boolean };

function MockSendButton({ running }: { running: boolean }) {
  return running ? (
    <span className="rhb-send is-stop">
      <StopSquareIcon className="rhb-stop-ic" />
    </span>
  ) : (
    <span className="rhb-send">
      <ReturnIcon className="rhb-send-ic" />
    </span>
  );
}

export function MockComposer({
  input,
  model = "Opus 5.5",
  modelIcon: ModelIcon = ClaudeIcon,
  reasoning = "Medium",
  project = null,
  environment,
  branch,
  access = "Full Access",
  running = false,
  className,
}: {
  input: ReactNode;
  model?: string;
  modelIcon?: MockIcon;
  reasoning?: string | null;
  project?: string | null;
  environment?: string;
  branch?: string | null;
  access?: string;
  running?: boolean | MockRunPhase[];
  className?: string;
}) {
  const env = environment ?? (project ? "Worktree" : "Personal workspace");
  const checkout = branch === undefined ? (project ? "main" : null) : branch;
  const phases = typeof running === "boolean" ? null : running;
  return (
    <div className={className ? `rhb-dock-wrap ${className}` : "rhb-dock-wrap"}>
      <div className="rhb-box">
        <div className="rhb-input">{input}</div>
        <div className="rhb-box-row">
          <PlusIcon className="rhb-ic" />
          <span className="rhb-model">
            <ModelIcon className="rhb-model-ic" />
            <span className="rhb-model-name">{model}</span>
            {reasoning === null ? null : (
              <>
                {" "}
                <span className="rhb-model-sub">{reasoning}</span>
              </>
            )}
            <ChevronDown className="rhb-chev" />
          </span>
          <span className="rhb-box-end">
            <MicIcon className="rhb-ic" />
            {phases ? (
              <span
                className="rhb-send-track"
                key={phases.map((p) => p.at).join(" ")}
              >
                {phases.map((p, i) => (
                  <span
                    key={p.at}
                    style={{
                      animation: [
                        i > 0
                          ? `mock-phase-in 0.2s ease ${p.at}s backwards`
                          : "",
                        i < phases.length - 1
                          ? `mock-phase-out 0.01s linear ${phases[i + 1].at}s forwards`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(", "),
                    }}
                  >
                    <MockSendButton running={p.running} />
                  </span>
                ))}
              </span>
            ) : (
              <MockSendButton running={running === true} />
            )}
          </span>
        </div>
      </div>
      <div className="rhb-context">
        {project ? (
          <span className="rhb-ctx">
            <FolderIcon className="rhb-ctx-ic" />
            <span className="rhb-ctx-label">{project}</span>
          </span>
        ) : null}
        <span className="rhb-ctx">
          {project ? (
            <FolderGitIcon className="rhb-ctx-ic" />
          ) : (
            <FolderIcon className="rhb-ctx-ic" />
          )}
          <span className="rhb-ctx-label">{env}</span>
        </span>
        {checkout ? (
          <span className="rhb-ctx">
            <GitBranchIcon className="rhb-ctx-ic" />
            <span className="rhb-ctx-label">{checkout}</span>
          </span>
        ) : null}
        <span className="rhb-perm">
          {access}
          <ChevronDown className="rhb-chev" />
        </span>
      </div>
    </div>
  );
}

export type MockThreadStatusKind = "running" | "done" | "unread" | "waiting";

export function MockThreadStatus({ status }: { status: MockThreadStatusKind }) {
  return (
    <span className="tstatus" aria-hidden>
      {status === "running" ? (
        <Spinner className="trun" />
      ) : status === "waiting" ? (
        <CircleQuestionIcon className="twait" />
      ) : status === "unread" ? (
        <span className="tunread" />
      ) : null}
    </span>
  );
}

export function MockStatusTrack({
  phases,
}: {
  phases: { at: number; status: MockThreadStatusKind }[];
}) {
  return (
    <span
      className="rhb-status-track"
      key={phases.map((p) => `${p.at}:${p.status}`).join(" ")}
    >
      {phases.map((p, i) => (
        <span
          key={p.at}
          style={{
            animation: [
              i > 0 ? `mock-phase-in 0.25s ease ${p.at}s backwards` : "",
              i < phases.length - 1
                ? `mock-phase-out 0.25s ease ${phases[i + 1].at}s forwards`
                : "",
            ]
              .filter(Boolean)
              .join(", "),
          }}
        >
          <MockThreadStatus status={p.status} />
        </span>
      ))}
    </span>
  );
}

export function MockTurnHeader({
  worked,
  openAt = null,
}: {
  worked: string;
  openAt?: string | null;
}) {
  return (
    <div
      className={openAt == null ? "rhb-turn-head" : "rhb-turn-head is-opening"}
      style={openAt == null ? undefined : { animationDelay: openAt }}
    >
      <div className="rhb-turn">
        <span className="rhb-turn-label">Worked for</span>
        <span className="rhb-dur">{worked}</span>
        <ChevronRight className="rhb-chev" />
      </div>
    </div>
  );
}

export function MockWorkingRow({
  at = "0s",
  endAt = null,
}: {
  at?: string;
  endAt?: string | null;
}) {
  return (
    <div
      className={endAt == null ? "rhb-working" : "rhb-working is-ending"}
      style={{ animationDelay: endAt == null ? at : `${at}, ${endAt}` }}
    >
      <span className="rhb-working-label rhb-shimmer-text">Working...</span>
    </div>
  );
}

export function MockThreadPill({ label }: { icon?: MockIcon; label: string }) {
  return (
    <span className="rhb-pill">
      <UserRoundIcon className="rhb-pill-ic" />
      <span className="rhb-pill-text">{label}</span>
    </span>
  );
}

export function MockChildEvent({
  kind,
  thread,
  body,
  className,
  style,
}: {
  kind: "finished" | "sent" | "message";
  thread: { icon?: MockIcon; label: string };
  body: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className ? `rhb-gen ${className}` : "rhb-gen"}
      style={style}
    >
      <span className="rhb-gen-head">
        {kind === "finished" ? (
          <>
            <CircleCheckIcon className="rhb-gen-ic" />
            <span className="rhb-gen-subject">{thread.label}</span>
            <span className="rhb-gen-verb">finished</span>
          </>
        ) : (
          <>
            {kind === "sent" ? (
              <PaperPlane className="rhb-gen-ic" />
            ) : (
              <MessageIcon className="rhb-gen-ic" />
            )}
            <span className="rhb-gen-verb">
              {kind === "sent" ? "Sent to" : "Message from"}
            </span>
            <MockThreadPill label={thread.label} />
          </>
        )}
      </span>
      <span className="rhb-gen-body">{body}</span>
    </div>
  );
}

export const MOCK_FOLD_MS = 900;
export const MOCK_FOLD_EASE = "cubic-bezier(0.45, 0, 0.2, 1)";
export const MOCK_ROW_GROW_MS = 550;
export const MOCK_BLOCK_MS = 650;
export const MOCK_BLOCK_MS_PER_PX = 5;
export const MOCK_BLOCK_MAX_MS = 1200;
const MOCK_BLOCK_ROWS =
  ".rhb-chart, .rhb-fix-card, .rhb-gen, .rhb-wait, .rhb-spawn";

export function mockBlockMs(heightPx: number) {
  return Math.min(
    MOCK_BLOCK_MAX_MS,
    Math.max(MOCK_BLOCK_MS, Math.round(heightPx * MOCK_BLOCK_MS_PER_PX)),
  );
}
export const MOCK_ROW_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
export const MOCK_PANEL_OPEN_MS = 900;
export const MOCK_PANEL_EASE = "cubic-bezier(0.45, 0, 0.2, 1)";
export const MOCK_SLIDE_MS = 1400;
export const MOCK_GLIDE_RATE = 0.02;
export const MOCK_PACE_S = 1.1;
export const MOCK_CHILD_REPORT_PAUSE_S = 2.5;
export const MOCK_FIRST_ROW_S = 1.3;
export const MOCK_THREAD_OPEN_S = 0.55;
export const MOCK_WORKING_AFTER_PROMPT_S = 0.35;
export const MOCK_HEAD_AFTER_PROMPT_S = 0.4;
export const MOCK_TURN_GAP_S = 0.9;
export const MOCK_BEAT_S = 0.3;
export const MOCK_FOLD_BEAT_S = 0.6;
export const MOCK_FOLLOW_UP_PAUSE_S = 2.2;
export const MOCK_CLICK_LEAD_S = 1;
export const MOCK_CLICK_GAP_S = 1.8;
export const MOCK_KID_AFTER_CLICK_S = 0.75;
export const MOCK_CURSOR_LEAD_S = 0.7;
export const MOCK_MUTE_AFTER_S = 0.35;
export const MOCK_MUTE_S = 0.35;
export const MOCK_SWAP_S = 0.3;
export const MOCK_RAIL_DELAY_S = 0.25;
export const MOCK_RAIL_IN_S = 0.4;
export const MOCK_TYPE_CHAR_S = 0.065;
export const MOCK_BAR_DELAY_S = 0.45;
export const MOCK_BAR_STAGGER_S = 0.06;
export const MOCK_SCENE_HOLD_S = 1.7;
export const MOCK_SCENE_HOLD_SHORT_S = 1.4;
export const MOCK_SCENE_REST_S = MOCK_PACE_S;
export const MOCK_SCENE_REST_AFTER_CLOSE_S = 1.4;
export const MOCK_FINAL_HOLD_S = 3.2;
export const MOCK_LOOP_PRELOAD_S = 1.1;
export const MOCK_RESTART_FADE_S = 0.7;
export const MOCK_LOOP_IDLE_S = 3.7;
export const MOCK_SIDEBAR_LAG_S = 1.04;
export const MOCK_STATUS_LEAD_S = 0.72;
export const MOCK_WAIT_DONE_LEAD_S = 0.26;
export const MOCK_TOAST_AFTER_S = 0.8;
export const MOCK_TIMER_AFTER_S = 1;
export const MOCK_TEST_RUN_S = 3.5;
export const MOCK_LOOP_FADE_MS = 800;
export const MOCK_LOOP_SCROLL_BACK_MS = 2000;
export const MOCK_SLIDE_FIRST_HOLD_MS = 1050;
export const MOCK_SLIDE_HOLD_MS = 2200;
export const MOCK_SIDEBAR_SWAP_MS = 160;
export const MOCK_SIDEBAR_MOVE_MS = 420;
export const MOCK_CROSSFADE_IN_MS = 260;
export const MOCK_CROSSFADE_DELAY_MS = 150;
export const MOCK_CROSSFADE_OUT_MS = 150;
export const MOCK_GHOST_FADE_MS = 450;

export function mockGrowRow(
  el: HTMLElement,
  room: number,
  marginBottom = parseFloat(getComputedStyle(el).marginBottom) || 0,
): Animation {
  return mockAnimateFromNow(
    el,
    [
      {
        marginBottom: `${marginBottom - room}px`,
        clipPath: `inset(0 -100vw ${room}px -100vw)`,
      },
      {
        marginBottom: `${marginBottom}px`,
        clipPath: "inset(0 -100vw 0 -100vw)",
      },
    ],
    el.matches(MOCK_BLOCK_ROWS) ? mockBlockMs(room) : MOCK_ROW_GROW_MS,
  );
}

export function mockAnimateFromNow(
  el: HTMLElement,
  [first, last]: [Record<string, string>, Record<string, string>],
  duration = MOCK_ROW_GROW_MS,
  easing = MOCK_ROW_EASE,
): Animation {
  Object.assign(el.style, first);
  const anim = el.animate([first, last], {
    duration,
    easing,
  });
  const clear = () => {
    for (const key of Object.keys(first))
      el.style.removeProperty(
        key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
      );
  };
  anim.addEventListener("finish", clear);
  anim.addEventListener("cancel", clear);
  return anim;
}

export function MockTurnFold({
  revealAt = "0s",
  foldAt = null,
  children,
}: {
  revealAt?: string;
  foldAt?: string | null;
  children: ReactNode;
}) {
  return (
    <div
      className={foldAt == null ? "rhb-turn-fold" : "rhb-turn-fold is-furling"}
      style={{
        animationDelay: foldAt == null ? revealAt : `${revealAt}, ${foldAt}`,
      }}
    >
      <div className="rhb-turn-body">{children}</div>
    </div>
  );
}
