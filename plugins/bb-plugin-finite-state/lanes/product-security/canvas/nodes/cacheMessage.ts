export const REFRESH_FAILURE_CACHE_MESSAGE =
  "The last product-security refresh failed; showing accepted cache.";

const FILE_DIAGNOSTIC_MARKERS = [
  "Unsupported component type",
  "Retired component type",
  "Invalid working YAML",
] as const;

export interface ArchitectureCacheSignals {
  refreshFailed: boolean;
  fileDiagnostics: string | null;
}

export function architectureCacheSignals(
  message: string | null,
): ArchitectureCacheSignals {
  if (!message) return { refreshFailed: false, fileDiagnostics: null };
  const diagnosticIndex = FILE_DIAGNOSTIC_MARKERS.reduce<number>(
    (earliest, marker) => {
      const index = message.indexOf(marker);
      return index >= 0 && (earliest < 0 || index < earliest)
        ? index
        : earliest;
    },
    -1,
  );
  return {
    refreshFailed: message.includes(REFRESH_FAILURE_CACHE_MESSAGE),
    fileDiagnostics:
      diagnosticIndex >= 0 ? message.slice(diagnosticIndex).trim() : null,
  };
}
