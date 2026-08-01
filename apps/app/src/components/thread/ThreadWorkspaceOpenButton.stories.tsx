import { useEffect, useRef } from "react";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { ThreadWorkspaceOpenButton } from "./ThreadWorkspaceOpenButton";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "thread/Workspace Open Button",
};

type OpenPreferredTargetHandler = () => Promise<void>;
type OpenTargetHandler = (targetId: WorkspaceOpenTargetId) => Promise<void>;

const openPreferredTarget: OpenPreferredTargetHandler = async () => {};
const openTarget: OpenTargetHandler = async () => {};

const vscodeTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
  },
  id: "vscode",
  label: "VS Code",
};

const cursorTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
  },
  id: "cursor",
  label: "Cursor",
};

const zedTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
  },
  id: "zed",
  label: "Zed",
};

const finderTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "finder",
  label: "Finder",
};

const terminalTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "terminal",
  label: "Terminal",
};

const defaultAppTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: false,
  },
  id: "default-app",
  label: "Default App",
};

const workspaceOpenTargets: WorkspaceOpenTarget[] = [
  vscodeTarget,
  cursorTarget,
  zedTarget,
  finderTarget,
  terminalTarget,
  defaultAppTarget,
];

function OpenMenuThreadWorkspaceOpenButtonStory() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const trigger = rootRef.current?.querySelector<HTMLButtonElement>(
        'button[aria-label="Choose another app to open workspace"]',
      );
      trigger?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
        }),
      );
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div ref={rootRef}>
      <ThreadWorkspaceOpenButton
        onOpenPreferredTarget={openPreferredTarget}
        onOpenTarget={openTarget}
        preferredTarget={defaultAppTarget}
        targets={workspaceOpenTargets}
      />
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard labelWidth="260px" valueAlign="end" className="max-w-2xl">
      <StoryRow
        label="preferred editor"
        hint="Default App is available as the last menu item"
      >
        <ThreadWorkspaceOpenButton
          onOpenPreferredTarget={openPreferredTarget}
          onOpenTarget={openTarget}
          preferredTarget={vscodeTarget}
          targets={workspaceOpenTargets}
        />
      </StoryRow>
      <StoryRow
        label="preferred Finder"
        hint="production split control with the restored outer border"
      >
        <ThreadWorkspaceOpenButton
          onOpenPreferredTarget={openPreferredTarget}
          onOpenTarget={openTarget}
          preferredTarget={finderTarget}
          targets={workspaceOpenTargets}
        />
      </StoryRow>
      <StoryRow label="open menu" hint="opened by story wrapper">
        <OpenMenuThreadWorkspaceOpenButtonStory />
      </StoryRow>
    </StoryCard>
  );
}
