export const BENCH_VERDICT_HANDLER_IMPLEMENTED = false as const;

export async function getOtaVerdict(): Promise<never> {
  throw new Error("NOT_IMPLEMENTED: WP-55 owns bench verdict evaluation");
}
