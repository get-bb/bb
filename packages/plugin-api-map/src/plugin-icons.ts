import {
  ArrowDataTransferHorizontalIcon,
  ArrowReloadHorizontalIcon,
  BellDotIcon,
  BrainIcon,
  BrowserIcon,
  CheckListIcon,
  Calendar03Icon,
  ChartColumnIcon,
  Clock01Icon,
  Coffee02Icon,
  ComputerIcon,
  DatabaseIcon,
  Edit04Icon,
  File01Icon,
  GithubIcon,
  FolderIcon,
  FolderGitTwoIcon,
  InternetIcon,
  LaptopIcon,
  Layers01Icon,
  LimitationIcon,
  LockIcon,
  MessageAdd02Icon,
  MessageQuestionIcon,
  RepeatIcon,
  SmartPhone01Icon,
  SourceCodeIcon,
  SparklesIcon,
  ComputerTerminal01Icon,
  TestTubeIcon,
  WorkflowCircle03Icon,
  Activity03Icon,
} from "@hugeicons/core-free-icons";
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
