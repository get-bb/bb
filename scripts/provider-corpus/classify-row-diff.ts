#!/usr/bin/env -S pnpm exec tsx
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  classifyRowSnapshotDiff,
  createRowDiffReport,
  formatRowDiffReport,
  idleRowDiffClasses,
  readRowDiffClasses,
  type RowDiffClass,
  type SnapshotRow,
  type SnapshotValue,
  type RowSnapshotVariants,
} from "../../apps/server/test/provider-corpus/row-diff-classes.js";

const snapshotJsonValueSchema: z.ZodType<SnapshotValue> = z.lazy(() =>
  z.union([
    z.undefined(),
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(snapshotJsonValueSchema),
    z.record(z.string(), snapshotJsonValueSchema),
  ]),
);
const snapshotRowSchema: z.ZodType<SnapshotRow> = z.record(
  z.string(),
  snapshotJsonValueSchema,
);
const rowSnapshotVariantsSchema = z
  .object({
    variants: z
      .record(
        z.string(),
        z
          .object({
            pages: z
              .array(
                z
                  .object({ rows: z.array(snapshotRowSchema).optional() })
                  .catchall(snapshotJsonValueSchema),
              )
              .optional(),
          })
          .catchall(snapshotJsonValueSchema),
      )
      .optional(),
  })
  .strict();

function readSnapshotVariants(filePath: string): RowSnapshotVariants {
  return rowSnapshotVariantsSchema.parse(
    JSON.parse(fs.readFileSync(filePath, "utf8")),
  );
}

function requireDirectories(values: string[]): readonly [string, string] {
  const baseline = values[0];
  const candidate = values[1];
  if (baseline === undefined || candidate === undefined) {
    throw new Error("two directory arguments are required");
  }
  return [baseline, candidate];
}

const args = process.argv.slice(2);
const classesIndex = args.indexOf("--classes");
const classesPath = classesIndex === -1 ? undefined : args[classesIndex + 1];
const verbose = args.includes("--verbose");
const positional = args.filter(
  (arg, index) =>
    !arg.startsWith("--") && !(index > 0 && args[index - 1] === "--classes"),
);
if (positional.length !== 2) {
  console.error(
    "usage: classify-row-diff.ts <baseline-rows-dir> <candidate-rows-dir> [--classes <file>] [--verbose]",
  );
  process.exit(2);
}
const [baselineArgument, candidateArgument] = requireDirectories(positional);
const baselineDir = path.resolve(baselineArgument);
const candidateDir = path.resolve(candidateArgument);
const classes: RowDiffClass[] = classesPath
  ? readRowDiffClasses(classesPath)
  : [];
const report = createRowDiffReport();

let threads = 0;
let threadsWithChanges = 0;
for (const provider of fs.readdirSync(baselineDir)) {
  const providerDir = path.join(baselineDir, provider);
  if (!fs.statSync(providerDir).isDirectory()) continue;
  for (const file of fs.readdirSync(providerDir)) {
    const candidateFile = path.join(candidateDir, provider, file);
    if (!fs.existsSync(candidateFile)) continue;
    threads += 1;
    const before = readSnapshotVariants(path.join(providerDir, file));
    const after = readSnapshotVariants(candidateFile);
    const thread = `${provider}/${file.replace(/\.json$/u, "")}`;
    if (classifyRowSnapshotDiff(thread, before, after, classes, report) > 0) {
      threadsWithChanges += 1;
    }
  }
}

console.log(
  `threads compared: ${threads}; with changes: ${threadsWithChanges}`,
);
console.log(formatRowDiffReport(classes, report, { examples: verbose }));
if (report.unclassified.length > 0) {
  if (verbose) {
    for (const change of report.unclassified.slice(0, 10)) {
      console.log(JSON.stringify(change).slice(0, 600));
    }
  }
  process.exit(1);
}
if (idleRowDiffClasses(classes, report).length > 0) {
  process.exit(1);
}
console.log("\nevery change is classified.");
