import {
  definePluginApp,
  experimental_THREAD_INFO_ROW_GROUPS,
} from "@get-bb/plugin-sdk/app";
import {
  PullRequestContextSegment,
  usePullRequestSegmentVisible,
} from "./ui/PullRequestContextSegment";
import { PullRequestInfoRow } from "./ui/PullRequestInfoRow";

export default definePluginApp((app) => {
  app.slots.experimental_threadContextSegment({
    id: "pull-request",
    title: "Pull request",
    order: 200,
    component: PullRequestContextSegment,
    useVisible: usePullRequestSegmentVisible,
  });
  app.slots.experimental_threadInfoRow({
    id: "pull-request",
    group: experimental_THREAD_INFO_ROW_GROUPS.pullRequest,
    order: 10,
    component: PullRequestInfoRow,
  });
});
