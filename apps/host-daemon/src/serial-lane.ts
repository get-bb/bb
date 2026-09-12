export function runInSerialLane<T>(
  lanes: Map<string, Promise<void>>,
  key: string,
  work: () => T | PromiseLike<T>,
): Promise<T> {
  const previousTail = lanes.get(key) ?? Promise.resolve();
  const next = previousTail.catch(() => undefined).then(work);
  const done = next.then(
    () => undefined,
    () => undefined,
  );
  lanes.set(key, done);
  void done.then(() => {
    if (lanes.get(key) === done) {
      lanes.delete(key);
    }
  });
  return next;
}
