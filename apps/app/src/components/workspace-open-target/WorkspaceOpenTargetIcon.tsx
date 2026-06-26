import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetIcon as WorkspaceOpenTargetIconValue,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import antigravityIcon from "@/assets/workspace-open-target-icons/antigravity.png";
import cursorIcon from "@/assets/workspace-open-target-icons/cursor.png";
import finderIcon from "@/assets/workspace-open-target-icons/finder.png";
import ghosttyIcon from "@/assets/workspace-open-target-icons/ghostty.png";
import iterm2Icon from "@/assets/workspace-open-target-icons/iterm2.png";
import sublimeTextIcon from "@/assets/workspace-open-target-icons/sublime-text.png";
import terminalIcon from "@/assets/workspace-open-target-icons/terminal.png";
import vscodeIcon from "@/assets/workspace-open-target-icons/vscode.png";
import warpIcon from "@/assets/workspace-open-target-icons/warp.png";
import windsurfIcon from "@/assets/workspace-open-target-icons/windsurf.png";
import xcodeIcon from "@/assets/workspace-open-target-icons/xcode.png";
import zedIcon from "@/assets/workspace-open-target-icons/zed.png";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";
import { getWorkspaceOpenTargetFallbackIcon } from "./workspace-open-target-display";

const WORKSPACE_OPEN_TARGET_ICONS: Record<string, string | undefined> = {
  antigravity: antigravityIcon,
  cursor: cursorIcon,
  finder: finderIcon,
  ghostty: ghosttyIcon,
  iterm2: iterm2Icon,
  "sublime-text": sublimeTextIcon,
  terminal: terminalIcon,
  vscode: vscodeIcon,
  warp: warpIcon,
  windsurf: windsurfIcon,
  xcode: xcodeIcon,
  zed: zedIcon,
};

export interface WorkspaceOpenTargetIconProps {
  className?: string;
  target?: Pick<WorkspaceOpenTarget, "icon" | "id">;
  targetId?: WorkspaceOpenTargetId;
}

function resolveIcon(
  props: WorkspaceOpenTargetIconProps,
): WorkspaceOpenTargetIconValue {
  if (props.target?.icon) {
    return props.target.icon;
  }
  return getWorkspaceOpenTargetFallbackIcon(
    props.target?.id ?? props.targetId ?? "",
  );
}

export function WorkspaceOpenTargetIcon({
  className = "size-4",
  ...props
}: WorkspaceOpenTargetIconProps) {
  const icon = resolveIcon(props);

  if (icon.kind === "data-url") {
    return (
      <img
        alt=""
        className={cn(className, "shrink-0 rounded-sm")}
        draggable={false}
        src={icon.dataUrl}
      />
    );
  }

  if (icon.kind === "builtin") {
    const iconSrc = WORKSPACE_OPEN_TARGET_ICONS[icon.name];
    if (iconSrc) {
      return (
        <img
          alt=""
          className={cn(className, "shrink-0 rounded-sm")}
          draggable={false}
          src={iconSrc}
        />
      );
    }
  }

  const symbolName = icon.kind === "symbol" ? icon.name : "app";
  const iconName =
    symbolName === "file-manager"
      ? "Folder"
      : symbolName === "terminal"
        ? "Terminal"
        : symbolName === "default-app"
          ? "ExternalLink"
          : "AppWindow";

  return (
    <span
      className={cn(
        className,
        "flex shrink-0 items-center justify-center text-muted-foreground",
      )}
    >
      <Icon name={iconName} className="!size-3.5" aria-hidden />
    </span>
  );
}
