import {
  experimental_compareVersions as compareVersions,
  experimental_versionFrom as versionFrom,
  threadVoiceParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { VoiceState } from "../voice-state.js";
import { z } from "zod";
import type { CodexAppServerConnection } from "./app-server-connection.js";

export const voiceCommandSchema = threadVoiceParamsSchema.shape.command;

export function requireNativeVoiceVersion(userAgent: string | null): void {
  const version = versionFrom(
    userAgent?.match(/^[^\s/]+\/(\S+)(?:\s|$)/)?.[1] ?? null,
  );
  if (!version || compareVersions(version, "0.147.0") < 0) {
    throw new Error(
      "Native voice requires Codex 0.147.0 or newer with a verifiable app-server version",
    );
  }
}

export class CodexVoiceSession {
  private leaseTimer: ReturnType<typeof setTimeout> | undefined;
  private sessionId: string | null = null;
  private stopping: {
    sessionId: string;
    reason: string | undefined;
    done: Promise<void>;
  } | null = null;
  private pending: {
    resolve(sdp: string): void;
    reject(error: Error): void;
  } | null = null;

  constructor(
    private readonly connection: CodexAppServerConnection,
    private readonly threadId: string,
    private readonly publish: (state: VoiceState) => void,
  ) {}

  notification(method: string, params: unknown): void {
    const event = z
      .object({
        threadId: z.string(),
        sdp: z.string().min(1).max(131072).optional(),
        message: z.string().optional(),
        reason: z.string().nullable().optional(),
      })
      .safeParse(params);
    if (
      !event.success ||
      event.data.threadId !== this.threadId ||
      this.sessionId === null
    )
      return;
    if (method === "thread/realtime/sdp" && event.data.sdp)
      this.pending?.resolve(event.data.sdp);
    if (method === "thread/realtime/error")
      this.close(event.data.message ?? "Codex voice failed");
    if (method === "thread/realtime/closed") {
      const stopReason =
        this.stopping?.sessionId === this.sessionId
          ? this.stopping.reason
          : undefined;
      this.close(stopReason ?? event.data.reason ?? undefined, "closed");
    }
  }

  private renewLease(): void {
    clearTimeout(this.leaseTimer);
    this.leaseTimer = setTimeout(() => {
      const sessionId = this.sessionId;
      if (sessionId) void this.stop(sessionId, "The voice lease expired");
    }, 60000);
    this.leaseTimer.unref?.();
  }

  close(
    message?: string,
    status: "closed" | "error" = message === undefined ? "closed" : "error",
  ): void {
    clearTimeout(this.leaseTimer);
    const sessionId = this.sessionId;
    this.sessionId = null;
    this.pending?.reject(new Error(message ?? "Voice session closed"));
    this.pending = null;
    if (sessionId)
      this.publish({
        sessionId,
        status,
        message: message ?? null,
      });
  }

  private stop(sessionId: string, reason?: string): Promise<void> {
    if (this.stopping?.sessionId === sessionId) return this.stopping.done;
    const done = (async () => {
      let unconfirmed: string | undefined;
      try {
        await this.connection.request({
          method: "thread/realtime/stop",
          params: { threadId: this.threadId },
          resultSchema: z.object({}),
          timeoutMs: 10000,
        });
      } catch (error) {
        unconfirmed = `Codex did not confirm the voice stop: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
      if (this.stopping?.sessionId === sessionId) this.stopping = null;
      if (this.sessionId !== sessionId) return;
      this.close(
        [reason, unconfirmed].filter((part) => part !== undefined).join(". ") ||
          undefined,
        "closed",
      );
    })();
    this.stopping = { sessionId, reason, done };
    return done;
  }

  async command(
    command: z.infer<typeof voiceCommandSchema>,
  ): Promise<{ sdp: string | null }> {
    if (command.action === "keepAlive") {
      if (this.sessionId !== command.sessionId)
        throw new Error("Voice session is no longer active");
      this.renewLease();
      return { sdp: null };
    }
    if (command.action === "stop") {
      if (this.sessionId === command.sessionId)
        await this.stop(command.sessionId);
      return { sdp: null };
    }
    if (this.sessionId !== null)
      throw new Error(
        "A voice chat is already open in this thread. End it before starting another.",
      );
    this.sessionId = command.sessionId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answer = new Promise<string>((resolve, reject) => {
      this.pending = { resolve, reject };
      timer = setTimeout(
        () => reject(new Error("Codex voice connection timed out")),
        30000,
      );
    });
    try {
      const [, sdp] = await Promise.all([
        this.connection.request({
          method: "thread/realtime/start",
          params: {
            threadId: this.threadId,
            transport: { type: "webrtc", sdp: command.sdp },
            version: "v3",
            outputModality: "audio",
            ...(command.voice ? { voice: command.voice } : {}),
            ...(command.instructions !== undefined
              ? { realtimeStartInstructions: command.instructions }
              : {}),
            ...(command.initialContext !== undefined
              ? {
                  includeStartupContext: false,
                  initialItems: command.initialContext
                    ? [{ role: "developer", text: command.initialContext }]
                    : [],
                }
              : {}),
          },
          resultSchema: z.object({}),
          timeoutMs: 30000,
        }),
        answer,
      ]);
      if (this.sessionId !== command.sessionId)
        throw new Error("Voice session closed while connecting");
      this.renewLease();
      this.publish({
        sessionId: command.sessionId,
        status: "active",
        message: null,
      });
      return { sdp };
    } catch (error) {
      await this.connection
        .request({
          method: "thread/realtime/stop",
          params: { threadId: this.threadId },
          resultSchema: z.object({}),
          timeoutMs: 5000,
        })
        .catch(() => {});
      if (this.sessionId === command.sessionId)
        this.close(
          error instanceof Error
            ? error.message
            : "Could not start Codex voice",
        );
      throw error;
    } finally {
      clearTimeout(timer);
      this.pending = null;
    }
  }
}
