const threadOperationTails = new Map<string, Promise<void>>();

export async function acquireThreadOperation(
  threadId: string,
): Promise<() => void> {
  const previous = threadOperationTails.get(threadId) ?? Promise.resolve();
  let resolveCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  threadOperationTails.set(threadId, current);
  await previous;

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    if (threadOperationTails.get(threadId) === current) {
      threadOperationTails.delete(threadId);
    }
    resolveCurrent();
  };
}

export async function acquireThreadOperations(
  threadIds: readonly string[],
): Promise<() => void> {
  const releases: (() => void)[] = [];
  try {
    for (const threadId of [...new Set(threadIds)].sort()) {
      releases.push(await acquireThreadOperation(threadId));
    }
  } catch (error) {
    for (const release of releases.reverse()) {
      release();
    }
    throw error;
  }

  return () => {
    for (const release of [...releases].reverse()) {
      release();
    }
  };
}

export function tryAcquireThreadOperation(
  threadId: string,
): (() => void) | null {
  if (threadOperationTails.has(threadId)) {
    return null;
  }

  let resolveCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  threadOperationTails.set(threadId, current);

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    if (threadOperationTails.get(threadId) === current) {
      threadOperationTails.delete(threadId);
    }
    resolveCurrent();
  };
}

export function tryAcquireThreadOperations(
  threadIds: readonly string[],
): (() => void) | null {
  const releases: (() => void)[] = [];
  for (const threadId of [...new Set(threadIds)].sort()) {
    const release = tryAcquireThreadOperation(threadId);
    if (!release) {
      for (const acquired of releases) {
        acquired();
      }
      return null;
    }
    releases.push(release);
  }

  return () => {
    for (const release of releases) {
      release();
    }
  };
}
