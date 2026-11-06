import { type BbPluginApi } from "@get-bb/plugin-sdk";
import type { AccountSummary } from "./contracts.js";
import type { AccountPoolHub } from "./hub.js";
import {
  usageSourceRpcContract,
  usageListMethod,
  usageFetchMethod,
  type UsageResource,
} from "./usage-contract.js";

export function usageWindowLabel(
  minutes: number | null,
  fallback: string,
): string {
  if (minutes === 300) return "Five-hour limit";
  if (minutes === 1_440) return "Daily limit";
  if (minutes === 10_080) return "Weekly limit";
  if (minutes === null) return fallback;
  return minutes % 1_440 === 0
    ? `${minutes / 1_440} day limit`
    : `${minutes / 60} hour limit`;
}

export function usagePlan(
  account: Pick<AccountSummary, "subscriptionType" | "rateLimitTier">,
): { id: string; label: string } | null {
  const tier = account.rateLimitTier ?? "";
  if (/max_20x/u.test(tier)) return { id: "ultra", label: "Ultra" };
  if (/max_\d+x/u.test(tier)) return { id: "max", label: "Max" };
  const subscription = account.subscriptionType;
  return subscription
    ? {
        id: subscription.toLowerCase(),
        label: subscription.charAt(0).toUpperCase() + subscription.slice(1),
      }
    : null;
}

function accountKey(account: AccountSummary): string | null {
  return account.provider === "codex"
    ? account.codexAccountId
      ? `openai:chatgpt:${account.codexAccountId}`
      : null
    : account.accountUuid
      ? `anthropic:account:${account.accountUuid}`
      : null;
}

async function subscriptionAccounts(
  hub: AccountPoolHub,
): Promise<AccountSummary[]> {
  const { accounts } = await hub.status();
  return accounts.filter((account) => account.kind === "oauth");
}

export function registerUsageSource(bb: BbPluginApi, hub: AccountPoolHub) {
  bb.rpc.register(
    usageSourceRpcContract,
    {
      async [usageListMethod]() {
        const accounts = await subscriptionAccounts(hub);
        return {
          label: "Account Pooler",
          resources: accounts.map((account) => ({
            id: account.id,
            accountKey: accountKey(account),
            providerId: account.provider === "claude" ? "claude-code" : "codex",
            label:
              account.email ??
              (account.provider === "claude" ? "Claude Code" : "Codex"),
            scope: { kind: "shared" as const },
          })),
        };
      },
      async [usageFetchMethod]({ resourceId, refresh }) {
        if (
          !(await subscriptionAccounts(hub)).some(
            (account) => account.id === resourceId,
          )
        )
          throw new Error("Usage resource no longer exists.");
        await hub.refreshUsage(resourceId, refresh);
        const accounts = (await subscriptionAccounts(hub)).filter(
          (account) => account.id === resourceId,
        );
        if (accounts.length === 0)
          throw new Error("Usage resource no longer exists.");
        const resources: UsageResource[] = accounts.map((account) => {
          const windows: Extract<
            UsageResource["usage"],
            { status: "ok" }
          >["windows"] = [];
          const add = (
            id: string,
            label: string,
            utilization: number | null,
            reset: number | null,
            model: string | null,
          ) => {
            if (utilization === null) return;
            windows.push({
              kind:
                label === "Five-hour limit"
                  ? "five-hour"
                  : label === "Daily limit"
                    ? "daily"
                    : label.startsWith("Weekly")
                      ? "weekly"
                      : "custom",
              id,
              label,
              usedPercent: Math.round(utilization * 100),
              resetsAt: reset === null ? null : new Date(reset).toISOString(),
              model,
              cost: null,
            });
          };
          for (const window of account.limitWindows) {
            add(
              window.slot,
              usageWindowLabel(window.windowMinutes, window.slot),
              window.utilization,
              window.resetAt,
              null,
            );
          }
          for (const [family, window] of Object.entries(account.familyWeekly)) {
            if (window !== null)
              add(
                `weekly:${family}`,
                `Weekly · ${family}`,
                window.utilization,
                window.resetAt,
                family,
              );
          }
          const plan = usagePlan(account);
          const accountFields = {
            plan: plan ? { id: plan.id, multiplier: null } : null,
            accountEmail: account.email,
            planLabel: plan?.label ?? null,
          };
          const error =
            (account.error === null
              ? null
              : "Usage could not be collected for this account. Try refreshing usage.") ??
            (account.observedAt === null
              ? "Usage has not been observed for this account."
              : null);
          return {
            id: account.id,
            accountKey: accountKey(account),
            providerId: account.provider === "claude" ? "claude-code" : "codex",
            label: account.label,
            scope: { kind: "shared" },
            observedAt: account.observedAt,
            usage:
              error === null
                ? { status: "ok", ...accountFields, windows }
                : { status: "error", ...accountFields, message: error },
          };
        });
        const resource = resources[0]!;
        return {
          accountKey: resource.accountKey,
          observedAt: resource.observedAt,
          usage: resource.usage,
        };
      },
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Usage windows for Account Pooler's signed-in subscription accounts, independent of routing settings and host-local credentials. API-key accounts have no usage windows and are not listed.",
    },
  );
}
