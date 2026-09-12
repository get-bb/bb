import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  LOG_VIEWER_APPEND_CHANNEL,
  LOG_VIEWER_COPY_CHANNEL,
  LOG_VIEWER_OPEN_LOGS_FOLDER_CHANNEL,
  LOG_VIEWER_SNAPSHOT_CHANNEL,
  type LogViewerApi,
  type LogViewerCopyRequest,
  type LogViewerOpenLogsFolderResult,
  type LogViewerUnsubscribe,
} from "./log-viewer-contract.js";

function subscribe<T>(
  channel: string,
  handler: (payload: T) => void,
): LogViewerUnsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    handler(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const logViewerApi: LogViewerApi = {
  async copyLogs(request: LogViewerCopyRequest): Promise<void> {
    await ipcRenderer.invoke(LOG_VIEWER_COPY_CHANNEL, request);
  },
  onAppend(handler) {
    return subscribe(LOG_VIEWER_APPEND_CHANNEL, handler);
  },
  onSnapshot(handler) {
    return subscribe(LOG_VIEWER_SNAPSHOT_CHANNEL, handler);
  },
  async openLogsFolder(): Promise<LogViewerOpenLogsFolderResult> {
    return ipcRenderer.invoke(LOG_VIEWER_OPEN_LOGS_FOLDER_CHANNEL);
  },
};

contextBridge.exposeInMainWorld("bbLogViewer", logViewerApi);
