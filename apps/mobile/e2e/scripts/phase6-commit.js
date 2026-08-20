// Maestro runScript: commit the dirty worktree of the thread titled
// THREAD_TITLE through `POST /environments/:id/actions` so the Diff tab's
// target picker gains the "Committed changes" target. Env: SERVER_URL,
// THREAD_TITLE (Maestro exposes flow env as globals).
const threads = json(http.get(`${SERVER_URL}/api/v1/threads`).body);
const thread = threads.find(
  (entry) => entry.title === THREAD_TITLE && !entry.archivedAt,
);
if (!thread) {
  throw new Error(`No thread titled ${THREAD_TITLE}`);
}
const response = http.post(
  `${SERVER_URL}/api/v1/environments/${thread.environmentId}/actions`,
  {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "commit" }),
  },
);
if (!response.ok) {
  throw new Error(`commit failed: ${response.status} ${response.body}`);
}
output.commitSha = json(response.body).commitSha;
