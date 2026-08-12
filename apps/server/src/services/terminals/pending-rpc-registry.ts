export interface PendingRpcKey {
  rpcKey: string;
}

interface PendingRpcEntry<TKey, TResult> {
  key: TKey;
  promise: Promise<TResult>;
  reject: (error: Error) => void;
  resolve: (result: TResult) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

type PendingRpcRegistryOptions<TKey, TResult> = (
  | { timeoutError: (key: TKey) => Error; timeoutMs: number }
  | { timeoutMs: null }
) & {
  onFail?: (key: TKey, error: Error) => void;
  onSettle?: (key: TKey, result: TResult) => void;
};

export interface PendingRpcClaim<TResult> {
  created: boolean;
  promise: Promise<TResult>;
}

export class PendingRpcRegistry<TKey extends PendingRpcKey, TResult> {
  private readonly entries = new Map<string, PendingRpcEntry<TKey, TResult>>();

  constructor(
    private readonly options: PendingRpcRegistryOptions<TKey, TResult>,
  ) {}

  claim(key: TKey): PendingRpcClaim<TResult> {
    const existing = this.entries.get(key.rpcKey);
    if (existing) {
      return { created: false, promise: existing.promise };
    }
    let resolveResult: (result: TResult) => void = () => undefined;
    let rejectResult: (error: Error) => void = () => undefined;
    const promise = new Promise<TResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const entry: PendingRpcEntry<TKey, TResult> = {
      key,
      promise,
      reject: rejectResult,
      resolve: resolveResult,
      timeout: null,
    };
    const timeout = this.options;
    if (timeout.timeoutMs !== null) {
      entry.timeout = setTimeout(() => {
        if (this.entries.get(key.rpcKey) !== entry) return;
        this.entries.delete(key.rpcKey);
        const error = timeout.timeoutError(key);
        this.options.onFail?.(key, error);
        entry.reject(error);
      }, timeout.timeoutMs);
    }
    this.entries.set(key.rpcKey, entry);
    return { created: true, promise };
  }

  settle(rpcKey: string, result: TResult): boolean {
    const entry = this.take(rpcKey);
    if (!entry) return false;
    this.options.onSettle?.(entry.key, result);
    entry.resolve(result);
    return true;
  }

  fail(rpcKey: string, error: Error): boolean {
    const entry = this.take(rpcKey);
    if (!entry) return false;
    this.options.onFail?.(entry.key, error);
    entry.reject(error);
    return true;
  }

  cancel(rpcKey: string): boolean {
    return this.take(rpcKey) !== null;
  }

  failAllMatching(
    matches: (key: TKey) => boolean,
    error: Error | ((key: TKey) => Error),
  ): number {
    let failed = 0;
    for (const entry of [...this.entries.values()]) {
      if (!matches(entry.key)) continue;
      this.clear(entry);
      const failure = typeof error === "function" ? error(entry.key) : error;
      this.options.onFail?.(entry.key, failure);
      entry.reject(failure);
      failed += 1;
    }
    return failed;
  }

  private take(rpcKey: string): PendingRpcEntry<TKey, TResult> | null {
    const entry = this.entries.get(rpcKey);
    if (!entry) return null;
    this.clear(entry);
    return entry;
  }

  private clear(entry: PendingRpcEntry<TKey, TResult>): void {
    if (entry.timeout) clearTimeout(entry.timeout);
    this.entries.delete(entry.key.rpcKey);
  }
}
