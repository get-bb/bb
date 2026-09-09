import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { portSchema } from "./schemas.js";
import { validateServe, type TailscaleClient } from "./tailscale.js";

const endpointSchema = z
  .object({ port: portSchema, serverUrl: z.string().url() })
  .strict();
export function registerAccess(bb: BbPluginApi, client: TailscaleClient) {
  async function inspect(port: number, signal: AbortSignal) {
    const state = await client.status(signal);
    if (!state.certDomains.includes(state.self.DNSName))
      throw new Error(
        "Enable HTTPS in the Tailscale tailnet settings so this server's DNS name is eligible for a certificate.",
      );
    return validateServe(
      await client.serveStatus(signal),
      state.self.DNSName,
      port,
      bb.server.loopbackBaseUrl,
    );
  }
  async function status() {
    const saved = await bb.storage.kv.get("endpoint");
    const endpoint = saved === undefined ? null : endpointSchema.parse(saved);
    try {
      if (!endpoint)
        throw new Error(
          "Configure a dedicated HTTPS Serve endpoint, then verify its port here.",
        );
      const serverUrl = await inspect(
        endpoint.port,
        AbortSignal.timeout(15_000),
      );
      if (serverUrl !== endpoint.serverUrl)
        throw new Error(
          "The Tailscale server identity changed. Restore the original endpoint for enrolled machines.",
        );
      return {
        available: true,
        serverUrl,
        port: endpoint.port,
        message: "Private tailnet access is ready.",
        loopbackUrl: bb.server.loopbackBaseUrl,
      };
    } catch (error) {
      return {
        available: false,
        serverUrl: endpoint?.serverUrl ?? null,
        port: endpoint?.port ?? null,
        message:
          error instanceof z.ZodError
            ? "Tailscale returned an unsupported configuration."
            : error instanceof Error
              ? error.message
              : "Tailscale access is unavailable.",
        loopbackUrl: bb.server.loopbackBaseUrl,
      };
    }
  }
  async function configure(port: number) {
    const serverUrl = await inspect(
      portSchema.parse(port),
      AbortSignal.timeout(15_000),
    );
    const saved = await bb.storage.kv.get("endpoint");
    if (
      saved !== undefined &&
      endpointSchema.parse(saved).serverUrl !== serverUrl
    )
      throw new Error(
        "Restore the configured endpoint; changing it would strand enrolled machines.",
      );
    await bb.storage.kv.set("endpoint", { port, serverUrl });
    return status();
  }
  bb.experimental_serverAccess.register({
    id: "tailscale",
    displayName: "Tailscale",
    availability: async () => {
      const result = await status();
      return result.available
        ? { status: "available" }
        : { status: "setup-required", message: result.message };
    },
    acquire: async ({ hostId, signal }) => {
      signal.throwIfAborted();
      const saved = endpointSchema.parse(await bb.storage.kv.get("endpoint"));
      const serverUrl = await inspect(saved.port, signal);
      if (serverUrl !== saved.serverUrl)
        throw new Error("The Tailscale server identity changed.");
      return { id: hostId, serverUrl };
    },
    release: async () => {},
  });
  return { status, configure };
}
