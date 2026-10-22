import type { ComponentType, ReactNode } from "react";
import type {
  ComposerAttachment,
  ExperimentalComposerContributions,
  ExperimentalComposerPendingUpload,
  ExperimentalComposerPromptAction,
} from "@get-bb/plugin-sdk";
import { composerPluginModule } from "./composer-plugin";

interface PromptBoxActionsMenuProps {
  actions?: readonly ExperimentalComposerPromptAction[];
  onAttach?: () => void;
  onAction: (action: ExperimentalComposerPromptAction) => void;
  plugins?: Pick<
    ExperimentalComposerContributions,
    "plusMenuItems" | "MenuEntry"
  >;
}

interface ComposerSendMenuProps {
  children: ReactNode;
  isPointerCoarse: boolean;
  modifierKind: "send" | "queue" | "steer" | null;
  hasInput: boolean;
  canSubmit: boolean;
  onSubmit: (() => void) | undefined;
}

interface AttachmentPreviewProps {
  attachments: readonly ComposerAttachment[];
  pendingUploads?: readonly ExperimentalComposerPendingUpload[];
  compact?: boolean;
  attachmentProjectId?: string;
  expandedImageIndex: number | null;
  onExpandedImageIndexChange: (index: number | null) => void;
  onRemoveAttachment?: (path: string) => void;
}

export function loadComposerMenus() {
  return Promise.all([
    composerPluginModule<{
      PromptBoxActionsMenu: ComponentType<PromptBoxActionsMenuProps>;
      ComposerPlusMenuSlot: ComponentType<
        Omit<PromptBoxActionsMenuProps, "plugins">
      >;
    }>("PromptBoxActionsMenu.tsx"),
    composerPluginModule<{
      ComposerSendMenu: ComponentType<ComposerSendMenuProps>;
    }>("ComposerSendMenu.tsx"),
  ]).then(([actions, send]) => ({ ...actions, ...send }));
}

export async function loadAttachmentPreview() {
  return (
    await composerPluginModule<{
      AttachmentPreview: ComponentType<AttachmentPreviewProps>;
    }>("AttachmentPreview.tsx")
  ).AttachmentPreview;
}
