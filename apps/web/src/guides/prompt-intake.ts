export interface IntakeField {
  label: string;
  hint: string;
}

const AFTER_QUESTIONS = [
  "Skip any I've answered. Then sum up the plan in three bullets and wait for me to confirm it. My answers override the steps below.",
  "If a wait times out, wait again, up to three times.",
].join("\n");

export function withIntake(fields: IntakeField[], prompt: string): string {
  const questions = fields.map((field) => `- ${field.label} (${field.hint})`);
  const split = prompt.indexOf("\n\n");
  const job = split === -1 ? prompt : prompt.slice(0, split);
  const steps = split === -1 ? "" : prompt.slice(split + 2);
  return [
    job,
    "",
    "First, tell me in a sentence or two what you're about to do. Then ask me about each of these, one at a time, with a suggested default:",
    ...questions,
    AFTER_QUESTIONS,
    "",
    steps,
  ].join("\n");
}

export function skillOffer(name: string, filledIn: string): string {
  return `Then offer to save these steps as a bb skill in .bb/skills/${name}/SKILL.md, with ${filledIn} filled in, so next time I can just ask for it.`;
}
