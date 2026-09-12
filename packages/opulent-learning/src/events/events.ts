export type ExecutionTarget = "local" | "modal" | "daytona";
export interface ExecutionRef {
    readonly target: ExecutionTarget;
    readonly ref: string;
}
export type RunFidelity = "token" | "event" | "lifecycle";
export type DoneStatus = "completed" | "interrupted" | "errored";
export interface TodoItem {
    readonly text: string;
    readonly done: boolean;
}
export type ToolCall = {
    readonly kind: "exec";
    readonly command: string;
} | {
    readonly kind: "readFile";
    readonly path: string;
} | {
    readonly kind: "writeFile";
    readonly path: string;
    readonly content?: string;
} | {
    readonly kind: "editFile";
    readonly path: string;
    readonly oldString?: string;
    readonly newString?: string;
} | {
    readonly kind: "applyPatch";
    readonly path?: string;
} | {
    readonly kind: "search";
    readonly pattern: string;
    readonly path?: string;
} | {
    readonly kind: "glob";
    readonly pattern: string;
} | {
    readonly kind: "webFetch";
    readonly url: string;
    readonly prompt?: string;
} | {
    readonly kind: "webSearch";
    readonly query: string;
} | {
    readonly kind: "todo";
    readonly items: readonly TodoItem[];
} | {
    readonly kind: "mcp";
    readonly server: string;
    readonly tool: string;
    readonly input?: unknown;
} | {
    readonly kind: "unknown";
    readonly name: string;
    readonly input?: unknown;
};
export interface UserInputQuestion {
    readonly id: string;
    readonly header: string;
    readonly question: string;
    readonly options: readonly string[];
    readonly multiSelect?: boolean;
}
export interface UserInputAnswer {
    readonly questionId: string;
    readonly labels: readonly string[];
}
export type AgentEvent = {
    readonly type: "sessionStarted";
    readonly harness: string;
    readonly model: string;
    readonly tools?: readonly string[];
    readonly cwd: string;
    readonly sessionId: string;
    readonly assistantMessageId: string;
    readonly execution?: ExecutionRef;
    readonly fidelity?: RunFidelity;
} | {
    readonly type: "textDelta";
    readonly text: string;
} | {
    readonly type: "reasoningDelta";
    readonly text: string;
} | {
    readonly type: "assistantMessageCompleted";
    readonly assistantMessageId: string;
} | {
    readonly type: "toolCall";
    readonly id: string;
    readonly call: ToolCall;
} | {
    readonly type: "toolResult";
    readonly id: string;
    readonly isError: boolean;
} | {
    readonly type: "usage";
    readonly inputTokens: number;
    readonly outputTokens: number;
} | {
    readonly type: "error";
    readonly message: string;
} | {
    readonly type: "inputRequested";
    readonly requestId: string;
    readonly questions: readonly UserInputQuestion[];
} | {
    readonly type: "inputResolved";
    readonly requestId: string;
} | {
    readonly type: "contextCompacted";
    readonly droppedEvents: number;
    readonly droppedTokensEstimate: number;
    readonly summary: string;
    readonly generation: number;
} | {
    readonly type: "steered";
    readonly assistantMessageId?: string;
    readonly nextAssistantMessageId?: string;
} | {
    readonly type: "done";
    readonly status: DoneStatus;
    readonly result?: string;
    readonly error?: string;
    readonly sessionId?: string;
};
export interface JournalLine {
    readonly seq: number;
    readonly event: AgentEvent;
}
export class JournalParseError extends Error {
    readonly lineNumber: number;
    constructor(message: string, lineNumber: number) {
        super(`journal line ${lineNumber}: ${message}`);
        this.name = "JournalParseError";
        this.lineNumber = lineNumber;
    }
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
const EVENT_TYPES = new Set([
    "sessionStarted",
    "textDelta",
    "reasoningDelta",
    "assistantMessageCompleted",
    "toolCall",
    "toolResult",
    "usage",
    "error",
    "inputRequested",
    "inputResolved",
    "contextCompacted",
    "steered",
    "done",
]);
export function parseJournal(text: string): JournalLine[] {
    const rawLines = text.split("\n");
    const lines: JournalLine[] = [];
    for (let i = 0; i < rawLines.length; i += 1) {
        const raw = rawLines[i] ?? "";
        if (raw.trim() === "")
            continue;
        const isLast = i === rawLines.length - 1;
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            if (isLast)
                continue;
            throw new JournalParseError("malformed JSON", i + 1);
        }
        if (!isRecord(parsed))
            throw new JournalParseError("expected an object", i + 1);
        const { seq, event } = parsed;
        if (typeof seq !== "number" || !Number.isInteger(seq)) {
            throw new JournalParseError("missing integer `seq`", i + 1);
        }
        if (!isRecord(event) || typeof event["type"] !== "string") {
            throw new JournalParseError("missing `event.type`", i + 1);
        }
        if (!EVENT_TYPES.has(event["type"])) {
            throw new JournalParseError(`unknown event type "${event["type"]}"`, i + 1);
        }
        lines.push({ seq, event: event as unknown as AgentEvent });
    }
    return lines;
}
export function serializeJournal(lines: readonly JournalLine[]): string {
    return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}
export function isAborted(lines: readonly JournalLine[]): boolean {
    const last = lines.at(-1);
    return last === undefined || last.event.type !== "done";
}
export function closeAborted(lines: readonly JournalLine[]): JournalLine[] {
    if (!isAborted(lines))
        return [...lines];
    const nextSeq = (lines.at(-1)?.seq ?? -1) + 1;
    return [
        ...lines,
        {
            seq: nextSeq,
            event: {
                type: "done",
                status: "errored",
                error: "run ended without a terminal event (recovered at boot)",
            },
        },
    ];
}
