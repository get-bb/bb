import type { BbPluginApi, PluginCliContext } from "@bb/plugin-sdk";
import { z } from "zod";

const hostSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const hostsSchema = z.array(hostSchema);
const serverHostConfigSchema = z.object({
  primaryHostId: z.string().min(1).nullable(),
});
const threadEnvironmentSchema = z.object({
  environment: z
    .object({ hostId: z.string().min(1) })
    .nullable()
    .optional(),
});

export interface ShareHost {
  id: string;
  name: string;
  isServer: boolean;
}

/** Resolves share ownership from trusted bb server state. */
export class ShareHostResolver {
  constructor(private readonly getSdk: () => BbPluginApi["sdk"]) {}

  async serverHost(): Promise<ShareHost> {
    const sdk = this.getSdk();
    const config = serverHostConfigSchema.parse(await sdk.system.config());
    if (config.primaryHostId === null) {
      throw new Error(
        "this bb has no primary host yet — connect a machine before sharing ports",
      );
    }
    return this.byId(config.primaryHostId, true);
  }

  async byId(hostId: string, knownServerHost = false): Promise<ShareHost> {
    const normalized = hostId.trim();
    if (normalized.length === 0) throw new Error("host id must be non-empty");
    const [host, server] = await Promise.all([
      this.getSdk()
        .hosts.get({ hostId: normalized })
        .then((value) => hostSchema.parse(value)),
      knownServerHost ? Promise.resolve(null) : this.serverHost(),
    ]);
    return {
      id: host.id,
      name: host.name,
      isServer: knownServerHost || host.id === server?.id,
    };
  }

  async resolve(
    ctx: Pick<PluginCliContext, "threadId">,
    override?: string,
  ): Promise<ShareHost> {
    if (override !== undefined) return this.byNameOrId(override);
    if (ctx.threadId === undefined) return this.serverHost();

    const thread = threadEnvironmentSchema.parse(
      await this.getSdk().threads.get({
        threadId: ctx.threadId,
        include: "environment",
      }),
    );
    if (!thread.environment) {
      throw new Error(
        `thread ${ctx.threadId} has no environment, so its share host cannot be resolved; pass --host <name-or-id>`,
      );
    }
    return this.byId(thread.environment.hostId);
  }

  async byNameOrId(nameOrId: string): Promise<ShareHost> {
    const query = nameOrId.trim();
    if (query.length === 0) throw new Error("--host requires a name or id");
    const [hosts, server] = await Promise.all([
      this.getSdk()
        .hosts.list()
        .then((value) => hostsSchema.parse(value)),
      this.serverHost(),
    ]);
    const idMatch = hosts.find((host) => host.id === query);
    if (idMatch) {
      return {
        id: idMatch.id,
        name: idMatch.name,
        isServer: idMatch.id === server.id,
      };
    }
    const nameMatches = hosts.filter(
      (host) => host.name.toLocaleLowerCase() === query.toLocaleLowerCase(),
    );
    if (nameMatches.length === 0) {
      throw new Error(
        `unknown host "${query}"; run \`bb machine list\` to list hosts`,
      );
    }
    if (nameMatches.length > 1) {
      throw new Error(
        `host name "${query}" is ambiguous; pass one of these ids: ${nameMatches.map((host) => host.id).join(", ")}`,
      );
    }
    const host = nameMatches[0]!;
    return { id: host.id, name: host.name, isServer: host.id === server.id };
  }
}
