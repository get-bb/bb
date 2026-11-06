import { flag } from "@bb/operations";
import type { Command } from "commander";
import type {
  MachineEnvironmentList,
  ProjectMachineEnvironmentList,
} from "@bb/server-contract";
import { clientCommand, mountCommands } from "../operation-doors.js";

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

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
    name: "cli.machine.env.list",
    kind: "read",
    description:
      "List global machine environment variables, or one project's overrides and inherited globals",
    door: {
      path: ["machine", "env", "list"],
      summary: "",
      options: [
        flag(
          "--project <id>",
          "Show this project's overrides and inherited global variables",
        ),
      ],
      prepare: ({ options }) => ({ project: text(options.project) }),
      async run({ project }, client): Promise<ProjectMachineEnvironmentList> {
        if (project) {
          return client.call("projects.machineEnvironment", { id: project });
        }
        return {
          ...(await client.call("system.machineEnvironment", {})),
          inheritedVariables: [],
        };
      },
      print(result, { project }) {
        printEnvironment(result);
        if (project) {
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
    },
  }),
  clientCommand({
    name: "cli.machine.env.set",
    kind: "write",
    description:
      "Set a global machine environment variable, or a project override, from stdin",
    door: {
      path: ["machine", "env", "set"],
      summary: "Read a value from stdin; remove one trailing newline",
      positionals: [{ name: "NAME" }],
      options: [
        flag("--project <id>", "Set an override for this project"),
        flag("--note <text>", "Describe this variable"),
      ],
      async prepare({ positionals, options }) {
        return {
          project: text(options.project),
          name: text(positionals.NAME) ?? "",
          value: await readValue(),
          note: text(options.note) ?? null,
        };
      },
      run({ project, ...variable }, client): Promise<MachineEnvironmentList> {
        return project
          ? client.call("projects.setMachineEnvironmentVariable", {
              ...variable,
              id: project,
            })
          : client.call("system.setMachineEnvironmentVariable", variable);
      },
      print(result) {
        printEnvironment(result);
        return null;
      },
    },
  }),
  clientCommand({
    name: "cli.machine.env.unset",
    kind: "write",
    description:
      "Remove a global machine environment variable, or a project override",
    door: {
      path: ["machine", "env", "unset"],
      summary: "",
      positionals: [{ name: "NAME" }],
      options: [
        flag(
          "--project <id>",
          "Remove this project's override and restore inheritance",
        ),
      ],
      prepare: ({ positionals, options }) => ({
        project: text(options.project),
        name: text(positionals.NAME) ?? "",
      }),
      run({ project, name }, client): Promise<MachineEnvironmentList> {
        return project
          ? client.call("projects.deleteMachineEnvironmentVariable", {
              id: project,
              name,
            })
          : client.call("system.deleteMachineEnvironmentVariable", { name });
      },
      print(result) {
        printEnvironment(result);
        return null;
      },
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
