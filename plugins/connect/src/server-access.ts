import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createHash } from "node:crypto";
import { lookupMachineCode } from "./machine-code.js";
import type { ConnectTunnel } from "./tunnel.js";
import { fetchMachineCode } from "./machine-code.js";
import { revokeMachine } from "./revoke-machine.js";
import { redeemMachineCode } from "./redeem.js";

const grantSchema = z.object({
  connectMachineId: z.string().min(1),
  grant: z.object({
    id: z.string().min(1),
    serverUrl: z.string().url(),
    headers: z.record(z.string(), z.string()),
  }),
});

const metadataSchema = z.strictObject({
  grantId: z.string().optional(),
  key: z.string().optional(),
  message: z.string().optional(),
  quarantined: z.boolean().optional(),
  connectMachineId: z.string().optional(),
  connectMachineIds: z.array(z.string()).optional(),
  codeId: z.string().optional(),
});

function recoveryError(message: string): Error {
  return Object.assign(new Error(message), {
    name: "experimental_ServerAccessRecoveryError",
  });
}

function grantKey(hostId: string): string {
  return `server-access-grant:${hostId}`;
}

export async function registerServerAccess(
  bb: BbPluginApi,
  tunnel: {
    getCredential: ConnectTunnel["getCredential"];
    status(): { paired: boolean };
  },
) {
  const secrets = bb.storage.experimental_secrets;
  const intentSchema = z.object({
    key: z.string(),
    hostId: z.string(),
    code: z.string(),
    expiresAt: z.number().finite().nullable().default(null),
    serverUrl: z.string().url(),
  });
  const stateSchema = z.record(
    z.string(),
    z.object({
      result: grantSchema.optional(),
      intent: intentSchema.optional(),
    }),
  );
  let queue = Promise.resolve();
  function serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function readState() {
    const raw = await secrets.get("machineAccessSecrets");
    try {
      return stateSchema.parse(raw ? JSON.parse(raw) : {});
    } catch {
      throw new Error("Stored machine access credentials are invalid");
    }
  }
  async function storeState(state: z.infer<typeof stateSchema>) {
    await secrets.set("machineAccessSecrets", JSON.stringify(state));
  }
  async function load(hostId: string) {
    const state = await readState();
    const raw = await bb.storage.kv.get(grantKey(hostId));
    const legacy = grantSchema.safeParse(raw);
    if (legacy.success) {
      state[hostId] = { result: legacy.data };
      await storeState(state);
      await bb.storage.kv.set(grantKey(hostId), {
        connectMachineId: legacy.data.connectMachineId,
        grantId: legacy.data.grant.id,
      });
    } else if (raw !== undefined && !metadataSchema.safeParse(raw).success) {
      const identifiers = z
        .object({
          connectMachineId: z.string().optional().catch(undefined),
          connectMachineIds: z.array(z.string()).optional().catch(undefined),
        })
        .safeParse(raw);
      await bb.storage.kv.set(grantKey(hostId), {
        ...(identifiers.success ? identifiers.data : {}),
        grantId: hostId,
        quarantined: true,
      });
      bb.log.warn(
        "Malformed legacy access record scrubbed; cleanup requires attention",
      );
    }
    return state;
  }
  async function reconcile(
    hostId: string,
    intent: z.infer<typeof intentSchema>,
  ) {
    const credential = tunnel.getCredential();
    if (!credential)
      throw new Error(
        "Pair this bb instance with bb connect to revoke machine access",
      );
    try {
      const status = await lookupMachineCode(credential, intent.code);
      if (status.consumed && !status.machineId)
        throw new Error("Device identity unavailable");
      if (status.machineId) await revokeMachine(credential, status.machineId);
      return status.consumed;
    } catch {
      const message =
        "Cloud device may need dashboard revocation: interrupted machine access acquisition; retry after Cloud lookup is available";
      await bb.storage.kv.set(grantKey(hostId), {
        grantId: hostId,
        key: intent.key,
        codeId: createHash("sha256").update(intent.code).digest("hex"),
        message,
      });
      throw recoveryError(message);
    }
  }
  await serialized(async () => {
    for (const key of await bb.storage.kv.list("server-access-grant:")) {
      await load(key.slice("server-access-grant:".length));
    }
  });
  bb.experimental_serverAccess.register({
    id: "connect",
    displayName: "bb connect",
    experimental_attention: async () => {
      let count = 0;
      for (const key of await bb.storage.kv.list("server-access-grant:")) {
        const metadata = metadataSchema.safeParse(await bb.storage.kv.get(key));
        if (metadata.success && metadata.data.quarantined) count += 1;
      }
      return count > 0 ? `${count} legacy access records need attention` : null;
    },
    availability: () =>
      tunnel.status().paired
        ? { status: "available" }
        : {
            status: "setup-required",
            message: "Pair this bb instance with bb connect",
          },
    acquire({ key, hostId, signal }) {
      return serialized(async () => {
        signal.throwIfAborted();
        const state = await load(hostId);
        const existing = state[hostId];
        if (existing?.result) return existing.result.grant;
        const credential = tunnel.getCredential();
        if (!credential)
          throw new Error("Pair this bb instance with bb connect");
        const metadata = metadataSchema.safeParse(
          await bb.storage.kv.get(grantKey(hostId)),
        );
        if (metadata.success && metadata.data.quarantined)
          throw recoveryError(
            "Legacy access record needs attention before machine access can be acquired",
          );
        if (!existing?.intent && metadata.success) {
          if (metadata.data.connectMachineId)
            await revokeMachine(credential, metadata.data.connectMachineId);
          else if (metadata.data.codeId)
            throw recoveryError(
              "Cloud device may need dashboard revocation: acquisition secret is missing",
            );
        }
        let intent = existing?.intent;
        if (intent) {
          const consumed = await reconcile(hostId, intent);
          if (
            consumed ||
            intent.expiresAt === null ||
            intent.expiresAt <= Date.now()
          )
            intent = undefined;
        }
        if (!intent) {
          const code = await fetchMachineCode(credential);
          intent = {
            key,
            hostId,
            code: code.code,
            serverUrl: code.serverUrl,
            expiresAt: code.expiresAt,
          };
        }
        state[hostId] = { intent };
        await storeState(state);
        await bb.storage.kv.set(grantKey(hostId), {
          grantId: hostId,
          key,
          codeId: createHash("sha256").update(intent.code).digest("hex"),
        });
        const pending = intent;
        const redeemed = await redeemMachineCode(pending).catch(async () => {
          const message =
            "Cloud device may need dashboard revocation: interrupted machine access acquisition";
          await bb.storage.kv.set(grantKey(hostId), {
            grantId: hostId,
            key,
            codeId: createHash("sha256").update(pending.code).digest("hex"),
            message,
          });
          throw recoveryError(message);
        });
        const grant = {
          id: hostId,
          serverUrl: redeemed.serverUrl,
          headers: { "x-bb-connect-machine": redeemed.credential },
        };
        state[hostId] = {
          result: {
            connectMachineId: redeemed.machineId,
            grant,
          },
        };
        await storeState(state);
        await bb.storage.kv.set(grantKey(hostId), {
          connectMachineId: redeemed.machineId,
          grantId: hostId,
        });
        return grant;
      });
    },
    release({ hostId: grantId }) {
      return serialized(async () => {
        const state = await load(grantId);
        const stored = state[grantId];
        if (stored?.intent) await reconcile(grantId, stored.intent);
        const metadata = metadataSchema.safeParse(
          await bb.storage.kv.get(grantKey(grantId)),
        );
        if (
          !stored &&
          metadata.success &&
          metadata.data.codeId &&
          !metadata.data.connectMachineId
        ) {
          throw recoveryError(
            "Cloud device may need dashboard revocation: acquisition secret is missing",
          );
        }
        const connectMachineId =
          stored?.result?.connectMachineId ??
          (metadata.success ? metadata.data.connectMachineId : undefined);
        const reportedMachineId = (await bb.sdk.hosts.get({ hostId: grantId }))
          .connectMachineId;
        const ids = [
          ...new Set([
            ...(connectMachineId ? [connectMachineId] : []),
            ...(reportedMachineId ? [reportedMachineId] : []),
            ...(metadata.success
              ? (metadata.data.connectMachineIds ?? [])
              : []),
          ]),
        ];
        if (ids.length === 0 && metadata.success && metadata.data.quarantined)
          throw recoveryError(
            "Cloud device may need dashboard revocation: malformed legacy access record has no device identity",
          );
        if (ids.length > 0) {
          const credential = tunnel.getCredential();
          if (!credential)
            throw new Error(
              "Pair this bb instance with bb connect to revoke machine access",
            );
          await bb.storage.kv.set(grantKey(grantId), {
            grantId,
            connectMachineId,
            connectMachineIds: ids,
            ...(metadata.success && metadata.data.quarantined
              ? { quarantined: true }
              : {}),
          });
          for (const id of ids) await revokeMachine(credential, id);
        }
        delete state[grantId];
        await storeState(state);
        await bb.storage.kv.delete(grantKey(grantId));
        await bb.storage.kv.delete(`server-access-expiry:${grantId}`);
      });
    },
  });
}
