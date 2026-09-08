import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { modalRpcContract } from "./contract.js";
import { CatalogueError } from "./model.js";
import type { CatalogueService } from "./service.js";

const commandFlags: Record<string, readonly string[]> = {
  "account inspect": [],
  "project sources": ["project"],
  "project preflight": ["project", "provider"],
  "project inspect": ["project", "environment"],
  "recipe put": ["project", "expected-revision", "input-text", "json-input"],
  "recipe show": ["project"],
  "recipe list": ["cursor", "limit"],
  "context upload": [
    "project",
    "environment",
    "recipe",
    "revision",
    "reviewed-dirty-json",
  ],
  "image verify": ["provider", "key"],
  "image use": ["project", "provider", "expected-revision"],
  "image build": ["project", "recipe", "revision", "context", "key"],
  "image logs": ["follow", "cursor", "limit"],
  "image status": [],
  "image cancel": [],
  "image list": ["project", "cursor", "limit"],
  "image gc": ["apply", "dry-run"],
  "project configure": ["project", "expected-revision", "json-input"],
  "project show": ["project"],
};
export const commandNames = Object.keys(commandFlags);
export function registerCatalogueCli(
  bb: BbPluginApi,
  service: CatalogueService,
) {
  bb.cli.register({
    name: "modal",
    summary:
      "Inspect projects and explicitly build credential-free Modal images",
    commands: commandNames.map((name) => ({
      name: name.replaceAll(" ", "-"),
      summary: name,
      usage: `bb modal ${name} --json`,
    })),
    async run(argv) {
      try {
        const [group, action, ...rest] = argv;
        const flags = new Map<string, string>();
        const positional = [];
        for (let i = 0; i < rest.length; i++) {
          const value = rest[i]!;
          if (!value.startsWith("--")) {
            positional.push(value);
            continue;
          }
          if (flags.has(value))
            throw new CatalogueError(400, `Repeated flag ${value}`);
          flags.set(
            value,
            rest[i + 1] && !rest[i + 1]!.startsWith("--") ? rest[++i]! : "true",
          );
        }
        const command = `${group} ${action}`;
        const allowed = commandFlags[command];
        if (!allowed)
          throw new CatalogueError(400, `Commands: ${commandNames.join(", ")}`);
        for (const flag of flags.keys()) {
          if (flag !== "--json" && !allowed.includes(flag.slice(2)))
            throw new CatalogueError(
              400,
              `Unknown flag ${flag} for ${command}`,
            );
        }
        const expectsBuild = [
          "image verify",
          "image use",
          "image logs",
          "image status",
          "image cancel",
        ].includes(command);
        if (positional.length !== (expectsBuild ? 1 : 0))
          throw new CatalogueError(
            400,
            expectsBuild
              ? "Provide exactly one build ID"
              : "Unexpected positional argument",
          );
        const required = (name: string) => {
          const value = flags.get(`--${name}`);
          if (!value || value === "true")
            throw new CatalogueError(400, `--${name} is required`);
          return value;
        };
        const number = (name: string) =>
          z.coerce.number().int().nonnegative().parse(required(name));
        async function projectId() {
          const value = required("project");
          const projects = await bb.sdk.projects.list();
          const matches = projects.filter(
            (project) => project.id === value || project.name === value,
          );
          if (matches.length !== 1)
            throw new CatalogueError(
              400,
              "Project must resolve to exactly one stable ID",
            );
          return matches[0]!.id;
        }
        async function invoke<Method extends keyof typeof modalRpcContract>(
          method: Method,
          input: unknown,
        ) {
          const parsed = modalRpcContract[method].input.parse(input);
          const handler = service.handlers[method] as (
            input: typeof parsed,
          ) => unknown;
          return await handler(parsed);
        }
        const page = {
          cursor: flags.get("--cursor") ?? null,
          limit: flags.has("--limit") ? number("limit") : 50,
        };
        let result: unknown;
        let continuation: { argv: string[]; delayMs: number } | undefined;
        switch (`${group} ${action}`) {
          case "account inspect": result = await invoke("account.inspect", {}); break;
          case "project sources": result = await invoke("project.sources", { projectId: await projectId() }); break;
          case "project preflight": result = await invoke("project.preflight", { projectId: await projectId(), agentProviderId: flags.get("--provider") ?? "codex", buildId: null }); break;
          case "project inspect":
            result = await invoke("project.inspect", {
              projectId: await projectId(),
              environmentId: required("environment"),
            });
            break;
          case "recipe put": {
            const text = flags.get("--input-text") ?? flags.get("--json-input");
            if (text === undefined)
              throw new CatalogueError(
                400,
                "Pipe Dockerfile text or a JSON recipe envelope using --stdin",
              );
            const content = text.trim().startsWith("{")
              ? z.record(z.string(), z.unknown()).parse(JSON.parse(text))
              : { dockerfileText: text };
            result = await invoke("recipe.put", {
              ...content,
              projectId: await projectId(),
              expectedRevision: number("expected-revision"),
            });
            break;
          }
          case "recipe show":
            result = await invoke("recipe.get", {
              projectId: await projectId(),
            });
            break;
          case "recipe list":
            result = await invoke("recipe.list", page);
            break;
          case "context upload": {
            const prepared = await service.handlers["context.prepare"](
              modalRpcContract["context.prepare"].input.parse({
                projectId: await projectId(),
                environmentId: required("environment"),
                recipeId: required("recipe"),
                revision: number("revision"),
                reviewedDirty: JSON.parse(
                  flags.get("--reviewed-dirty-json") ?? "[]",
                ),
              }),
            );
            result = await service.handlers["context.upload"]({
              contextId: prepared.contextId,
              uploadToken: prepared.uploadToken,
            });
            break;
          }
          case "image build":
            result = await invoke("build.start", {
              projectId: await projectId(),
              recipeId: required("recipe"),
              revision: number("revision"),
              contextId: required("context"),
              key: required("key"),
            });
            break;
          case "image logs": {
            const input = modalRpcContract["build.events"].input.parse({
              buildId: positional[0],
              cursor: Number(flags.get("--cursor") ?? 0),
              limit: flags.has("--limit") ? number("limit") : 200,
            });
            const events = await service.handlers["build.events"](input);
            result = events;
            if (flags.has("--follow") && !events.terminal)
              continuation = {
                argv: [
                  "image",
                  "logs",
                  input.buildId,
                  "--follow",
                  "--cursor",
                  String(events.nextCursor),
                  "--json",
                ],
                delayMs: events.events.length ? 0 : 1000,
              };
            break;
          }
          case "image verify":
            result = await invoke("verification.start", {
              buildId: positional[0],
              agentProviderId: required("provider"),
              key: required("key"),
            });
            break;
          case "image use":
            result = await invoke("project.useImage", {
              buildId: positional[0],
              projectId: await projectId(),
              agentProviderId: flags.get("--provider") ?? "codex",
              expectedRevision: number("expected-revision"),
            });
            break;
          case "image status":
            result = await invoke("build.get", { buildId: positional[0] });
            break;
          case "image cancel":
            result = await invoke("build.cancel", { buildId: positional[0] });
            break;
          case "image list":
            result = await invoke("image.list", {
              ...page,
              projectId: flags.has("--project") ? await projectId() : null,
            });
            break;
          case "image gc": {
            if (flags.has("--apply") === flags.has("--dry-run"))
              throw new CatalogueError(400, "Choose --dry-run or --apply");
            result = await invoke("image.gc", {
              dryRun: flags.has("--dry-run"),
            });
            break;
          }
          case "project configure":
            result = await invoke("project.configure", {
              ...z
                .record(z.string(), z.unknown())
                .parse(JSON.parse(required("json-input"))),
              projectId: await projectId(),
              expectedRevision: number("expected-revision"),
            });
            break;
          case "project show":
            result = await invoke("project.show", {
              projectId: await projectId(),
            });
            break;
          default:
            throw new CatalogueError(
              400,
              `Commands: ${commandNames.join(", ")}`,
            );
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify(result),
          ...(continuation ? { experimental_continue: continuation } : {}),
        } satisfies PluginCliResult;
      } catch (error) {
        return {
          exitCode: 1,
          stderr: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: error instanceof CatalogueError ? error.status : 400,
            latestRevision:
              error instanceof CatalogueError ? error.latestRevision : null,
          }),
        };
      }
    },
  });
}
