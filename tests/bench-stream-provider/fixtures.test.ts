import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  FIXTURE_NAMES,
  getFixture,
  type FixtureName,
} from "./src/fixtures/index.js";

const FIXTURE_SHA256: Record<FixtureName, string> = {
  "long-response":
    "e927b2598909d5b9fcf788eb42b77328c73065ad6b69aaaafa08e391626d2400",
  "incident-writeup":
    "a93ba9646d7c5e710a9f630d3030e76f5bcb79c29b5f3b99e5c9cc42ecc11c0d",
  "refactor-plan":
    "97f77723ce12a7175b21f980bb60f2b0f480bc99492b90f17e2c1ab5e6cf91c4",
  "api-design":
    "817415e72d1b14686b577edfe59316230459b5b01bc4c5fab15d2b3626ff7e7f",
  "data-analysis":
    "a18b55f6ad3e0f2c1dab2fbd1b616ffc51662163de2aeb65a7867f667fc554cb",
  pathological:
    "fd56977382419c36f097cfbd84eda0920028cac3ce7d5d3a2ac4b02c79c2a1b4",
};

it.each(FIXTURE_NAMES)("pins the %s fixture byte for byte", (name) => {
  expect(createHash("sha256").update(getFixture(name)).digest("hex")).toBe(
    FIXTURE_SHA256[name],
  );
});

it("rejects unknown fixture names", () => {
  expect(() => getFixture("missing")).toThrow(
    /Unknown bench fixture "missing"/u,
  );
});
