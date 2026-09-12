const CHUNK_CHARS = 24;

export interface Scenario {
  description: string;
  doc: string;
  historyProfile: string;
  intervalMs: number;
  name: string;
  repeat: number;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    description: "16.5 KB agent answer at ~800 chars/s into a 150-turn thread",
    doc: "long-response",
    historyProfile: "large",
    intervalMs: 30,
    name: "default",
    repeat: 1,
  },
  {
    description: "66 KB answer (4x) at ~1500 chars/s into a 150-turn thread",
    doc: "long-response",
    historyProfile: "large",
    intervalMs: 16,
    name: "long",
    repeat: 4,
  },
  {
    description:
      "Pathological Markdown (stray $$, long loose list, long fence, big table)",
    doc: "pathological",
    historyProfile: "large",
    intervalMs: 30,
    name: "pathological",
    repeat: 1,
  },
  {
    description: "16.5 KB answer into an 8-turn thread",
    doc: "long-response",
    historyProfile: "small",
    intervalMs: 30,
    name: "small-history",
    repeat: 1,
  },
  {
    description: "16.5 KB answer into a 600-turn thread",
    doc: "long-response",
    historyProfile: "xlarge",
    intervalMs: 30,
    name: "xlarge-history",
    repeat: 1,
  },
];

export function findScenario(name: string): Scenario {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) {
    throw new Error(
      `Unknown scenario ${name}; expected one of ${SCENARIOS.map((candidate) => candidate.name).join(", ")}`,
    );
  }
  return scenario;
}

export function streamPrompt(scenario: Scenario): string {
  return [
    "bench_stream",
    `doc=${scenario.doc}`,
    `chunk=${CHUNK_CHARS}`,
    `interval=${scenario.intervalMs}`,
    `repeat=${scenario.repeat}`,
    "prelude=1",
  ].join(" ");
}

export function expectedStreamMs(scenario: Scenario, docChars: number): number {
  return Math.ceil(docChars / CHUNK_CHARS) * scenario.intervalMs;
}
