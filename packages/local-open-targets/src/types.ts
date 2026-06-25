import type {
  WorkspaceOpenTargetCapabilities,
  WorkspaceOpenTargetIcon,
  WorkspaceOpenTargetId,
  WorkspaceOpenTargetKind,
} from "@bb/host-daemon-contract";

export interface LocalOpenTargetContext {
  kind: "local";
}

export interface RemoteSshOpenTargetContext {
  kind: "remote-ssh";
  serverOrigin: string;
  hostId: string;
  sshAuthority: string;
}

export type OpenPathInTargetContext =
  | LocalOpenTargetContext
  | RemoteSshOpenTargetContext;

export interface OpenPathInTargetArgs {
  columnNumber: number | null;
  context: OpenPathInTargetContext;
  lineNumber: number | null;
  path: string;
  targetId: WorkspaceOpenTargetId;
}

export interface ListWorkspaceOpenTargetsOptions {
  path?: string;
}

export interface ExecFileResult {
  stdout: string;
}

export type ExecFileHandler = (
  file: string,
  args: string[],
) => Promise<ExecFileResult>;

export interface WorkspaceOpenTargetRuntime {
  applicationDirectories: string[];
  desktopFileDirectories?: string[];
  env?: NodeJS.ProcessEnv;
  execFile: ExecFileHandler;
  platform: NodeJS.Platform;
}

export interface MacDefaultLaunchAdapter {
  openMode: "default-app";
}

export interface MacApplicationLaunchAdapter {
  appName: string;
  bundleIds: string[];
  builtIn: boolean;
  fileOpenCommand?: MacFileOpenCommandAdapter;
  lineOpenCommand?: MacLineOpenCommandAdapter;
  localTerminalOpenCommand?: MacLocalTerminalOpenCommandAdapter;
  openMode: "application";
  pathOpenCommand?: MacPathOpenCommandAdapter;
  remoteSshOpenCommand?: MacRemoteSshOpenCommandAdapter;
}

export type MacLaunchAdapter =
  | MacApplicationLaunchAdapter
  | MacDefaultLaunchAdapter;

export interface LaunchAdapter {
  capabilities: WorkspaceOpenTargetCapabilities;
  fileOpenBehavior: "direct" | "containing-directory";
  icon: WorkspaceOpenTargetIcon;
  id: WorkspaceOpenTargetId;
  kind: WorkspaceOpenTargetKind;
  label: string;
  macos: MacLaunchAdapter;
}

export interface ExecFileInvocation {
  args: string[];
  file: string;
}

export interface ExistingPath {
  path: string;
  type: "directory" | "file";
}

export interface BuildMacLineOpenArgs {
  columnNumber: number | null;
  lineNumber: number;
  path: string;
}

export interface BuildMacTerminalOpenArgs {
  columnNumber: number | null;
  lineNumber: number | null;
  path: string;
}

export interface BuildMacRemoteSshOpenArgs {
  columnNumber: number | null;
  lineNumber: number | null;
  path: string;
  sshAuthority: string;
}

export interface MacLineOpenCommandAdapter {
  executable: string;
  supportsColumn: boolean;
  toArgs: (args: BuildMacLineOpenArgs) => string[];
}

export interface MacPathOpenCommandAdapter {
  executable: string;
  toArgs: (path: string) => string[];
}

export interface MacFileOpenCommandAdapter {
  executable: string;
  toArgs: (path: string) => string[];
}

export interface MacLocalTerminalOpenCommandAdapter {
  executable: string;
  toArgs: (args: BuildMacTerminalOpenArgs) => string[];
}

export interface MacRemoteSshOpenCommandAdapter {
  capabilities: WorkspaceOpenTargetCapabilities;
  executable: string;
  requiredExecutables?: string[];
  toArgs: (args: BuildMacRemoteSshOpenArgs) => string[];
}

export interface PlatformOpenInvocationArgs {
  columnNumber: number | null;
  existingPath: ExistingPath;
  lineNumber: number | null;
}

export interface PlatformRemoteSshOpenInvocationArgs {
  columnNumber: number | null;
  lineNumber: number | null;
  path: string;
  sshAuthority: string;
}

export interface ResolveMacOpenInvocationArgs {
  columnNumber: number | null;
  definition: LaunchAdapter;
  existingPath: ExistingPath;
  lineNumber: number | null;
}

export interface ResolveMacRemoteSshOpenInvocationArgs {
  columnNumber: number | null;
  definition: LaunchAdapter;
  lineNumber: number | null;
  path: string;
  sshAuthority: string;
}

export interface ResolveTargetOpenPathArgs {
  definition: LaunchAdapter;
  existingPath: ExistingPath;
}

export interface ResolveMacTargetIconArgs {
  appPath: string | null;
  definition: LaunchAdapter;
  runtime: WorkspaceOpenTargetRuntime;
}

export interface DiscoveredMacApplication {
  appPath: string;
  bundleId: string | null;
  label: string;
}

export interface LinuxDesktopApplication {
  desktopFileId: string;
  desktopFilePath: string;
  exec: string;
  label: string;
}
