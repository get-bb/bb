export function createTestLogger() {
  return {
    debug(): void {},
    error(): void {},
    info(): void {},
    warn(): void {},
  };
}

export const testLogger = createTestLogger();
