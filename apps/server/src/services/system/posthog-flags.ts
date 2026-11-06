import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { ServerLogger } from "../../types.js";
import type { FeatureFlagIdentity } from "./telemetry.js";

const POSTHOG_FLAGS_URL = "https://us.i.posthog.com/flags?v=2";

const flagsResponseSchema = z.object({
  flags: z.record(z.string(), z.unknown()),
});

const flagDetailSchema = z.object({
  enabled: z.boolean(),
  variant: z.string().nullable().optional(),
  metadata: z.object({ payload: z.unknown().optional() }).nullish(),
});

export interface PostHogFlag {
  variant: string | null;
  payload: unknown;
}

export async function evaluatePostHogFlag(args: {
  fetch: typeof globalThis.fetch;
  identity: FeatureFlagIdentity;
  key: string;
  logger: ServerLogger;
  timeoutMs: number;
}): Promise<PostHogFlag | null> {
  try {
    const response = await args.fetch(POSTHOG_FLAGS_URL, {
      body: JSON.stringify({
        api_key: args.identity.apiKey,
        distinct_id: args.identity.distinctId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(args.timeoutMs),
    });
    if (!response.ok) {
      args.logger.debug(
        { flag: args.key, status: response.status },
        "PostHog flag evaluation failed",
      );
      return null;
    }
    const body = flagsResponseSchema.safeParse(await response.json());
    if (!body.success) return null;
    const flag = flagDetailSchema.safeParse(body.data.flags[args.key]);
    if (!flag.success || !flag.data.enabled) return null;
    return {
      variant: flag.data.variant ?? null,
      payload: flag.data.metadata?.payload,
    };
  } catch (error) {
    args.logger.debug(
      { err: error, flag: args.key },
      "PostHog flag evaluation failed",
    );
    return null;
  }
}

export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function readAssignmentFile<T>(args: {
  path: string;
  schema: z.ZodType<T>;
  logger: ServerLogger;
}): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(args.path, "utf8");
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      args.logger.debug(
        { err: error, path: args.path },
        "Experiment assignment read failed",
      );
    }
    return null;
  }
  const parsed = args.schema.safeParse(parseJsonText(text));
  if (!parsed.success) {
    args.logger.debug(
      { path: args.path },
      "Ignoring an invalid experiment assignment file",
    );
    return null;
  }
  return parsed.data;
}

export async function writeAssignmentFile(
  path: string,
  value: unknown,
): Promise<void> {
  const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
