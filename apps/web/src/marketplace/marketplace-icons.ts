import AiContentGenerator01Icon from "@hugeicons/core-free-icons/AiContentGenerator01Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import Archive03Icon from "@hugeicons/core-free-icons/Archive03Icon";
import AudioWave01Icon from "@hugeicons/core-free-icons/AudioWave01Icon";
import ChartColumnIcon from "@hugeicons/core-free-icons/ChartColumnIcon";
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import CloudIcon from "@hugeicons/core-free-icons/CloudIcon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Database01Icon from "@hugeicons/core-free-icons/Database01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Folder02Icon from "@hugeicons/core-free-icons/Folder02Icon";
import FolderGitTwoIcon from "@hugeicons/core-free-icons/FolderGit2Icon";
import GitBranchIcon from "@hugeicons/core-free-icons/GitBranchIcon";
import GridViewIcon from "@hugeicons/core-free-icons/GridViewIcon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Mail02Icon from "@hugeicons/core-free-icons/Mail02Icon";
import PuzzleIcon from "@hugeicons/core-free-icons/PuzzleIcon";
import SentIcon from "@hugeicons/core-free-icons/SentIcon";
import SidebarLeftIcon from "@hugeicons/core-free-icons/SidebarLeftIcon";
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import UserSwitchIcon from "@hugeicons/core-free-icons/UserSwitchIcon";
import WorkflowCircle03Icon from "@hugeicons/core-free-icons/WorkflowCircle03Icon";
import ZapIcon from "@hugeicons/core-free-icons/ZapIcon";
import ZoomInAreaIcon from "@hugeicons/core-free-icons/ZoomInAreaIcon";
import type { IconSvgElement } from "@hugeicons/react";

const PLUGIN_ICONS: Readonly<Record<string, IconSvgElement | undefined>> = {
  AiContentGenerator01: AiContentGenerator01Icon,
  AlertCircle: AlertCircleIcon,
  Archive: Archive03Icon,
  AudioLines: AudioWave01Icon,
  ChartColumn: ChartColumnIcon,
  ClipboardCheck: CheckListIcon,
  Clock: Clock01Icon,
  Cloud: CloudIcon,
  Copy: Copy01Icon,
  Database: Database01Icon,
  FileText: File01Icon,
  FolderGit: FolderGitTwoIcon,
  FolderOpen: Folder02Icon,
  GitBranch: GitBranchIcon,
  GridView: GridViewIcon,
  Layers: Layers01Icon,
  Lock: LockIcon,
  Mail: Mail02Icon,
  PanelLeft: SidebarLeftIcon,
  Puzzle: PuzzleIcon,
  SlidersHorizontal: SlidersHorizontalIcon,
  SideChat: SentIcon,
  Terminal: ComputerTerminal01Icon,
  UserSwitch: UserSwitchIcon,
  Workflow: WorkflowCircle03Icon,
  Zap: ZapIcon,
  ZoomIn: ZoomInAreaIcon,
};

export function marketplacePluginIcon(name: string): IconSvgElement {
  return PLUGIN_ICONS[name] ?? PuzzleIcon;
}
