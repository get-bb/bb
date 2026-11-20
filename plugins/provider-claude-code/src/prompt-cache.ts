import type { AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

export const PROMPT_CACHE_TTL_OPTION_ID = "promptCacheTtl";
export const promptCacheTtlSchema = z.enum(["auto", "5m", "1h"]);
export type PromptCacheTtl = z.infer<typeof promptCacheTtlSchema>;

export function promptCacheTtlOption(): NonNullable<
  AvailableModel["sessionOptions"]
>[number] {
  return {
    id: PROMPT_CACHE_TTL_OPTION_ID,
    type: "select",
    label: "Prompt cache TTL",
    value: "auto",
    values: [
      {
        id: "auto",
        label: "Automatic",
        description: "Use Claude Code's settings and defaults.",
      },
      {
        id: "5m",
        label: "5m · ×1.25",
        description: "API cache writes: 1.25× input price.",
      },
      {
        id: "1h",
        label: "1h · ×2",
        description: "API cache writes: 2× input price.",
      },
    ],
  };
}
