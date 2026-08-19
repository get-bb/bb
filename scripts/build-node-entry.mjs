import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNodeEsmEntry, copyDirectory } from "./build-utils.mjs";

const packageRoot = process.cwd();
const [entryPointArg, outfileArg, ...flags] = process.argv.slice(2);

if (!entryPointArg || !outfileArg) {
  throw new Error(
    "Usage: node scripts/build-node-entry.mjs <entrypoint> <outfile> [--clean-dist] [--executable] [--external <pattern>] [--copy-dir <from> <to>]",
  );
}

function parseExternalPatterns(args) {
  const external = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--external") {
      continue;
    }

    const pattern = args[index + 1];
    if (!pattern) {
      throw new Error("--external requires <pattern>");
    }

    external.push(pattern);
    index += 1;
  }
  return external;
}

function parseCopyDirectories(args) {
  const copyDirectories = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--copy-dir") {
      continue;
    }

    const from = args[index + 1];
    const to = args[index + 2];
    if (!from || !to) {
      throw new Error("--copy-dir requires <from> and <to> arguments");
    }

    copyDirectories.push({
      from: path.resolve(packageRoot, from),
      to: path.resolve(packageRoot, to),
    });
    index += 2;
  }
  return copyDirectories;
}

await buildNodeEsmEntry({
  cleanDist: flags.includes("--clean-dist"),
  entryPoint: path.resolve(packageRoot, entryPointArg),
  executable: flags.includes("--executable"),
  external: parseExternalPatterns(flags),
  outfile: path.resolve(packageRoot, outfileArg),
  packageRoot,
});

for (const copyArgs of parseCopyDirectories(flags)) {
  await copyDirectory(copyArgs);
}
