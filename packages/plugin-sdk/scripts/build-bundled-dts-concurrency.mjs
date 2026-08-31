const MEMORY_BYTES_PER_BUNDLE_WORKER = 8 * 1024 ** 3;

export function computeBundleWorkerCount(
  entryCount,
  availableWorkers,
  totalMemoryBytes,
) {
  const memoryWorkers = Math.max(
    1,
    Math.floor(totalMemoryBytes / MEMORY_BYTES_PER_BUNDLE_WORKER),
  );
  return Math.max(1, Math.min(entryCount, availableWorkers, memoryWorkers));
}
