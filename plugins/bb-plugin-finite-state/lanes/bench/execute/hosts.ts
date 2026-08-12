export const BENCH_HOST_HANDLERS_IMPLEMENTED = false as const;

export async function listBenchHosts(): Promise<never> {
  throw new Error("NOT_IMPLEMENTED: WP-53 owns bench host listing");
}

export async function createBenchHostJoinCode(): Promise<never> {
  throw new Error("NOT_IMPLEMENTED: WP-53 owns bench host enrollment");
}
