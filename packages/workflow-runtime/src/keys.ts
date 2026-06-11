// Chained call-key hashing for resume + a static determinism lint.
//
// Keys are per-branch deterministic. Each branch (the top-level body, each
// parallel() thunk, each pipeline() item, each pipeline() stage) carries its
// own lineage, so the key of an agent() call depends only on WHERE it sits in
// the call tree — not on the wall-clock order in which sibling branches happen
// to finish. This is what makes resume cache-hit under concurrency.
//
//   branchKey  = hash(parentKey || kind || index)   -- derive a child lineage node
//   agentKey_i = hash(branchKey || "agent" || i || prompt || canonical(keyedFields))
//
// Each parallel()/pipeline() CALL is itself a lineage node, keyed by a
// per-branch fan-out call counter (the runtime's key context). Without that
// counter, two sequential identical fan-outs in one branch would derive
// identical child lineages and collide on the same journal slots —
// wrong-result replay on resume (the loop-until-dry pattern re-issues
// identical fan-outs per round).
//
// Chaining off the branch key (not a global "last completed" key) yields
// longest-unchanged-prefix replay that is invariant to concurrency. An
// explicit opts.key still overrides the content hash for stability.

import { createHash } from "node:crypto";
import type { JsonObject, JsonValue } from "@bb/domain";

// bb owns its own key-version line, starting at "bb1". The derivation matches
// omegacode's v3 scheme (per-branch lineage plus the per-branch fan-out call
// counter), but the version string feeds every hash, so journals produced by
// any other scheme miss on the version check at resume and fail fast instead
// of silently missing every key and re-billing the whole run.
export const KEY_VERSION = "bb1";

/** Stable JSON: object keys sorted recursively so equal values hash equally. */
export function canonical(value: JsonValue): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  const out: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "__proto__") continue;
    out[key] = sortDeep(value[key]);
  }
  return out;
}

/**
 * The semantics-bearing fields that participate in the cache key. Built from
 * the RESOLVED values so that defaults and launch-time overrides (provider,
 * model, sandbox, …) correctly invalidate the cache — keying off raw opts
 * alone would silently replay stale results when a default changed.
 * `worktree` is carried from opts (it is not part of the resolved spec until
 * setup time). Presentation-only fields (label, phase) and the explicit key
 * itself are deliberately excluded.
 */
export type KeyedFields = {
  provider: string | null;
  model: string | null;
  effort: string | null;
  sandbox: string | null;
  cwd: string | null;
  instructions: string | null;
  schema: JsonObject | null;
  worktree: boolean | null;
};

/**
 * The subset of a resolved agent spec that participates in the cache key.
 * Structural on purpose: the runtime's resolved spec type satisfies it without
 * keys.ts depending on the DSL types.
 */
export type KeyedSpecInput = {
  provider?: string;
  model?: string;
  effort?: string;
  sandbox?: string;
  cwd?: string;
  instructions?: string;
  schema?: JsonObject;
};

export function keyedSpec(
  spec: KeyedSpecInput,
  worktree: boolean | undefined,
): KeyedFields {
  return {
    provider: spec.provider ?? null,
    model: spec.model ?? null,
    effort: spec.effort ?? null,
    sandbox: spec.sandbox ?? null,
    cwd: spec.cwd ?? null,
    instructions: spec.instructions ?? null,
    schema: spec.schema ?? null,
    worktree: worktree ?? null,
  };
}

/** The root branch key for a run. All lineage descends from here. */
export const ROOT_KEY = createHash("sha256")
  .update(KEY_VERSION)
  .update("\0root\0")
  .digest("hex");

/**
 * Derive a child branch key from a parent. `kind` distinguishes the branching
 * primitive (parallel/branch/pipeline/item/stage) and `index` is the
 * deterministic position within the parent branch.
 */
export function branchKey(
  parentKey: string,
  kind: string,
  index: number,
): string {
  return createHash("sha256")
    .update(KEY_VERSION)
    .update(parentKey)
    .update("\0branch\0")
    .update(kind)
    .update("\0")
    .update(String(index))
    .digest("hex");
}

/**
 * Compute the chained key for an agent() call within a branch. `index` is the
 * deterministic position of this call inside its branch. `fields` are the
 * resolved semantic fields (see keyedSpec). Explicit keys (opts.key) are
 * handled by the caller via explicitKey().
 */
export function chainKey(
  branchKeyValue: string,
  index: number,
  prompt: string,
  fields: KeyedFields,
): string {
  return createHash("sha256")
    .update(KEY_VERSION)
    .update(branchKeyValue)
    .update("\0agent\0")
    .update(String(index))
    .update("\0")
    .update(prompt)
    .update("\0")
    .update(canonical(fields))
    .digest("hex");
}

/** The journal key for an explicit opts.key. Exposed for duplicate-detection. */
export function explicitKey(key: string): string {
  return createHash("sha256")
    .update(KEY_VERSION)
    .update("\0explicit\0")
    .update(key)
    .digest("hex");
}

// --- Determinism lint (static) -----------------------------------------------
// Replay correctness needs the workflow body to be deterministic between agent
// calls. We forbid raw Date.now()/Math.random()/new Date() at submit time (the
// sandbox also makes them throw). We strip strings and comments first so a
// prompt or comment that merely *mentions* Date.now() does not block the
// workflow — only real code references do. Template-literal substitutions
// (`${…}`) are executable code and stay visible to the lint.

type ForbiddenGlobal = {
  re: RegExp;
  token: string;
  use: string;
};

const FORBIDDEN_GLOBALS: ForbiddenGlobal[] = [
  { re: /\bDate\s*\.\s*now\b/, token: "Date.now()", use: "now()" },
  { re: /\bMath\s*\.\s*random\b/, token: "Math.random()", use: "random()" },
  { re: /\bnew\s+Date\s*\(\s*\)/, token: "new Date()", use: "now()" },
];

export type LintFinding = {
  /** The banned construct found in executable code, e.g. "Date.now()". */
  token: string;
  /** The injected deterministic replacement to use instead, e.g. "now()". */
  use: string;
};

export function determinismLint(source: string): LintFinding[] {
  const code = stripStringsAndComments(source);
  const findings: LintFinding[] = [];
  for (const forbidden of FORBIDDEN_GLOBALS) {
    if (forbidden.re.test(code)) {
      findings.push({ token: forbidden.token, use: forbidden.use });
    }
  }
  return findings;
}

type LexFrame = { kind: "code"; braceDepth: number } | { kind: "template" };

/**
 * Replace the contents of string/template literals and comments with spaces
 * (preserving length and newlines) so the lint regexes only see executable
 * code. Template-literal substitutions (`${…}`) are kept as code — a banned
 * call inside one genuinely executes and must be flagged. Best-effort lexer:
 * it does not need to be a full JS parser, only good enough that mentioning
 * `Date.now()` inside a string or comment is not a false positive.
 *
 * Known limitation: regex literals are not lexed (telling `/`-as-regex from
 * `/`-as-division needs expression-position tracking). A regex containing a
 * quote or backtick desyncs the lexer and can blank real code after it — a
 * banned call there escapes the lint but still throws at runtime via the
 * sandbox shims (degraded failure mode, not a determinism hole).
 */
function stripStringsAndComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  const stack: LexFrame[] = [{ kind: "code", braceDepth: 0 }];
  while (i < n) {
    const frame = stack[stack.length - 1];
    const c = source[i];
    const next = source[i + 1];
    if (frame.kind === "template") {
      if (c === "\\") {
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "`") {
        out += " ";
        i += 1;
        stack.pop();
        continue;
      }
      if (c === "$" && next === "{") {
        out += "  ";
        i += 2;
        stack.push({ kind: "code", braceDepth: 0 });
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      out += "  ";
      i += 2;
      while (i < n && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += " ";
      i += 1;
      while (i < n) {
        const d = source[i];
        if (d === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (d === quote) {
          out += " ";
          i += 1;
          break;
        }
        out += d === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }
    if (c === "`") {
      out += " ";
      i += 1;
      stack.push({ kind: "template" });
      continue;
    }
    if (c === "{") {
      frame.braceDepth += 1;
      out += c;
      i += 1;
      continue;
    }
    if (c === "}") {
      if (frame.braceDepth === 0 && stack.length > 1) {
        // Closing a template substitution: back into the template literal.
        out += " ";
        i += 1;
        stack.pop();
        continue;
      }
      frame.braceDepth = Math.max(0, frame.braceDepth - 1);
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}
