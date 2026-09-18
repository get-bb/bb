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
  experimental_CliError,
  experimental_cliCommand,
  experimental_defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
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
  async function guarded(
    run: () => Promise<PluginCliResult>,
  ): Promise<PluginCliResult> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof experimental_CliError) throw error;
      throw new experimental_CliError(errorMessage(error));
    }
  }
  const jsonOption = {
    json: {
      type: "boolean",
      description: "Emit the raw result as JSON instead of readable text",
    },
  } as const;
  bb.cli.register(
    experimental_defineCli({
      name: "modal",
      summary: "Configure, build and debug Modal images",
      description:
        "Debug sandboxes are ephemeral: they run the saved image for 30 minutes and carry no machine secrets.",
      commands: {
        "machine inspect": experimental_cliCommand({
          summary: "Inspect Modal compute and the last saved snapshot",
          positionals: [
            {
              name: "host-id",
              description: "BB host whose Modal machine is inspected",
              required: true,
            },
          ],
          options: jsonOption,
          run(input) {
            return guarded(async () => {
              const result = await inspectMachine(
                machineInput.parse({ hostId: input.positionals["host-id"] }),
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : result.summary,
              };
            });
          },
        }),
        "image build": experimental_cliCommand({
          summary: "Build or reuse the saved image",
          options: jsonOption,
          run(input, context) {
            return guarded(async () => {
              const result = await debug.build(context.signal);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : `${result.logs}${result.imageId}`,
              };
            });
          },
        }),
        "sandbox run": experimental_cliCommand({
          summary: "Run the saved image in a 30-minute debug sandbox",
          options: jsonOption,
          run(input, context) {
            return guarded(async () => {
              const result = await debug.run(context.signal);
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : result.sandboxId,
                stderr: input.options.json ? "" : result.logs,
              };
            });
          },
        }),
        "sandbox exec": experimental_cliCommand({
          summary: "Execute a command in a debug sandbox",
          description:
            "Everything after `--` is the command; it is never parsed as options.",
          positionals: [
            {
              name: "sandbox-id",
              description: "Debug sandbox started by bb modal sandbox run",
              required: true,
            },
          ],
          passthrough: true,
          options: jsonOption,
          run(input, context) {
            return guarded(async () => {
              if (input.passthrough.length === 0) {
                throw new experimental_CliError(
                  "bb modal sandbox exec requires a command after --",
                  {
                    code: "missing_command",
                    hint: "Write bb modal sandbox exec <sandbox-id> -- bash -lc 'echo hi'.",
                  },
                );
              }
              const result = await debug.exec(
                execInput.parse({
                  sandboxId: input.positionals["sandbox-id"],
                  command: input.passthrough,
                }),
                context.signal,
              );
              return {
                exitCode: result.exitCode,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : result.stdout,
                stderr: input.options.json ? "" : result.stderr,
              };
            });
          },
        }),
        "sandbox stop": experimental_cliCommand({
          summary: "Stop a debug sandbox",
          positionals: [
            {
              name: "sandbox-id",
              description: "Debug sandbox started by bb modal sandbox run",
              required: true,
            },
          ],
          options: jsonOption,
          run(input) {
            return guarded(async () => {
              const result = await debug.stop(
                sandboxInput.parse({
                  sandboxId: input.positionals["sandbox-id"],
                }),
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : `Stopped ${result.sandboxId}`,
              };
            });
          },
        }),
        "image show": experimental_cliCommand({
          summary: "Show the Dockerfile used for new machines",
          options: jsonOption,
          run(input) {
            return guarded(async () => {
              const result = await image.get();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : result.dockerfile,
              };
            });
          },
        }),
        "image set": experimental_cliCommand({
          summary: "Save a Dockerfile for future machines",
          options: {
            file: {
              type: "string",
              required: true,
              placeholder: "PATH",
              aliases: ["dockerfile", "path"],
              description:
                "Dockerfile to save; a relative path resolves from the CLI working directory on the thread's host",
            },
            ...jsonOption,
          },
          run(input, context) {
            return guarded(async () => {
              const result = await image.set(
                await readDockerfile(input.options.file, context),
              );
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : "Saved the Dockerfile for future machines.",
              };
            });
          },
        }),
        "image reset": experimental_cliCommand({
          summary: "Restore the bundled Dockerfile",
          options: jsonOption,
          run(input) {
            return guarded(async () => {
              const result = await image.reset();
              return {
                exitCode: 0,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : "Restored the bundled Dockerfile for future machines.",
              };
            });
          },
        }),
        "account inspect": experimental_cliCommand({
          summary: "Test the configured Modal account",
          options: jsonOption,
          run(input) {
            return guarded(async () => {
              const result = await inspect();
              return {
                exitCode: result.available ? 0 : 1,
                stdout: input.options.json
                  ? JSON.stringify(result)
                  : result.message,
              };
            });
          },
        }),
      },
    }),
  );
}
