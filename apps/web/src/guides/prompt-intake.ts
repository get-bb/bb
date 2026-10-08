export interface IntakeField {
  label: string;
  hint: string;
}

const FOR_AGENT = [
  "--- For the agent ---",
  "Read the lines above first. Treat a line as blank if it still has only its [bracketed hint]. For each blank line, interview me: ask one short question at a time, suggest a sensible default, and wait for my answer. Then restate the plan in three bullets and wait for my go.",
  "Use my answers exactly. If an answer conflicts with a step below, my answer wins, and skip any step an answer turns off.",
  "When you wait on a thread or a run, a timeout isn't a failure: wait again, up to three times.",
].join("\n");

export function withIntake(fields: IntakeField[], prompt: string): string {
  const lines = fields.map((field) => `${field.label}: [${field.hint}]`);
  return [
    "Fill in what you know below, replacing the brackets. Leave the rest for the agent to ask you about.",
    ...lines,
    "",
    FOR_AGENT,
    "",
    prompt,
  ].join("\n");
}
