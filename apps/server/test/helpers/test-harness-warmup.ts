let pendingWarmup: (() => Promise<void>) | null = null;

export function registerTestHarnessWarmup(warmup: () => Promise<void>): void {
  pendingWarmup = warmup;
}

export async function warmTestHarness(): Promise<void> {
  const warmup = pendingWarmup;
  pendingWarmup = null;
  await warmup?.();
}
