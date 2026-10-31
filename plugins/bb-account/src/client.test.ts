import { expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createAccountClient, watchAccount } from "./client.js";
import type { AccountStatus } from "./schemas.js";

type Step =
  | { status: AccountStatus }
  | { error: { status: number; code?: string } };

interface WatchCase {
  name: string;
  steps: Step[];
  syncResults?: boolean[];
  accounts: (string | null)[];
  calls: string[];
  warnings: number;
}

function signedIn(revision: number): Step {
  return {
    status: {
      state: "signed-in",
      revision,
      account: {
        userId: "usr_1",
        githubLogin: "sawyerhood",
        name: "Sawyer Hood",
        avatarUrl: null,
        handle: "sawyer",
        serverId: "srv_1",
        serverLabel: "sawyer",
        serverUrl: "https://sawyer.getbb.app",
        baseUrl: "https://getbb.app",
      },
    },
  };
}

function signedOut(revision: number): Step {
  return { status: { state: "signed-out", revision, account: null } };
}

function failure(status: number, code?: string): Step {
  return { error: code === undefined ? { status } : { status, code } };
}

const cases: WatchCase[] = [
  {
    name: "reports the signed-in account, then long-polls from its revision",
    steps: [signedIn(1), signedOut(2)],
    accounts: ["srv_1", null],
    calls: ["status", "waitForStatusChange(1)"],
    warnings: 0,
  },
  {
    name: "reports no account while bb account isn't running",
    steps: [failure(503), signedIn(1)],
    accounts: [null, "srv_1"],
    calls: ["status", "status"],
    warnings: 0,
  },
  {
    name: "reports no account while bb account isn't installed",
    steps: [failure(404), signedIn(1)],
    accounts: [null, "srv_1"],
    calls: ["status", "status"],
    warnings: 0,
  },
  {
    name: "keeps the account through a server-move freeze and polls again",
    steps: [signedIn(1), failure(503, "server_moving"), signedIn(1)],
    accounts: ["srv_1", "srv_1"],
    calls: ["status", "waitForStatusChange(1)", "status"],
    warnings: 1,
  },
  {
    name: "keeps the account and warns when reading it fails another way",
    steps: [signedIn(1), failure(500), signedIn(1)],
    accounts: ["srv_1", "srv_1"],
    calls: ["status", "waitForStatusChange(1)", "status"],
    warnings: 1,
  },
  {
    name: "reads the status again when the sync step changed it",
    steps: [signedOut(1), signedIn(2)],
    syncResults: [true, false],
    accounts: ["srv_1"],
    calls: ["status", "status"],
    warnings: 0,
  },
  {
    name: "syncs each revision once",
    steps: [signedIn(1), signedIn(1), signedIn(2)],
    syncResults: [false, false],
    accounts: ["srv_1", "srv_1", "srv_1"],
    calls: ["status", "waitForStatusChange(1)", "waitForStatusChange(1)"],
    warnings: 0,
  },
];

it.each(cases)("watchAccount $name", async (row) => {
  const steps = [...row.steps];
  const controller = new AbortController();
  const calls: string[] = [];
  const accounts: (string | null)[] = [];
  const synced: number[] = [];
  let warnings = 0;
  const sdk = {
    plugins: {
      callRpc: async (args: {
        method: string;
        input: { afterRevision?: number };
        outputSchema: { parse(value: unknown): unknown };
      }) => {
        calls.push(
          args.method === "bb-account.v1.waitForStatusChange"
            ? `waitForStatusChange(${args.input.afterRevision})`
            : args.method.replace("bb-account.v1.", ""),
        );
        const step = steps.shift();
        if (step === undefined) {
          controller.abort();
          throw new Error("script finished");
        }
        if ("error" in step) {
          throw Object.assign(
            new Error(`HTTP ${step.error.status}`),
            step.error,
          );
        }
        return args.outputSchema.parse(step.status);
      },
    },
  } as unknown as BbPluginApi["sdk"];
  const syncResults = row.syncResults;

  await watchAccount(
    {
      account: createAccountClient(() => sdk),
      log: {
        debug() {},
        info() {},
        warn() {
          warnings += 1;
        },
        error() {},
      },
      onAccount: (account) => accounts.push(account?.serverId ?? null),
      ...(syncResults === undefined
        ? {}
        : {
            sync: async (status: AccountStatus) => {
              synced.push(status.revision);
              return syncResults[synced.length - 1] ?? false;
            },
          }),
      retryMinMs: 1,
    },
    controller.signal,
  );

  expect(calls.slice(0, -1)).toEqual(row.calls);
  expect(accounts).toEqual(row.accounts);
  expect(warnings).toBe(row.warnings);
  if (syncResults !== undefined) {
    expect(new Set(synced).size).toBe(synced.length);
  }
});
