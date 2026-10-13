import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { HostedConnectApi } from "./hosted.js";
import { redeemMachineCode } from "./machine-code.js";

export type ServerAccessCloud = Pick<
  HostedConnectApi,
  "createMachineCode" | "lookupMachineCode" | "revokeMachine"
> & {
  redeemMachineCode: typeof redeemMachineCode;
};

export function createServerAccessCloud(
  hosted: HostedConnectApi,
): ServerAccessCloud {
  return {
    createMachineCode: (signal) => hosted.createMachineCode(signal),
    lookupMachineCode: (code, signal) => hosted.lookupMachineCode(code, signal),
    revokeMachine: (machineId, signal) =>
      hosted.revokeMachine(machineId, signal),
    redeemMachineCode,
  };
}

const SIGN_IN_REQUIRED = "Sign in to your bb account to use bb connect";

const grantSchema = z.object({
  connectMachineId: z.string().min(1),
  grant: z.object({
    id: z.string().min(1),
    serverUrl: z.string().url(),
    headers: z.record(z.string(), z.string()),
  }),
});

export function createServerAccessRecheck(
  bb: BbPluginApi,
): (status: { paired: boolean; enabled: boolean; url: string | null }) => void {
  let last: string | null = null;
  return (status) => {
    const signature = `${status.paired}:${status.enabled}:${status.url ?? ""}`;
    const changed = last !== null && last !== signature;
    last = signature;
    if (changed) bb.experimental_serverAccess.recheck();
  };
}

function acquisitionFailure(message: string) {
  return { status: "failed" as const, message };
}

function grantKey(hostId: string): string {
  return `server-access-grant:${hostId}`;
}

export async function registerServerAccess(
  bb: BbPluginApi,
  deps: {
    cloud: ServerAccessCloud;
    status(): { paired: boolean; enabled: boolean; url: string | null };
  },
) {
  const { cloud } = deps;
  const intentSchema = z.object({
    key: z.string(),
    hostId: z.string(),
    code: z.string(),
    expiresAt: z.number().finite(),
    serverUrl: z.string().url(),
  });
  const stateSchema = z.union([
    z.object({ result: grantSchema }),
    z.object({ intent: intentSchema }),
  ]);
  let queue = Promise.resolve();
  function serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function load(hostId: string) {
    const raw = await bb.storage.kv.get<unknown>(grantKey(hostId));
    return raw === undefined ? undefined : stateSchema.parse(raw);
  }
  function requireSignedIn(action: string): void {
    if (!deps.status().paired) throw new Error(`${SIGN_IN_REQUIRED} ${action}`);
  }
  async function reconcile(
    intent: z.infer<typeof intentSchema>,
    signal: AbortSignal,
  ) {
    requireSignedIn("to revoke machine access");
    try {
      const status = await cloud.lookupMachineCode(intent.code, signal);
      if (status.consumed && !status.machineId)
        throw new Error("Device identity unavailable");
      if (status.machineId) await cloud.revokeMachine(status.machineId, signal);
      return status.consumed;
    } catch {
      signal.throwIfAborted();
      const message =
        "Cloud device may need dashboard revocation: interrupted machine access acquisition; retry after Cloud lookup is available";
      return acquisitionFailure(message);
    }
  }
  bb.experimental_serverAccess.register({
    id: "connect",
    displayName: "bb connect",
    description: "Use a private getbb.app address.",
    availability: () => {
      const status = deps.status();
      if (!status.paired) {
        return { status: "setup-required", message: SIGN_IN_REQUIRED };
      }
      if (!status.enabled) {
        return {
          status: "setup-required",
          message: "Turn on remote access with bb connect on",
        };
      }
      return {
        status: "available",
        ...(status.url ? { serverUrl: status.url } : {}),
      };
    },
    acquire({ key, hostId, signal }) {
      return serialized(async () => {
        signal.throwIfAborted();
        const existing = await load(hostId);
        if (existing && "result" in existing) return existing.result.grant;
        requireSignedIn("to add machines");
        let intent = existing?.intent;
        if (intent) {
          const reconciliation = await reconcile(intent, signal);
          if (typeof reconciliation !== "boolean") return reconciliation;
          if (reconciliation || intent.expiresAt <= Date.now())
            intent = undefined;
        }
        if (!intent) {
          const code = await cloud.createMachineCode(signal);
          intent = {
            key,
            hostId,
            code: code.code,
            serverUrl: code.serverUrl,
            expiresAt: code.expiresAt,
          };
        }
        signal.throwIfAborted();
        await bb.storage.kv.set(grantKey(hostId), { intent });
        signal.throwIfAborted();
        const pending = intent;
        const redeemed = await cloud
          .redeemMachineCode({ ...pending, signal })
          .catch(() => {
            signal.throwIfAborted();
            return null;
          });
        if (redeemed === null)
          return acquisitionFailure(
            "Cloud device may need dashboard revocation: interrupted machine access acquisition",
          );
        const grant = {
          id: hostId,
          serverUrl: redeemed.serverUrl,
          headers: { "x-bb-connect-machine": redeemed.credential },
        };
        await bb.storage.kv.set(grantKey(hostId), {
          result: { connectMachineId: redeemed.machineId, grant },
        });
        return grant;
      });
    },
    release({ hostId }) {
      return serialized(async () => {
        const stored = await load(hostId);
        if (!stored) return;
        if ("intent" in stored) {
          const reconciliation = await reconcile(
            stored.intent,
            AbortSignal.timeout(30_000),
          );
          if (typeof reconciliation !== "boolean")
            throw new Error(reconciliation.message);
          if (!reconciliation && stored.intent.expiresAt > Date.now())
            throw new Error(
              "Machine access acquisition is still unsettled; cleanup will retry after redemption or code expiry",
            );
        } else {
          requireSignedIn("to revoke machine access");
          await cloud.revokeMachine(stored.result.connectMachineId);
        }
        await bb.storage.kv.delete(grantKey(hostId));
      });
    },
  });
}
