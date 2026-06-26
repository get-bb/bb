import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetIcon as WorkspaceOpenTargetIconValue,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import androidStudioIcon from "@/assets/workspace-open-target-icons/android-studio.png";
import antigravityIcon from "@/assets/workspace-open-target-icons/antigravity.png";
import bbeditIcon from "@/assets/workspace-open-target-icons/bbedit.png";
import cursorIcon from "@/assets/workspace-open-target-icons/cursor.png";
import emacsIcon from "@/assets/workspace-open-target-icons/emacs.png";
import finderIcon from "@/assets/workspace-open-target-icons/finder.png";
import ghosttyIcon from "@/assets/workspace-open-target-icons/ghostty.png";
import golandIcon from "@/assets/workspace-open-target-icons/goland.png";
import intellijIcon from "@/assets/workspace-open-target-icons/intellij.png";
import iterm2Icon from "@/assets/workspace-open-target-icons/iterm2.png";
import phpstormIcon from "@/assets/workspace-open-target-icons/phpstorm.png";
import pycharmIcon from "@/assets/workspace-open-target-icons/pycharm.png";
import riderIcon from "@/assets/workspace-open-target-icons/rider.png";
import rustroverIcon from "@/assets/workspace-open-target-icons/rustrover.png";
import sublimeTextIcon from "@/assets/workspace-open-target-icons/sublime-text.png";
import terminalIcon from "@/assets/workspace-open-target-icons/terminal.png";
import textmateIcon from "@/assets/workspace-open-target-icons/textmate.png";
import vscodeInsidersIcon from "@/assets/workspace-open-target-icons/vscode-insiders.png";
import vscodeIcon from "@/assets/workspace-open-target-icons/vscode.png";
import warpIcon from "@/assets/workspace-open-target-icons/warp.png";
import webstormIcon from "@/assets/workspace-open-target-icons/webstorm.svg";
import windsurfIcon from "@/assets/workspace-open-target-icons/windsurf.png";
import xcodeIcon from "@/assets/workspace-open-target-icons/xcode.png";
import zedIcon from "@/assets/workspace-open-target-icons/zed.png";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";
import { getWorkspaceOpenTargetFallbackIcon } from "./workspace-open-target-display";

const WORKSPACE_OPEN_TARGET_ICONS: Record<string, string | undefined> = {
  "android-studio": androidStudioIcon,
  antigravity: antigravityIcon,
  bbedit: bbeditIcon,
  cursor: cursorIcon,
  emacs: emacsIcon,
  finder: finderIcon,
  ghostty: ghosttyIcon,
  goland: golandIcon,
  intellij: intellijIcon,
  "intellij-idea": intellijIcon,
  iterm2: iterm2Icon,
  phpstorm: phpstormIcon,
  pycharm: pycharmIcon,
  rider: riderIcon,
  rustrover: rustroverIcon,
  "sublime-text": sublimeTextIcon,
  terminal: terminalIcon,
  textmate: textmateIcon,
  "vscode-insiders": vscodeInsidersIcon,
  vscode: vscodeIcon,
  warp: warpIcon,
  webstorm: webstormIcon,
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
