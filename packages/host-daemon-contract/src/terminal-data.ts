import { z } from "zod";
import {
  hostDaemonTerminalAckMessageSchema,
  hostDaemonTerminalAttachMessageSchema,
  hostDaemonTerminalErrorMessageSchema,
  hostDaemonTerminalExitedMessageSchema,
  hostDaemonTerminalFlowControlMessageSchema,
  hostDaemonTerminalInputMessageSchema,
  hostDaemonTerminalOutputMessageSchema,
  hostDaemonTerminalReplayMessageSchema,
  hostDaemonTerminalResizeMessageSchema,
} from "./session.js";

export const HOST_DAEMON_TERMINAL_DATA_PATH = "/internal/ws/terminals";

export const hostDaemonTerminalDataServerMessageSchema = z.discriminatedUnion(
  "type",
  [
    hostDaemonTerminalAttachMessageSchema,
    hostDaemonTerminalInputMessageSchema,
    hostDaemonTerminalResizeMessageSchema,
    hostDaemonTerminalAckMessageSchema,
    hostDaemonTerminalFlowControlMessageSchema,
  ],
);
export type HostDaemonTerminalDataServerMessage = z.infer<
  typeof hostDaemonTerminalDataServerMessageSchema
>;

export const hostDaemonTerminalDataDaemonMessageSchema = z.discriminatedUnion(
  "type",
  [
    hostDaemonTerminalOutputMessageSchema,
    hostDaemonTerminalReplayMessageSchema,
    hostDaemonTerminalExitedMessageSchema,
    hostDaemonTerminalErrorMessageSchema,
  ],
);
export type HostDaemonTerminalDataDaemonMessage = z.infer<
  typeof hostDaemonTerminalDataDaemonMessageSchema
>;
