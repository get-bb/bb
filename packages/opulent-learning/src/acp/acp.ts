import type { AgentEvent, DoneStatus, ToolCall } from "../events/events.ts";
export const ACP_PROTOCOL_VERSION = 1;
export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";
export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";
export interface TextContentBlock {
    readonly type: "text";
    readonly text: string;
}
export interface OtherContentBlock {
    readonly type: "image" | "audio" | "resource" | "resource_link";
    readonly [key: string]: unknown;
}
export type ContentBlock = TextContentBlock | OtherContentBlock;
export interface PlanEntry {
    readonly content: string;
    readonly priority?: "high" | "medium" | "low";
    readonly status?: "pending" | "in_progress" | "completed";
}
export type SessionUpdate = {
    readonly sessionUpdate: "user_message_chunk";
    readonly content: ContentBlock;
    readonly messageId?: string;
} | {
    readonly sessionUpdate: "agent_message_chunk";
    readonly content: ContentBlock;
    readonly messageId?: string;
} | {
    readonly sessionUpdate: "agent_thought_chunk";
    readonly content: ContentBlock;
    readonly messageId?: string;
} | {
    readonly sessionUpdate: "tool_call";
    readonly toolCallId: string;
    readonly title: string;
    readonly kind?: ToolKind;
    readonly status?: ToolCallStatus;
    readonly rawInput?: Record<string, unknown>;
} | {
    readonly sessionUpdate: "tool_call_update";
    readonly toolCallId: string;
    readonly status?: ToolCallStatus;
    readonly title?: string;
    readonly kind?: ToolKind;
    readonly rawOutput?: Record<string, unknown>;
} | {
    readonly sessionUpdate: "plan";
    readonly entries: readonly PlanEntry[];
} | {
    readonly sessionUpdate: "usage_update";
    readonly used: number;
    readonly size: number;
    readonly cost?: {
        readonly amount: number;
        readonly currency: string;
    };
} | {
    readonly sessionUpdate: "available_commands_update";
    readonly availableCommands: readonly unknown[];
} | {
    readonly sessionUpdate: "current_mode_update";
    readonly currentModeId: string;
} | {
    readonly sessionUpdate: string;
};
export interface SessionNotification {
    readonly sessionId: string;
    readonly update: SessionUpdate;
}
export function decodeToolCall(title: string, kind: ToolKind | undefined, rawInput: Record<string, unknown> | undefined): ToolCall {
    const input = rawInput ?? {};
    const str = (key: string): string | undefined => typeof input[key] === "string" ? (input[key] as string) : undefined;
    const path = str("path") ?? str("file_path") ?? str("filePath");
    const command = str("command") ?? str("cmd");
    const pattern = str("pattern") ?? str("query");
    const url = str("url");
    switch (kind) {
        case "execute":
            if (command !== undefined)
                return { kind: "exec", command };
            break;
        case "read":
            if (path !== undefined)
                return { kind: "readFile", path };
            break;
        case "edit":
            if (path !== undefined) {
                const oldString = str("old_string") ?? str("oldString");
                const newString = str("new_string") ?? str("newString");
                const content = str("content");
                if (oldString !== undefined || newString !== undefined) {
                    return {
                        kind: "editFile",
                        path,
                        ...(oldString === undefined ? {} : { oldString }),
                        ...(newString === undefined ? {} : { newString }),
                    };
                }
                return { kind: "writeFile", path, ...(content === undefined ? {} : { content }) };
            }
            break;
        case "search":
            if (pattern !== undefined) {
                return { kind: "search", pattern, ...(path === undefined ? {} : { path }) };
            }
            break;
        case "fetch":
            if (url !== undefined) {
                const prompt = str("prompt");
                return { kind: "webFetch", url, ...(prompt === undefined ? {} : { prompt }) };
            }
            break;
        default:
            break;
    }
    return { kind: "unknown", name: title, ...(rawInput === undefined ? {} : { input: rawInput }) };
}
export function stopReasonToStatus(reason: StopReason): DoneStatus {
    switch (reason) {
        case "end_turn":
            return "completed";
        case "cancelled":
            return "interrupted";
        case "max_tokens":
        case "max_turn_requests":
        case "refusal":
            return "errored";
    }
}
export function isTruncatedStop(reason: StopReason): boolean {
    return reason === "max_tokens" || reason === "max_turn_requests" || reason === "refusal";
}
function textOf(content: ContentBlock): string | null {
    return content.type === "text" ? content.text : null;
}
export class AcpTranslator {
    readonly #seen = new Set<string>();
    readonly #settled = new Set<string>();
    translate(notification: SessionNotification): AgentEvent[] {
        const update = notification.update;
        switch (update.sessionUpdate) {
            case "agent_message_chunk": {
                const text = textOf((update as {
                    content: ContentBlock;
                }).content);
                return text === null || text === "" ? [] : [{ type: "textDelta", text }];
            }
            case "agent_thought_chunk": {
                const text = textOf((update as {
                    content: ContentBlock;
                }).content);
                return text === null || text === "" ? [] : [{ type: "reasoningDelta", text }];
            }
            case "tool_call": {
                const u = update as Extract<SessionUpdate, {
                    sessionUpdate: "tool_call";
                }>;
                const events: AgentEvent[] = [];
                if (!this.#seen.has(u.toolCallId)) {
                    this.#seen.add(u.toolCallId);
                    events.push({
                        type: "toolCall",
                        id: u.toolCallId,
                        call: decodeToolCall(u.title, u.kind, u.rawInput),
                    });
                }
                events.push(...this.#settle(u.toolCallId, u.status));
                return events;
            }
            case "tool_call_update": {
                const u = update as Extract<SessionUpdate, {
                    sessionUpdate: "tool_call_update";
                }>;
                return this.#settle(u.toolCallId, u.status);
            }
            case "plan": {
                const u = update as Extract<SessionUpdate, {
                    sessionUpdate: "plan";
                }>;
                return [
                    {
                        type: "toolCall",
                        id: `plan-${this.#seen.size}`,
                        call: {
                            kind: "todo",
                            items: u.entries.map((entry) => ({
                                text: entry.content,
                                done: entry.status === "completed",
                            })),
                        },
                    },
                ];
            }
            case "usage_update": {
                const u = update as Extract<SessionUpdate, {
                    sessionUpdate: "usage_update";
                }>;
                return [{ type: "usage", inputTokens: u.used, outputTokens: 0 }];
            }
            default:
                return [];
        }
    }
    finish(reason: StopReason, sessionId?: string): AgentEvent {
        const status = stopReasonToStatus(reason);
        return {
            type: "done",
            status,
            ...(isTruncatedStop(reason) ? { error: `turn truncated: ${reason}` } : {}),
            ...(sessionId === undefined ? {} : { sessionId }),
        };
    }
    #settle(toolCallId: string, status: ToolCallStatus | undefined): AgentEvent[] {
        if (status !== "completed" && status !== "failed")
            return [];
        if (this.#settled.has(toolCallId))
            return [];
        this.#settled.add(toolCallId);
        return [{ type: "toolResult", id: toolCallId, isError: status === "failed" }];
    }
}
