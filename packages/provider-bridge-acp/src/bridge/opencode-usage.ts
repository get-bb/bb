import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProviderUsageResult } from "@bb/provider-bridge-protocol";
import { z } from "zod";

const apiCredentialSchema = z.object({
  type: z.literal("api"),
  key: z.string().trim().min(1),
});
const credentialsSchema = z.record(z.string(), z.unknown());
const accountSchema = z.object({
  id: z.string().min(1),
  email: z.email().nullable().catch(null),
  url: z.url(),
  access_token: z.string().min(1),
  token_expiry: z.number().nullable(),
  active_org_id: z.string().min(1).nullable(),
});
const windowSchema = z.object({
  status: z.enum(["ok", "rate-limited"]),
  percent: z.number().nonnegative(),
  resetsAt: z.iso.datetime({ offset: true }),
});
const usageSchema = z.object({
  usage: z.object({
    rolling: windowSchema,
    weekly: windowSchema,
    monthly: windowSchema,
  }),
});

function dataDirectory(env: NodeJS.ProcessEnv): string {
  const dataHome = env.XDG_DATA_HOME;
  return path.join(
    dataHome && path.isAbsolute(dataHome)
      ? dataHome
      : path.join(env.HOME || os.homedir(), ".local", "share"),
    "opencode",
  );
}

async function readAccount(env: NodeJS.ProcessEnv) {
  const databasePath = path.join(dataDirectory(env), "opencode.db");
  try {
    await fs.access(databasePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('account', 'account_state')",
      )
      .all();
    if (tables.length !== 2) return null;
    const row = database
      .prepare(
        "SELECT a.id, a.email, a.url, a.access_token, a.token_expiry, s.active_org_id FROM account a JOIN account_state s ON s.active_account_id = a.id WHERE s.id = 1",
      )
      .get();
    if (!row) return null;
    const account = accountSchema.parse(row);
    const issuer = new URL(account.url);
    if (
      issuer.origin !== "https://opencode.ai" ||
      !["/", "/console", "/console/"].includes(issuer.pathname) ||
      account.active_org_id === null
    )
      return null;
    return account;
  } finally {
    database.close();
  }
}

async function readApiKey(env: NodeJS.ProcessEnv): Promise<string | null> {
  if (env.OPENCODE_API_KEY?.trim()) return env.OPENCODE_API_KEY.trim();
  let content = env.OPENCODE_AUTH_CONTENT;
  if (content) {
    try {
      JSON.parse(content);
    } catch {
      content = undefined;
    }
  }
  if (!content) {
    try {
      content = await fs.readFile(
        path.join(dataDirectory(env), "auth.json"),
        "utf8",
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    }
  }
  const credentials = credentialsSchema.parse(JSON.parse(content));
  for (const provider of ["opencode-go", "opencode"]) {
    const credential = apiCredentialSchema.safeParse(credentials[provider]);
    if (credential.success) return credential.data.key;
  }
  return null;
}

export async function readOpenCodeGoUsage(
  env: NodeJS.ProcessEnv,
): Promise<ProviderUsageResult> {
  const failure = (message: string): ProviderUsageResult => ({
    supported: true,
    usage: {
      status: "error",
      message,
      planLabel: "OpenCode Go",
      accountEmail: null,
    },
  });
  let apiKey: string | null;
  let account: Awaited<ReturnType<typeof readAccount>>;
  try {
    account = env.OPENCODE_API_KEY?.trim() ? null : await readAccount(env);
    apiKey = account?.access_token ?? (await readApiKey(env));
  } catch {
    return failure("OpenCode credentials could not be read.");
  }
  if (apiKey === null)
    return { supported: true, usage: { status: "unauthenticated" } };
  if (account?.token_expiry != null && account.token_expiry <= Date.now())
    return { supported: true, usage: { status: "expired" } };
  try {
    const response = await fetch(
      account
        ? "https://opencode.ai/inference/go/v1/usage"
        : "https://opencode.ai/zen/go/v1/usage",
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": "bb-provider-acp",
          ...(account?.active_org_id
            ? { "x-opencode-org-id": account.active_org_id }
            : {}),
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status === 401)
      return { supported: true, usage: { status: "expired" } };
    if (response.status === 403)
      return failure(
        "OpenCode Go usage access was denied. Check that the account has an active Go subscription.",
      );
    if (!response.ok)
      return failure(
        `OpenCode Go usage request failed (HTTP ${response.status}).`,
      );
    const parsed = usageSchema.safeParse(await response.json());
    if (!parsed.success)
      return failure("OpenCode Go returned invalid usage information.");
    const { rolling, weekly, monthly } = parsed.data.usage;
    return {
      supported: true,
      usage: {
        status: "ok",
        accountEmail: account?.email ?? null,
        accountKey: account
          ? `opencode:organization:${account.active_org_id}:account:${account.id}`
          : null,
        planLabel: "OpenCode Go",
        windows: [
          { label: "5 hour", kind: "five-hour", window: rolling },
          { label: "Weekly", kind: "weekly", window: weekly },
          { label: "Monthly", kind: "custom", window: monthly },
        ].map(({ label, kind, window }) => ({
          label,
          kind,
          model: null,
          usedPercent: Math.min(100, window.percent),
          resetsAt: window.resetsAt,
        })),
      },
    };
  } catch {
    return failure("OpenCode Go usage could not be collected. Try again.");
  }
}
