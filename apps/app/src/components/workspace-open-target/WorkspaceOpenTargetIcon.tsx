import type { WorkspaceOpenTargetId } from "@bb/host-daemon-contract";
import antigravityIcon from "@/assets/workspace-open-target-icons/antigravity.png";
import cursorIcon from "@/assets/workspace-open-target-icons/cursor.png";
import finderIcon from "@/assets/workspace-open-target-icons/finder.png";
import ghosttyIcon from "@/assets/workspace-open-target-icons/ghostty.png";
import iterm2Icon from "@/assets/workspace-open-target-icons/iterm2.png";
import sublimeTextIcon from "@/assets/workspace-open-target-icons/sublime-text.png";
import terminalIcon from "@/assets/workspace-open-target-icons/terminal.png";
import vscodeIcon from "@/assets/workspace-open-target-icons/vscode.png";
import windsurfIcon from "@/assets/workspace-open-target-icons/windsurf.png";
import xcodeIcon from "@/assets/workspace-open-target-icons/xcode.png";
import zedIcon from "@/assets/workspace-open-target-icons/zed.png";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

const WORKSPACE_OPEN_TARGET_ICONS: Record<
  Exclude<WorkspaceOpenTargetId, "default-app">,
  string
> = {
  antigravity: antigravityIcon,
  cursor: cursorIcon,
  finder: finderIcon,
  ghostty: ghosttyIcon,
  iterm2: iterm2Icon,
  "sublime-text": sublimeTextIcon,
  terminal: terminalIcon,
  vscode: vscodeIcon,
  windsurf: windsurfIcon,
  xcode: xcodeIcon,
  zed: zedIcon,
};

export interface WorkspaceOpenTargetIconProps {
  className?: string;
  targetId: WorkspaceOpenTargetId;
}

export function WorkspaceOpenTargetIcon({
  className = "size-4",
  targetId,
}: WorkspaceOpenTargetIconProps) {
  if (targetId === "default-app") {
    return (
      <span
        className={cn(
          className,
          "flex shrink-0 items-center justify-center text-muted-foreground",
        )}
      >
        <Icon name="ExternalLink" className="!size-3.5" aria-hidden />
      </span>
    );
  }

  return (
    <img
      alt=""
      className={cn(className, "shrink-0 rounded-sm")}
      draggable={false}
      src={WORKSPACE_OPEN_TARGET_ICONS[targetId]}
    />
  );
}
