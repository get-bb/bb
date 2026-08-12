export const FIXTURE_SCHEMA_VERSION = 1 as const;

export const DEFAULT_FIXTURE_SEED = "finite-state-eagle-v1" as const;

export interface FixtureManifest {
  schemaVersion: number;
  seed: string;
  fixedNow: string;
  counts: {
    findings: number;
    components: number;
    sbomComponents: number;
    taraNodes: number;
    requirements: number;
    firmwarePaths: number;
    documents: number;
  };
  files: {
    path: string;
    sha256: string;
    bytes: number;
    rows?: number;
  }[];
  cases: Record<string, { description: string; refs: string[] }>;
}

export interface GenerateOptions {
  seed: string;
  outDir: string;
  check: boolean;
}

export class FixtureGenerationError extends Error {
  readonly code: "INVALID_SEED" | "INVALID_OUTPUT" | "FIXTURE_DRIFT";

  constructor(
    code: FixtureGenerationError["code"],
    message: string,
  ) {
    super(message);
    this.name = "FixtureGenerationError";
    this.code = code;
  }
}
