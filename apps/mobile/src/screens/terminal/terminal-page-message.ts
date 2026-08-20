import { z } from "zod";
import type { TerminalPageMessage } from "./terminal-bridge";

/**
 * Parser for page → host payloads (`onMessage`), kept apart from
 * `terminal-bridge.ts` so the page bundle does not carry zod.
 */
function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const terminalPageMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  z.object({ type: z.literal("data"), dataBase64: z.string() }),
  z.object({
    type: z.literal("resize"),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("link"),
    // Link text comes from terminal output (anything the host process
    // prints); only web URLs may leave the page.
    url: z.string().url().refine(isWebUrl, "http(s) only"),
  }),
  z.object({ type: z.literal("title"), title: z.string() }),
  z.object({ type: z.literal("text-mirror"), lines: z.array(z.string()) }),
  z.object({ type: z.literal("error"), message: z.string() }),
]) satisfies z.ZodType<TerminalPageMessage>;

/** Parse a page → host payload; null for anything unexpected. */
export function parseTerminalPageMessage(
  raw: string,
): TerminalPageMessage | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = terminalPageMessageSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}
