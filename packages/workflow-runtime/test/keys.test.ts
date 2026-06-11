import { describe, expect, it } from "vitest";
import {
  KEY_VERSION,
  ROOT_KEY,
  branchKey,
  canonical,
  chainKey,
  determinismLint,
  explicitKey,
  keyedSpec,
} from "../src/keys.js";
import type { KeyedFields, KeyedSpecInput } from "../src/keys.js";
import type { JsonObject } from "@bb/domain";

function fields(spec: KeyedSpecInput = {}, worktree?: boolean): KeyedFields {
  return keyedSpec(spec, worktree);
}

describe("canonical", () => {
  it("sorts object keys recursively so equal values hash equally", () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonical({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("preserves array order and primitives", () => {
    expect(canonical([3, 1, 2])).toBe("[3,1,2]");
    expect(canonical("s")).toBe('"s"');
    expect(canonical(null)).toBe("null");
  });

  it("drops own __proto__ properties", () => {
    const polluted: JsonObject = { x: 2 };
    Object.defineProperty(polluted, "__proto__", {
      value: 1,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(canonical(polluted)).toBe('{"x":2}');
  });
});

describe("keyedSpec", () => {
  it("captures the semantic fields and defaults unset ones to null", () => {
    const keyed = keyedSpec(
      { provider: "codex", sandbox: "workspace-write" },
      true,
    );
    expect(keyed.provider).toBe("codex");
    expect(keyed.sandbox).toBe("workspace-write");
    expect(keyed.worktree).toBe(true);
    expect(keyed.model).toBeNull();
    expect(keyed.effort).toBeNull();
  });

  it("contains exactly the semantic fields (label/phase/key never leak in)", () => {
    expect(Object.keys(keyedSpec({}, undefined)).sort()).toEqual([
      "cwd",
      "effort",
      "instructions",
      "model",
      "provider",
      "sandbox",
      "schema",
      "worktree",
    ]);
  });
});

describe("key derivation", () => {
  it("KEY_VERSION is bb1 (bb owns its own version line)", () => {
    // The version string feeds every hash. Any change to the derivation scheme
    // must bump it so journals from the old scheme fail resume preconditions
    // fast instead of silently missing every key and re-billing the run.
    expect(KEY_VERSION).toBe("bb1");
  });

  it("ROOT_KEY is a sha256 hex digest", () => {
    expect(ROOT_KEY).toMatch(/^[0-9a-f]{64}$/);
  });

  it("branchKey distinguishes parent, kind, and index", () => {
    const child = branchKey(ROOT_KEY, "parallel", 0);
    expect(branchKey(ROOT_KEY, "parallel", 0)).toBe(child);
    expect(branchKey(ROOT_KEY, "pipeline", 0)).not.toBe(child);
    expect(branchKey(ROOT_KEY, "parallel", 1)).not.toBe(child);
    expect(branchKey(child, "parallel", 0)).not.toBe(child);
  });

  it("pipeline lineage separates items and stages", () => {
    const callKey = branchKey(ROOT_KEY, "pipeline", 0);
    const item0 = branchKey(callKey, "item", 0);
    const item1 = branchKey(callKey, "item", 1);
    expect(item0).not.toBe(item1);
    expect(branchKey(item0, "stage", 0)).not.toBe(branchKey(item0, "stage", 1));
    expect(branchKey(item0, "stage", 0)).not.toBe(branchKey(item1, "stage", 0));
  });

  it("chainKey is sensitive to prompt, position, and lineage", () => {
    const branchA = branchKey(ROOT_KEY, "branch", 0);
    const branchB = branchKey(ROOT_KEY, "branch", 1);
    const base = chainKey(branchA, 0, "do x", fields());
    expect(chainKey(branchA, 0, "do x", fields())).toBe(base);
    expect(chainKey(branchA, 0, "do y", fields())).not.toBe(base);
    expect(chainKey(branchA, 1, "do x", fields())).not.toBe(base);
    expect(chainKey(branchB, 0, "do x", fields())).not.toBe(base);
  });

  it("every keyed semantic field participates in the key", () => {
    const branch = branchKey(ROOT_KEY, "branch", 0);
    const variants: KeyedFields[] = [
      fields(),
      fields({ provider: "codex" }),
      fields({ model: "model-a" }),
      fields({ effort: "high" }),
      fields({ sandbox: "workspace-write" }),
      fields({ cwd: "/repo" }),
      fields({ instructions: "be brief" }),
      fields({ schema: { type: "object" } }),
      fields({}, true),
    ];
    const keys = variants.map((variant) =>
      chainKey(branch, 0, "prompt", variant),
    );
    expect(new Set(keys).size).toBe(variants.length);
  });

  it("resolved defaults invalidate the cache (provider/model overrides)", () => {
    const branch = branchKey(ROOT_KEY, "branch", 0);
    const codexA = chainKey(
      branch,
      0,
      "p",
      fields({ provider: "codex", model: "model-a" }),
    );
    const claudeA = chainKey(
      branch,
      0,
      "p",
      fields({ provider: "claude-code", model: "model-a" }),
    );
    const codexB = chainKey(
      branch,
      0,
      "p",
      fields({ provider: "codex", model: "model-b" }),
    );
    expect(claudeA).not.toBe(codexA);
    expect(codexB).not.toBe(codexA);
  });

  it("explicitKey is stable and independent of position", () => {
    expect(explicitKey("stable")).toBe(explicitKey("stable"));
    expect(explicitKey("a")).not.toBe(explicitKey("b"));
  });
});

// --- Chained-key stability under concurrency interleavings --------------------
// A tiny simulator that derives keys exactly the way the runtime does: each
// branch carries its own context (lineage key + per-branch agent and fan-out
// counters), and a schedule decides which runnable branch advances next. The
// same logical workflow must produce identical keys under every schedule —
// this is the property that makes resume cache-hit under concurrency, and it
// fails for any scheme that chains keys off a global completion order.

type SimContext = {
  branchKey: string;
  agentIndex: number;
  fanoutIndex: number;
};

type SimStep =
  | {
      kind: "agent";
      label: string;
      prompt: string;
      spec?: KeyedSpecInput;
      worktree?: boolean;
    }
  | { kind: "parallel"; branches: SimStep[][] };

type SimTask = {
  context: SimContext;
  steps: SimStep[];
};

type PickTask = (taskCount: number) => number;

function deriveKeys(
  program: SimStep[],
  pickTask: PickTask,
): Map<string, string> {
  const keys = new Map<string, string>();
  const tasks: SimTask[] = [
    {
      context: { branchKey: ROOT_KEY, agentIndex: 0, fanoutIndex: 0 },
      steps: [...program],
    },
  ];
  while (tasks.length > 0) {
    const taskIndex = pickTask(tasks.length);
    const task = tasks[taskIndex];
    const step = task.steps.shift();
    if (step === undefined) {
      tasks.splice(taskIndex, 1);
      continue;
    }
    if (step.kind === "agent") {
      if (keys.has(step.label)) {
        throw new Error(`duplicate sim label: ${step.label}`);
      }
      keys.set(
        step.label,
        chainKey(
          task.context.branchKey,
          task.context.agentIndex++,
          step.prompt,
          keyedSpec(step.spec ?? {}, step.worktree),
        ),
      );
      continue;
    }
    const callKey = branchKey(
      task.context.branchKey,
      "parallel",
      task.context.fanoutIndex++,
    );
    step.branches.forEach((branchSteps, index) => {
      tasks.push({
        context: {
          branchKey: branchKey(callKey, "branch", index),
          agentIndex: 0,
          fanoutIndex: 0,
        },
        steps: [...branchSteps],
      });
    });
  }
  return keys;
}

const schedules: Array<{ name: string; makePick: () => PickTask }> = [
  { name: "fifo", makePick: () => () => 0 },
  { name: "lifo", makePick: () => (taskCount) => taskCount - 1 },
  {
    name: "round-robin",
    makePick: () => {
      let turn = 0;
      return (taskCount) => turn++ % taskCount;
    },
  },
  {
    name: "seeded-shuffle",
    makePick: () => {
      let state = 42;
      return (taskCount) => {
        state = (state * 48271) % 2147483647;
        return state % taskCount;
      };
    },
  },
];

describe("chained-key stability under interleaving", () => {
  const program: SimStep[] = [
    { kind: "agent", label: "plan", prompt: "plan the work" },
    {
      kind: "parallel",
      branches: [
        [
          { kind: "agent", label: "a1", prompt: "investigate area 1" },
          { kind: "agent", label: "a2", prompt: "summarize area 1" },
        ],
        [
          { kind: "agent", label: "b1", prompt: "investigate area 2" },
          {
            kind: "parallel",
            branches: [
              [{ kind: "agent", label: "b2a", prompt: "deep dive" }],
              [{ kind: "agent", label: "b2b", prompt: "deep dive" }],
            ],
          },
        ],
        [{ kind: "agent", label: "c1", prompt: "investigate area 3" }],
      ],
    },
    { kind: "agent", label: "synthesize", prompt: "synthesize results" },
  ];

  it("produces identical keys regardless of completion order", () => {
    const baseline = deriveKeys(program, schedules[0].makePick());
    for (const schedule of schedules.slice(1)) {
      expect(deriveKeys(program, schedule.makePick()), schedule.name).toEqual(
        baseline,
      );
    }
  });

  it("identical sibling agents in different branches get distinct keys", () => {
    const keys = deriveKeys(program, schedules[0].makePick());
    // b2a and b2b share prompt and spec; only lineage separates them.
    expect(keys.get("b2a")).not.toBe(keys.get("b2b"));
    expect(new Set(keys.values()).size).toBe(keys.size);
  });

  it("two sequential identical fan-outs derive disjoint keys", () => {
    // The loop-until-dry pattern re-issues identical fan-outs per round.
    // Without the per-branch fan-out call counter both rounds would collide on
    // the same journal slots and replay round 1 results into round 2.
    const round = (label: string): SimStep => ({
      kind: "parallel",
      branches: [
        [{ kind: "agent", label: `${label}-0`, prompt: "check the area" }],
        [{ kind: "agent", label: `${label}-1`, prompt: "check the area" }],
      ],
    });
    const keys = deriveKeys(
      [round("r1"), round("r2")],
      schedules[0].makePick(),
    );
    expect(keys.get("r1-0")).not.toBe(keys.get("r2-0"));
    expect(keys.get("r1-1")).not.toBe(keys.get("r2-1"));
    expect(new Set(keys.values()).size).toBe(4);
  });
});

describe("determinismLint", () => {
  it("flags each banned call in plain code", () => {
    expect(determinismLint("const t = Date.now()")).toEqual([
      { token: "Date.now()", use: "now()" },
    ]);
    expect(determinismLint("if (Math.random() > 0.5) { log('x') }")).toEqual([
      { token: "Math.random()", use: "random()" },
    ]);
    expect(determinismLint("const d = new Date()")).toEqual([
      { token: "new Date()", use: "now()" },
    ]);
  });

  it("flags whitespace-separated variants", () => {
    expect(determinismLint("const t = Date . now ()")).toHaveLength(1);
    expect(determinismLint("const r = Math\n  .random()")).toHaveLength(1);
    expect(determinismLint("const d = new  Date (  )")).toHaveLength(1);
  });

  it("flags a bare Date.now reference (call may happen later)", () => {
    expect(determinismLint("const f = Date.now")).toEqual([
      { token: "Date.now()", use: "now()" },
    ]);
  });

  it("allows new Date(value) with arguments", () => {
    expect(determinismLint("const d = new Date(args.since)")).toEqual([]);
  });

  it("allows mentions inside string literals", () => {
    expect(
      determinismLint('await agent("audit any Date.now() usage in the repo")'),
    ).toEqual([]);
    expect(determinismLint("const p = 'mention new Date() here'")).toEqual([]);
    expect(
      determinismLint('const s = "a \\" Date.now() still in string"'),
    ).toEqual([]);
  });

  it("allows mentions in template literal text", () => {
    expect(determinismLint("const p = `look for Math.random() calls`")).toEqual(
      [],
    );
    expect(
      determinismLint('const m = `note ${ "Date.now()" } in a substitution`'),
    ).toEqual([]);
  });

  it("allows mentions inside comments", () => {
    expect(determinismLint("// avoid Date.now() in workflows")).toEqual([]);
    expect(
      determinismLint("/* Math.random() and new Date() are banned */"),
    ).toEqual([]);
  });

  it("flags banned calls inside template-literal substitutions", () => {
    expect(determinismLint("const msg = `t=${Date.now()}`")).toEqual([
      { token: "Date.now()", use: "now()" },
    ]);
    expect(
      determinismLint(
        "const m = `r=${JSON.stringify({ value: Math.random() })}`",
      ),
    ).toEqual([{ token: "Math.random()", use: "random()" }]);
    expect(
      determinismLint("const m = `outer ${ `inner ${new Date()}` }`"),
    ).toEqual([{ token: "new Date()", use: "now()" }]);
  });

  it("stays in sync after substitutions with nested braces", () => {
    // If the lexer lost track of the substitution's closing brace, the code
    // after the template would be blanked as literal text and the call missed.
    expect(
      determinismLint("const a = `x${({ b: 1 }).b}y`;\nconst t = Date.now();"),
    ).toEqual([{ token: "Date.now()", use: "now()" }]);
    expect(determinismLint("const a = `hello`; Math.random()")).toEqual([
      { token: "Math.random()", use: "random()" },
    ]);
  });

  it("flags code following comments", () => {
    expect(determinismLint("// banned below\nDate.now()")).toEqual([
      { token: "Date.now()", use: "now()" },
    ]);
    expect(determinismLint("/* note */ Math.random()")).toEqual([
      { token: "Math.random()", use: "random()" },
    ]);
  });

  it("flags real code even when a string also mentions a banned call", () => {
    expect(
      determinismLint(
        'const note = "Date.now is fine in prose";\nconst x = Math.random();',
      ),
    ).toEqual([{ token: "Math.random()", use: "random()" }]);
  });

  it("known limitation: a regex literal containing a quote desyncs the lexer", () => {
    // stripStringsAndComments does not lex regex literals, so the `"` inside
    // the regex opens a phantom string that swallows the Date.now() call — a
    // documented false negative, not a determinism hole: the sandbox shims
    // still throw at runtime (degraded failure mode). If the lexer learns
    // regexes, flip this expectation.
    expect(determinismLint('const re = /"/; const t = Date.now();')).toEqual(
      [],
    );
  });

  it("reports each banned construct once, in a stable order", () => {
    expect(
      determinismLint("const a = Date.now(); const b = new Date(); Date.now()"),
    ).toEqual([
      { token: "Date.now()", use: "now()" },
      { token: "new Date()", use: "now()" },
    ]);
  });
});
