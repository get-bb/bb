import {
  definePluginApp,
  experimental_THREAD_INFO_ROW_GROUPS,
} from "@get-bb/plugin-sdk/app";
import {
  PullRequestSegmentAction,
  PullRequestSegmentSummary,
  usePullRequestSegmentVisible,
} from "./ui/PullRequestContextSegment";
import { PullRequestInfoRow } from "./ui/PullRequestInfoRow";
import {
  PullRequestRowMetadata,
  usePullRequestRows,
} from "./ui/PullRequestRowMetadata";

const CONTEXT_SEGMENT_GROUP = "2_pullRequest";

export default definePluginApp((app) => {
  app.slots.experimental_threadContextSegment({
    id: "pull-request",
    title: "Pull request",
    group: CONTEXT_SEGMENT_GROUP,
    order: 10,
    summary: PullRequestSegmentSummary,
    action: PullRequestSegmentAction,
    useVisible: usePullRequestSegmentVisible,
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
