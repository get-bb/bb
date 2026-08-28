export interface DeferredPromise<T> {
  promise: Promise<T>;
  reject: <Reason>(reason?: Reason) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

export function createDeferredPromise<T>(): DeferredPromise<T> {
  let reject: DeferredPromise<T>["reject"] | null = null;
  let resolve: DeferredPromise<T>["resolve"] | null = null;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  if (!resolve || !reject) {
    throw new Error("Failed to create deferred promise");
  }
  return {
    promise,
    reject,
    resolve,
  };
}
