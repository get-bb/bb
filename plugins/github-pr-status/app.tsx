import {
  definePluginApp,
  experimental_THREAD_INFO_ROW_GROUPS,
} from "@get-bb/plugin-sdk/app";
import {
  PullRequestSegmentAction,
  PullRequestSegmentSummary,
  usePullRequestSegmentVisible,
} from "./ui/PullRequestContextSegment";
import { PullRequestContextCardRow } from "./ui/PullRequestContextCardRow";
import { PullRequestInfoRow } from "./ui/PullRequestInfoRow";
import {
  PullRequestRowMetadata,
  usePullRequestRows,
} from "./ui/PullRequestRowMetadata";

export default definePluginApp((app) => {
  app.slots.experimental_threadContextItem({
    id: "pull-request",
    title: "Pull request",
    group: experimental_THREAD_INFO_ROW_GROUPS.pullRequest,
    order: 10,
    banner: {
      summary: PullRequestSegmentSummary,
      action: PullRequestSegmentAction,
      useVisible: usePullRequestSegmentVisible,
    },
    card: { row: PullRequestContextCardRow },
  });
  app.slots.experimental_threadInfoRow({
    id: "pull-request",
    group: experimental_THREAD_INFO_ROW_GROUPS.pullRequest,
    order: 10,
    component: PullRequestInfoRow,
  });
  app.slots.experimental_threadRowMetadata({
    id: "pull-request",
    useData: usePullRequestRows,
    component: PullRequestRowMetadata,
  });
});
