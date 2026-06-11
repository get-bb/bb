import { Icon, ICON_NAMES, type IconName } from "./icon";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "ui/Icon",
};

const USAGE: Partial<Record<IconName, string>> = {
  AlertCircle: "Dialog warning state",
  AlertTriangle: "“Project folder not found” indicator on sidebar project rows",
  AlignLeft: "Mobile/coarse-pointer sidebar toggle",
  AppWindow: "Right-panel app fallback and HTML/mockup file visual",
  Archive: "“Archived threads” header link, archived-thread banner",
  ArchiveRestore: "Unarchive button on archived threads",
  ArrowDown: "Scroll-to-bottom button when conversation is scrolled up",
  ArrowRight: "Rename arrow in diff file headers (old → new)",
  ArrowUp: "Submit prompt button",
  AudioLines: "Voice recording indicator (pulsing) and idle wave",
  Check:
    "Selected item in pickers/menus, CopyButton confirmation, completed todo",
  ChartColumn: "Right-panel report file visual",
  ChevronDown:
    "Picker/dropdown trigger, section toggle headers, child-thread indent glyph",
  ChevronLeft: "Image lightbox previous",
  ChevronRight:
    "Sidebar row collapsed-state glyph, breadcrumb separator, lightbox next, submenu indicator, replay-capture expand",
  ChevronUp: "“Load older messages” button",
  ChevronsDown: "Git diff toolbar collapse-all",
  ChevronsUp: "Git diff toolbar expand-all",
  Circle: "Radio item indicator in menus",
  CircleCheck: "Auth callback success state",
  CircleDashed: "Thread row busy spinner, child-thread busy section indicator",
  CircleX: "Auth callback failure state",
  Clock:
    "Automations nav button in sidebar, automation rows in Automations view",
  Code: "Right-panel source file visual",
  Columns2: "Git diff toolbar “split view”",
  Container: "Container icon",
  Copy: "CopyButton, metadata-value copy buttons",
  CornerDownLeft: "Mod+Enter submit hint in prompt footer",
  CornerDownRight:
    "Queued message indicator, steer/edit request label marker in conversation",
  Edit: "Rename project, edit queued message, edit project source",
  ExternalLink: "FilePathLink external indicator",
  File: "Right-panel markdown/doc file visual, Open file action",
  FileDiff: "Right panel diff tab, thread changes banner section",
  FileQuestion: "FilePreview empty state (passed via local iconName variable)",
  FileX2: "FilePreview missing-file state (passed via local iconName variable)",
  Folder: "EmptyState “no projects”, sidebar project row when collapsed",
  FolderOpen: "Sidebar project row when expanded",
  FolderPlus: "(currently unused — was Add local path in project actions menu)",
  GitBranch:
    "Worktree environment icon (resolved via environment-workspace helpers)",
  GitMerge: "Branch name display, branch picker selected/option glyph",
  Info: "Right panel “thread info” tab, replay list info banner",
  Laptop: "Persistent host icon (resolved via getHostIconName)",
  ListTodo: "Todo section header in prompt context banner",
  Maximize2: "Enter zen mode (prompt expand)",
  MessageSquarePlus: "“New chat” button in sidebar",
  Mic: "Voice toggle in prompt",
  Minimize2: "Exit zen mode (prompt collapse)",
  MoreHorizontal:
    "Triple-dot actions menu trigger (project list, projects, threads, project sources, hosts)",
  NewTab: "Right-panel New tab tab",
  PanelBottom: "Available built-in app icon",
  PanelLeft: "Sidebar toggle (desktop / fine pointer)",
  PanelRight:
    "Toggle right panel (desktop / non-drawer; resolved via togglePanelIconName)",
  Paperclip: "Attach files button",
  Plus: "New host button, new terminal button, “new branch” option in branch picker",
  RotateCcw: "Retry button when fetching timeline turn details fails",
  Rows2: "Git diff toolbar “unified view”",
  Search: "Picker search inputs, file tree search, branch picker filter",
  Settings: "App settings link in sidebar, project settings link in header",
  Spinner: "All loading / pending states",
  Square: "Stop button while running, in-progress and pending todo glyphs",
  Trash2: "Delete queued message, remove project source, delete replay capture",
  UserRound: "Parent-thread indicator in sidebar and prompt banner",
  UserRoundPlus: "unused legacy parent-action icon",
  X: "Close dialogs/drawers, clear search input, remove attachment, close metadata panel",
  Zap: "Fast-mode indicator in model picker trigger, Fast-mode toggle row",
};

const NAMES: readonly IconName[] = [...ICON_NAMES].sort();

export function Overview() {
  return (
    <StoryCard labelWidth="280px">
      {NAMES.map((name) => (
        <StoryRow key={name} label={name} hint={USAGE[name] ?? null}>
          <Icon name={name} className="size-5" />
        </StoryRow>
      ))}
    </StoryCard>
  );
}
