import { experimentKeySchema } from "@bb/domain";
import { useSystemConfig } from "@/hooks/queries/system-queries";

export function useExperiment(key: string): boolean {
  const { data } = useSystemConfig();
  const parsed = experimentKeySchema.safeParse(key);
  return parsed.success && data?.experiments[parsed.data] === true;
}
