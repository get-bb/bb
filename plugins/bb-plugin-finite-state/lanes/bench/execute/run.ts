export const BENCH_RUN_HANDLER_IMPLEMENTED = false as const;

export async function runBench(): Promise<never> {
  throw new Error("NOT_IMPLEMENTED: WP-53 owns bench run execution");
}
