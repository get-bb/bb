import {
  type EnvironmentDisplayInfo,
  formatEnvironmentDisplay,
} from "@bb/core-ui";
import { resolveEnvironmentMergeBaseBranch } from "@bb/domain";
import type { BbSdk } from "@bb/sdk";

export interface ThreadEnvironmentInfo {
  baseBranch: string | null;
  display: EnvironmentDisplayInfo;
  effectiveMergeBaseBranch: string | undefined;
  hostId: string;
  mergeBaseBranch: string | null;
}

export async function fetchEnvironmentInfo(args: {
  environmentId: string;
  sdk: BbSdk;
}): Promise<ThreadEnvironmentInfo | null> {
  try {
    const env = await args.sdk.environments.get({
      environmentId: args.environmentId,
    });
    return {
      baseBranch: env.baseBranch,
      display: formatEnvironmentDisplay({
        environment: env,
        host: {
          locality: "local",
          identity: null,
        },
      }),
      effectiveMergeBaseBranch: resolveEnvironmentMergeBaseBranch(env),
      hostId: env.hostId,
      mergeBaseBranch: env.mergeBaseBranch,
    };
  } catch {
    return null;
  }
}

export function printEnvironmentInfo(env: ThreadEnvironmentInfo): void {
  console.log(`  Environment: ${env.display.modeLabel} (${env.display.id})`);
  if (env.baseBranch) {
    console.log(`    Base branch: ${env.baseBranch}`);
  }
  if (env.mergeBaseBranch) {
    console.log(`    Merge-base override: ${env.mergeBaseBranch}`);
  }
  if (env.effectiveMergeBaseBranch) {
    console.log(`    Effective merge base: ${env.effectiveMergeBaseBranch}`);
  }
}
