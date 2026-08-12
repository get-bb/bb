import { describe, expect, it } from "vitest";
import { AssuranceStudioClient } from "../../lib/remote/assurance-studio/client.js";
import { readRemoteConfig, type RemoteSettingValues } from "../../lib/remote/config.js";
import { ForgeComputeClient } from "../../lib/remote/forge-compute/client.js";
import { createForgeMcpTransport } from "../../lib/remote/forge-compute/mcp-transport.js";
import { PlatformClient } from "../../lib/remote/platform/client.js";

const live = process.env.FS_REMOTE_LIVE === "1" ? describe : describe.skip;
const tenant = process.env.FS_LIVE_TENANT;

live("designated read-only remote contracts", () => {
  it.skipIf(!(tenant && process.env.FS_PLATFORM_URL && process.env.FS_PLATFORM_TOKEN))(
    "Platform requires FS_REMOTE_LIVE=1, FS_LIVE_TENANT, FS_PLATFORM_URL, and FS_PLATFORM_TOKEN",
    async () => {
      const client = new PlatformClient({
        baseUrl: process.env.FS_PLATFORM_URL ?? "",
        token: process.env.FS_PLATFORM_TOKEN ?? "",
      });
      for await (const page of client.listProjects({ pageSize: 1 })) {
        expect(page.items.length).toBeLessThanOrEqual(1);
        break;
      }
      client.close();
    },
  );

  it.skipIf(!(tenant && process.env.FS_AS_URL && process.env.FS_AS_API_KEY))(
    "Assurance Studio requires FS_REMOTE_LIVE=1, FS_LIVE_TENANT, FS_AS_URL, and FS_AS_API_KEY",
    async () => {
      const client = new AssuranceStudioClient({
        baseUrl: process.env.FS_AS_URL ?? "",
        apiKey: process.env.FS_AS_API_KEY ?? "",
      });
      for await (const page of client.listEntities("threat", {
        projectId: tenant ?? "",
        page: { pageSize: 1 },
      })) {
        expect(page.items.length).toBeLessThanOrEqual(1);
        break;
      }
      client.close();
    },
  );

  it.skipIf(!(process.env.FS_FORGE_TRANSPORT && (process.env.FS_FORGE_URL || process.env.FS_FORGE_COMMAND)))(
    "Forge requires FS_REMOTE_LIVE=1 plus FS_FORGE_TRANSPORT and FS_FORGE_URL or FS_FORGE_COMMAND",
    async () => {
      const values: RemoteSettingValues = {
        platformBaseUrl: "", platformToken: undefined, platformConcurrency: "8",
        asBaseUrl: "", asApiKey: undefined, asConcurrency: "8",
        forgeTransport: process.env.FS_FORGE_TRANSPORT ?? "disabled",
        forgeUrl: process.env.FS_FORGE_URL ?? "",
        forgeCommand: process.env.FS_FORGE_COMMAND ?? "",
        forgeAuthToken: process.env.FS_FORGE_TOKEN,
        forgeConcurrency: "4",
      };
      const config = readRemoteConfig(values);
      const transport = await createForgeMcpTransport(config);
      const client = new ForgeComputeClient({
        transport,
        remoteTransport: config.forgeTransport !== "stdio",
      });
      for await (const page of client.listJobs({ page: { pageSize: 1 } })) {
        expect(page.items.length).toBeLessThanOrEqual(1);
        break;
      }
      await client.close();
    },
  );
});
