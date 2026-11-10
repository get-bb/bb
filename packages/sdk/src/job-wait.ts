import { BbHttpError, BbRequestTimeoutError } from "./response.js";

const UNREACHABLE_LIMIT_MS = 2 * 60_000;
const UNREACHABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([
  502, 503, 504,
]);

function isUnreachableServerError(error: unknown): boolean {
  if (error instanceof BbHttpError) {
    return UNREACHABLE_HTTP_STATUSES.has(error.status);
  }
  return (
    error instanceof TypeError ||
    error instanceof BbRequestTimeoutError ||
    (error instanceof Error && error.cause instanceof TypeError)
  );
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function waitForJob<TJob>(args: {
  job: TJob | null;
  isActive: (job: TJob) => boolean;
  read: () => Promise<TJob>;
  intervalMs: number;
  signal?: AbortSignal;
  onJob?: (job: TJob) => void;
}): Promise<TJob> {
  let job = args.job;
  let unreachableSince: number | null = null;
  while (job === null || args.isActive(job)) {
    if (job !== null || unreachableSince !== null) {
      await delay(args.intervalMs, args.signal);
    }
    try {
      job = await args.read();
      unreachableSince = null;
      args.onJob?.(job);
    } catch (error) {
      if (!isUnreachableServerError(error)) throw error;
      unreachableSince ??= Date.now();
      if (Date.now() - unreachableSince >= UNREACHABLE_LIMIT_MS) throw error;
    }
  }
  return job;
}
