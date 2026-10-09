export interface IntakeField {
  label: string;
  hint: string;
}

const AFTER_QUESTIONS = [
  "Skip any question I've already answered in this thread. Then restate the plan in three bullets and wait for my go before step 1.",
  "Use my answers exactly. If an answer conflicts with a step below, my answer wins, and skip any step an answer turns off.",
  "When you wait on a thread or a run, a timeout isn't a failure: wait again, up to three times.",
].join("\n");

const BB_SETUP = [
  "These steps use the bb CLI. If BB_THREAD_ID is set, you're in a bb thread and `bb` is ready. If it isn't set, set up first:",
  "- Run `bb status`, or `npx -p bb-app@latest bb status` if `bb` isn't installed, and use that same command wherever a step says `bb`. If it can't reach bb, ask me to open the bb app or run `npx bb-app@latest`, and wait.",
  "- Find this repo's project with `bb project list --json`. If it isn't there, ask me, then run `bb project create --root <repo path>`. Use its ID wherever a step says $BB_PROJECT_ID.",
  '- Where a step says $BB_ENVIRONMENT_ID or asks for an environment, pass the repo path to --environment. Where it says --parent-self, leave that out and follow the thread with `bb thread wait <id>` and `bb thread log <id>`. Where a terminal uses --thread "$BB_THREAD_ID", use --machine <this machine> --cwd <repo path> instead.',
].join("\n");

export function withIntake(fields: IntakeField[], prompt: string): string {
  const questions = fields.map((field) => `- ${field.label} (${field.hint})`);
  return [
    "First, ask me about each of these, one question at a time. Suggest a sensible default and wait for my answer.",
    ...questions,
    AFTER_QUESTIONS,
    "",
    BB_SETUP,
    "",
    prompt,
  ].join("\n");
}
