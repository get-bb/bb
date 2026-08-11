const environmentOperationTails = new Map<string, Promise<void>>();

export async function acquireEnvironmentOperation(
  environmentId: string,
): Promise<() => void> {
  const previous =
    environmentOperationTails.get(environmentId) ?? Promise.resolve();
  let resolveCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  environmentOperationTails.set(environmentId, current);
  await previous;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (environmentOperationTails.get(environmentId) === current) {
      environmentOperationTails.delete(environmentId);
    }
    resolveCurrent();
  };
}

export function tryAcquireEnvironmentOperations(
  environmentIds: readonly string[],
): (() => void) | null {
  const uniqueEnvironmentIds = [...new Set(environmentIds)].sort();
  const releases: (() => void)[] = [];
  for (const environmentId of uniqueEnvironmentIds) {
    if (environmentOperationTails.has(environmentId)) {
      for (const release of releases) {
        release();
      }
      return null;
    }

    let resolveCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    environmentOperationTails.set(environmentId, current);
    let released = false;
    releases.push(() => {
      if (released) return;
      released = true;
      if (environmentOperationTails.get(environmentId) === current) {
        environmentOperationTails.delete(environmentId);
      }
      resolveCurrent();
    });
  }

  return () => {
    for (const release of releases) {
      release();
    }
  };
}
