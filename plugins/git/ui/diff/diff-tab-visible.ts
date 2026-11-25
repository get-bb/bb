import type { ExperimentalThreadTabProps } from "@get-bb/plugin-sdk/app";
import { useGitRepoCount, useGitStatus } from "../queries.js";

export function useDiffTabVisible({
  environment,
}: ExperimentalThreadTabProps): boolean {
  const status = useGitStatus(environment?.id ?? null);
  const notApplicable = status.result?.outcome === "not_applicable";
  const repoCount = useGitRepoCount(environment?.id ?? null, notApplicable);
  return environment !== null && (!notApplicable || (repoCount ?? 0) > 0);
}
