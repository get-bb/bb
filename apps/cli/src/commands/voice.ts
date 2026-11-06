import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Command } from "commander";
import { arg, flag } from "../cli-door.js";
import { mountCommands, publicCommand } from "../operation-doors.js";

export const voiceCommands = [
  publicCommand("system.voiceTranscription", {
    path: ["voice", "transcribe"],
    summary: "Transcribe an audio file with BB's configured voice service",
    positionals: { file: arg("<file>") },
    options: {
      prompt: flag("--prompt <text>", "Optional transcription context"),
      type: flag("--type <mime>", "Audio MIME type", { default: "audio/webm" }),
    },
    async prepare({ positionals, options }) {
      const bytes = await readFile(positionals.file);
      const file = new File([bytes], basename(positionals.file), {
        type: options.type,
      });
      if (file.size === 0) throw new Error("Audio file must not be empty");
      return { file, ...(options.prompt ? { prompt: options.prompt } : {}) };
    },
    print: (result) => result.text,
  }),
];

export function registerVoiceCommands(
  program: Command,
  getUrl: () => string,
): void {
  program.command("voice").description("Voice input utilities");
  mountCommands(program, voiceCommands, { getUrl });
}
