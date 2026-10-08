export interface IntakeField {
  label: string;
  hint: string;
}

const INTERVIEW =
  "Before anything else, read the lines above. For each one that's blank or still shows its hint in parentheses, interview me: ask one short question at a time, suggest a default that fits this project, and wait for my answer. Then restate the plan in three bullets and wait for my go.";

export function withIntake(fields: IntakeField[], prompt: string): string {
  const lines = fields.map((field) => `${field.label}: (${field.hint})`);
  return [
    "Fill in what you know, and leave the rest as is for your agent to ask about.",
    ...lines,
    "",
    INTERVIEW,
    "",
    prompt,
  ].join("\n");
}
