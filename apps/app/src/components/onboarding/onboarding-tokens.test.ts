import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../../../..");
const onboardingDir = import.meta.dirname;
const sharedUiDir = resolve(repoRoot, "packages/shared-ui/src/components/ui");

const scannedFiles = [
  ...readdirSync(onboardingDir)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(onboardingDir, name)),
  join(sharedUiDir, "setup-option-row.tsx"),
  join(sharedUiDir, "sign-in-panel.tsx"),
];

function repoPath(file: string): string {
  return relative(repoRoot, file).split(sep).join("/");
}

const RAW_VALUE_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: "arbitrary text size", pattern: /text-\[/ },
  { name: "arbitrary length", pattern: /-\[\d+(\.\d+)?(px|rem)\]/ },
  { name: "hex color", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "oklch literal", pattern: /oklch\(/ },
  { name: "rgb literal", pattern: /rgba?\(/ },
];

function rawValueViolations(source: string): string[] {
  return source
    .split("\n")
    .flatMap((line, index) =>
      RAW_VALUE_PATTERNS.filter(({ pattern }) => pattern.test(line)).map(
        ({ name }) => `${index + 1}: ${name}: ${line.trim()}`,
      ),
    );
}

describe("onboarding design tokens", () => {
  it("scans the onboarding sources and shared setup guide components", () => {
    expect(scannedFiles.map(repoPath)).toEqual(
      expect.arrayContaining([
        "apps/app/src/components/onboarding/OnboardingViews.tsx",
        "apps/app/src/components/onboarding/OnboardingFlow.tsx",
        "packages/shared-ui/src/components/ui/setup-option-row.tsx",
        "packages/shared-ui/src/components/ui/sign-in-panel.tsx",
      ]),
    );
  });

  it.each(scannedFiles.map((file) => [repoPath(file), file]))(
    "%s uses tokens instead of raw values",
    (_name, file) => {
      expect(rawValueViolations(readFileSync(file, "utf8"))).toEqual([]);
    },
  );

  it("flags raw values the tokens replace", () => {
    expect(
      rawValueViolations(
        [
          'className="text-[13px]"',
          'className="max-w-[600px]"',
          'className="w-[2.5rem]"',
          'style={{ color: "#fff" }}',
          'style={{ color: "oklch(0.5 0 0)" }}',
          'style={{ color: "rgb(0 0 0)" }}',
          'className="max-w-150 text-xs"',
        ].join("\n"),
      ),
    ).toEqual([
      '1: arbitrary text size: className="text-[13px]"',
      '1: arbitrary length: className="text-[13px]"',
      '2: arbitrary length: className="max-w-[600px]"',
      '3: arbitrary length: className="w-[2.5rem]"',
      '4: hex color: style={{ color: "#fff" }}',
      '5: oklch literal: style={{ color: "oklch(0.5 0 0)" }}',
      '6: rgb literal: style={{ color: "rgb(0 0 0)" }}',
    ]);
  });
});
