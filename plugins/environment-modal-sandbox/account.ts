import {
  buildOutput,
  runOutput,
  execInput,
  execOutput,
  sandboxInput,
  type DebugSandbox,
} from "./debug-sandbox.js";
import {
  defineRpcContract,
  type BbPluginApi,
  type PluginCliContext,
} from "@get-bb/plugin-sdk";
import path from "node:path";
import { z } from "zod";
import { dockerfileSchema, type ImageDefinition } from "./image-definition.js";
import { errorMessage } from "./error-message.js";
import {
  modalLaunchOptionsSchema,
  type ModalLaunchOptionsStore,
} from "./launch-options.js";

const machineInput = z.object({ hostId: z.string().min(1) }).strict();
const machineOutput = z.object({
  summary: z.string(),
  values: z.object({
    state: z.enum(["running", "suspended", "missing"]),
    expiresAt: z.number().nullable(),
    snapshotImageId: z.string().nullable(),
  }),
});

const definitionSchema = z.object({
  dockerfile: z.string(),
  customized: z.boolean(),
});
export const modalRpcContract = defineRpcContract({
  "machine.inspect": { input: machineInput, output: machineOutput },
  "image.build": { input: z.object({}).strict(), output: buildOutput },
  "sandbox.run": { input: z.object({}).strict(), output: runOutput },
  "sandbox.exec": { input: execInput, output: execOutput },
  "sandbox.stop": { input: sandboxInput, output: sandboxInput },
  "image.definition": {
    input: z.object({}).strict(),
    output: definitionSchema,
  },
  "image.set": {
    input: z.object({ dockerfile: dockerfileSchema }).strict(),
    output: definitionSchema,
  },
  "image.reset": { input: z.object({}).strict(), output: definitionSchema },
  "launch.options": {
    input: z.object({}).strict(),
    output: modalLaunchOptionsSchema,
  },
  "launch.options.set": {
    input: modalLaunchOptionsSchema,
    output: modalLaunchOptionsSchema,
  },
  "account.inspect": {
    input: z.object({}).strict(),
    output: z.object({ available: z.boolean(), message: z.string() }),
  },
});

export function registerRpcAndCli(
  bb: BbPluginApi,
  image: ImageDefinition,
  launchOptions: ModalLaunchOptionsStore,
  inspect: () => Promise<{ available: boolean; message: string }>,
  debug: DebugSandbox,
  inspectMachine: (
    input: z.infer<typeof machineInput>,
  ) => Promise<z.infer<typeof machineOutput>>,
) {
  bb.rpc.register(modalRpcContract, {
    "machine.inspect": inspectMachine,
    "image.build": () => debug.build(),
    "sandbox.run": () => debug.run(),
    "sandbox.exec": (input) => debug.exec(input),
    "sandbox.stop": debug.stop,
    "account.inspect": inspect,
    "image.definition": image.get,
    "image.set": ({ dockerfile }) => image.set(dockerfile),
    "image.reset": image.reset,
    "launch.options": launchOptions.get,
    "launch.options.set": launchOptions.set,
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
    "Usage: bb modal machine inspect HOST_ID [--json] | bb modal account inspect [--json] | bb modal image show [--json] | bb modal image set --file PATH [--json] | bb modal image reset [--json] | bb modal image build [--json] | bb modal sandbox run [--json] | bb modal sandbox exec ID [--json] -- COMMAND... | bb modal sandbox stop ID [--json]";
  type CliResult = {
    exitCode: number;
    stdout?: string;
    stderr?: string;
  };
  type CliRoute = {
    path: readonly string[];
    arity: number;
    separator?: boolean;
    run: (
      args: string[],
      command: string[],
      context: PluginCliContext,
      json: boolean,
    ) => Promise<CliResult>;
  };
  const routes = [
    {
      path: ["machine", "inspect"],
      arity: 1,
      async run(args, _command, _context, json) {
        const result = await inspectMachine(
          machineInput.parse({ hostId: args[0] }),
        );
        return {
          exitCode: 0,
          stdout: json ? JSON.stringify(result) : result.summary,
        };
      },
    },
    {
      path: ["account", "inspect"],
      arity: 0,
      async run(_args, _command, _context, json) {
        const result = await inspect();
        return {
          exitCode: result.available ? 0 : 1,
          stdout: json ? JSON.stringify(result) : result.message,
        };
      },
    },
    {
      path: ["image", "show"],
      arity: 0,
      async run(_args, _command, _context, json) {
        const result = await image.get();
        return {
          exitCode: 0,
          stdout: json ? JSON.stringify(result) : result.dockerfile,
        };
      },
    },
    {
      path: ["image", "set", "--file"],
      arity: 1,
      async run(args, _command, context, json) {
        const result = await image.set(await readDockerfile(args[0]!, context));
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify(result)
            : "Saved the Dockerfile for future machines.",
        };
      },
    },
    {
      path: ["image", "reset"],
      arity: 0,
      async run(_args, _command, _context, json) {
        const result = await image.reset();
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify(result)
            : "Restored the bundled Dockerfile for future machines.",
        };
      },
    },
    {
      path: ["image", "build"],
      arity: 0,
      async run(_args, _command, context, json) {
        const result = await debug.build(context.signal);
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify(result)
            : `${result.logs}${result.imageId}`,
        };
      },
    },
    {
      path: ["sandbox", "run"],
      arity: 0,
      async run(_args, _command, context, json) {
        const result = await debug.run(context.signal);
        return {
          exitCode: 0,
          stdout: json ? JSON.stringify(result) : result.sandboxId,
          stderr: json ? "" : result.logs,
        };
      },
    },
    {
      path: ["sandbox", "exec"],
      arity: 1,
      separator: true,
      async run(args, command, context, json) {
        const result = await debug.exec(
          execInput.parse({ sandboxId: args[0], command }),
          context.signal,
        );
        return {
          exitCode: result.exitCode,
          stdout: json ? JSON.stringify(result) : result.stdout,
          stderr: json ? "" : result.stderr,
        };
      },
    },
    {
      path: ["sandbox", "stop"],
      arity: 1,
      async run(args, _command, _context, json) {
        const result = await debug.stop(
          sandboxInput.parse({ sandboxId: args[0] }),
        );
        return {
          exitCode: 0,
          stdout: json ? JSON.stringify(result) : `Stopped ${result.sandboxId}`,
        };
      },
    },
  ] satisfies readonly CliRoute[];
  bb.cli.register({
    name: "modal",
    summary: "Configure, build and debug Modal images",
    commands: [
      {
        name: "machine-inspect",
        summary: "Inspect Modal compute and the last saved snapshot",
        usage: "bb modal machine inspect HOST_ID [--json]",
      },
      {
        name: "image-build",
        summary: "Build or reuse the saved image",
        usage: "bb modal image build [--json]",
      },
      {
        name: "sandbox-run",
        summary: "Run the saved image in a 30-minute debug sandbox",
        usage: "bb modal sandbox run [--json]",
      },
      {
        name: "sandbox-exec",
        summary: "Execute a command in a debug sandbox",
        usage: "bb modal sandbox exec ID [--json] -- COMMAND...",
      },
      {
        name: "sandbox-stop",
        summary: "Stop a debug sandbox",
        usage: "bb modal sandbox stop ID [--json]",
      },
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
        const separator = argv.indexOf("--");
        const flags = separator < 0 ? argv : argv.slice(0, separator);
        const json = flags.at(-1) === "--json";
        const args = json ? flags.slice(0, -1) : flags;
        const route = routes.find(
          (candidate) =>
            candidate.path.every((part, index) => args[index] === part) &&
            args.length === candidate.path.length + candidate.arity &&
            (candidate.separator === true) === separator >= 0,
        );
        if (route === undefined) throw new Error(usage);
        return route.run(
          args.slice(route.path.length),
          separator < 0 ? [] : argv.slice(separator + 1),
          context,
          json,
        );
      } catch (error) {
        return {
          exitCode: 1,
          stderr: errorMessage(error),
        };
      }
    },
  });
}
