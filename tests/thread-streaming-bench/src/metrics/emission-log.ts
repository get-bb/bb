import { z } from "zod";

const emissionStartSchema = z.object({
  event: z.literal("start"),
  t: z.number(),
  doc: z.string(),
  docChars: z.number().int().nonnegative(),
  chunk: z.number().int().positive(),
  interval: z.number().nonnegative(),
});

const emissionDeltaSchema = z.object({
  event: z.literal("delta"),
  t: z.number(),
  chars: z.number().int().nonnegative(),
});

const emissionCompleteSchema = z.object({
  event: z.literal("complete"),
  t: z.number(),
});

const emissionLogEventSchema = z.discriminatedUnion("event", [
  emissionStartSchema,
  emissionDeltaSchema,
  emissionCompleteSchema,
]);

export type EmissionLogEvent = z.infer<typeof emissionLogEventSchema>;

export function parseEmissionLog(jsonl: string): EmissionLogEvent[] {
  const events: EmissionLogEvent[] = [];
  const lines = jsonl.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Emission log line ${index + 1} is not JSON: ${reason}`);
    }
    const parsed = emissionLogEventSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Emission log line ${index + 1} is not a valid event: ${parsed.error.message}`,
      );
    }
    events.push(parsed.data);
  }
  return events;
}
