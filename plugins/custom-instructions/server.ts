import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 4096;
const STORAGE_KEY = "customInstructions";

const instructionsInputSchema = z
  .object({
    instructions: z.string().max(MAX_CUSTOM_INSTRUCTIONS_LENGTH),
  })
  .strict();

const instructionsResponseSchema = z
  .object({
    instructions: z.string(),
    maxLength: z.number().int().positive(),
  })
  .strict();

export const customInstructionsRpcContract = defineRpcContract({
  getInstructions: { input: z.null(), output: instructionsResponseSchema },
  saveInstructions: {
    input: instructionsInputSchema,
    output: instructionsResponseSchema,
  },
});

function parseInstructionsInput(input: unknown): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("expected { instructions: string }");
  }
  const entries = Object.entries(input);
  if (entries.length !== 1 || entries[0]?.[0] !== "instructions") {
    throw new Error('expected exactly one field: "instructions"');
  }
  const instructions = entries[0][1];
  if (typeof instructions !== "string") {
    throw new Error('"instructions" must be a string');
  }
  if (instructions.length > MAX_CUSTOM_INSTRUCTIONS_LENGTH) {
    throw new Error(
      `"instructions" must be at most ${MAX_CUSTOM_INSTRUCTIONS_LENGTH} characters`,
    );
  }
  return instructions;
}

export default async function plugin(bb: BbPluginApi) {
  let customInstructions = (await bb.storage.kv.get<string>(STORAGE_KEY)) ?? "";

  bb.rpc.register(customInstructionsRpcContract, {
    getInstructions() {
      return {
        instructions: customInstructions,
        maxLength: MAX_CUSTOM_INSTRUCTIONS_LENGTH,
      };
    },
    async saveInstructions({ instructions }) {
      await bb.storage.kv.set(STORAGE_KEY, instructions);
      customInstructions = instructions;
      return {
        instructions: customInstructions,
        maxLength: MAX_CUSTOM_INSTRUCTIONS_LENGTH,
      };
    },
  });

  bb.agents.contributeInstructions(() =>
    customInstructions.trim().length > 0 ? customInstructions : null,
  );

  bb.cli.register({
    name: "instructions",
    summary: "Read and update the custom instructions injected into agents",
    commands: [
      {
        name: "get",
        summary: "Print the current custom instructions",
        usage: "bb instructions get [--json]",
      },
      {
        name: "set",
        summary: "Replace the custom instructions",
        usage: "bb instructions set <text...> [--json]",
      },
      {
        name: "clear",
        summary: "Clear the custom instructions",
        usage: "bb instructions clear [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const positional = argv.filter((value) => value !== "--json");
      const [command, ...rest] = positional;
      if (command === "get") {
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify({ instructions: customInstructions })
            : customInstructions,
        };
      }
      if (command === "set") {
        const instructions = parseInstructionsInput({
          instructions: rest.join(" "),
        });
        await bb.storage.kv.set(STORAGE_KEY, instructions);
        customInstructions = instructions;
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify({ instructions: customInstructions })
            : "Custom instructions updated",
        };
      }
      if (command === "clear") {
        await bb.storage.kv.set(STORAGE_KEY, "");
        customInstructions = "";
        return {
          exitCode: 0,
          stdout: json
            ? JSON.stringify({ instructions: "" })
            : "Custom instructions cleared",
        };
      }
      return {
        exitCode: 1,
        stderr: "Usage: bb instructions get|set <text...>|clear [--json]",
      };
    },
  });
}
