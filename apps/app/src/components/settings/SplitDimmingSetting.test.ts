import { createStore } from "jotai";
import { expect, it } from "vitest";
import { dimInactiveSplitsAtom } from "@/lib/split-layout/atoms";

it("fades inactive splits by default", () => {
  expect(createStore().get(dimInactiveSplitsAtom)).toBe(true);
});
