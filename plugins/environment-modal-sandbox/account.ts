import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const modalRpcContract = defineRpcContract({
  "account.inspect": {
    input: z.object({}).strict(),
    output: z.object({ available: z.boolean(), message: z.string() }),
  },
});

export function registerAccount(
  bb: BbPluginApi,
  inspect: () => Promise<{ available: boolean; message: string }>,
) {
  bb.rpc.register(modalRpcContract, { "account.inspect": inspect });
  bb.cli.register({
    name: "modal",
    summary: "Check the Modal connection",
    commands: [
      {
        name: "account-inspect",
        summary: "Test the configured Modal account",
        usage: "bb modal account inspect [--json]",
      },
    ],
    async run(argv) {
      if (
        argv.length < 2 ||
        argv[0] !== "account" ||
        argv[1] !== "inspect" ||
        argv.slice(2).some((arg) => arg !== "--json") ||
        argv.length > 3
      )
        return {
          exitCode: 1,
          stderr: "Usage: bb modal account inspect [--json]",
        };
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
