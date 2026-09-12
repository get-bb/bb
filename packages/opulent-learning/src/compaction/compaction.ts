import type { AgentEvent, JournalLine } from "../events/events.ts";
const CHARS_PER_TOKEN = 3.5;
export interface CompactionPolicy {
    readonly keepHead: number;
    readonly keepTail: number;
    readonly targetTokens: number;
}
export const DEFAULT_POLICY: CompactionPolicy = {
    keepHead: 4,
    keepTail: 24,
    targetTokens: 60000,
};
export interface CompactionResult {
    readonly events: readonly AgentEvent[];
    readonly marker: Extract<AgentEvent, {
        type: "contextCompacted";
    }>;
    readonly compacted: boolean;
}
export class CompactionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CompactionError";
    }
}
export function estimateTokens(event: AgentEvent): number {
    return Math.ceil(JSON.stringify(event).length / CHARS_PER_TOKEN);
}
export function estimateTotalTokens(events: readonly AgentEvent[]): number {
    let total = 0;
    for (const event of events)
        total += estimateTokens(event);
    return total;
}
function pairPartner(events: readonly AgentEvent[]): Map<number, number> {
    const partner = new Map<number, number>();
    const openTool = new Map<string, number>();
    const openInput = new Map<string, number>();
    for (let i = 0; i < events.length; i += 1) {
        const event = events[i];
        if (event === undefined)
            continue;
        switch (event.type) {
            case "toolCall":
                openTool.set(event.id, i);
                break;
            case "toolResult": {
                const start = openTool.get(event.id);
                if (start !== undefined) {
                    partner.set(start, i);
                    partner.set(i, start);
                    openTool.delete(event.id);
                }
                break;
            }
            case "inputRequested":
                openInput.set(event.requestId, i);
                break;
            case "inputResolved": {
                const start = openInput.get(event.requestId);
                if (start !== undefined) {
                    partner.set(start, i);
                    partner.set(i, start);
                    openInput.delete(event.requestId);
                }
                break;
            }
            default:
                break;
        }
    }
    return partner;
}
function describe(event: AgentEvent): string | null {
    switch (event.type) {
        case "toolCall": {
            const call = event.call;
            switch (call.kind) {
                case "exec":
                    return `ran: ${call.command}`;
                case "readFile":
                    return `read ${call.path}`;
                case "writeFile":
                    return `wrote ${call.path}`;
                case "editFile":
                    return `edited ${call.path}`;
                case "applyPatch":
                    return `applied a patch${call.path === undefined ? "" : ` to ${call.path}`}`;
                case "search":
                    return `searched for ${call.pattern}`;
                case "glob":
                    return `globbed ${call.pattern}`;
                case "webFetch":
                    return `fetched ${call.url}`;
                case "webSearch":
                    return `web-searched ${call.query}`;
                case "todo":
                    return `updated a ${call.items.length}-item todo list`;
                case "mcp":
                    return `called ${call.server}/${call.tool}`;
                case "unknown":
                    return `called ${call.name}`;
            }
            return null;
        }
        case "error":
            return `error: ${event.message}`;
        case "contextCompacted":
            return `[earlier context was already compacted: generation ${event.generation}]`;
        default:
            return null;
    }
}
export function summarizeSpan(dropped: readonly AgentEvent[]): string {
    const actions: string[] = [];
    let textChars = 0;
    let errors = 0;
    for (const event of dropped) {
        const line = describe(event);
        if (line !== null)
            actions.push(line);
        if (event.type === "textDelta" || event.type === "reasoningDelta") {
            textChars += event.text.length;
        }
        if (event.type === "error")
            errors += 1;
    }
    const parts = [
        `[${dropped.length} earlier events were compacted out of the live context.]`,
    ];
    if (actions.length > 0) {
        const shown = actions.slice(0, 40);
        parts.push("Actions taken in that span:");
        for (const action of shown)
            parts.push(`  - ${action}`);
        if (actions.length > shown.length) {
            parts.push(`  - …and ${actions.length - shown.length} more`);
        }
    }
    if (textChars > 0) {
        parts.push(`Roughly ${textChars} characters of assistant output were dropped.`);
    }
    if (errors > 0) {
        parts.push(`${errors} error event(s) occurred in that span.`);
    }
    parts.push("Re-read any file you need rather than relying on memory of its earlier contents.");
    return parts.join("\n");
}
export function compactMiddle(events: readonly AgentEvent[], policy: CompactionPolicy = DEFAULT_POLICY, generation = 1): CompactionResult {
    if (policy.keepHead < 0 || policy.keepTail < 0) {
        throw new CompactionError("keepHead and keepTail must be non-negative");
    }
    if (policy.targetTokens <= 0) {
        throw new CompactionError("targetTokens must be positive");
    }
    const total = estimateTotalTokens(events);
    const noop = (): CompactionResult => ({
        events: [...events],
        marker: {
            type: "contextCompacted",
            droppedEvents: 0,
            droppedTokensEstimate: 0,
            summary: "",
            generation,
        },
        compacted: false,
    });
    if (total <= policy.targetTokens)
        return noop();
    const firstDroppable = policy.keepHead;
    const lastDroppable = events.length - policy.keepTail - 1;
    if (lastDroppable < firstDroppable)
        return noop();
    const partner = pairPartner(events);
    const drop = new Set<number>();
    let freed = 0;
    const needed = total - policy.targetTokens;
    for (let i = firstDroppable; i <= lastDroppable; i += 1) {
        if (freed >= needed)
            break;
        if (drop.has(i))
            continue;
        const mate = partner.get(i);
        if (mate !== undefined && (mate < firstDroppable || mate > lastDroppable))
            continue;
        const event = events[i];
        if (event === undefined)
            continue;
        drop.add(i);
        freed += estimateTokens(event);
        if (mate !== undefined && !drop.has(mate)) {
            const mateEvent = events[mate];
            if (mateEvent !== undefined) {
                drop.add(mate);
                freed += estimateTokens(mateEvent);
            }
        }
    }
    if (drop.size === 0)
        return noop();
    const droppedEvents: AgentEvent[] = [];
    const kept: AgentEvent[] = [];
    let spliced = false;
    const marker: Extract<AgentEvent, {
        type: "contextCompacted";
    }> = {
        type: "contextCompacted",
        droppedEvents: drop.size,
        droppedTokensEstimate: freed,
        summary: "",
        generation,
    };
    for (let i = 0; i < events.length; i += 1) {
        const event = events[i];
        if (event === undefined)
            continue;
        if (drop.has(i)) {
            droppedEvents.push(event);
            if (!spliced) {
                kept.push(marker);
                spliced = true;
            }
            continue;
        }
        kept.push(event);
    }
    const summary = summarizeSpan(droppedEvents);
    const finalMarker = { ...marker, summary };
    const finalEvents = kept.map((event) => event === marker ? finalMarker : event);
    return { events: finalEvents, marker: finalMarker, compacted: true };
}
export function compactionGeneration(events: readonly AgentEvent[]): number {
    let generation = 0;
    for (const event of events) {
        if (event.type === "contextCompacted") {
            generation = Math.max(generation, event.generation);
        }
    }
    return generation;
}
export function compactJournalWindow(lines: readonly JournalLine[], policy: CompactionPolicy = DEFAULT_POLICY): {
    readonly window: readonly JournalLine[];
    readonly result: CompactionResult;
} {
    const events = lines.map((line) => line.event);
    const generation = compactionGeneration(events) + 1;
    const result = compactMiddle(events, policy, generation);
    const window = result.events.map((event, index) => ({ seq: index, event }));
    return { window, result };
}
