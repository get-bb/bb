import { execPortableFile } from "@bb/process-utils";
import type { ProviderUsageResult } from "@bb/provider-bridge-protocol";
import { z } from "zod";

const usageResponseSchema = z.object({
  status: z.literal("SUCCESS"),
  command: z.object({
    name: z.literal("usage"),
    data: z.object({
      groups: z
        .array(
          z.object({
            name: z.string().min(1),
            buckets: z
              .array(
                z.object({
                  name: z.string().min(1),
                  window: z.string().min(1),
                  remaining_fraction: z.number().min(0).max(1),
                  reset_time: z.iso.datetime({ offset: true }).nullish(),
                }),
              )
              .min(1),
          }),
        )
        .min(1),
    }),
  }),
});

export async function readAntigravityUsage(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<ProviderUsageResult> {
  try {
    const { stdout } = await execPortableFile(
      command,
      ["-p", "/usage", "--output-format", "json", "--print-timeout", "15s"],
      { cwd: process.cwd(), env, timeout: 20_000, maxBuffer: 1024 * 1024 },
    );
    const parsed = usageResponseSchema.safeParse(JSON.parse(stdout));
    if (!parsed.success) {
      return {
        supported: true,
        usage: {
          status: "error",
          accountEmail: null,
          planLabel: null,
          message: "Antigravity returned invalid usage information.",
        },
      };
    }
    return {
      supported: true,
      usage: {
        status: "ok",
        accountKey: null,
        accountEmail: null,
        planLabel: null,
        windows: parsed.data.command.data.groups.flatMap((group) =>
          group.buckets.map((bucket) => ({
            label: `${group.name}: ${bucket.name.replace(/\s+remaining$/iu, "")}`,
            model: group.name,
            kind:
              bucket.window === "5h"
                ? ("five-hour" as const)
                : bucket.window === "weekly"
                  ? ("weekly" as const)
                  : ("custom" as const),
            usedPercent:
              Math.round((1 - bucket.remaining_fraction) * 10_000) / 100,
            resetsAt: bucket.reset_time ?? null,
          })),
        ),
      },
    };
  } catch {
    return {
      supported: true,
      usage: {
        status: "error",
        accountEmail: null,
        planLabel: null,
        message:
          "Could not read Antigravity usage. Run `agy acp --login` on this machine and try again.",
      },
    };
  }
}
