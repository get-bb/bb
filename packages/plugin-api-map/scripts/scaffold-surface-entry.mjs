import { fileURLToPath } from "node:url";

export const FIXTURE_FIDELITY_LEVELS = ["none", "anchor", "state", "flow"];
export const FIXTURE_RESPONSIVE_STRATEGIES = ["scale-together", "reflow"];

const REQUIRED_STATES = {
  none: [],
  anchor: ["anchor"],
  state: ["anchor", "triggered"],
  flow: ["anchor", "triggered", "outcome"],
};

/**
 * Picks the minimum honest Guide fixture from observable surface behavior.
 * The result is deterministic: the highest applicable behavior wins.
 */
export function classifyFixtureFidelity({
  spatialOwner,
  transient,
  outcome,
  replacement,
}) {
  if (!spatialOwner) return "none";
  if (outcome || replacement) return "flow";
  if (transient) return "state";
  return "anchor";
}

/** Responsive behavior follows spatial ownership, never author preference. */
export function fixtureResponsiveStrategy({ spatialOwner }) {
  return spatialOwner ? "scale-together" : "reflow";
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseScaffoldArgs(argv) {
  const input = {
    id: null,
    title: null,
    groupId: null,
    sourcePaths: [],
    apiSymbols: [],
    spatialOwner: true,
    transient: false,
    outcome: false,
    replacement: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--id":
        input.id = requireValue(argv, index, flag);
        index += 1;
        break;
      case "--title":
        input.title = requireValue(argv, index, flag);
        index += 1;
        break;
      case "--group":
        input.groupId = requireValue(argv, index, flag);
        index += 1;
        break;
      case "--source":
        input.sourcePaths.push(requireValue(argv, index, flag));
        index += 1;
        break;
      case "--api-symbol":
        input.apiSymbols.push(requireValue(argv, index, flag));
        index += 1;
        break;
      case "--no-spatial-owner":
      case "--headless":
        input.spatialOwner = false;
        break;
      case "--transient":
        input.transient = true;
        break;
      case "--outcome":
        input.outcome = true;
        break;
      case "--replacement":
        input.replacement = true;
        break;
      default:
        throw new Error(`unknown argument: ${flag}`);
    }
  }

  return input;
}

function validateInput(input) {
  if (!input.id || !/^[a-z][a-z0-9-]*$/.test(input.id)) {
    throw new Error("--id must be lowercase kebab-case");
  }
  if (!input.title?.trim()) throw new Error("--title is required");
  if (!input.groupId || !/^[a-z][a-z0-9-]*$/.test(input.groupId)) {
    throw new Error("--group must be lowercase kebab-case");
  }
  if (input.apiSymbols.length === 0) {
    throw new Error("at least one --api-symbol is required");
  }
  if (input.spatialOwner && input.sourcePaths.length === 0) {
    throw new Error("spatial surfaces require at least one --source");
  }
  if (
    !input.spatialOwner &&
    (input.transient || input.outcome || input.replacement)
  ) {
    throw new Error(
      "--no-spatial-owner cannot be combined with spatial behavior flags",
    );
  }
}

export function buildSurfaceEntryScaffold(input) {
  validateInput(input);
  const fidelity = classifyFixtureFidelity(input);
  const sourcePaths = uniqueSorted(
    input.sourcePaths.map((path) => path.replaceAll("\\", "/")),
  );

  return {
    schemaVersion: 1,
    surface: {
      id: input.id,
      title: input.title.trim(),
      summary: `TODO: Describe where ${input.title.trim()} appears in bb. With this, a plugin can:`,
      bullets: [
        "TODO: Describe the first user-visible capability",
        "TODO: Describe the second user-visible capability",
      ],
      apiSymbols: uniqueSorted(input.apiSymbols),
    },
    fixture:
      fidelity === "none"
        ? null
        : {
            groupId: input.groupId,
            fidelity,
            responsiveStrategy: fixtureResponsiveStrategy(input),
            requiredStates: REQUIRED_STATES[fidelity],
            sources: sourcePaths.map((path) => ({
              path,
              anchors: ["TODO: Add a stable source anchor"],
            })),
            fixtureClassAnchors: ["TODO: Add a product token class"],
          },
  };
}

export function renderSurfaceEntryScaffold(input) {
  return `${JSON.stringify(buildSurfaceEntryScaffold(input), null, 2)}\n`;
}

function usage() {
  return `Usage:
  pnpm exec turbo run scaffold:surface-entry --filter=@bb/plugin-api-map -- \\
    --id <surface-id> --title <title> --group <group-id> \\
    --source <repo-path> --api-symbol <SDK-symbol> \\
    [--transient] [--outcome] [--replacement] [--no-spatial-owner]
`;
}

function main() {
  try {
    process.stdout.write(
      renderSurfaceEntryScaffold(parseScaffoldArgs(process.argv.slice(2))),
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n${usage()}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
