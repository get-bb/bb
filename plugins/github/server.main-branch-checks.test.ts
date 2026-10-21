import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const fake = vi.hoisted(() => ({
  responses: new Map<string, string | Error>(),
  calls: [] as string[][],
}));
vi.mock("node:child_process", () => ({
  execFile(
    file: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) {
    fake.calls.push([file, ...args]);
    const response = fake.responses.get([file, ...args].join(" "));
    if (response === undefined) {
      callback(new Error("Unexpected command"), "", "Unexpected command");
    } else if (response instanceof Error) {
      callback(response, "", response.message);
    } else {
      callback(null, response, "");
    }
  },
}));

const commit = "a".repeat(40);
const hosts: ReturnType<typeof createFakePluginHost>[] = [];

beforeEach(() => {
  fake.responses.clear();
  fake.calls = [];
  fake.responses.set("gh --version", "available");
  fake.responses.set(
    "gh auth status --hostname github.com --active",
    "authenticated",
  );
  fake.responses.set(
    "git -C /checkout remote get-url origin",
    "git@github.com:acme/widgets.git\n",
  );
  fake.responses.set(
    "gh api repos/acme/widgets",
    JSON.stringify({ default_branch: "release/main" }),
  );
  fake.responses.set(
    "gh api repos/acme/widgets/commits/release%2Fmain",
    JSON.stringify({ sha: commit }),
  );
  fake.responses.set(
    `gh api --paginate --slurp repos/acme/widgets/commits/${commit}/check-runs?filter=latest&per_page=100`,
    JSON.stringify([
      {
        check_runs: [
          {
            name: "unit",
            status: "completed",
            conclusion: "failure",
            html_url: "https://github.com/acme/widgets/actions/runs/1/job/2",
          },
        ],
      },
      {
        check_runs: [
          {
            name: "build",
            status: "queued",
            conclusion: null,
            html_url: "https://github.com/acme/widgets/actions/runs/3/job/4",
          },
        ],
      },
    ]),
  );
  fake.responses.set(
    `gh api --paginate --slurp repos/acme/widgets/commits/${commit}/status?per_page=100`,
    JSON.stringify([
      {
        statuses: [
          {
            context: "external",
            state: "error",
            target_url: "https://ci.example/run/1",
          },
        ],
      },
      { statuses: [{ context: "deploy", state: "success", target_url: null }] },
    ]),
  );
});

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});

async function start() {
  const host = createFakePluginHost({
    pluginId: "github",
    sdk: {
      projects: {
        list: async () => [
          {
            id: "project",
            sources: [{ type: "local_path", path: "/checkout" }],
          },
        ],
      },
    },
  });
  hosts.push(host);
  await plugin(host.bb);
  return host.harness;
}

it.each(["rpc", "cli"] as const)(
  "reads every CI page for the resolved commit through %s",
  async (surface) => {
    const harness = await start();
    const result =
      surface === "rpc"
        ? await harness.callRpc("mainBranchChecks", { projectId: "project" })
        : JSON.parse(
            (await harness.runCli(["checks", "project", "--json"])).stdout,
          );
    expect(result).toMatchObject({
      status: "available",
      repo: "acme/widgets",
      branch: "release/main",
      commit,
      checks: [
        {
          name: "unit",
          status: "failure",
          url: "https://github.com/acme/widgets/actions/runs/1/job/2",
        },
        {
          name: "build",
          status: "pending",
          url: "https://github.com/acme/widgets/actions/runs/3/job/4",
        },
        {
          name: "external",
          status: "failure",
          url: "https://ci.example/run/1",
        },
        {
          name: "deploy",
          status: "success",
          url: `https://github.com/acme/widgets/commit/${commit}`,
        },
      ],
    });
    expect(fake.calls.filter((call) => call[1] === "api")).toHaveLength(4);
  },
);

it("returns local-tests-only when signed out without making repository API calls", async () => {
  fake.responses.set(
    "gh auth status --hostname github.com --active",
    new Error("not logged in"),
  );
  fake.responses.set(
    "gh auth token --hostname github.com",
    new Error("no oauth token"),
  );
  const harness = await start();
  await expect(
    harness.callRpc("mainBranchChecks", { projectId: "project" }),
  ).resolves.toEqual({
    status: "unavailable",
    reason: "signed_out",
  });
  expect(fake.calls.some((call) => call[1] === "api")).toBe(false);
});

it("does not misreport transient auth failures as signed out or expose credentials", async () => {
  fake.responses.set(
    "gh auth status --hostname github.com --active",
    new Error("offline"),
  );
  fake.responses.set("gh auth token --hostname github.com", "private-token");
  const harness = await start();
  await expect(
    harness.callRpc("mainBranchChecks", { projectId: "project" }),
  ).resolves.toEqual({
    status: "unavailable",
    reason: "github_unavailable",
  });
});

it("does not substitute another project or cached checks when the requested repository is unavailable", async () => {
  const harness = await start();
  await expect(
    harness.callRpc("mainBranchChecks", { projectId: "missing" }),
  ).resolves.toEqual({
    status: "unavailable",
    reason: "repository_unavailable",
  });
  fake.responses.set(
    `gh api --paginate --slurp repos/acme/widgets/commits/${commit}/status?per_page=100`,
    JSON.stringify([{ statuses: [{ context: "malformed" }] }]),
  );
  await expect(
    harness.callRpc("mainBranchChecks", { projectId: "project" }),
  ).resolves.toEqual({
    status: "unavailable",
    reason: "github_unavailable",
  });
});

it("reads a remote-host project's stored GitHub remote without opening a server checkout", async () => {
  const harness = await start();
  harness.sdk.stub("projects.get", () => ({
    gitRemoteUrl: "https://github.com/acme/widgets.git",
  }));
  await expect(
    harness.callRpc("mainBranchChecks", { projectId: "remote-project" }),
  ).resolves.toMatchObject({
    status: "available",
    repo: "acme/widgets",
    commit,
  });
  expect(fake.calls.some((call) => call[0] === "git")).toBe(false);
});
