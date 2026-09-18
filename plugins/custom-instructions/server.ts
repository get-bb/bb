import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 4096;
const STORAGE_KEY = "customInstructions";
const customInstructionsSchema = z
  .string()
  .max(
    MAX_CUSTOM_INSTRUCTIONS_LENGTH,
    `Custom instructions must be at most ${MAX_CUSTOM_INSTRUCTIONS_LENGTH} characters`,
  );

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    instructions: {
      type: "string",
      label: "Custom instructions",
      description:
        "Give agents extra instructions and context for tasks on this bb host.",
      experimental_multiline: true,
      experimental_schema: customInstructionsSchema,
      default: "",
    },
  });

  let current = await settings.get();
  const legacy = await bb.storage.kv.get<string>(STORAGE_KEY);
  if (legacy !== undefined) {
    if (current.instructions.length === 0 && legacy.length > 0) {
      current = await settings.experimental_set({ instructions: legacy });
    }
    await bb.storage.kv.delete(STORAGE_KEY);
  }
  let customInstructions = current.instructions;

  settings.onChange((next) => {
    customInstructions = next.instructions;
  });

  bb.agents.contributeInstructions(() =>
    customInstructions.trim().length > 0 ? customInstructions : null,
  );

  bb.cli.register(
    defineCli({
      name: "instructions",
      summary: "Read and update the custom instructions injected into agents",
      description:
        "The text is appended to the instructions bb already gives every agent on this host.",
      commands: {
        get: cliCommand({
          summary: "Print the current custom instructions",
          options: { json: JSON_OPTION },
          run: (input) => ({
            exitCode: 0,
            stdout: input.options.json
              ? JSON.stringify({ instructions: customInstructions })
              : customInstructions,
          }),
        }),
        set: cliCommand({
          summary: "Replace the custom instructions",
          positionals: [
            {
              name: "text",
              description: `Replacement instructions, joined with single spaces; at most ${MAX_CUSTOM_INSTRUCTIONS_LENGTH} characters`,
              required: true,
              variadic: true,
            },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const parsed = customInstructionsSchema.safeParse(
              input.positionals.text.join(" "),
            );
            if (!parsed.success) {
              throw new PluginCliError(
                parsed.error.issues[0]?.message ?? "invalid instructions",
                { code: "invalid_instructions" },
              );
            }
            const next = await settings.experimental_set({
              instructions: parsed.data,
            });
            customInstructions = next.instructions;
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ instructions: customInstructions })
                : "Custom instructions updated",
            };
          },
        }),
        clear: cliCommand({
          summary: "Clear the custom instructions",
          options: { json: JSON_OPTION },
          async run(input) {
            const next = await settings.experimental_set({ instructions: "" });
            customInstructions = next.instructions;
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify({ instructions: "" })
                : "Custom instructions cleared",
            };
          },
        }),
      },
    }),
  );
}
