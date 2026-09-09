import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { readStandardDockerfile } from "./standard-image.js";

export const modalRpcContract = defineRpcContract({
  "image.definition": {
    input: z.object({}).strict(),
    output: z.object({ dockerfile: z.string() }),
  },
  "account.inspect": {
    input: z.object({}).strict(),
    output: z.object({ available: z.boolean(), message: z.string() }),
  },
});

export function registerAccount(
  bb: BbPluginApi,
  inspect: () => Promise<{ available: boolean; message: string }>,
) {
  const definition = async () => ({
    dockerfile: await readStandardDockerfile(),
  });
  bb.rpc.register(modalRpcContract, {
    "account.inspect": inspect,
    "image.definition": definition,
  });
  bb.cli.register({
    name: "modal",
    summary: "Inspect the Modal connection and standard Dockerfile",
    commands: [
      {
        name: "image-show",
        summary: "Show the bundled Dockerfile",
        usage: "bb modal image show [--json]",
      },
      {
        name: "account-inspect",
        summary: "Test the configured Modal account",
        usage: "bb modal account inspect [--json]",
      },
    ],
    async run(argv) {
      if (
        argv.length < 2 ||
        !(
          (argv[0] === "account" && argv[1] === "inspect") ||
          (argv[0] === "image" && argv[1] === "show")
        ) ||
        argv.slice(2).some((arg) => arg !== "--json") ||
        argv.length > 3
      )
        return {
          exitCode: 1,
          stderr:
            "Usage: bb modal account inspect [--json] | bb modal image show [--json]",
        };
      if (argv[0] === "image") {
        const result = await definition();
        return {
          exitCode: 0,
          stdout: argv.includes("--json")
            ? JSON.stringify(result)
            : result.dockerfile,
        };
      }
      const result = await inspect();
      return {
        exitCode: result.available ? 0 : 1,
        stdout: argv.includes("--json")
          ? JSON.stringify(result)
          : result.message,
      };
    },
  });
}
