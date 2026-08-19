import { Icon, ICON_NAMES, type IconName } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "ui/Icon",
};

const USAGE: Partial<Record<IconName, string>> = {
  AlertCircle: "Dialog warning state",
  AlertTriangle: "“Project folder not found” indicator on sidebar project rows",
  AlignLeft: "Left-aligned menu",
  AppWindow: "Right-panel app fallback and HTML/mockup file visual",
  Archive: "Archived threads settings navigation and archived-thread banner",
  ArchiveRestore: "Unarchive button on archived threads",
  ArrowDown: "Scroll-to-bottom button when conversation is scrolled up",
  ArrowRight: "Rename arrow in diff file headers (old → new)",
  ArrowUp: "Submit prompt button",
  Beaker: "Experiments section in Settings navigation",
  Bug: "Report a bug link in sidebar footer",
  Check:
    "Selected item in pickers/menus, CopyButton confirmation, completed todo",
  ChartColumn: "Right-panel report file visual",
  ChevronDown:
    "Picker/dropdown trigger, section toggle headers, child-thread indent glyph",
  ChevronLeft: "Image lightbox previous",
  ChevronRight:
    "Sidebar row collapsed-state glyph, breadcrumb separator, lightbox next, submenu indicator",
  ChevronUp: "“Load older messages” button",
  ChevronsDown: "Git diff toolbar collapse-all",
  ChevronsUp: "Git diff toolbar expand-all",
  Circle: "Radio item indicator in menus",
  CircleCheck: "Auth callback success state",
  CircleQuestion: "Thread needs user input and timeline question rows",
  CircleX: "Auth callback failure state",
  ClosePluginPane: "Close a split pane containing a plugin surface",
  CloseThreadPane: "Close an existing or empty thread split pane",
  Clock: "Thread duration and timestamp affordances, automation prompt action",
  Code: "Right-panel source file visual, Mermaid source toggle",
  Columns2: "Git diff toolbar “split view”",
  Copy: "CopyButton, metadata-value copy buttons",
  CornerDownLeft: "Mod+Enter submit hint in prompt footer",
  CornerDownRight:
    "Queued message indicator, steer/edit request label marker in conversation",
  Discord: "Join Discord link in Settings → Community",
  Github: "View on GitHub link in Settings → Community",
  Edit: "Rename project, edit queued message, edit project source",
  ExternalLink: "FilePathLink external indicator",
  File: "Right-panel markdown/doc file visual, Open file action",
  FileDiff: "Right panel diff tab, thread changes banner section",
  FileQuestion: "FilePreview empty state (passed via local iconName variable)",
  Folder: "EmptyState “no projects”, sidebar project row when collapsed",
  FolderOpen: "Sidebar project row when expanded",
  FolderPlus: "(currently unused — was Add local path in project actions menu)",
  GitBranch:
    "Worktree environment icon (resolved via environment-workspace helpers)",
  GitMerge: "Branch name display, branch picker selected/option glyph",
  GitPullRequest: "Available pull request glyph",
  GitPullRequestArrow: "Open pull request glyph",
  GitPullRequestClosed: "Closed pull request glyph",
  GitPullRequestDraft: "Draft pull request glyph",
  Info: "Right panel “thread info” tab, informational banners",
  Laptop: "Persistent host icon (resolved via getHostIconName)",
  ListTodo: "Plan prompt action, todo prompt-stack card header",
  Loading: "Loading03 thread row working spinner",
  Mail: "Mark unread thread action",
  MailOpen: "Mark read thread action",
  Maximize2: "Expand right panel, enter zen mode, open Mermaid diagram dialog",
  MessageSquarePlus: "“New chat” button in sidebar",
  Mic: "Voice toggle in prompt",
  Minimize2: "Restore conversation split, exit zen mode",
  MoreHorizontal:
    "Triple-dot actions menu trigger (project list, projects, threads, project sources, hosts)",
  NewTab: "Right-panel New tab tab",
  PanelBottom: "Available built-in app icon",
  PanelLeft: "Sidebar toggle on every viewport",
  PanelRight:
    "Toggle right panel (desktop / non-drawer; resolved via togglePanelIconName)",
  Paperclip: "Attach files button",
  Pin: "Pin thread action",
  PinOff: "Unpin thread action",
  Plus: "New host button, new terminal button, “new branch” option in branch picker",
  Repeat: "Automation prompt action",
  RotateCcw:
    "Retry button when fetching timeline turn details fails, reset Mermaid diagram view",
  Rows2: "Git diff toolbar “unified view”",
  Search: "Picker search inputs, file tree search, branch picker filter",
  Settings: "Settings link in sidebar, project settings link in header",
  Spinner: "All loading / pending states",
  Square: "Stop button while running, in-progress and pending todo glyphs",
  TextWrap: "Line-wrap toggle for diff cards and source file previews",
  Trash2: "Delete queued message, remove project source",
  UserRound:
    "Thread mentions, parent-thread indicators, and active child-thread banner",
  UserRoundPlus: "unused legacy parent-action icon",
  Workflow: "Workflow card indicator in the prompt stack",
  X: "Close dialogs/drawers, clear search input, remove attachment, close metadata panel",
  Zap: "Fast-mode indicator in model picker trigger, Fast-mode toggle row",
  ZoomIn: "Mermaid diagram dialog zoom in",
  ZoomOut: "Mermaid diagram dialog zoom out",
};

const NAMES: readonly IconName[] = [...ICON_NAMES].sort();

function ExpandCollapseControl({
  icon,
  label,
}: {
  icon: "ClosePluginPane" | "CloseThreadPane" | "Maximize2" | "Minimize2";
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label}>
          <Icon name={icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ExpandCollapse() {
  return (
    <TooltipProvider>
      <StoryCard>
        <StoryRow
          label="Expand right panel"
          hint="outward corners; used before the panel fills the canvas"
        >
          <ExpandCollapseControl icon="Maximize2" label="Expand right panel" />
        </StoryRow>
        <StoryRow
          label="Restore conversation"
          hint="inward corners; used to return to the split layout"
        >
          <ExpandCollapseControl
            icon="Minimize2"
            label="Restore conversation"
          />
        </StoryRow>
        <StoryRow
          label="Close thread pane"
          hint="Hugeicons multiplication-square glyph; optically reduced in split headers"
        >
          <ExpandCollapseControl icon="CloseThreadPane" label="Close pane" />
        </StoryRow>
        <StoryRow
          label="Close plugin pane"
          hint="Hugeicons multiplication-square glyph; optically reduced in split headers"
        >
          <ExpandCollapseControl icon="ClosePluginPane" label="Close pane" />
        </StoryRow>
      </StoryCard>
    </TooltipProvider>
  );
}

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
