import { useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type { WorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";

type ChangedFilesBucketKind = WorkspaceChangedFilesSection["kind"];

export interface ChangedFilesBucketSelection {
  activeSection: WorkspaceChangedFilesSection | undefined;
  selectKind: (kind: ChangedFilesBucketKind) => void;
}

export function useChangedFilesBucket(
  sections: readonly WorkspaceChangedFilesSection[],
): ChangedFilesBucketSelection {
  const [selectedKind, setSelectedKind] =
    useState<ChangedFilesBucketKind | null>(null);
  return {
    activeSection:
      sections.find((section) => section.kind === selectedKind) ?? sections[0],
    selectKind: setSelectedKind,
  };
}

interface ChangedFilesBucketMenuProps {
  sections: readonly WorkspaceChangedFilesSection[];
  activeSection: WorkspaceChangedFilesSection;
  onSelect: (kind: ChangedFilesBucketKind) => void;
  trigger: ReactNode;
}

export function ChangedFilesBucketMenu({
  sections,
  activeSection,
  onSelect,
  trigger,
}: ChangedFilesBucketMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {sections.map((option) => (
          <DropdownMenuItem
            key={option.kind}
            onSelect={() => onSelect(option.kind)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">{option.label}</span>
            <Icon
              name="Check"
              className={cn(
                "size-3.5 shrink-0",
                option.kind === activeSection.kind
                  ? "opacity-100"
                  : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
