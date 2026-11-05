import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowExpand01Icon from "@hugeicons/core-free-icons/ArrowExpand01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowMoveDownLeftIcon from "@hugeicons/core-free-icons/ArrowMoveDownLeftIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import AttachmentIcon from "@hugeicons/core-free-icons/AttachmentIcon";
import BookOpen01Icon from "@hugeicons/core-free-icons/BookOpen01Icon";
import BubbleChatAddIcon from "@hugeicons/core-free-icons/BubbleChatAddIcon";
import Bug01Icon from "@hugeicons/core-free-icons/Bug01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CommandLineIcon from "@hugeicons/core-free-icons/CommandLineIcon";
import CornerDownLeftIcon from "@hugeicons/core-free-icons/CornerDownLeftIcon";
import FileCodeIcon from "@hugeicons/core-free-icons/FileCodeIcon";
import FileEditIcon from "@hugeicons/core-free-icons/FileEditIcon";
import FlaskConicalIcon from "@hugeicons/core-free-icons/FlaskConicalIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import FolderGit2Icon from "@hugeicons/core-free-icons/FolderGit2Icon";
import GitBranchGlyph from "@hugeicons/core-free-icons/GitBranchIcon";
import GitMergeGlyph from "@hugeicons/core-free-icons/GitMergeIcon";
import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
import HelpCircleIcon from "@hugeicons/core-free-icons/HelpCircleIcon";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import MessageQuestionIcon from "@hugeicons/core-free-icons/MessageQuestionIcon";
import Mic02Icon from "@hugeicons/core-free-icons/Mic02Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import PinIcon from "@hugeicons/core-free-icons/PinIcon";
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

type IconProps = { className?: string };
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
export const BookIcon = glyph(BookOpen01Icon);
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
export const PullRequestIcon = glyph(GitPullRequestIcon);
export const Spinner = glyph(Loading03Icon);
export const Maximize2 = glyph(ArrowExpand01Icon);
export const MicIcon = glyph(Mic02Icon);
const SendIcon = glyph(ArrowMoveDownLeftIcon);
export const LaptopGlyph = glyph(LaptopIcon);
export const FileDiffIcon = glyph(PlusMinusSquare01Icon);
export const FileCodeGlyph = glyph(FileCodeIcon);
export const CloseIcon = glyph(Cancel01Icon);
export const TerminalIcon = glyph(CommandLineIcon);
export const FileEditGlyph = glyph(FileEditIcon);
export const PinGlyph = glyph(PinIcon);
export const TestIcon = glyph(FlaskConicalIcon);
export const MessageIcon = glyph(Message01Icon);

export type ThreadState = "running" | "done" | "waiting";

function StatusGlyph({ status }: { status: ThreadState | "unread" }) {
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

type NavLabel = (typeof NAV_ITEMS)[number]["label"];

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

export function useFitMock(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const mock = ref.current;
    const wrap = mock?.parentElement;
    if (!mock || !wrap) {
      return;
    }
    const fit = () => {
      const wrapStyle = getComputedStyle(wrap);
      const visibleWidth = Number.parseFloat(
        getComputedStyle(mock).getPropertyValue("--mock-visible-width"),
      );
      if (!visibleWidth) {
        mock.style.removeProperty("--mock-scale");
        return;
      }
      const slice =
        wrap.clientWidth -
        Number.parseFloat(wrapStyle.paddingLeft) -
        Number.parseFloat(wrapStyle.paddingRight);
      mock.style.setProperty("--mock-scale", String(slice / visibleWidth));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [ref]);
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
      {children}
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
  reasoning?: string;
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
            <ClaudeIcon className="rhb-model-ic" />
            <span className="rhb-model-name">{model}</span>{" "}
            <span className="rhb-model-sub">{reasoning}</span>
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
            {project}
          </span>
        ) : null}
        <span className="rhb-ctx">
          {project ? (
            <FolderGitIcon className="rhb-ctx-ic" />
          ) : (
            <FolderIcon className="rhb-ctx-ic" />
          )}
          {env}
        </span>
        {checkout ? (
          <span className="rhb-ctx">
            <GitBranchIcon className="rhb-ctx-ic" />
            {checkout}
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
