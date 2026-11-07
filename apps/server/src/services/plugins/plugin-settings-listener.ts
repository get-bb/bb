const deferredListenerFailures = new WeakSet<Promise<unknown>>();

export function deferredListenerFailure(failure: Promise<unknown>): Promise<unknown> {
  deferredListenerFailures.add(failure);
  return failure;
}

export function callSettingsListener(
  listener: (...args: never[]) => unknown,
  args: readonly unknown[],
  reportFailure: (error: unknown) => void,
): void {
  let result: unknown;
  try {
    result = (listener as (...callArgs: unknown[]) => unknown)(...args);
  } catch (error) {
    reportFailure(error);
    return;
  }
  if (result instanceof Promise && deferredListenerFailures.has(result)) {
    void result.then((error) => {
      if (error !== null) reportFailure(error);
    });
  }
}
