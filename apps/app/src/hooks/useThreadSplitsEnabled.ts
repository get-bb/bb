import { useSystemConfig } from "@/hooks/queries/system-queries";

/**
 * Thread splits fail closed until system config has loaded. This avoids split
 * chrome flashing for the default-off experience while preserving the stored
 * layout for a later opt-in.
 */
export function useThreadSplitsEnabled(): boolean {
  const systemConfig = useSystemConfig();
  return systemConfig.data?.experiments.threadSplits === true;
}
