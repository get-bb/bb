import { getThreadLocationPath } from "@/lib/route-paths";
import {
  openThreadInSplit,
  type OpenThreadInSplitArgs,
} from "./openThreadInSplit";

interface OpenThreadArgs extends OpenThreadInSplitArgs {
  split: boolean;
}

export function openThread({ split, ...args }: OpenThreadArgs): void {
  if (split) {
    openThreadInSplit(args);
    return;
  }
  const { navigate, projectId, threadId, messageSeq, state } = args;
  navigate(
    getThreadLocationPath({
      projectId,
      threadId,
      ...(messageSeq === undefined ? {} : { messageSeq }),
    }),
    state === undefined ? undefined : { state },
  );
}
