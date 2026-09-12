export interface Scenario {
  chunkChars: number;
  description: string;
  doc: string;
  historyProfile: string;
  intervalMs: number;
  name: string;
  prelude: boolean;
  repeat: number;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    chunkChars: 24,
    description: "16.5 KB agent answer at ~800 chars/s into a 150-turn thread",
    doc: "long-response",
    historyProfile: "large",
    intervalMs: 30,
    name: "default",
    prelude: true,
    repeat: 1,
  },
  {
    chunkChars: 24,
    description: "66 KB answer (4x) at ~1500 chars/s into a 150-turn thread",
    doc: "long-response",
    historyProfile: "large",
    intervalMs: 16,
    name: "long",
    prelude: true,
    repeat: 4,
  },
  {
    chunkChars: 24,
    description:
      "Pathological Markdown (stray $$, long loose list, long fence, big table)",
    doc: "pathological",
    historyProfile: "large",
    intervalMs: 30,
    name: "pathological",
    prelude: true,
    repeat: 1,
  },
  {
    chunkChars: 24,
    description: "16.5 KB answer into an 8-turn thread",
    doc: "long-response",
    historyProfile: "small",
    intervalMs: 30,
    name: "small-history",
    prelude: true,
    repeat: 1,
  },
];

export const XLARGE_HISTORY_SCENARIO: Scenario = {
  chunkChars: 24,
  description: "16.5 KB answer into a 600-turn thread",
  doc: "long-response",
  historyProfile: "xlarge",
  intervalMs: 30,
  name: "xlarge-history",
  prelude: true,
  repeat: 1,
};

export function findScenario(name: string): Scenario {
  const scenario = [...SCENARIOS, XLARGE_HISTORY_SCENARIO].find(
    (candidate) => candidate.name === name,
  );
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
    `chunk=${scenario.chunkChars}`,
    `interval=${scenario.intervalMs}`,
    `repeat=${scenario.repeat}`,
    `prelude=${scenario.prelude ? 1 : 0}`,
  ].join(" ");
}
