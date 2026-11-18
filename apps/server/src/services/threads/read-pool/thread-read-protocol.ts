import type { ThreadReadRequest, ThreadReadResult } from "./thread-read.js";

export interface ThreadReadWorkerData {
  databasePath: string;
  pageCacheKib: number;
}

export interface ThreadReadWorkerRunMessage {
  type: "run";
  id: number;
  request: ThreadReadRequest;
}

export interface ThreadReadWorkerApiError {
  status: number;
  code: string;
  message: string;
  details: unknown;
  retryable: boolean | undefined;
}

export type ThreadReadWorkerReply =
  | { type: "ready" }
  | { type: "result"; id: number; result: ThreadReadResult }
  | {
      type: "failed";
      id: number;
      apiError: ThreadReadWorkerApiError | null;
      message: string;
      stack: string | undefined;
    };
