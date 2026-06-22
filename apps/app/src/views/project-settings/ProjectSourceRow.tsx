import { type LocalPathProjectSource, type ProjectSource } from "@bb/domain";
import { Icon } from "@/components/ui/icon.js";
import { SettingsRow } from "@/components/ui/settings-section.js";
import { Pill } from "@/components/ui/pill.js";
import { PersistentHostIconName } from "@/lib/host-display";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";

interface ProjectSourceRowProps {
  source: ProjectSource;
  canEditLocalPath: boolean;
  isLocalPathInvalid: boolean;
  isEditPending: boolean;
  isOnlySource: boolean;
  onEditLocalPath: (source: LocalPathProjectSource) => void;
  onRemove: (source: ProjectSource) => void;
}

export function ProjectSourceRow({
  source,
  canEditLocalPath,
  isLocalPathInvalid,
  isEditPending,
  isOnlySource,
  onEditLocalPath,
  onRemove,
}: ProjectSourceRowProps) {
  return (
    <SettingsRow>
      <Icon
        name={PersistentHostIconName}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 flex-shrink truncate">{source.path}</span>
        {isLocalPathInvalid ? (
          <Pill variant="destructive">Invalid local path</Pill>
        ) : null}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 data-[state=open]:bg-state-active data-[state=open]:text-foreground"
            aria-label="Source actions"
          >
            <Icon name="MoreHorizontal" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {canEditLocalPath ? (
            <DropdownMenuItem
              disabled={isEditPending}
              onSelect={() => {
                onEditLocalPath(source);
              }}
            >
              Edit local path
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={isOnlySource}
            onSelect={() => onRemove(source)}
          >
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsRow>
  );
}
