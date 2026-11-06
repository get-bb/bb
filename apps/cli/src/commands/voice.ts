import { flag } from "@bb/operations";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Command } from "commander";
import { mountCommands, publicCommand } from "../operation-doors.js";

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const voiceCommands = [
  publicCommand("system.voiceTranscription", {
    path: ["voice", "transcribe"],
    summary: "Transcribe an audio file with BB's configured voice service",
    positionals: [{ name: "file" }],
    options: [
      flag("--prompt <text>", "Optional transcription context"),
      flag("--type <mime>", "Audio MIME type", { default: "audio/webm" }),
    ],
    async prepare({ positionals, options }) {
      const path = text(positionals.file) ?? "";
      const bytes = await readFile(path);
      const file = new File([bytes], basename(path), {
        type: text(options.type) ?? "audio/webm",
      });
      if (file.size === 0) throw new Error("Audio file must not be empty");
      const prompt = text(options.prompt);
      return { file, ...(prompt ? { prompt } : {}) };
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
