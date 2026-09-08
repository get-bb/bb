import type { BbPluginApi, ServerAccessGrant } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ConnectTunnel } from "./tunnel.js";
import { fetchMachineCode } from "./machine-code.js";
import { revokeMachine } from "./revoke-machine.js";

const expirySchema = z.object({
  expiresAt: z.number().int().positive().max(8_640_000_000_000_000),
});

function expiryKey(hostId: string): string {
  return `server-access-expiry:${hostId}`;
}

export function registerServerAccess(
  bb: BbPluginApi,
  tunnel: {
    getCredential: ConnectTunnel["getCredential"];
    status(): { paired: boolean };
  },
) {
  const pending = new Map<string, ServerAccessGrant>();
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
      const existing = pending.get(hostId);
      if (
        existing?.client.kind === "connect" &&
        existing.client.expiresAt > Date.now()
      )
        return existing;
      const credential = tunnel.getCredential();
      if (!credential) throw new Error("Pair this bb instance with bb Cloud");
      const code = await fetchMachineCode(credential);
      const previous = expirySchema.safeParse(
        await bb.storage.kv.get(expiryKey(hostId)),
      );
      await bb.storage.kv.set(expiryKey(hostId), {
        expiresAt: Math.max(
          code.expiresAt,
          previous.success ? previous.data.expiresAt : 0,
        ),
      });
      const grant: ServerAccessGrant = {
        id: hostId,
        serverUrl: code.serverUrl,
        client: {
          kind: "connect",
          machineCode: code.code,
          expiresAt: code.expiresAt,
        },
      };
      pending.set(hostId, grant);
      return grant;
    },
    async release({ grantId }) {
      const host = await bb.sdk.hosts.get({ hostId: grantId });
      if (host.connectMachineId) {
        const credential = tunnel.getCredential();
        if (!credential)
          throw new Error(
            "Pair this bb instance with bb Cloud to revoke machine access",
          );
        await revokeMachine(credential, host.connectMachineId);
      } else {
        const expiry = expirySchema.safeParse(
          await bb.storage.kv.get(expiryKey(grantId)),
        );
        const expiryMessage = expiry.success
          ? `Any unredeemed code expires by ${new Date(expiry.data.expiresAt).toISOString()}.`
          : "The expiry of this grant's unredeemed code is unavailable.";
        bb.log.warn(
          `Machine ${grantId}: Connect access release is best-effort because enrollment did not report a Cloud machine ID. ${expiryMessage} Code expiry does not revoke a credential already redeemed before enrollment. The current Cloud API cannot revoke that credential by grant; revoke it manually from the getbb.app dashboard if it was redeemed.`,
        );
      }
      await bb.storage.kv.delete(expiryKey(grantId));
      pending.delete(grantId);
    },
  });
}
