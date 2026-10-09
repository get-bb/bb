export interface IntakeField {
  label: string;
  hint: string;
}

const AFTER_QUESTIONS = [
  "Skip any I've answered. Then sum up the plan in three bullets and wait for my go. My answers override the steps below.",
  "If a wait times out, wait again, up to three times.",
].join("\n");

const BB_SETUP = [
  "Outside a bb thread (BB_THREAD_ID isn't set):",
  "- Check `bb status`. Only if `bb` isn't installed, use `npx -p bb-app@latest bb`. If bb isn't running, ask me to open it.",
  "- For $BB_PROJECT_ID, use this repo's ID from `bb project list --json`. If it's missing, ask me, then run `bb project create --root <repo path>`.",
  "- Use the repo path for --environment. Drop --parent-self and follow the thread with `bb thread wait` and `bb thread output`. For a terminal, use --machine <this machine> --cwd <repo path>.",
  "- If a command needs --thread, start one: `bb thread spawn --json --project <ID> --environment <repo path> --prompt 'Hold a browser session. Reply ready.'`.",
].join("\n");

export function withIntake(fields: IntakeField[], prompt: string): string {
  const questions = fields.map((field) => `- ${field.label} (${field.hint})`);
  return [
    "Ask me about each of these, one at a time, with a suggested default:",
    ...questions,
    AFTER_QUESTIONS,
    "",
    BB_SETUP,
    "",
    prompt,
  ].join("\n");
}
