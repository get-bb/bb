import { z } from "zod";

const checkSchema = z
  .object({
    name: z.string(),
    status: z.enum(["success", "failure", "pending", "neutral"]),
    url: z.string().url(),
  })
  .strict();

export const mainBranchChecksSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("available"),
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
      branch: z.string().min(1),
      commit: z.string().regex(/^[0-9a-f]{40,64}$/),
      checks: z.array(checkSchema),
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: z.enum([
        "signed_out",
        "github_unavailable",
        "repository_unavailable",
      ]),
    })
    .strict(),
]);

const repositorySchema = z.object({ default_branch: z.string().min(1) });
const commitSchema = z.object({ sha: z.string().regex(/^[0-9a-f]{40,64}$/) });
const checkPagesSchema = z.array(
  z.object({
    check_runs: z.array(
      z.object({
        name: z.string(),
        status: z.string(),
        conclusion: z.string().nullable(),
        html_url: z.string().url(),
      }),
    ),
  }),
);
const statusPagesSchema = z.array(
  z.object({
    statuses: z.array(
      z.object({
        context: z.string(),
        state: z.enum(["error", "failure", "pending", "success"]),
        target_url: z.string().url().nullable(),
      }),
    ),
  }),
);

export async function readMainBranchChecks(
  gh: (args: string[]) => Promise<string>,
  repo: string,
): Promise<z.infer<typeof mainBranchChecksSchema>> {
  const { default_branch: branch } = repositorySchema.parse(
    JSON.parse(await gh(["api", `repos/${repo}`])),
  );
  const { sha: commit } = commitSchema.parse(
    JSON.parse(
      await gh(["api", `repos/${repo}/commits/${encodeURIComponent(branch)}`]),
    ),
  );
  const [checksRaw, statusesRaw] = await Promise.all([
    gh([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repo}/commits/${commit}/check-runs?filter=latest&per_page=100`,
    ]),
    gh([
      "api",
      "--paginate",
      "--slurp",
      `repos/${repo}/commits/${commit}/status?per_page=100`,
    ]),
  ]);
  const checks = checkPagesSchema.parse(JSON.parse(checksRaw)).flatMap((page) =>
    page.check_runs.map((check): z.infer<typeof checkSchema> => ({
      name: check.name,
      status:
        check.status !== "completed"
          ? "pending"
          : check.conclusion === "success"
            ? "success"
            : [
                  "failure",
                  "timed_out",
                  "action_required",
                  "cancelled",
                  "startup_failure",
                  "stale",
                ].includes(check.conclusion ?? "")
              ? "failure"
              : "neutral",
      url: check.html_url,
    })),
  );
  const statuses = statusPagesSchema
    .parse(JSON.parse(statusesRaw))
    .flatMap((page) =>
      page.statuses.map((status): z.infer<typeof checkSchema> => ({
        name: status.context,
        status: status.state === "error" ? "failure" : status.state,
        url: status.target_url ?? `https://github.com/${repo}/commit/${commit}`,
      })),
    );
  return {
    status: "available",
    repo,
    branch,
    commit,
    checks: [...checks, ...statuses],
  };
}
