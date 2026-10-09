export interface IntakeField {
  label: string;
  hint: string;
}

const AFTER_QUESTIONS = [
  "Skip any I've answered. Then sum up the plan in three bullets and wait for my go. My answers override the steps below.",
  "If a wait times out, wait again, up to three times.",
].join("\n");

export function withIntake(fields: IntakeField[], prompt: string): string {
  const questions = fields.map((field) => `- ${field.label} (${field.hint})`);
  return [
    "Ask me about each of these, one at a time, with a suggested default:",
    ...questions,
    AFTER_QUESTIONS,
    "",
    prompt,
  ].join("\n");
}
