/**
 * Per-leg wiring for `pnpm parity --old <checkout> --new <checkout>`.
 *
 * A leg is a whole checkout, not just a bridge: the runtime's delta assembler
 * and the timeline projection are part of the path a recording takes to rows,
 * and the migration moves and changes both. Each leg therefore assembles and
 * projects with its own code, loaded from its checkout at run time:
 *
 *   1. the checkout's `@bb/provider-parity` (this package), when it has one —
 *      every checkout from this PR onward, so a leg describes itself;
 *   2. otherwise the checkout's delta collector at one of the known homes
 *      (`@bb/provider-bridge-protocol/testing` after WS1a, `@bb/agent-runtime`
 *      before it) plus this checkout's projector.
 *
 * The import is a file URL into the other worktree, so its bare specifiers
 * resolve against that worktree's `node_modules` (it must be installed).
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CreateParityAssembler,
  ParityAssembler,
  ParityRowProjector,
} from "@bb/provider-bridge-protocol/testing/parity";
import { createParityAssembler, projectParityRows } from "./index.js";

export interface ParityLeg {
  checkoutRoot: string;
  createAssembler: CreateParityAssembler;
  projectRows: ParityRowProjector;
  /** Where the leg's assembler came from, for the run header. */
  source: string;
}

const LEG_PACKAGE_ENTRY = "packages/provider-parity/src/index.ts";

/** Known homes of `createBridgeDeltaEventCollector`, newest first. */
const COLLECTOR_CANDIDATES = [
  "packages/provider-bridge-protocol/src/testing/bridge-delta-assembly.ts",
  "packages/agent-runtime/src/test/bridge-delta-assembly.ts",
];

interface CollectorModule {
  createBridgeDeltaEventCollector?: unknown;
}

interface LegPackageModule {
  createParityAssembler?: unknown;
  projectParityRows?: unknown;
}

type CreateCollector = (providerId: string) => ParityAssembler;

function isCreateCollector(value: unknown): value is CreateCollector {
  return typeof value === "function";
}

async function importFromCheckout<T>(checkoutRoot: string, relativePath: string): Promise<T | null> {
  const file = join(checkoutRoot, relativePath);
  if (!existsSync(file)) {
    return null;
  }
  return (await import(pathToFileURL(file).href)) as T;
}

export async function loadParityLeg(checkoutRoot: string): Promise<ParityLeg> {
  const root = resolve(checkoutRoot);

  const ownPackage = await importFromCheckout<LegPackageModule>(root, LEG_PACKAGE_ENTRY);
  if (
    ownPackage !== null &&
    typeof ownPackage.createParityAssembler === "function" &&
    typeof ownPackage.projectParityRows === "function"
  ) {
    return {
      checkoutRoot: root,
      createAssembler: ownPackage.createParityAssembler as CreateParityAssembler,
      projectRows: ownPackage.projectParityRows as ParityRowProjector,
      source: LEG_PACKAGE_ENTRY,
    };
  }

  for (const candidate of COLLECTOR_CANDIDATES) {
    const module = await importFromCheckout<CollectorModule>(root, candidate);
    if (module === null || !isCreateCollector(module.createBridgeDeltaEventCollector)) {
      continue;
    }
    const createCollector = module.createBridgeDeltaEventCollector;
    return {
      checkoutRoot: root,
      createAssembler: (providerId) => {
        const collector = createCollector(providerId);
        return { assembleMessage: (message) => collector.assembleMessage(message) };
      },
      // The projector is this checkout's: a pre-PR checkout ships none.
      projectRows: projectParityRows,
      source: `${candidate} (projection from the harness checkout)`,
    };
  }

  throw new Error(
    `${root} has neither ${LEG_PACKAGE_ENTRY} nor a delta collector at ${COLLECTOR_CANDIDATES.join(" / ")}; is it a bb checkout with pnpm install run?`,
  );
}

/** This checkout, statically wired (what the self-suite uses). */
export function currentParityLeg(checkoutRoot: string): ParityLeg {
  return {
    checkoutRoot: resolve(checkoutRoot),
    createAssembler: createParityAssembler,
    projectRows: projectParityRows,
    source: "static",
  };
}
