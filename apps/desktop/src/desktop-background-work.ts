import { z } from "zod";

const queueSchema = z.array(z.object({ sendAt: z.number().nullable() }));
const automationsSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    automations: z.array(
      z.object({
        automation: z.object({
          enabled: z.boolean(),
          nextRunAt: z.number().nullable(),
          lastRunStatus: z.string().nullable(),
        }),
      }),
    ),
  }),
});

export async function hasPendingDesktopWork(
  serverUrl: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const [queueResponse, automationsResponse] = await Promise.all([
    fetchImpl(new URL("/api/v1/queued-messages", serverUrl), {
      signal: AbortSignal.timeout(5_000),
    }),
    fetchImpl(
      new URL(
        "/api/v1/plugins/automations/rpc/automations_overview",
        serverUrl,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
        signal: AbortSignal.timeout(5_000),
      },
    ),
  ]);
  if (!queueResponse.ok) throw new Error("Could not read scheduled messages");
  const queue = queueSchema.parse(await queueResponse.json());
  if (queue.some((message) => message.sendAt !== null)) return true;
  if (automationsResponse.status === 404) return false;
  if (!automationsResponse.ok) throw new Error("Could not read automations");
  const { result } = automationsSchema.parse(await automationsResponse.json());
  return result.automations.some(
    ({ automation }) =>
      (automation.enabled && automation.nextRunAt !== null) ||
      automation.lastRunStatus === "running",
  );
}

export async function closeLastDesktopWindow(args: {
  platform: NodeJS.Platform;
  isQuitting(): boolean;
  hasOpenWindows(): boolean;
  hasPendingWork(): Promise<boolean>;
  quit(): void;
  onError(error: unknown): void;
}): Promise<void> {
  if (args.platform === "darwin" || args.isQuitting()) return;
  if (args.platform === "win32") {
    try {
      if (await args.hasPendingWork()) return;
    } catch (error) {
      args.onError(error);
      return;
    }
  }
  if (!args.isQuitting() && !args.hasOpenWindows()) args.quit();
}
