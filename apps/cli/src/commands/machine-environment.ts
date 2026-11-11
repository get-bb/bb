import type { Command } from "commander";
import type {
  MachineEnvironmentList,
  ProjectMachineEnvironmentList,
} from "@bb/server-contract";
import { arg, flag } from "../cli-door.js";
import { clientCommand, mountCommands } from "../operation-doors.js";

function printEnvironment(result: MachineEnvironmentList): void {
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

export const machineEnvironmentCommands = [
  clientCommand({
    path: ["machine", "env", "list"],
    summary: "",
    options: {
      project: flag(
        "--project <id>",
        "Show this project's overrides and inherited global variables",
      ),
    },
    async run({ options }, client): Promise<ProjectMachineEnvironmentList> {
      if (options.project) {
        return client.call("projects.machineEnvironment", {
          id: options.project,
        });
      }
      return {
        ...(await client.call("system.machineEnvironment", {})),
        inheritedVariables: [],
      };
    },
    print(result, { options }) {
      printEnvironment(result);
      if (options.project) {
        for (const row of result.inheritedVariables) {
          const overridden = result.variables.some(
            (variable) => variable.name === row.name,
          );
          console.log(
            `${row.name}=[secret] (Global${overridden ? "; overridden by project" : "; inherited"})`,
          );
        }
      }
      return null;
    },
  }),
  clientCommand({
    path: ["machine", "env", "set"],
    summary: "Read a value from stdin; remove one trailing newline",
    positionals: { name: arg("<NAME>") },
    options: {
      project: flag("--project <id>", "Set an override for this project"),
      note: flag("--note <text>", "Describe this variable"),
    },
    async run(
      { positionals, options },
      client,
    ): Promise<MachineEnvironmentList> {
      const variable = {
        name: positionals.name,
        value: await readValue(),
        note: options.note ?? null,
      };
      return options.project
        ? client.call("projects.setMachineEnvironmentVariable", {
            ...variable,
            id: options.project,
          })
        : client.call("system.setMachineEnvironmentVariable", variable);
    },
    print(result) {
      printEnvironment(result);
      return null;
    },
  }),
  clientCommand({
    path: ["machine", "env", "unset"],
    summary: "",
    positionals: { name: arg("<NAME>") },
    options: {
      project: flag(
        "--project <id>",
        "Remove this project's override and restore inheritance",
      ),
    },
    run({ positionals, options }, client): Promise<MachineEnvironmentList> {
      return options.project
        ? client.call("projects.deleteMachineEnvironmentVariable", {
            id: options.project,
            name: positionals.name,
          })
        : client.call("system.deleteMachineEnvironmentVariable", {
            name: positionals.name,
          });
    },
    print(result) {
      printEnvironment(result);
      return null;
    },
  }),
];

export function registerMachineEnvironmentCommands(
  machine: Command,
  getUrl: () => string,
): void {
  machine
    .command("env")
    .description("Configure global or project machine environment variables");
  mountCommands(machine, machineEnvironmentCommands, { getUrl });
}
