export const pathological = `This response deliberately mixes the constructs that are hardest for a streaming markdown renderer. Every section below is ordinary content on its own, but together they stress block splitting, math detection, long lists, and very large code and table blocks while text keeps arriving.

The first case is a dollar sign inside inline code. A renderer that looks for display math before it looks for code spans will treat the rest of the document as an unterminated formula.

Run \`echo $$\` to print the PID.

If the paragraph after this one renders as plain text, the inline code was handled correctly and nothing after it was swallowed by a math block.

The second case is a loose list, where every item is separated by a blank line. Loose lists wrap each item in its own paragraph, which multiplies the number of block elements a renderer has to reconcile on every update.

- Confirm the migration applies cleanly to a copy of the largest production database.

- Run the rollback migration on the same copy and compare the schema dump with the original.

- Record how long the migration takes on the copy and add a third as a safety margin.

- Check that no query in the release scans the events table without using an index.

- Verify that the new index is created concurrently so writes are not blocked.

- Make sure every new environment variable has a default that is safe in production.

- Document every new environment variable in the operations guide.

- Confirm that secrets are read from the secret store and never from the repository.

- Rotate the staging credentials that were shared in the incident channel last week.

- Check that feature flags for unfinished work default to off in every environment.

- Remove flags that have been fully rolled out for more than one release.

- Verify that the build uses the pinned toolchain versions from the lock file.

- Confirm the production bundle contains no development only logging.

- Check the bundle size report against the budget and explain any growth above two percent.

- Make sure source maps are uploaded to the error tracker and not served publicly.

- Run the full test suite on the release branch, not only the changed packages.

- Rerun any test that was retried during CI and confirm it passes on its own.

- File an issue for every flaky test observed during the release cycle.

- Run the end to end suite against staging with production like data volumes.

- Test the upgrade path from the previous two releases, not only the most recent one.

- Install the release on a clean machine with no cached configuration.

- Install the release on a machine that has the previous version running.

- Confirm that the desktop app updates itself without asking for administrator rights.

- Check that the mobile build number is higher than the one currently in review.

- Verify that push notifications still arrive after the app has been in the background overnight.

- Test sign in with every supported identity provider.

- Test sign out and confirm that local caches are cleared.

- Confirm that an expired session shows the sign in screen instead of an error page.

- Check that password reset emails render correctly in the three most common mail clients.

- Verify that rate limits apply per account and not per server instance.

- Check that the API returns problem details for every validation error.

- Confirm the API documentation matches the routes that actually shipped.

- Regenerate the client SDK and check the diff for unexpected breaking changes.

- Run the SDK examples against staging and confirm each one completes.

- Verify that deprecated endpoints log a warning with the caller user agent.

- Check that webhook payloads include the new fields and keep the old ones.

- Replay a day of production webhooks against staging and compare delivery rates.

- Confirm that the retry scheduler respects the per host concurrency limit.

- Check that the dead letter queue is empty before the release starts.

- Verify that background jobs scheduled before the deploy still run after it.

- Confirm that long running jobs drain gracefully when a worker receives a shutdown signal.

- Check the job dashboard for queues whose depth has been growing all week.

- Make sure every new metric has a unit in its name or description.

- Add dashboards for the new endpoints before they receive traffic.

- Set alert thresholds that match what the documentation promises customers.

- Test each new alert by triggering it in staging.

- Confirm the on call rotation for release week includes someone who worked on the change.

- Update the runbook for every alert whose behavior changed.

- Check that log lines for new code paths include the request id.

- Verify that logs contain no personal data that the privacy policy does not allow.

- Confirm that audit events are written for every administrative action.

- Check that data exports include the new tables where customers expect them.

- Verify that account deletion removes rows from the new tables.

- Run the accessibility checker on every new screen.

- Navigate every new dialog using only the keyboard.

- Check every new screen with the operating system text size set to the largest option.

- Confirm that color is never the only signal for a status.

- Test the dark theme on every new component.

- Review new strings for tone and make sure they are ready for translation.

- Check that translated strings do not overflow their containers in German.

- Verify that dates and numbers use the locale of the user and not of the server.

- Confirm that time zones are handled correctly for users east of UTC.

- Test the app on the oldest browser version the support policy still covers.

- Check memory usage after leaving the app open on a busy thread for an hour.

- Profile the slowest screen with CPU throttling enabled.

- Confirm that scrolling a long thread stays smooth while a response is streaming.

- Check that images load lazily and have explicit dimensions.

- Verify that the service worker serves the new assets after the update.

- Confirm that offline mode shows cached threads and a clear banner.

- Test reconnecting after the network drops in the middle of a response.

- Check that the websocket reconnects with backoff and does not hammer the server.

- Verify that the server rejects connections from outdated clients with a helpful message.

- Confirm the minimum supported client version is updated in the server configuration.

- Check that the CLI prints a clear error when the server version is too old.

- Run the CLI help output through a spell checker.

- Confirm every new CLI flag appears in the reference documentation.

- Test the CLI on Windows, macOS, and Linux.

- Verify that shell completion scripts include the new commands.

- Check that plugin authors are warned about any API that changes behavior.

- Build every first party plugin against the new SDK.

- Install a community plugin from the marketplace and confirm it still loads.

- Confirm that the plugin sandbox blocks access outside the plugin data directory.

- Review the dependency updates in the release for known vulnerabilities.

- Check licenses of new dependencies against the approved list.

- Remove dependencies that are no longer imported anywhere.

- Confirm the container image is built from the patched base image.

- Scan the container image and triage every high severity finding.

- Verify that the deploy pipeline refuses images that were not built by CI.

- Check that the canary receives a representative share of traffic.

- Define the metrics that decide whether the canary is promoted.

- Decide in advance who can stop the rollout and how they do it.

- Practice the rollback on staging and time it.

- Make sure the previous release artifacts are still available for rollback.

- Confirm database backups completed successfully in the last twenty four hours.

- Test restoring the latest backup into an isolated environment.

- Check disk space on database hosts before running the migration.

- Confirm that replicas are caught up before promoting the new schema.

- Verify that cache keys include a version so old entries are not read by new code.

- Warm the cache for the most popular pages after the deploy.

- Check the CDN configuration for new routes that should not be cached.

- Confirm that the status page has a draft ready in case the release causes an incident.

- Prepare the support team with a summary of changes and known issues.

- Write release notes that describe changes from the point of view of users.

- Link every release note entry to its issue or pull request.

- Check that screenshots in the documentation match the new interface.

- Update the changelog in the repository and in the app.

- Tag the release commit and push the tag.

- Confirm the release build was produced from the tagged commit.

- Announce the release in the community channels after it is fully rolled out.

- Watch error rates for the first hour and compare them with the previous release.

- Check support tickets for the first day and group them by feature.

- Review performance dashboards at the end of the first day.

- Close the release milestone and move unfinished issues to the next one.

- Remove temporary logging that was added to debug the release.

- Clean up staging data that was created for release testing.

- Schedule the retrospective while the details are still fresh.

- Record the actual release duration next to the estimate.

- Update this checklist with anything that was missed this time.

- Thank the people who stayed late to get the release out.

- Take a break before starting the next release cycle.

That is the whole checklist. The third case is a single fenced code block that is long enough to span several screens, so a renderer that re-highlights the whole block on every delta will fall behind while the block is still open.

\`\`\`ts
import { createHash } from "node:crypto";

export type BlockKind =
  | "paragraph"
  | "heading"
  | "fence"
  | "list"
  | "table"
  | "quote"
  | "math"
  | "rule";

export interface MarkdownBlock {
  kind: BlockKind;
  start: number;
  end: number;
  closed: boolean;
  digest: string;
}

interface FenceState {
  marker: "\`" | "~";
  length: number;
  start: number;
}

interface SplitterState {
  offset: number;
  blocks: MarkdownBlock[];
  pending: string;
  fence: FenceState | null;
  mathOpen: boolean;
}

const FENCE_PATTERN = /^( {0,3})(\`{3,}|~{3,})(.*)$/;
const HEADING_PATTERN = /^ {0,3}#{1,6}(?:\\s|$)/;
const LIST_PATTERN = /^ {0,3}(?:[-+*]|\\d{1,9}[.)])\\s/;
const TABLE_PATTERN = /^ {0,3}\\|/;
const QUOTE_PATTERN = /^ {0,3}>/;
const RULE_PATTERN = /^ {0,3}(?:(?:-\\s*){3,}|(?:\\*\\s*){3,}|(?:_\\s*){3,})$/;
const MATH_PATTERN = /^ {0,3}\\$\\$\\s*$/;
export function createSplitterState(): SplitterState {
  return {
    offset: 0,
    blocks: [],
    pending: "",
    fence: null,
    mathOpen: false,
  };
}

function digestOf(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function classifyLine(line: string): BlockKind {
  if (HEADING_PATTERN.test(line)) {
    return "heading";
  }
  if (RULE_PATTERN.test(line)) {
    return "rule";
  }
  if (LIST_PATTERN.test(line)) {
    return "list";
  }
  if (TABLE_PATTERN.test(line)) {
    return "table";
  }
  if (QUOTE_PATTERN.test(line)) {
    return "quote";
  }
  return "paragraph";
}

function continuesBlock(block: MarkdownBlock, line: string): boolean {
  if (line.trim().length === 0) {
    return block.kind === "list";
  }
  switch (block.kind) {
    case "heading":
    case "rule":
      return false;
    case "list":
      return LIST_PATTERN.test(line) || /^\\s{2,}\\S/.test(line);
    case "table":
      return TABLE_PATTERN.test(line);
    case "quote":
      return QUOTE_PATTERN.test(line);
    case "paragraph":
      return classifyLine(line) === "paragraph";
    case "fence":
    case "math":
      return true;
  }
}

function openBlock(
  state: SplitterState,
  kind: BlockKind,
  start: number,
): MarkdownBlock {
  const block: MarkdownBlock = {
    kind,
    start,
    end: start,
    closed: false,
    digest: "",
  };
  state.blocks.push(block);
  return block;
}

function closeLastBlock(state: SplitterState, source: string): void {
  const last = state.blocks.at(-1);
  if (last === undefined || last.closed) {
    return;
  }
  last.closed = true;
  last.digest = digestOf(source.slice(last.start, last.end));
}

function handleFenceLine(
  state: SplitterState,
  line: string,
  lineStart: number,
  lineEnd: number,
): boolean {
  const match = FENCE_PATTERN.exec(line);
  if (state.fence !== null) {
    const block = state.blocks.at(-1);
    if (block !== undefined) {
      block.end = lineEnd;
    }
    if (
      match !== null &&
      match[2]?.[0] === state.fence.marker &&
      (match[2]?.length ?? 0) >= state.fence.length &&
      (match[3] ?? "").trim().length === 0
    ) {
      state.fence = null;
      return true;
    }
    return true;
  }
  if (match === null) {
    return false;
  }
  const marker = match[2]?.[0] === "~" ? "~" : "\`";
  state.fence = {
    marker,
    length: match[2]?.length ?? 3,
    start: lineStart,
  };
  const block = openBlock(state, "fence", lineStart);
  block.end = lineEnd;
  return true;
}

function handleMathLine(
  state: SplitterState,
  line: string,
  lineStart: number,
  lineEnd: number,
): boolean {
  if (!MATH_PATTERN.test(line) && !state.mathOpen) {
    return false;
  }
  if (!state.mathOpen) {
    state.mathOpen = true;
    const block = openBlock(state, "math", lineStart);
    block.end = lineEnd;
    return true;
  }
  const block = state.blocks.at(-1);
  if (block !== undefined) {
    block.end = lineEnd;
  }
  if (MATH_PATTERN.test(line)) {
    state.mathOpen = false;
  }
  return true;
}

export function appendChunk(
  state: SplitterState,
  source: string,
  chunk: string,
): MarkdownBlock[] {
  state.pending += chunk;
  const settled: MarkdownBlock[] = [];
  let newline = state.pending.indexOf("\\n");
  while (newline !== -1) {
    const line = state.pending.slice(0, newline);
    const lineStart = state.offset;
    const lineEnd = lineStart + newline + 1;
    state.pending = state.pending.slice(newline + 1);
    state.offset = lineEnd;
    const before = state.blocks.length;
    if (
      !handleFenceLine(state, line, lineStart, lineEnd) &&
      !handleMathLine(state, line, lineStart, lineEnd)
    ) {
      const last = state.blocks.at(-1);
      if (last !== undefined && !last.closed && continuesBlock(last, line)) {
        last.end = lineEnd;
      } else if (line.trim().length > 0) {
        closeLastBlock(state, source);
        openBlock(state, classifyLine(line), lineStart).end = lineEnd;
      } else {
        closeLastBlock(state, source);
      }
    }
    for (const block of state.blocks.slice(Math.max(0, before - 1))) {
      if (block.closed && !settled.includes(block)) {
        settled.push(block);
      }
    }
    newline = state.pending.indexOf("\\n");
  }
  return settled;
}

export function finish(state: SplitterState, source: string): MarkdownBlock[] {
  if (state.pending.length > 0) {
    appendChunk(state, source, "\\n");
  }
  state.fence = null;
  state.mathOpen = false;
  closeLastBlock(state, source);
  return state.blocks;
}

export function unsettledTail(state: SplitterState, source: string): string {
  const last = state.blocks.at(-1);
  if (last === undefined || last.closed) {
    return state.pending;
  }
  return source.slice(last.start, state.offset) + state.pending;
}

export function summarize(blocks: readonly MarkdownBlock[]): string {
  const counts = new Map<BlockKind, number>();
  for (const block of blocks) {
    counts.set(block.kind, (counts.get(block.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => \`\${kind}=\${count}\`)
    .join(" ");
}
\`\`\`

The fourth case is a wide table with sixty rows. Tables are expensive because a new row can change column widths for every row above it, and many renderers rebuild the entire table element whenever a row is appended.

| # | Scenario | Chunk | Interval (ms) | CPU | p50 (ms) | p95 (ms) | Long frames | Verdict |
| --: | :-- | --: | --: | :-- | --: | --: | --: | :-- |
| 1 | default | 8 | 30 | 1x | 14.8 | 28.1 | 0 | ok |
| 2 | default | 8 | 60 | 1x | 14.0 | 28.1 | 0 | ok |
| 3 | default | 8 | 30 | 4x | 49.1 | 89.5 | 3 | ok |
| 4 | default | 8 | 60 | 4x | 45.5 | 87.7 | 3 | ok |
| 5 | default | 24 | 30 | 1x | 18.9 | 38.3 | 0 | ok |
| 6 | default | 24 | 60 | 1x | 16.8 | 31.0 | 0 | ok |
| 7 | default | 24 | 30 | 4x | 61.8 | 120.5 | 6 | slow |
| 8 | default | 24 | 60 | 4x | 57.3 | 117.5 | 6 | ok |
| 9 | default | 64 | 30 | 1x | 23.7 | 44.4 | 0 | ok |
| 10 | default | 64 | 60 | 1x | 22.2 | 43.9 | 0 | ok |
| 11 | default | 64 | 30 | 4x | 79.6 | 143.2 | 8 | slow |
| 12 | default | 64 | 60 | 4x | 73.6 | 139.8 | 7 | slow |
| 13 | default | 256 | 30 | 1x | 38.6 | 77.2 | 2 | ok |
| 14 | default | 256 | 60 | 1x | 34.9 | 63.6 | 1 | ok |
| 15 | default | 256 | 30 | 4x | 129.0 | 248.4 | 17 | slow |
| 16 | default | 256 | 60 | 4x | 119.1 | 241.3 | 16 | slow |
| 17 | default | 1024 | 30 | 1x | 70.4 | 130.2 | 7 | slow |
| 18 | default | 1024 | 60 | 1x | 65.2 | 127.1 | 6 | slow |
| 19 | default | 1024 | 30 | 4x | 239.7 | 491.3 | 37 | janky |
| 20 | default | 1024 | 60 | 4x | 219.9 | 412.3 | 30 | janky |
| 21 | long | 8 | 30 | 1x | 33.5 | 66.2 | 1 | ok |
| 22 | long | 8 | 60 | 1x | 30.2 | 54.3 | 0 | ok |
| 23 | long | 8 | 30 | 4x | 111.9 | 212.6 | 14 | slow |
| 24 | long | 8 | 60 | 4x | 103.4 | 206.8 | 13 | slow |
| 25 | long | 24 | 30 | 1x | 41.1 | 75.0 | 2 | ok |
| 26 | long | 24 | 60 | 1x | 38.2 | 73.6 | 2 | ok |
| 27 | long | 24 | 30 | 4x | 140.3 | 284.1 | 20 | slow |
| 28 | long | 24 | 60 | 4x | 128.4 | 237.6 | 16 | slow |
| 29 | long | 64 | 30 | 1x | 53.9 | 105.1 | 5 | ok |
| 30 | long | 64 | 60 | 1x | 50.0 | 102.6 | 4 | ok |
| 31 | long | 64 | 30 | 4x | 181.5 | 340.4 | 24 | janky |
| 32 | long | 64 | 60 | 4x | 167.4 | 330.7 | 23 | janky |
| 33 | long | 256 | 30 | 1x | 86.1 | 155.0 | 9 | slow |
| 34 | long | 256 | 60 | 1x | 79.6 | 151.3 | 8 | slow |
| 35 | long | 256 | 30 | 4x | 293.5 | 587.1 | 45 | janky |
| 36 | long | 256 | 60 | 4x | 269.4 | 491.7 | 37 | janky |
| 37 | long | 1024 | 30 | 1x | 160.4 | 308.8 | 22 | janky |
| 38 | long | 1024 | 60 | 1x | 148.0 | 299.7 | 21 | slow |
| 39 | long | 1024 | 30 | 4x | 543.9 | 1006.1 | 80 | janky |
| 40 | long | 1024 | 60 | 4x | 500.8 | 976.5 | 77 | janky |
| 41 | pathological | 8 | 30 | 1x | 46.6 | 95.5 | 4 | ok |
| 42 | pathological | 8 | 60 | 1x | 42.3 | 79.2 | 2 | ok |
| 43 | pathological | 8 | 30 | 4x | 155.7 | 307.6 | 21 | janky |
| 44 | pathological | 8 | 60 | 4x | 142.6 | 256.7 | 17 | slow |
| 45 | pathological | 24 | 30 | 1x | 57.4 | 109.1 | 5 | ok |
| 46 | pathological | 24 | 60 | 1x | 53.2 | 106.5 | 5 | ok |
| 47 | pathological | 24 | 30 | 4x | 193.9 | 353.9 | 25 | janky |
| 48 | pathological | 24 | 60 | 4x | 178.8 | 344.2 | 25 | janky |
| 49 | pathological | 64 | 30 | 1x | 75.0 | 151.9 | 8 | slow |
| 50 | pathological | 64 | 60 | 1x | 68.4 | 126.5 | 6 | slow |
| 51 | pathological | 64 | 30 | 4x | 252.5 | 492.5 | 37 | janky |
| 52 | pathological | 64 | 60 | 4x | 232.8 | 477.2 | 36 | janky |
| 53 | pathological | 256 | 30 | 1x | 120.0 | 225.0 | 15 | slow |
| 54 | pathological | 256 | 60 | 1x | 110.8 | 218.9 | 14 | slow |
| 55 | pathological | 256 | 30 | 4x | 407.0 | 732.6 | 57 | janky |
| 56 | pathological | 256 | 60 | 4x | 374.8 | 712.2 | 55 | janky |
| 57 | pathological | 1024 | 30 | 1x | 223.1 | 446.2 | 33 | janky |
| 58 | pathological | 1024 | 60 | 1x | 204.6 | 373.4 | 27 | janky |
| 59 | pathological | 1024 | 30 | 4x | 756.3 | 1455.9 | 117 | janky |
| 60 | pathological | 1024 | 60 | 4x | 696.3 | 1409.9 | 113 | janky |

Those numbers are illustrative rather than measured, but the shape is realistic. Larger chunks produce fewer updates with more work in each one, and throttling the CPU multiplies whatever cost the renderer pays per update.

The last case is simply ordinary prose after all of the heavy blocks. A renderer that only memoizes settled blocks should render this paragraph without touching anything above it, and the final sentence should appear as soon as its last chunk arrives.

That is the end of the pathological fixture.
`;
