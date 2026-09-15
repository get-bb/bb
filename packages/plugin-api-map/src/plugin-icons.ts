import ArrowDataTransferHorizontalIcon from "@hugeicons/core-free-icons/ArrowDataTransferHorizontalIcon";
import ArrowReloadHorizontalIcon from "@hugeicons/core-free-icons/ArrowReloadHorizontalIcon";
import BellDotIcon from "@hugeicons/core-free-icons/BellDotIcon";
import BrainIcon from "@hugeicons/core-free-icons/BrainIcon";
import BrowserIcon from "@hugeicons/core-free-icons/BrowserIcon";
import CheckListIcon from "@hugeicons/core-free-icons/CheckListIcon";
import Calendar03Icon from "@hugeicons/core-free-icons/Calendar03Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import ChartColumnIcon from "@hugeicons/core-free-icons/ChartColumnIcon";
import Coffee02Icon from "@hugeicons/core-free-icons/Coffee02Icon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import DatabaseIcon from "@hugeicons/core-free-icons/DatabaseIcon";
import Edit04Icon from "@hugeicons/core-free-icons/Edit04Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
import FolderGitTwoIcon from "@hugeicons/core-free-icons/FolderGit2Icon";
import InternetIcon from "@hugeicons/core-free-icons/InternetIcon";
import LaptopIcon from "@hugeicons/core-free-icons/LaptopIcon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import LimitationIcon from "@hugeicons/core-free-icons/LimitationIcon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import MessageAdd02Icon from "@hugeicons/core-free-icons/MessageAdd02Icon";
import MessageQuestionIcon from "@hugeicons/core-free-icons/MessageQuestionIcon";
import RepeatIcon from "@hugeicons/core-free-icons/RepeatIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import SourceCodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import TestTubeIcon from "@hugeicons/core-free-icons/TestTubeIcon";
import WorkflowCircle03Icon from "@hugeicons/core-free-icons/WorkflowCircle03Icon";
import Activity03Icon from "@hugeicons/core-free-icons/Activity03Icon";
import type { IconSvgElement } from "@hugeicons/react";

interface FirstPartyPlugin {
  id: string;
  icon?: IconSvgElement;
}

const FIRST_PARTY_PLUGINS: Record<string, FirstPartyPlugin> = {
  "Account Pooler [Experimental]": { id: "account-pool", icon: Layers01Icon },
  "Ask User Question": { id: "ask-user-question", icon: MessageQuestionIcon },
  Automations: { id: "automations", icon: RepeatIcon },
  "Browser Automation": { id: "browser-automation", icon: InternetIcon },
  "Concurrency limit": { id: "concurrency-limit", icon: LimitationIcon },
  "Custom instructions": { id: "custom-instructions", icon: Edit04Icon },
  Docs: { id: "simple-notes", icon: File01Icon },
  Drafts: { id: "drafts", icon: Edit04Icon },
  "File Editor": { id: "monaco-editor", icon: SourceCodeIcon },
  GitHub: { id: "github", icon: GithubIcon },
  "Inline visualizations": { id: "inline-vis", icon: BrowserIcon },
  "Keep Awake": { id: "keep-awake", icon: Coffee02Icon },
  Memory: { id: "memory", icon: BrainIcon },
  "Modal Sandbox [Experimental]": { id: "environment-modal-sandbox" },
  "Personal workspace": {
    id: "environment-personal-workspace",
    icon: FolderIcon,
  },
  "Project checkout": { id: "environment-project-checkout", icon: LaptopIcon },
  "Provider usage": { id: "provider-usage", icon: ChartColumnIcon },
  "Provider retry": { id: "provider-retry", icon: ArrowReloadHorizontalIcon },
  "Provider usage": { id: "provider-usage", icon: ChartColumnIcon },
  "Push notifications": { id: "push-notifications", icon: BellDotIcon },
  "Remote access": { id: "connect", icon: SmartPhone01Icon },
  Secrets: { id: "secrets", icon: LockIcon },
  "Send later": { id: "scheduled-send", icon: Calendar03Icon },
  "Side chat": { id: "side-chat", icon: MessageAdd02Icon },
  Tasks: { id: "tasks", icon: CheckListIcon },
  Workflows: { id: "workflows", icon: WorkflowCircle03Icon },
  Worktree: { id: "environment-git-worktree", icon: FolderGitTwoIcon },
  "ACP providers": { id: "provider-acp" },
  "Claude Code provider": { id: "provider-claude-code" },
  "Codex provider": { id: "provider-codex" },
  "Pi provider": { id: "provider-pi" },
};

export function pluginIcon(displayName: string): IconSvgElement | null {
  return FIRST_PARTY_PLUGINS[displayName]?.icon ?? null;
}

export function firstPartyPluginId(displayName: string): string | null {
  return FIRST_PARTY_PLUGINS[displayName]?.id ?? null;
}

const SURFACE_ICONS: Record<string, IconSvgElement> = {
  cli: ComputerTerminal01Icon,
  "agent-tools": SparklesIcon,
  background: Clock01Icon,
  wire: ArrowDataTransferHorizontalIcon,
  storage: DatabaseIcon,
  "thread-events": Activity03Icon,
  "host-workers": ComputerIcon,
  "bb-sdk": SourceCodeIcon,
  "host-components": Layers01Icon,
  testing: TestTubeIcon,
};

export function surfaceIcon(surfaceId: string): IconSvgElement | null {
  return SURFACE_ICONS[surfaceId] ?? null;
}
