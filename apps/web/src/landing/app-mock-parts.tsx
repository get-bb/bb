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
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import CornerDownLeftIcon from "@hugeicons/core-free-icons/CornerDownLeftIcon";
import Edit04Icon from "@hugeicons/core-free-icons/Edit04Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import FileCodeIcon from "@hugeicons/core-free-icons/FileCodeIcon";
import FileEditIcon from "@hugeicons/core-free-icons/FileEditIcon";
import FlaskConicalIcon from "@hugeicons/core-free-icons/FlaskConicalIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import FolderGit2Icon from "@hugeicons/core-free-icons/FolderGit2Icon";
import GitBranchGlyph from "@hugeicons/core-free-icons/GitBranchIcon";
import GitMergeGlyph from "@hugeicons/core-free-icons/GitMergeIcon";
import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
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
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useEffect } from "react";
import type { ReactNode, RefObject } from "react";

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
const SkillsIcon = glyph(ZapIcon);
const AutomationsIcon = glyph(RepeatIcon);
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
export const SendIcon = glyph(ArrowMoveDownLeftIcon);
export const LaptopGlyph = glyph(LaptopIcon);
export const FileDiffIcon = glyph(PlusMinusSquare01Icon);
export const FileCodeGlyph = glyph(FileCodeIcon);
export const CloseIcon = glyph(Cancel01Icon);
export const TerminalIcon = glyph(CommandLineIcon);
export const FileEditGlyph = glyph(FileEditIcon);
export const PinGlyph = glyph(PinIcon);
export const TestIcon = glyph(FlaskConicalIcon);
export const MessageIcon = glyph(Message01Icon);
export const SubagentIcon = glyph(UserAdd01Icon);
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
