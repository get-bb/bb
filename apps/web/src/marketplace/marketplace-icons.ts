import AiContentGenerator01Icon from "@hugeicons/core-free-icons/AiContentGenerator01Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import Archive03Icon from "@hugeicons/core-free-icons/Archive03Icon";
import ArrowReloadHorizontalIcon from "@hugeicons/core-free-icons/ArrowReloadHorizontalIcon";
import AudioWave01Icon from "@hugeicons/core-free-icons/AudioWave01Icon";
import BellDotIcon from "@hugeicons/core-free-icons/BellDotIcon";
import Book02Icon from "@hugeicons/core-free-icons/Book02Icon";
import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import BrowserIcon from "@hugeicons/core-free-icons/BrowserIcon";
import Calendar03Icon from "@hugeicons/core-free-icons/Calendar03Icon";
import ChartColumnIcon from "@hugeicons/core-free-icons/ChartColumnIcon";
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CloudIcon from "@hugeicons/core-free-icons/CloudIcon";
import Coffee02Icon from "@hugeicons/core-free-icons/Coffee02Icon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Database01Icon from "@hugeicons/core-free-icons/Database01Icon";
import Edit04Icon from "@hugeicons/core-free-icons/Edit04Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Folder02Icon from "@hugeicons/core-free-icons/Folder02Icon";
import FolderGitTwoIcon from "@hugeicons/core-free-icons/FolderGit2Icon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import GridViewIcon from "@hugeicons/core-free-icons/GridViewIcon";
import InternetIcon from "@hugeicons/core-free-icons/InternetIcon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import LimitationIcon from "@hugeicons/core-free-icons/LimitationIcon";
import ListViewIcon from "@hugeicons/core-free-icons/ListViewIcon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Mail02Icon from "@hugeicons/core-free-icons/Mail02Icon";
import MessageQuestionIcon from "@hugeicons/core-free-icons/MessageQuestionIcon";
import PaintBoardIcon from "@hugeicons/core-free-icons/PaintBoardIcon";
import PuzzleIcon from "@hugeicons/core-free-icons/PuzzleIcon";
import RepeatIcon from "@hugeicons/core-free-icons/RepeatIcon";
import SentIcon from "@hugeicons/core-free-icons/SentIcon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import SourceCodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon";
import UserSwitchIcon from "@hugeicons/core-free-icons/UserSwitchIcon";
import WorkflowCircle03Icon from "@hugeicons/core-free-icons/WorkflowCircle03Icon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import ZoomInAreaIcon from "@hugeicons/core-free-icons/ZoomInAreaIcon";
import type { IconSvgElement } from "@hugeicons/react";

const PLUGIN_ICONS: Readonly<Record<string, IconSvgElement | undefined>> = {
  AiContentGenerator01: AiContentGenerator01Icon,
  AlertCircle: AlertCircleIcon,
  AppWindow: BrowserIcon,
  Archive: Archive03Icon,
  ArrowReloadHorizontal: ArrowReloadHorizontalIcon,
  AudioLines: AudioWave01Icon,
  BellDot: BellDotIcon,
  Brain: BrainIcon,
  Calendar: Calendar03Icon,
  ChartColumn: ChartColumnIcon,
  ClipboardCheck: CheckListIcon,
  Clock: Clock01Icon,
  Cloud: CloudIcon,
  Code: SourceCodeIcon,
  Coffee: Coffee02Icon,
  Copy: Copy01Icon,
  Database: Database01Icon,
  EditFile: Edit04Icon,
  Explore: Book02Icon,
  FileText: File01Icon,
  FolderGit: FolderGitTwoIcon,
  FolderOpen: Folder02Icon,
  GitBranch: GitBranchIcon,
  Github: GithubIcon,
  Globe: InternetIcon,
  GridView: GridViewIcon,
  Layers: Layers01Icon,
  Limitation: LimitationIcon,
  ListTodo: CheckListIcon,
  ListView: ListViewIcon,
  Lock: LockIcon,
  Mail: Mail02Icon,
  MessageQuestion: MessageQuestionIcon,
  Palette: PaintBoardIcon,
  PanelLeft: SidebarLeftIcon,
  Puzzle: PuzzleIcon,
  Repeat: RepeatIcon,
  SlidersHorizontal: SlidersHorizontalIcon,
  SideChat: SentIcon,
  Smartphone: SmartPhone01Icon,
  Terminal: ComputerTerminal01Icon,
  UserSwitch: UserSwitchIcon,
  Workflow: WorkflowCircle03Icon,
  Zap: ZapIcon,
  ZoomIn: ZoomInAreaIcon,
};

export function marketplacePluginIcon(name: string): IconSvgElement {
  return PLUGIN_ICONS[name] ?? PuzzleIcon;
}
