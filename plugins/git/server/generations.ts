import { randomUUID } from "node:crypto";
import type { GitReadFreshness } from "../contract.js";

const WORK_TRUST_MS = 3_000;
const REFS_TRUST_MS = 30_000;

interface Generation {
  work: string;
  workAt: number;
  refs: string;
  refsAt: number;
}

export function createReadGenerations(
  isWatched: (environmentId: string) => boolean,
  now: () => number = Date.now,
) {
  const epoch = randomUUID();
  let issued = 0;
  const nextToken = () => `${epoch}:${issued++}`;
  const generations = new Map<string, Generation>();

  function current(environmentId: string): Generation {
    const known = generations.get(environmentId);
    if (known !== undefined) return known;
    const at = now();
    const created = {
      work: nextToken(),
      workAt: at,
      refs: nextToken(),
      refsAt: at,
    };
    generations.set(environmentId, created);
    return created;
  }

  function bump(environmentId: string, refs: boolean): void {
    const generation = generations.get(environmentId);
    if (generation === undefined) return;
    const at = now();
    generation.work = nextToken();
    generation.workAt = at;
    if (refs) {
      generation.refs = nextToken();
      generation.refsAt = at;
    }
  }

  return {
    freshness(environmentId: string, shared: boolean): GitReadFreshness {
      if (!shared || !isWatched(environmentId)) {
        const unique = nextToken();
        return { work: unique, refs: unique };
      }
      const generation = current(environmentId);
      const at = now();
      if (at - generation.workAt > WORK_TRUST_MS) {
        generation.work = nextToken();
        generation.workAt = at;
      }
      if (at - generation.refsAt > REFS_TRUST_MS) {
        generation.refs = nextToken();
        generation.refsAt = at;
      }
      return { work: generation.work, refs: generation.refs };
    },
    changed(environmentId: string, refs: boolean): void {
      bump(environmentId, refs);
    },
    reset(environmentId: string): void {
      bump(environmentId, true);
    },
    resetAll(): void {
      for (const environmentId of generations.keys()) bump(environmentId, true);
    },
    forget(environmentId: string): void {
      generations.delete(environmentId);
    },
  };
}
