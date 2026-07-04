import { skillBundlesQueryKey } from "../queries/query-keys";
import type { QueryClientArg } from "../cache-effect-types";

export function invalidateSkillBundles({ queryClient }: QueryClientArg): void {
  queryClient.invalidateQueries({ queryKey: skillBundlesQueryKey() });
}
