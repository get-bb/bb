import type { Question } from "@ai-ecoverse/gpu-ask.js";

type Result = { id: number; questions?: Question[]; error?: string };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (questions: Question[]) => void>();
const cache = new Map<string, Question[]>();
const CACHE_LIMIT = 100;

function getWorker(): Worker {
  if (worker !== null) return worker;
  worker = new Worker(new URL("./agent-questions.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<Result>) => {
    const { id, questions } = event.data;
    pending.get(id)?.(questions ?? []);
    pending.delete(id);
  };
  worker.onerror = () => {
    for (const resolve of pending.values()) resolve([]);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function detectAgentQuestions(text: string): Promise<Question[]> {
  const cached = cache.get(text);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, (questions) => {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(text, questions);
      resolve(questions);
    });
    getWorker().postMessage({ id, text });
  });
}
