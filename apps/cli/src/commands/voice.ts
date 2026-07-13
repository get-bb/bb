import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

interface VoiceTranscribeOptions {
  json?: boolean;
  prompt?: string;
  type?: string;
}

export function registerVoiceCommands(
  program: Command,
  getUrl: () => string,
): void {
  const voice = program.command("voice").description("Voice input utilities");
  voice
    .command("transcribe <file>")
    .description("Transcribe an audio file with BB's configured voice service")
    .option("--prompt <text>", "Optional transcription context")
    .option("--type <mime>", "Audio MIME type", "audio/webm")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: VoiceTranscribeOptions) => {
        const bytes = await readFile(path);
        const blob = new File([bytes], basename(path), {
          type: opts.type ?? "audio/webm",
        });
        const result = await createCliBbSdk(getUrl()).system.transcribeVoice({
          file: blob,
          ...(opts.prompt ? { prompt: opts.prompt } : {}),
        });
        if (outputJson(opts, result)) return;
        console.log(result.text);
      }),
    );
}
