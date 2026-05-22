import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  LOG_VIEWER_APPEND_CHANNEL,
  LOG_VIEWER_COPY_CHANNEL,
  LOG_VIEWER_OPEN_LOGS_FOLDER_CHANNEL,
  LOG_VIEWER_SNAPSHOT_CHANNEL,
  type LogViewerApi,
  type LogViewerAppendEvent,
  type LogViewerAppendHandler,
  type LogViewerCopyRequest,
  type LogViewerOpenLogsFolderResult,
  type LogViewerSnapshotEvent,
  type LogViewerSnapshotHandler,
  type LogViewerUnsubscribe,
} from "./log-viewer-contract.js";

interface SnapshotListenerArgs {
  handler: LogViewerSnapshotHandler;
}

interface AppendListenerArgs {
  handler: LogViewerAppendHandler;
}

function onSnapshot(args: SnapshotListenerArgs): LogViewerUnsubscribe {
  const listener = (
    _event: IpcRendererEvent,
    payload: LogViewerSnapshotEvent,
  ): void => {
    args.handler(payload);
  };
  ipcRenderer.on(LOG_VIEWER_SNAPSHOT_CHANNEL, listener);
  return () => {
    ipcRenderer.removeListener(LOG_VIEWER_SNAPSHOT_CHANNEL, listener);
  };
}

function onAppend(args: AppendListenerArgs): LogViewerUnsubscribe {
  const listener = (
    _event: IpcRendererEvent,
    payload: LogViewerAppendEvent,
  ): void => {
    args.handler(payload);
  };
  ipcRenderer.on(LOG_VIEWER_APPEND_CHANNEL, listener);
  return () => {
    ipcRenderer.removeListener(LOG_VIEWER_APPEND_CHANNEL, listener);
  };
}

const logViewerApi: LogViewerApi = {
  async copyLogs(request: LogViewerCopyRequest): Promise<void> {
    await ipcRenderer.invoke(LOG_VIEWER_COPY_CHANNEL, request);
  },
  onAppend(handler) {
    return onAppend({ handler });
  },
  onSnapshot(handler) {
    return onSnapshot({ handler });
  },
  async openLogsFolder(): Promise<LogViewerOpenLogsFolderResult> {
    return ipcRenderer.invoke(LOG_VIEWER_OPEN_LOGS_FOLDER_CHANNEL);
  },
};

contextBridge.exposeInMainWorld("bbLogViewer", logViewerApi);
