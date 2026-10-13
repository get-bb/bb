import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

export type SaveIndicator = "clean" | "dirty" | "saving" | "error";

export interface NotesToolbarProps {
  path: string | null;
  indicator: SaveIndicator;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  wordWrap: boolean;
  onToggleWordWrap: () => void;
  onInsertToc: () => void;
  onReload: () => void;
  onSave: () => void;
  isReloading: boolean;
  canEdit: boolean;
}

export function NotesToolbar({
  path,
  indicator,
  isSidebarOpen,
  onToggleSidebar,
  wordWrap,
  onToggleWordWrap,
  onInsertToc,
  onReload,
  onSave,
  isReloading,
  canEdit,
}: NotesToolbarProps) {
  const isUnsaved = indicator === "dirty" || indicator === "error";
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 bg-surface-raised px-2">
      <ToolbarButton
        label={isSidebarOpen ? "Hide notes list" : "Show notes list"}
        icon="PanelLeft"
        onClick={onToggleSidebar}
        pressed={isSidebarOpen}
      />
      <span className="min-w-0 flex-1 truncate px-1 text-xs text-foreground/80">
        {path ?? "No note open"}
      </span>
      <SaveDot indicator={indicator} />
      {canEdit && isUnsaved ? (
        <button
          type="button"
          onClick={onSave}
          className="shrink-0 cursor-pointer rounded-sm px-2 py-0.5 text-xs font-medium text-foreground hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        >
          Save
        </button>
      ) : null}
      {canEdit ? (
        <>
          <ToolbarButton
            label="Insert or refresh table of contents"
            icon="AlignLeft"
            onClick={onInsertToc}
          />
          <ToolbarButton
            label={wordWrap ? "Turn off word wrap" : "Turn on word wrap"}
            icon="TextWrap"
            onClick={onToggleWordWrap}
            pressed={wordWrap}
          />
          <ToolbarButton
            label={isReloading ? "Reloading" : "Reload from disk"}
            icon="ArrowReloadHorizontal"
            onClick={onReload}
            disabled={isReloading}
            spin={isReloading}
          />
        </>
      ) : null}
    </div>
  );
}

function SaveDot({ indicator }: { indicator: SaveIndicator }) {
  if (indicator === "clean") {
    return <span className="size-4 shrink-0" aria-hidden />;
  }
  const label =
    indicator === "saving"
      ? "Saving…"
      : indicator === "error"
        ? "Could not save — unsaved changes"
        : "Unsaved changes";
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn(
        "size-2 shrink-0 rounded-full",
        indicator === "error" ? "bg-destructive" : "bg-foreground/50",
        indicator === "saving" && "animate-pulse",
      )}
    />
  );
}

function ToolbarButton({
  label,
  icon,
  onClick,
  pressed,
  disabled,
  spin,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-subtle-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        pressed === true && "bg-state-active text-foreground",
      )}
    >
      <Icon
        name={icon}
        className={cn("size-3.5", spin && "animate-spin")}
        aria-hidden
      />
    </button>
  );
}
