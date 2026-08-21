import { getThreadRoutePath } from "@bb/client-core";

/**
 * Links to a thread on its server (the web app path from client-core): the
 * browser URL for "Copy link" / "Open in web". The native `bb://` deep link
 * (same path) arrives with universal links in Phase 5.
 */
export function buildThreadWebUrl({
  serverUrl,
  projectId,
  threadId,
}: {
  serverUrl: string;
  projectId: string;
  threadId: string;
}): string {
  const base = serverUrl.replace(/\/+$/u, "");
  return `${base}${getThreadRoutePath({ projectId, threadId })}`;
}
