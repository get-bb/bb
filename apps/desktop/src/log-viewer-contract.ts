export const LOG_VIEWER_APPEND_CHANNEL = "bb:log-viewer:append";
export const LOG_VIEWER_COPY_CHANNEL = "bb:log-viewer:copy";
export const LOG_VIEWER_OPEN_LOGS_FOLDER_CHANNEL =
  "bb:log-viewer:open-logs-folder";
export const LOG_VIEWER_SNAPSHOT_CHANNEL = "bb:log-viewer:snapshot";
export const LOG_VIEWER_VISIBLE_LINE_LIMIT = 10_000;

export type LogViewerComponent = "host-daemon" | "server";
export type LogViewerLineSource = LogViewerComponent | "system";

export interface LogViewerLine {
  source: LogViewerLineSource;
  text: string;
}

export interface LogViewerAppendEvent {
  lines: LogViewerLine[];
}

export interface LogViewerSnapshotEvent {
  lines: LogViewerLine[];
  logDir: string;
}

export interface LogViewerCopyRequest {
  text: string;
}

export interface LogViewerOpenLogsFolderResult {
  path: string;
}

export type LogViewerAppendHandler = (event: LogViewerAppendEvent) => void;
export type LogViewerSnapshotHandler = (
  event: LogViewerSnapshotEvent,
) => void;
export type LogViewerUnsubscribe = () => void;

export interface LogViewerApi {
  copyLogs(request: LogViewerCopyRequest): Promise<void>;
  onAppend(handler: LogViewerAppendHandler): LogViewerUnsubscribe;
  onSnapshot(handler: LogViewerSnapshotHandler): LogViewerUnsubscribe;
  openLogsFolder(): Promise<LogViewerOpenLogsFolderResult>;
}
