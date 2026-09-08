import type { BbPluginApi, ServerAccessGrant } from "@get-bb/plugin-sdk";
import type { ConnectTunnel } from "./tunnel.js";
import { fetchMachineCode } from "./machine-code.js";
import { revokeMachine } from "./revoke-machine.js";

export function registerServerAccess(bb: BbPluginApi, tunnel: ConnectTunnel) {
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
      }
      pending.delete(grantId);
    },
  });
}
