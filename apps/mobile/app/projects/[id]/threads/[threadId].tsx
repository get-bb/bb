import { Redirect, useLocalSearchParams } from "expo-router";
import { threadHref } from "@/screens/shell/hrefs";

/** Web deep-link alias (`/projects/:projectId/threads/:threadId`) → `/threads/:id`. */
export default function ProjectThreadAlias() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  return <Redirect href={threadHref(threadId)} />;
}
