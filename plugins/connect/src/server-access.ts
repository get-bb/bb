import type { BbPluginApi, ServerAccessGrant } from "@get-bb/plugin-sdk";
import { z } from "zod";
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

function grantKey(hostId: string): string {
  return `server-access-grant:${hostId}`;
}

export function registerServerAccess(
  bb: BbPluginApi,
  tunnel: {
    getCredential: ConnectTunnel["getCredential"];
    status(): { paired: boolean };
  },
) {
  bb.experimental_serverAccess.register({
    id: "connect",
    displayName: "bb Cloud",
    availability: () =>
      tunnel.status().paired
        ? { status: "available" }
        : {
            status: "setup-required",
            message: "Pair this bb instance with bb Cloud",
          },
    async acquire({ hostId, signal }) {
      signal.throwIfAborted();
      const existing = grantSchema.safeParse(
        await bb.storage.kv.get(grantKey(hostId)),
      );
      if (existing.success) return existing.data.grant;
      const credential = tunnel.getCredential();
      if (!credential) throw new Error("Pair this bb instance with bb Cloud");
      const code = await fetchMachineCode(credential);
      const redeemed = await redeemMachineCode({
        code: code.code,
        serverUrl: code.serverUrl,
      });
      const grant: ServerAccessGrant = {
        id: hostId,
        serverUrl: redeemed.serverUrl,
        headers: { "x-bb-connect-machine": redeemed.credential },
      };
      try {
        await bb.storage.kv.set(grantKey(hostId), {
          connectMachineId: redeemed.machineId,
          grant,
        });
      } catch (error) {
        await revokeMachine(credential, redeemed.machineId);
        throw error;
      }
      return grant;
    },
    async release({ grantId }) {
      const stored = grantSchema.safeParse(
        await bb.storage.kv.get(grantKey(grantId)),
      );
      const connectMachineId = stored.success
        ? stored.data.connectMachineId
        : (await bb.sdk.hosts.get({ hostId: grantId })).connectMachineId;
      if (connectMachineId) {
        const credential = tunnel.getCredential();
        if (!credential)
          throw new Error(
            "Pair this bb instance with bb Cloud to revoke machine access",
          );
        await revokeMachine(credential, connectMachineId);
      }
      await bb.storage.kv.delete(grantKey(grantId));
      await bb.storage.kv.delete(`server-access-expiry:${grantId}`);
    },
  });
}
