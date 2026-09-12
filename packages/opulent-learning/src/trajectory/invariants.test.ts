import { expect, test } from "vitest";
import { isTrainable, journalToTrajectory, toGeneratorOutput } from "./trajectory.ts";

function record() {
  return { ...journalToTrajectory([], { trajectoryId: "fixture" }), fidelity: "token" as const, tokens: { promptTokenIds: [1], responseIds: [2], lossMask: [1], rolloutLogprobs: [-0.2] } };
}

test.each([-1, 1.5, NaN, Infinity])("rejects invalid token id %s", (id) => {
  const value = record(); value.tokens.responseIds = [id];
  expect(isTrainable(value)).toBe(false);
  expect(() => toGeneratorOutput([value])).toThrow();
});

test("rejects invalid masks, logprob alignment and rewards", () => {
  const value = record(); value.tokens.lossMask = [2];
  expect(isTrainable(value)).toBe(false);
  value.tokens.lossMask = [1]; value.tokens.rolloutLogprobs = [];
  expect(isTrainable(value)).toBe(false);
  value.tokens.rolloutLogprobs = [NaN];
  expect(isTrainable(value)).toBe(false);
  expect(isTrainable({ ...record(), reward: { value: NaN, kind: "rubric" } })).toBe(false);
});

test("does not substitute zero for missing timing components", () => {
  expect(() => toGeneratorOutput([{ ...record(), timeSplits: { llm: 1 } }, { ...record(), timeSplits: { env: 1 } }])).toThrow(/keys must match/);
  expect(() => toGeneratorOutput([{ ...record(), timeSplits: { llm: NaN } }])).toThrow(/finite/);
});
