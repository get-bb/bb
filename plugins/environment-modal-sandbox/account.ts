import {
  defineRpcContract,
  type BbPluginApi,
  type PluginCliContext,
} from "@get-bb/plugin-sdk";
import path from "node:path";
import { z } from "zod";
import { dockerfileSchema, imageDefinition } from "./image-definition.js";

const definitionSchema = z.object({
  dockerfile: z.string(),
  customized: z.boolean(),
});
export const modalRpcContract = defineRpcContract({
  "image.definition": {
    input: z.object({}).strict(),
    output: definitionSchema,
  },
  "image.set": {
    input: z.object({ dockerfile: dockerfileSchema }).strict(),
    output: definitionSchema,
  },
  "image.reset": { input: z.object({}).strict(), output: definitionSchema },
  "account.inspect": {
    input: z.object({}).strict(),
    output: z.object({ available: z.boolean(), message: z.string() }),
  },
});

export function registerAccount(
  bb: BbPluginApi,
  inspect: () => Promise<{ available: boolean; message: string }>,
) {
  const image = imageDefinition(bb);
  bb.rpc.register(modalRpcContract, {
    "account.inspect": inspect,
    "image.definition": image.get,
    "image.set": ({ dockerfile }) => image.set(dockerfile),
    "image.reset": image.reset,
  });
  async function readDockerfile(file: string, context: PluginCliContext) {
    let hostId: string | undefined;
    if (context.threadId) {
      const thread = await bb.sdk.threads.get({ threadId: context.threadId });
      if (!thread.environmentId)
        throw new Error("The current thread has no machine workspace");
      const environment = await bb.sdk.environments.get({
        environmentId: thread.environmentId,
      });
      if (!environment.hostId)
        throw new Error("The current thread has no machine workspace");
      hostId = environment.hostId;
    }
    if (!path.isAbsolute(file) && !context.cwd)
      throw new Error("A relative --file requires the CLI working directory");
    const result = await bb.sdk.files.read({
      hostId,
      path: path.resolve(context.cwd ?? "/", file),
      signal: context.signal,
    });
    if (result.contentEncoding !== "utf8")
      throw new Error("Dockerfile must be UTF-8 text");
    return dockerfileSchema.parse(result.content);
  }
  const usage =
    "Usage: bb modal account inspect [--json] | bb modal image show [--json] | bb modal image set --file PATH [--json] | bb modal image reset [--json]";
  bb.cli.register({
    name: "modal",
    summary: "Configure the Modal Dockerfile and inspect the connection",
    commands: [
      {
        name: "image-show",
        summary: "Show the Dockerfile used for new machines",
        usage: "bb modal image show [--json]",
      },
      {
        name: "image-set",
        summary: "Save a Dockerfile for future machines",
        usage: "bb modal image set --file PATH [--json]",
      },
      {
        name: "image-reset",
        summary: "Restore the bundled Dockerfile",
        usage: "bb modal image reset [--json]",
      },
      {
        name: "account-inspect",
        summary: "Test the configured Modal account",
        usage: "bb modal account inspect [--json]",
      },
    ],
    async run(argv, context) {
      try {
        const json = argv.at(-1) === "--json";
        const args = json ? argv.slice(0, -1) : argv;
        if (
          args.length === 2 &&
          args[0] === "account" &&
          args[1] === "inspect"
        ) {
          const result = await inspect();
          return {
            exitCode: result.available ? 0 : 1,
            stdout: json ? JSON.stringify(result) : result.message,
          };
        }
        if (args[0] !== "image") throw new Error(usage);
        let result;
        if (args.length === 2 && args[1] === "show") result = await image.get();
        else if (args.length === 2 && args[1] === "reset")
          result = await image.reset();
        else if (
          args.length === 4 &&
          args[1] === "set" &&
          args[2] === "--file" &&
          args[3]
        )
          result = await image.set(await readDockerfile(args[3], context));
        else throw new Error(usage);
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify(result)
            : args[1] === "show"
              ? result.dockerfile
              : args[1] === "reset"
                ? "Restored the bundled Dockerfile for future machines."
                : "Saved the Dockerfile for future machines.",
        };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
