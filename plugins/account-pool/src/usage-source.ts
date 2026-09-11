import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import type { AccountSummary } from "./contracts.js";
import type { AccountPoolHub } from "./hub.js";
import {
  usageInputSchema,
  usageSnapshotSchema,
  type UsageSnapshot,
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

export function usagePlanLabel(
  account: Pick<AccountSummary, "subscriptionType" | "rateLimitTier">,
): string | null {
  const maxMatch = (account.rateLimitTier ?? "").match(/max_(\d+)x/u);
  if (maxMatch) return `Max (${maxMatch[1]}x)`;
  const subscription = account.subscriptionType;
  return subscription
    ? subscription.charAt(0).toUpperCase() + subscription.slice(1)
    : null;
}

export function registerUsageSource(bb: BbPluginApi, hub: AccountPoolHub) {
  bb.rpc.register(
    defineRpcContract({
      "provider-usage.v1.get": {
        experimental_description:
          "Returns a complete snapshot of pooled account usage across hosts. refresh=true asks the pool to refresh eligible OAuth accounts; busy accounts retain their previous observation time. API key accounts may not expose usage. Unknown measurements are not reported as zero.",
        input: usageInputSchema,
        output: usageSnapshotSchema,
      },
    }),
    {
      async "provider-usage.v1.get"({ refresh }) {
        await hub.refreshUsage(undefined, refresh);
        const { accounts } = await hub.status();
        const resources: UsageSnapshot["resources"] = accounts.map(
          (account) => {
            const windows: Extract<
              UsageSnapshot["resources"][number]["usage"],
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
                id,
                label,
                usedPercent: Math.round(utilization * 100),
                resetsAt: reset === null ? null : new Date(reset).toISOString(),
                model,
                cost: null,
              });
            };
            if (account.limitWindows.length > 0) {
              for (const window of account.limitWindows) {
                add(
                  window.slot,
                  usageWindowLabel(window.windowMinutes, window.slot),
                  window.utilization,
                  window.resetAt,
                  null,
                );
              }
            } else {
              add(
                "five-hour",
                "Five-hour limit",
                account.fiveHourUtilization,
                account.fiveHourResetAt,
                null,
              );
              add(
                "weekly",
                "Weekly limit",
                account.sevenDayUtilization,
                account.sevenDayResetAt,
                null,
              );
            }
            for (const [family, window] of Object.entries(
              account.familyWeekly,
            )) {
              if (window !== null)
                add(
                  `weekly:${family}`,
                  `Weekly · ${family}`,
                  window.utilization,
                  window.resetAt,
                  family,
                );
            }
            const accountFields = {
              accountEmail: account.email,
              planLabel: usagePlanLabel(account),
            };
            const error =
              account.error ??
              (account.observedAt === null
                ? "Usage has not been observed for this account."
                : null);
            return {
              id: account.id,
              providerId:
                account.provider === "claude" ? "claude-code" : "codex",
              label: account.label,
              scope: { kind: "shared" },
              observedAt: account.observedAt,
              usage:
                error === null
                  ? { status: "ok", ...accountFields, windows }
                  : { status: "error", ...accountFields, message: error },
            };
          },
        );
        return { label: "Account Pooler", resources };
      },
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Usage windows for Account Pooler's shared accounts, independent of routing settings and host-local credentials.",
    },
  );
}
