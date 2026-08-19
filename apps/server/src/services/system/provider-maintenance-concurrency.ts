const PROVIDER_MAINTENANCE_CONCURRENCY = 3;

/**
 * Provider maintenance calls can verify artifacts and start bridge workers.
 * Keep a large plugin roster from doing all of that host-local work at once
 * while preserving registry order in the response.
 */
export async function mapProviderMaintenanceRequests<TValue, TResult>(
  values: readonly TValue[],
  request: (value: TValue, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(values.length);
  const remaining = values.entries();
  const workerCount = Math.min(PROVIDER_MAINTENANCE_CONCURRENCY, values.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (const [index, value] of remaining) {
        results[index] = await request(value, index);
      }
    }),
  );

  return results;
}
