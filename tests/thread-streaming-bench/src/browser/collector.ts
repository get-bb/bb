import { z } from "zod";
import type { BenchPage } from "./driver.js";

export type CollectorStartOptions = {
  messageSelector: string;
  rootSelector: string;
  checkpoints: string[];
};

const collectorStartResultSchema = z.object({ startedAt: z.number() });

export const collectorProgressSchema = z.object({
  textLength: z.number(),
  checkpointHits: z.number(),
  checkpoints: z.number(),
});

export type CollectorProgress = z.infer<typeof collectorProgressSchema>;

const collectorLoafScriptSchema = z.object({
  startTime: z.number(),
  duration: z.number(),
  invoker: z.string(),
  invokerType: z.string(),
  sourceURL: z.string(),
  sourceFunctionName: z.string(),
  sourceCharPosition: z.number(),
  forcedStyleAndLayoutDuration: z.number(),
});

const collectorLoafSchema = z.object({
  startTime: z.number(),
  duration: z.number(),
  blockingDuration: z.number(),
  renderStart: z.number(),
  styleAndLayoutStart: z.number(),
  scripts: z.array(collectorLoafScriptSchema),
});

const collectorResourceSchema = z.object({
  name: z.string(),
  initiatorType: z.string(),
  startTime: z.number(),
  duration: z.number(),
  transferSize: z.number(),
  encodedBodySize: z.number(),
  decodedBodySize: z.number(),
  responseStatus: z.number(),
});

export const collectorResultSchema = z.object({
  reactHookInstalled: z.boolean(),
  rootFound: z.boolean(),
  unsupportedEntryTypes: z.array(z.string()),
  timeOrigin: z.number(),
  startedAt: z.number(),
  stoppedAt: z.number(),
  commits: z.number(),
  commitTimes: z.array(z.number()),
  frames: z.array(z.number()),
  longTasks: z.array(z.tuple([z.number(), z.number()])),
  loafs: z.array(collectorLoafSchema),
  resources: z.array(collectorResourceSchema),
  wsMessages: z.number(),
  wsBytes: z.number(),
  checkpoints: z.array(z.string()),
  checkpointHits: z.array(z.number()),
  samples: z.array(z.tuple([z.number(), z.number()])),
  addedNodes: z.number(),
  removedNodes: z.number(),
});

export type CollectorResult = z.infer<typeof collectorResultSchema>;

export function collectorStartExpression(
  options: CollectorStartOptions,
): string {
  return `window.__bbStreamBench.start(${JSON.stringify(options)})`;
}

export const COLLECTOR_PROGRESS_EXPRESSION =
  "window.__bbStreamBench.progress()";
export const COLLECTOR_STOP_EXPRESSION = "window.__bbStreamBench.stop()";

export async function startCollector(
  page: BenchPage,
  options: CollectorStartOptions,
): Promise<{ startedAt: number }> {
  return collectorStartResultSchema.parse(
    await page.evaluate(collectorStartExpression(options)),
  );
}

export async function readCollectorProgress(
  page: BenchPage,
): Promise<CollectorProgress> {
  return collectorProgressSchema.parse(
    await page.evaluate(COLLECTOR_PROGRESS_EXPRESSION),
  );
}

export async function stopCollector(page: BenchPage): Promise<CollectorResult> {
  return collectorResultSchema.parse(
    await page.evaluate(COLLECTOR_STOP_EXPRESSION),
  );
}
