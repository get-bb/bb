import { z } from "zod";
import {
  terminalColsSchema,
  terminalDataBase64Schema,
  terminalRowsSchema,
  terminalSessionCloseReasonSchema,
  terminalSessionStatusSchema,
} from "@bb/domain/terminal";
import {
  hostDaemonTerminalDataDaemonMessageSchema,
  hostDaemonTerminalDataServerMessageSchema,
} from "@bb/host-daemon-contract/terminal-data";
import {
  terminalOutputChunkSchema,
  terminalClientMessageSchema,
  terminalSessionSchema,
  terminalServerMessageSchema,
} from "@bb/server-contract";

const id = z.string().min(1);
const seq = z.number().int().nonnegative();
const browserGrantSchema = z
  .object({
    kind: z.literal("browser"),
    terminalId: id,
    sinceSeq: seq,
    outputAcks: z.boolean(),
  })
  .strict();
const daemonGrantSchema = z
  .object({
    kind: z.literal("daemon-data"),
    hostId: id,
    sessionId: id,
  })
  .strict();
const acceptFields = {
  head: z.string(),
  headers: z.record(z.string(), z.string()),
  method: z.string(),
  url: z.string(),
};

export const terminalRelayToMainMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), pid: z.number().int() }).strict(),
  z
    .object({
      type: z.literal("attach-requested"),
      terminalId: id,
      socketId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal("browser-input"),
      terminalId: id,
      socketId: id,
      dataBase64: terminalDataBase64Schema,
    })
    .strict(),
  z
    .object({
      type: z.literal("browser-resize"),
      terminalId: id,
      socketId: id,
      cols: terminalColsSchema,
      rows: terminalRowsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("terminal-exited"),
      terminalId: id,
      daemonSessionId: id,
      exitCode: z.number().int().nullable(),
      closeReason: terminalSessionCloseReasonSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("attach-error"),
      terminalId: id,
      daemonSessionId: id,
      requestId: id,
      code: z.string(),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("catch-up-error"),
      terminalId: id,
      daemonSessionId: id,
      requestId: id,
      code: z.string(),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("replay"),
      daemonSessionId: id,
      requestId: id,
      terminalId: id,
      chunks: z.array(terminalOutputChunkSchema),
      replayStartSeq: seq,
      nextSeq: seq,
    })
    .strict(),
  z
    .object({ type: z.literal("daemon-data-socket-closed"), sessionId: id })
    .strict(),
  z
    .object({
      type: z.literal("daemon-data-socket-opened"),
      sessionId: id,
      hostId: id,
    })
    .strict(),
  z.object({ type: z.literal("daemon-send-failed"), sessionId: id }).strict(),
  z
    .object({
      type: z.literal("log"),
      message: z.string(),
      details: z.record(z.string(), z.string()),
    })
    .strict(),
  z
    .object({
      type: z.literal("metrics"),
      rssBytes: z.number().int(),
      clients: z.number().int(),
      daemonSockets: z.number().int(),
    })
    .strict(),
]);
export type TerminalRelayToMainMessage = z.infer<
  typeof terminalRelayToMainMessageSchema
>;

export const mainToTerminalRelayMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("accept-browser"),
      grant: browserGrantSchema,
      ...acceptFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("accept-daemon-data"),
      grant: daemonGrantSchema,
      ...acceptFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("attach-decision"),
      socketId: id,
      decision: z.enum([
        "running",
        "hold",
        "not-running",
        "not-found",
        "exited",
      ]),
      session: terminalSessionSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("terminal-state"),
      terminalId: id,
      state: z
        .object({
          daemonSessionId: id.nullable(),
          hostId: id,
          session: terminalSessionSchema,
          status: terminalSessionStatusSchema,
        })
        .strict()
        .nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session-updated"),
      terminalId: id,
      session: terminalSessionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("exited"),
      terminalId: id,
      session: terminalSessionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("request-catch-up"),
      terminalId: id,
      daemonSessionId: id,
      force: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("fail-daemon-session"),
      daemonSessionId: id,
      reason: z.literal("daemon-disconnect"),
    })
    .strict(),
  z
    .object({
      type: z.literal("fail-terminal"),
      terminalId: id,
      code: z.string(),
      message: z.string(),
    })
    .strict(),
  z.object({ type: z.literal("forget-terminal"), terminalId: id }).strict(),
  z
    .object({
      type: z.literal("send-socket-message"),
      socketId: id,
      message: terminalServerMessageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("send-daemon-data"),
      daemonSessionId: id,
      message: hostDaemonTerminalDataServerMessageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("close-socket"),
      socketId: id,
      code: z.number().int(),
      reason: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("attach-client"),
      socketId: id,
      terminalId: id,
      sinceSeq: seq,
      outputAcks: z.boolean(),
    })
    .strict(),
  z
    .object({ type: z.literal("detach-client"), socketId: id, terminalId: id })
    .strict(),
  z
    .object({
      type: z.literal("hold-for-reattach"),
      socketId: id,
      terminalId: id,
      session: terminalSessionSchema,
      sinceSeq: seq,
      outputAcks: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("browser-message"),
      socketId: id,
      terminalId: id,
      message: terminalClientMessageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("daemon-message"),
      daemonSessionId: id,
      message: hostDaemonTerminalDataDaemonMessageSchema,
    })
    .strict(),
  z.object({ type: z.literal("move-fence"), pending: z.boolean() }).strict(),
  z.object({ type: z.literal("shutdown") }).strict(),
]);
export type MainToTerminalRelayMessage = z.infer<
  typeof mainToTerminalRelayMessageSchema
>;
export type AcceptMessage = Extract<
  MainToTerminalRelayMessage,
  { type: "accept-browser" | "accept-daemon-data" }
>;
