export const BENCH_JOB_SERVICE_IMPLEMENTED = false as const;

export async function runBenchJobService(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
