import type { WorkspaceOpenTargetCapabilities } from "@bb/host-daemon-contract";

export const FULL_FILE_OPEN_CAPABILITIES: WorkspaceOpenTargetCapabilities = {
  openDirectory: true,
  openFile: true,
  openFileAtColumn: true,
  openFileAtLine: true,
};

export const BASIC_FILE_OPEN_CAPABILITIES: WorkspaceOpenTargetCapabilities = {
  openDirectory: true,
  openFile: true,
  openFileAtColumn: false,
  openFileAtLine: false,
};

export const FILE_MANAGER_OPEN_CAPABILITIES: WorkspaceOpenTargetCapabilities = {
  openDirectory: true,
  openFile: true,
  openFileAtColumn: false,
  openFileAtLine: false,
};

export const TERMINAL_OPEN_CAPABILITIES: WorkspaceOpenTargetCapabilities = {
  openDirectory: true,
  openFile: true,
  openFileAtColumn: true,
  openFileAtLine: true,
};

export const LINE_ONLY_FILE_OPEN_CAPABILITIES: WorkspaceOpenTargetCapabilities =
  {
    openDirectory: true,
    openFile: true,
    openFileAtColumn: false,
    openFileAtLine: true,
  };
