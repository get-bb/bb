import { z } from "zod";

/**
 * Zod schemas for well-known tool arguments used by both Claude Code and Pi
 * bridges.
 *
 * These tools genuinely use different arg names across SDK versions, so the
 * schemas express the real variants rather than picking one.
 */

export const bashArgsSchema = z
  .object({
    command: z.string().optional(),
    cwd: z.string().optional(),
  })
  .passthrough();

export const textBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const contentWrapperSchema = z
  .object({
    content: z.array(z.unknown()),
  })
  .passthrough();
