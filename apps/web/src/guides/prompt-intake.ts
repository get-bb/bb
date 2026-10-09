export interface IntakeField {
  label: string;
  hint: string;
}

const AFTER_QUESTIONS = [
  "Skip any question I've already answered in this thread. Then restate the plan in three bullets and wait for my go before step 1.",
  "Use my answers exactly. If an answer conflicts with a step below, my answer wins, and skip any step an answer turns off.",
  "When you wait on a thread or a run, a timeout isn't a failure: wait again, up to three times.",
].join("\n");

export function withIntake(fields: IntakeField[], prompt: string): string {
  const questions = fields.map((field) => `- ${field.label} (${field.hint})`);
  return [
    "First, ask me about each of these, one question at a time. Suggest a sensible default and wait for my answer.",
    ...questions,
    AFTER_QUESTIONS,
    "",
    prompt,
  ].join("\n");
}
