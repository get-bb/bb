import type { Command } from "commander";
import type { MachineEnvironmentList } from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

function printEnvironment(
  result: MachineEnvironmentList,
  options: { json?: boolean },
): void {
  if (outputJson(options, result)) return;
  console.log(
    `Built-in GitHub: ${result.builtInGit.status} — ${result.builtInGit.statusMessage}`,
  );
  for (const row of result.variables)
    console.log(
      `${row.name}=${row.secret ? "[secret]" : row.value}${row.note ? ` (${row.note})` : ""}`,
    );
}

async function readValue(): Promise<string> {
  if (process.stdin.isTTY)
    throw new Error(
      "Pipe the value to stdin; environment values are never accepted in command arguments.",
    );
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 65536)
      throw new Error("Environment value exceeds 65536 bytes.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/u, "");
}

export function registerMachineEnvironmentCommands(
  machine: Command,
  getUrl: () => string,
): void {
  const env = machine
    .command("env")
    .description("Configure the global environment for machine hosts");
  env
    .command("list")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (options: { json?: boolean }) => {
        printEnvironment(
          await createCliBbSdk(getUrl()).system.machineEnvironment(),
          options,
        );
      }),
    );
  env
    .command("set <NAME>")
    .description("Read a value from stdin; remove one trailing newline")
    .option("--note <text>", "Describe this variable")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (name: string, options: { note?: string; json?: boolean }) => {
          const system = createCliBbSdk(getUrl()).system;
          const current = await system.machineEnvironment();
          const result = await system.replaceMachineEnvironment({
            variables: [
              ...current.variables
                .filter((variable) => variable.name !== name)
                .map((variable) => ({
                  name: variable.name,
                  value: null,
                  note: variable.note,
                })),
              {
                name,
                value: await readValue(),
                note: options.note ?? null,
              },
            ],
          });
          printEnvironment(result, options);
        },
      ),
    );
  env
    .command("unset <NAME>")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (name: string, options: { json?: boolean }) => {
        const system = createCliBbSdk(getUrl()).system;
        const current = await system.machineEnvironment();
        printEnvironment(
          await system.replaceMachineEnvironment({
            variables: current.variables
              .filter((variable) => variable.name !== name)
              .map((variable) => ({
                name: variable.name,
                value: null,
                note: variable.note,
              })),
          }),
          options,
        );
      }),
    );
}
