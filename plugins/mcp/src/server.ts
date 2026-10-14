import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { mcpAccessProblem } from "./access.js";
import { createCliRunner } from "./cli-runner.js";
import { createCommandIndexLoader } from "./command-index.js";
import { createBbMcpHttpHandler } from "./mcp-handler.js";

const MCP_SERVER_VERSION = "0.1.0";
const MCP_ROUTE_PATH = "/mcp";
const ACCOUNT_PLUGIN_ID = "bb-account";
const GRANTS_PATH = "/api/mcp/grants";
const GRANTS_REVOKE_PATH = "/api/mcp/grants/revoke";

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const accountStatusSchema = z.object({
  state: z.string(),
  account: z.object({ serverUrl: z.string() }).nullable(),
});

const accountFetchResultSchema = z.object({
  status: z.number().int(),
  body: z.json().nullable(),
});

const grantSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  scope: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
});

const grantsBodySchema = z.object({ grants: z.array(grantSchema) });
const revokeBodySchema = z.object({ revoked: z.boolean() });

type Grant = z.infer<typeof grantSchema>;

function localMcpUrl(bb: BbPluginApi): string {
  return `${bb.server.loopbackBaseUrl}/api/v1/plugins/${bb.pluginId}/http${MCP_ROUTE_PATH}`;
}

function notSignedIn(): PluginCliError {
  return new PluginCliError("This bb is not signed in to a bb account.", {
    code: "not_signed_in",
    hint: "Run `bb account login`, then try again. Remote MCP access goes through bb connect.",
  });
}

function formatGrant(grant: Grant): string {
  const lastUsed =
    grant.lastUsedAt === null
      ? "never used"
      : `last used ${new Date(grant.lastUsedAt).toISOString()}`;
  return `${grant.id}  ${grant.clientName}  connected ${new Date(grant.createdAt).toISOString()}  ${lastUsed}`;
}

export default async function mcpPlugin(bb: BbPluginApi): Promise<void> {
  const runCli = createCliRunner({
    env: process.env,
    serverUrl: () => bb.server.loopbackBaseUrl,
  });
  const handler = createBbMcpHttpHandler(
    { runCli, loadCommandIndex: createCommandIndexLoader(runCli) },
    MCP_SERVER_VERSION,
    (error) => bb.log.warn(`MCP request failed: ${error.message}`),
  );
  bb.onDispose(() => handler.close());

  for (const method of ["POST", "GET", "DELETE"]) {
    bb.http.route(
      method,
      MCP_ROUTE_PATH,
      async (context) => {
        const problem = mcpAccessProblem(context.req.raw.headers);
        if (problem !== null) {
          return Response.json(
            { error: "forbidden", message: problem.message },
            { status: problem.status },
          );
        }
        return handler.fetch(context.req.raw);
      },
      { auth: "none" },
    );
  }

  async function remoteMcpUrl(): Promise<string | null> {
    const status = await bb.sdk.plugins.callRpc({
      pluginId: ACCOUNT_PLUGIN_ID,
      method: "bb-account.v1.status",
      input: {},
      outputSchema: accountStatusSchema,
    });
    return status.account === null
      ? null
      : `${status.account.serverUrl.replace(/\/+$/u, "")}${MCP_ROUTE_PATH}`;
  }

  async function accountFetch<T>(
    request: {
      method: "GET" | "POST";
      path: string;
      body: z.core.util.JSONType;
    },
    schema: z.ZodType<T>,
  ): Promise<T> {
    const result = await bb.sdk.plugins.callRpc({
      pluginId: ACCOUNT_PLUGIN_ID,
      method: "bb-account.v1.fetch",
      input: { target: "api", ...request },
      outputSchema: accountFetchResultSchema,
    });
    if (result.status === 401) throw notSignedIn();
    if (result.status !== 200) {
      throw new PluginCliError(
        `The bb account service answered ${result.status}.`,
        { code: "account_request_failed" },
      );
    }
    return schema.parse(result.body);
  }

  bb.cli.register(
    defineCli({
      name: "mcp",
      summary: "Let ChatGPT, Claude and other MCP clients control this bb",
      description:
        "While this plugin is enabled, bb serves a Model Context Protocol endpoint. Remote apps sign in through your bb account and reach it at your bb connect address; apps on this machine can use the local address directly.",
      commands: {
        status: cliCommand({
          summary: "Show the MCP addresses for this bb",
          options: { json: JSON_OPTION },
          async run(input) {
            const localUrl = localMcpUrl(bb);
            let remoteUrl: string | null = null;
            let accountError: string | null = null;
            try {
              remoteUrl = await remoteMcpUrl();
            } catch (error) {
              accountError =
                error instanceof Error ? error.message : String(error);
            }
            if (input.options.json) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ remoteUrl, localUrl, accountError }),
              };
            }
            return {
              exitCode: 0,
              stdout: [
                remoteUrl === null
                  ? `Remote: unavailable (${accountError ?? "sign in with `bb account login` and turn on bb connect"})`
                  : `Remote: ${remoteUrl}`,
                `Local:  ${localUrl}`,
                "Add the remote address as a custom connector in ChatGPT or Claude; you approve access on a bb account page.",
              ].join("\n"),
            };
          },
        }),
        clients: cliCommand({
          summary: "List the remote apps that can reach this bb over MCP",
          options: { json: JSON_OPTION },
          async run(input) {
            const { grants } = await accountFetch(
              { method: "GET", path: GRANTS_PATH, body: null },
              grantsBodySchema,
            );
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(grants)
                : grants.length === 0
                  ? "No remote apps are connected."
                  : grants.map(formatGrant).join("\n"),
            };
          },
        }),
        revoke: cliCommand({
          summary: "Disconnect a remote app",
          positionals: [
            {
              name: "grant-id",
              description: "The id `bb mcp clients` prints",
              required: true,
            },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const grantId = input.positionals["grant-id"];
            const { revoked } = await accountFetch(
              { method: "POST", path: GRANTS_REVOKE_PATH, body: { grantId } },
              revokeBodySchema,
            );
            if (!revoked) {
              throw new PluginCliError(`No connected app has id ${grantId}.`, {
                code: "unknown_grant",
                hint: "Run `bb mcp clients` for the ids.",
              });
            }
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ revoked: true, grantId })
                : `Disconnected ${grantId}. The app loses access within about a minute.`,
            };
          },
        }),
      },
    }),
  );
}
