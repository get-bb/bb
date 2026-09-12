import { z } from "zod";
import type { BenchPage } from "./driver.js";

type CollectorPage = Pick<BenchPage, "evaluate">;

const collectorProgressSchema = z.object({
  textLength: z.number(),
  checkpointHits: z.number(),
  checkpoints: z.number(),
});

const collectorResultSchema = z.object({
  commits: z.number(),
  frames: z.array(z.number()),
  longTasks: z.array(z.tuple([z.number(), z.number()])),
  loafs: z.array(
    z.object({
      duration: z.number(),
      blockingDuration: z.number(),
      scripts: z.array(
        z.object({
          duration: z.number(),
          invoker: z.string(),
          sourceURL: z.string(),
          sourceFunctionName: z.string(),
          forcedStyleAndLayoutDuration: z.number(),
        }),
      ),
    }),
  ),
  checkpointHits: z.array(z.number()),
  samples: z.array(z.tuple([z.number(), z.number()])),
  addedNodes: z.number(),
  removedNodes: z.number(),
});

export async function startCollector(
  page: CollectorPage,
  options: {
    checkpoints: string[];
    messageSelector: string;
    rootSelector: string;
  },
): Promise<void> {
  await page.evaluate(
    `window.__bbStreamBench.start(${JSON.stringify(options)})`,
  );
}

export async function readCollectorProgress(
  page: CollectorPage,
): Promise<z.infer<typeof collectorProgressSchema>> {
  return collectorProgressSchema.parse(
    await page.evaluate("window.__bbStreamBench.progress()"),
  );
}

export async function stopCollector(
  page: CollectorPage,
): Promise<z.infer<typeof collectorResultSchema>> {
  return collectorResultSchema.parse(
    await page.evaluate("window.__bbStreamBench.stop()"),
  );
}
