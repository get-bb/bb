// The vm-free validation surface of @bb/workflow-runtime, exposed as the
// `@bb/workflow-runtime/validation` subpath. apps/server MUST import this
// subpath (never the package barrel): the barrel re-exports `runInSandbox`
// from sandbox.ts — the one module that imports node:vm — so importing it
// would pull node:vm into the server's module graph and put the sandbox one
// careless import away from server-side execution. The canonical vm-isolation
// test (tests/integration/fake/workflows/vm-isolation.test.ts) enforces both
// halves: no node:vm reference and no barrel import under apps/server/src.

export {
  parseMeta,
  parseMetaLiteral,
  parseWorkflow,
  WorkflowSyntaxError,
} from "./meta-parser.js";
export type { MetaLiteralValue, ParsedWorkflow } from "./meta-parser.js";

export { determinismLint, KEY_VERSION } from "./keys.js";
export type { LintFinding } from "./keys.js";

export { metaSchema } from "./dsl-types.js";
export type { Meta } from "./dsl-types.js";
