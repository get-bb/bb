import type { ReactNode } from "react";
import type { WorkspaceFilePreviewStatusLabel } from "@/lib/file-preview";

/**
 * A single file/app tab rendered in the secondary panel's scrolling tab strip.
 */
export interface SecondaryPanelFileTab {
  id: string;
  filename: string;
  isActive: boolean;
  isPinned?: boolean;
  leadingVisual?: ReactNode;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
  onSelect: () => void;
  onClose: () => void;
}
