import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type GitHostPullRequest, gitHostPullRequestSchema } from "@bb/domain";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";

const execFileAsync = promisify(execFile);

/** `gh` is a network round-trip; cap it so it never blocks a status poll. */
const GH_PR_VIEW_TIMEOUT_MS = 10_000;

/**
 * Explicit stdout cap rather than Node's 1 MB execFile default. The selected
 * field set is tiny (a few hundred bytes) so this is never reached today, but
 * stating the bound keeps it intentional and matches the package's git buffer
 * if the field list ever grows.
 */
const GH_PR_VIEW_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

const GH_PR_VIEW_JSON_FIELDS = "number,title,state,url,isDraft";

interface GetPullRequestForBranchArgs {
  cwd: string;
  branch: string;
}

/**
 * Parse the stdout of `gh pr view --json <fields>` into a validated
 * {@link GitHostPullRequest}. Returns `null` for any output that is not a
 * well-formed PR object (empty, non-JSON, missing/extra fields, unexpected
 * state) so callers never have to special-case malformed `gh` output.
 */
export function parseGitHostPullRequest(
  stdout: string,
): GitHostPullRequest | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const parsed = gitHostPullRequestSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Detect the open/most-relevant GitHub pull request for `branch` by shelling
 * out to the host `gh` CLI in `cwd`. Returns `null` — never throws — for every
 * "no PR" condition: `gh` not installed, not authenticated, no GitHub remote,
 * no PR for the branch, a timeout, or unparseable output. The inherited
 * environment preserves `PATH`/`HOME`/token vars so `gh` auth resolves the same
 * way it would in the user's shell.
 */
export async function getPullRequestForBranch(
  args: GetPullRequestForBranchArgs,
): Promise<GitHostPullRequest | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      // `--` ends option parsing so `branch` is always taken as the positional
      // target, never mistaken for a flag.
      ["pr", "view", "--json", GH_PR_VIEW_JSON_FIELDS, "--", args.branch],
      {
        cwd: args.cwd,
        encoding: "utf8",
        env: sanitizeInheritedChildProcessEnv({ env: process.env }),
        timeout: GH_PR_VIEW_TIMEOUT_MS,
        maxBuffer: GH_PR_VIEW_MAX_BUFFER_BYTES,
      },
    );
    return parseGitHostPullRequest(stdout);
  } catch {
    // gh-missing / not-authed / no-remote / no-PR / timeout all land here and
    // mean the same thing to the product: there is no PR to show.
    return null;
  }
}
