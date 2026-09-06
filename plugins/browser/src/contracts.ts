import {
  browserAgentControlActionSchema,
  browserControlErrorSchema,
  browserControlActionVariants,
  browserTabTargetSchema,
  browserWaitCriteriaSchema,
  browserWaitResultSchema,
  type BrowserControlAction,
  type BrowserControlError,
} from "@bb/server-contract";
import type {
  BbPluginApi,
  PluginAgentToolContext,
  PluginCliContext,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

const timeoutMsSchema = z.number().int().min(100).max(120_000).optional();
const BROWSER_BATCH_MAX_BYTES = 16 * 1024 * 1024;

const agentBrowserControlActionSchema = browserAgentControlActionSchema;

const listOperationSchema = z
  .object({
    operation: z.literal("list"),
    threadId: z.string().min(1).max(256).optional(),
    projectId: z.string().min(1).max(256).optional(),
    active: z.boolean().optional(),
  })
  .strict();

const openOperationSchema = z
  .object({
    operation: z.literal("open"),
    url: z.string().min(1).max(16_384).optional(),
    clientId: z.string().min(1).max(128).optional(),
    windowId: z.string().min(1).max(128).optional(),
    ownerId: z.string().min(1).max(256).optional(),
    threadId: z.string().min(1).max(256).optional(),
    projectId: z.string().min(1).max(256).optional(),
    timeoutMs: timeoutMsSchema,
  })
  .strict();

const runOperationSchema = z
  .object({
    operation: z.literal("run"),
    target: browserTabTargetSchema,
    action: agentBrowserControlActionSchema,
    timeoutMs: timeoutMsSchema,
  })
  .strict();
const batchOperationSchema = z
  .object({
    operation: z.literal("batch"),
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).max(128),
            action: agentBrowserControlActionSchema,
            target: browserTabTargetSchema,
          })
          .strict(),
      )
      .min(1)
      .max(16),
    concurrency: z.number().int().min(1).max(4),
    timeoutMs: z.number().int().min(100).max(120_000),
  })
  .strict();

const scriptOperationSchema = z
  .object({
    operation: z.literal("script"),
    target: browserTabTargetSchema,
    code: browserControlActionVariants.script.shape.source,
    frame: browserControlActionVariants.script.shape.frame,
    world: browserControlActionVariants.script.shape.world,
    input: browserControlActionVariants.script.shape.input.default(null),
    timeoutMs: browserControlActionVariants.script.shape.timeoutMs.default(30_000),
  })
  .strict();

const waitOperationSchema = z
  .object({
    operation: z.literal("wait"),
    target: browserTabTargetSchema,
    criteria: browserWaitCriteriaSchema,
    timeoutMs: z.number().int().min(100).max(120_000),
  })
  .strict();

const diagnosticsOperationSchema = z
  .object({
    operation: z.literal("diagnostics"),
    target: browserTabTargetSchema,
    timeoutMs: timeoutMsSchema,
  })
  .strict();
const agentScriptOperationSchema = z
  .object({
    operation: z.literal("script"),
    target: browserTabTargetSchema,
    code: browserControlActionVariants.script.shape.source,
    frame: browserControlActionVariants.script.shape.frame,
    world: browserControlActionVariants.script.shape.world,
    input: z.unknown().default(null),
    timeoutMs: browserControlActionVariants.script.shape.timeoutMs.default(30_000),
  })
  .strict();

export const browserAgentOperationSchema = z.discriminatedUnion("operation", [
  listOperationSchema,
  openOperationSchema,
  runOperationSchema,
  batchOperationSchema,
  agentScriptOperationSchema,
  waitOperationSchema,
  diagnosticsOperationSchema,
]);

export const browserOperationSchema = z
  .discriminatedUnion("operation", [
    listOperationSchema,
    openOperationSchema,
    runOperationSchema,
    batchOperationSchema,
    scriptOperationSchema,
    waitOperationSchema,
    diagnosticsOperationSchema,
  ])
  .superRefine((operation, context) => {
    if (operation.operation !== "batch") return;
    const ids = new Set(operation.items.map((item) => item.id));
    if (ids.size !== operation.items.length) {
      context.addIssue({
        code: "custom",
        message: "Browser batch item ids must be unique",
        path: ["items"],
      });
    }
    if (
      new TextEncoder().encode(JSON.stringify(operation)).byteLength >
      BROWSER_BATCH_MAX_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: "Browser batch request exceeds the aggregate byte limit",
      });
    }
  });
export type BrowserOperation = z.output<typeof browserOperationSchema>;

type BrowserContext = PluginAgentToolContext | PluginCliContext;
type BrowserAccess = Pick<BbPluginApi, "experimental_browser">;


function browserOperationError(error: unknown): BrowserControlError {
  let body: unknown = undefined;
  if (typeof error === "object" && error !== null && "body" in error) {
    body = error.body;
  }
  const parsed = browserControlErrorSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : "Browser action failed";
  const code =
    error instanceof Error && error.name.length > 0 && error.name !== "Error"
      ? error.name
      : "browser_action_failed";
  return { code, message: message.slice(0, 2_048) };
}

const diagnosticsSource = `({ signal }) => {
  if (signal.aborted) throw signal.reason;
  const entries = performance.getEntriesByType("navigation");
  const navigation = entries.length === 0 ? null : entries[entries.length - 1];
  return {
    url: location.href,
    title: document.title || null,
    readyState: document.readyState,
    bodyText: (document.body?.innerText || "").slice(0, 16_384),
    navigation: navigation === null ? null : {
      type: navigation.type,
      duration: Math.round(navigation.duration),
      domContentLoaded: Math.round(navigation.domContentLoadedEventEnd),
      load: Math.round(navigation.loadEventEnd)
    }
  };
}`;

export async function executeBrowserOperation(args: {
  browser: BrowserAccess;
  context: BrowserContext;
  defaultHomepageUrl?: string;
  operation: BrowserOperation;
}): Promise<unknown> {
  const { browser, context, defaultHomepageUrl, operation } = args;
  if (operation.operation === "list") {
    const usesContextScope =
      operation.threadId === undefined && operation.projectId === undefined;
    const threadId = usesContextScope ? context.threadId : operation.threadId;
    const projectId = usesContextScope
      ? context.projectId
      : operation.projectId;
    const filter = {
      ...(threadId === null || threadId === undefined ? {} : { threadId }),
      ...(projectId === null || projectId === undefined ? {} : { projectId }),
      ...(operation.active === undefined ? {} : { active: operation.active }),
    };
    return {
      tabs: browser.experimental_browser.listTabs(context, filter),
      owners: browser.experimental_browser.listOwners(context, filter),
    };
  }
  if (operation.operation === "open") {
    return browser.experimental_browser.openTab(
      context,
      operation.url ?? defaultHomepageUrl ?? "https://www.google.com/",
      {
        ...(operation.clientId === undefined
          ? {}
          : { clientId: operation.clientId }),
        ...(operation.windowId === undefined
          ? {}
          : { windowId: operation.windowId }),
        ...(operation.ownerId === undefined
          ? {}
          : { ownerId: operation.ownerId }),
        ...(operation.threadId === undefined
          ? {}
          : { threadId: operation.threadId }),
        ...(operation.projectId === undefined
          ? {}
          : { projectId: operation.projectId }),
        ...(operation.timeoutMs === undefined
          ? {}
          : { timeoutMs: operation.timeoutMs }),
      },
    );
  }
  if (operation.operation === "run") {
    return browser.experimental_browser.run(
      operation.target,
      operation.action,
      {
        context,
        timeoutMs: operation.timeoutMs,
      },
    );
  }
  if (operation.operation === "wait") {
    const value = await browser.experimental_browser.run(
      operation.target,
      {
        kind: "wait",
        criteria: operation.criteria,
      },
      {
        context,
        timeoutMs: operation.timeoutMs,
      },
    );
    const parsed = browserWaitResultSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error("Browser wait returned an invalid typed result");
    }
    if (parsed.data.kind !== operation.criteria.kind) {
      throw new Error("Browser wait result kind does not match the request");
    }
    return parsed.data;
  }
  if (operation.operation === "batch") {
    const results = [];
    let responseBytes = 0;
    for (
      let offset = 0;
      offset < operation.items.length;
      offset += operation.concurrency
    ) {
      const group = operation.items.slice(
        offset,
        offset + operation.concurrency,
      );
      const groupResults = await Promise.all(
        group.map(async (item) => {
          try {
            const value = await browser.experimental_browser.run(
              item.target,
              item.action,
              { context, timeoutMs: operation.timeoutMs },
            );
            return { id: item.id, ok: true as const, value };
          } catch (error) {
            return {
              id: item.id,
              ok: false as const,
              error: browserOperationError(error),
            };
          }
        }),
      );
      for (const result of groupResults) {
        const bytes = new TextEncoder().encode(
          JSON.stringify(result),
        ).byteLength;
        if (responseBytes + bytes > BROWSER_BATCH_MAX_BYTES) {
          results.push({
            id: result.id,
            ok: false,
            error: {
              code: "browser_batch_response_too_large",
              message:
                "Browser batch response exceeded the aggregate byte limit",
            },
          });
        } else {
          results.push(result);
          responseBytes += bytes;
        }
      }
    }
    return { results };
  }
  if (operation.operation === "script") {
    const input = operation.input;
    const action: BrowserControlAction = {
      kind: "script",
      source: operation.code,
      ...(operation.frame === undefined ? {} : { frame: operation.frame }),
      ...(operation.world === undefined ? {} : { world: operation.world }),
      input,
      timeoutMs: operation.timeoutMs,
    };
    return browser.experimental_browser.run(operation.target, action, {
      context,
      timeoutMs: operation.timeoutMs,
    });
  }
  const timeoutMs = operation.timeoutMs ?? 30_000;
  const [native, page] = await Promise.all([
    browser.experimental_browser.run(
      operation.target,
      { kind: "diagnostics" },
      { context, timeoutMs },
    ),
    browser.experimental_browser.run(
      operation.target,
      {
        kind: "script",
        source: diagnosticsSource,
        input: null,
        timeoutMs,
      },
      { context, timeoutMs },
    ),
  ]);
  return { native, page };
}
