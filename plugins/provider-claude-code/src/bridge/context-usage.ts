import { z } from "zod";
import {
  contextSnapshotSchema,
  type ContextCategory,
  type ContextEntry,
  type ContextSnapshot,
} from "@get-bb/plugin-sdk/provider-bridge";

const tokens = z.number().int().nonnegative();
const namedTokens = z.object({ name: z.string().min(1), tokens });
const reportSchema = z.object({
  categories: z.array(
    namedTokens.extend({ isDeferred: z.boolean().default(false) }),
  ),
  totalTokens: tokens,
  rawMaxTokens: z.number().int().positive(),
  model: z.string().min(1),
  autoCompactThreshold: z.number().int().positive().optional(),
  isAutoCompactEnabled: z.boolean(),
  memoryFiles: z
    .array(z.object({ path: z.string(), type: z.string(), tokens }))
    .default([]),
  mcpTools: z
    .array(
      namedTokens.extend({
        serverName: z.string(),
        isLoaded: z.boolean().default(true),
      }),
    )
    .default([]),
  deferredBuiltinTools: z
    .array(namedTokens.extend({ isLoaded: z.boolean() }))
    .default([]),
  systemTools: z.array(namedTokens).default([]),
  systemPromptSections: z.array(namedTokens).default([]),
  agents: z
    .array(z.object({ agentType: z.string(), source: z.string(), tokens }))
    .default([]),
  skills: z
    .object({
      skillFrontmatter: z.array(namedTokens.extend({ source: z.string() })),
    })
    .optional(),
  messageBreakdown: z
    .object({
      toolCallTokens: tokens,
      toolResultTokens: tokens,
      attachmentTokens: tokens,
      assistantMessageTokens: tokens,
      userMessageTokens: tokens,
      redirectedContextTokens: tokens,
      unattributedTokens: tokens,
    })
    .optional(),
});

type Report = z.infer<typeof reportSchema>;
type Category = Report["categories"][number];

function categoryKind(category: Category): ContextCategory["kind"] {
  if (category.isDeferred) return "deferred";
  switch (category.name.toLowerCase()) {
    case "free space":
      return "free";
    case "autocompact buffer":
    case "manual compact buffer":
      return "reserved";
    default:
      return "used";
  }
}

function categoryEntries(report: Report, category: Category): ContextEntry[] {
  let entries: { name: string; tokens: number }[] = [];
  switch (category.name.toLowerCase()) {
    case "system prompt":
      entries = report.systemPromptSections;
      break;
    case "system tools":
      entries = report.systemTools;
      break;
    case "system tools (deferred)":
      entries = report.deferredBuiltinTools.filter((tool) => !tool.isLoaded);
      break;
    case "mcp tools":
    case "mcp tools (deferred)":
      entries = report.mcpTools
        .filter((tool) => tool.isLoaded !== category.isDeferred)
        .map((tool) => ({
          name: `${tool.serverName}: ${tool.name}`,
          tokens: tool.tokens,
        }));
      break;
    case "memory files":
      entries = report.memoryFiles.map((file) => ({
        name: file.path,
        tokens: file.tokens,
      }));
      break;
    case "custom agents":
    case "agents":
      entries = report.agents.map((agent) => ({
        name: `${agent.agentType} (${agent.source})`,
        tokens: agent.tokens,
      }));
      break;
    case "skills":
      entries = report.skills?.skillFrontmatter ?? [];
      break;
    case "messages": {
      const breakdown = report.messageBreakdown;
      if (breakdown) {
        entries = [
          { name: "Tool results", tokens: breakdown.toolResultTokens },
          {
            name: "Assistant messages",
            tokens: breakdown.assistantMessageTokens,
          },
          { name: "User messages", tokens: breakdown.userMessageTokens },
          { name: "Tool calls", tokens: breakdown.toolCallTokens },
          { name: "Attachments", tokens: breakdown.attachmentTokens },
          {
            name: "Redirected context",
            tokens: breakdown.redirectedContextTokens,
          },
          { name: "Unattributed", tokens: breakdown.unattributedTokens },
        ];
      }
    }
  }
  if (entries.reduce((sum, entry) => sum + entry.tokens, 0) > category.tokens)
    return [];
  const occurrences = new Map<string, number>();
  return entries
    .filter((entry) => entry.tokens > 0)
    .map((entry) => {
      const occurrence = occurrences.get(entry.name) ?? 0;
      occurrences.set(entry.name, occurrence + 1);
      return {
        id: JSON.stringify([entry.name, occurrence]),
        label: entry.name,
        tokens: entry.tokens,
      };
    });
}

export function normalizeClaudeContextUsage(
  value: unknown,
  metadata: Pick<
    ContextSnapshot,
    "capturedAt" | "providerSessionId" | "providerTurnId"
  >,
): ContextSnapshot {
  const report = reportSchema.parse(value);
  const occurrences = new Map<string, number>();
  return contextSnapshotSchema.parse({
    ...metadata,
    model: report.model,
    usedTokens: report.totalTokens,
    contextWindowTokens: report.rawMaxTokens,
    autoCompactAtTokens: report.isAutoCompactEnabled
      ? (report.autoCompactThreshold ?? null)
      : null,
    estimated: true,
    categories: report.categories.map((category) => {
      const occurrence = occurrences.get(category.name) ?? 0;
      occurrences.set(category.name, occurrence + 1);
      return {
        id: JSON.stringify(["claude", category.name, occurrence]),
        label: category.name,
        kind: categoryKind(category),
        tokens: category.tokens,
        entries: categoryEntries(report, category),
      };
    }),
  });
}

export class ClaudeContextUsageCollector {
  private revision = 0;

  invalidate(): void {
    this.revision += 1;
  }

  async capture(args: {
    read: () => Promise<unknown>;
    isCurrent: () => boolean;
    publish: (snapshot: ContextSnapshot) => void;
    providerSessionId: string;
  }): Promise<void> {
    const revision = ++this.revision;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const report = await Promise.race([
        args.read(),
        new Promise<null>((resolve) => {
          timeout = setTimeout(() => resolve(null), 5_000);
          timeout.unref();
        }),
      ]);
      if (report === null || revision !== this.revision || !args.isCurrent())
        return;
      args.publish(
        normalizeClaudeContextUsage(report, {
          capturedAt: new Date().toISOString(),
          providerSessionId: args.providerSessionId,
          providerTurnId: null,
        }),
      );
    } catch {
      return;
    } finally {
      clearTimeout(timeout);
    }
  }
}
