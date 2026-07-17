import { describe, expect, it, vi } from "vitest";
import { executeWorkflowScript } from "./runtime.js";
import type { WorkflowCapabilities } from "./types.js";

describe("workflow QuickJS runtime", () => {
  it("awaits multiple concurrent host agents", async () => {
    const calls: string[] = [];
    const result = await executeWorkflowScript({
      args: { suffix: "!" },
      body: `
        const values = await Promise.all([
          agent("first", { title: "A" }),
          agent("second", { title: "B" }),
        ]);
        return { values, suffix: args.suffix };
      `,
      capabilities: {
        async agent(prompt, options) {
          calls.push(`${prompt}:${JSON.stringify(options)}`);
          await new Promise((resolve) =>
            setTimeout(resolve, prompt === "first" ? 10 : 1),
          );
          return { prompt };
        },
        log: vi.fn(),
        phase: vi.fn(),
      },
    });

    expect(calls).toEqual([
      'first:{"selection":null,"outputSchema":null,"title":"A","phase":null}',
      'second:{"selection":null,"outputSchema":null,"title":"B","phase":null}',
    ]);
    expect(result).toEqual({
      values: [{ prompt: "first" }, { prompt: "second" }],
      suffix: "!",
    });
  });

  it("exposes phase and log without host capabilities leaking in", async () => {
    const log = vi.fn();
    const phase = vi.fn();
    const result = await executeWorkflowScript({
      args: null,
      body: `
        phase("Inspect");
        log("started");
        return {
          process: typeof process,
          require: typeof require,
          randomBlocked: (() => { try { Math.random(); return false; } catch { return true; } })(),
        };
      `,
      capabilities: { agent: async () => null, log, phase },
    });

    expect(result).toEqual({
      process: "undefined",
      require: "undefined",
      randomBlocked: true,
    });
    expect(log).toHaveBeenCalledWith("started");
    expect(phase).toHaveBeenCalledWith("Inspect");
  });

  it("canonicalizes labels and deterministically inherits the current phase", async () => {
    const calls: Array<{
      prompt: string;
      outputSchema: unknown;
      title: string | null;
      phase: string | null;
    }> = [];
    const phase = vi.fn();
    await executeWorkflowScript({
      args: null,
      body: `
        phase("Inspect");
        await agent("inherited", {
          label: "Reader",
          schema: { required: ["ok"], type: "object" },
        });
        await agent("override", {
          title: "Verifier",
          label: "Verifier",
          phase: "Verify",
        });
        await agent("inherited-again");
        return null;
      `,
      capabilities: {
        async agent(prompt, options) {
          calls.push({
            prompt,
            outputSchema: options.outputSchema,
            title: options.title,
            phase: options.phase,
          });
          return null;
        },
        log: vi.fn(),
        phase,
      },
    });

    expect(calls).toEqual([
      {
        prompt: "inherited",
        outputSchema: { required: ["ok"], type: "object" },
        title: "Reader",
        phase: "Inspect",
      },
      {
        prompt: "override",
        outputSchema: null,
        title: "Verifier",
        phase: "Verify",
      },
      {
        prompt: "inherited-again",
        outputSchema: null,
        title: null,
        phase: "Inspect",
      },
    ]);
    expect(phase).toHaveBeenCalledTimes(1);
    expect(phase).toHaveBeenCalledWith("Inspect");
  });

  it("rejects conflicting aliases and invalid phase values at runtime", async () => {
    const capabilities: WorkflowCapabilities = {
      agent: async () => null,
      log: vi.fn(),
      phase: vi.fn(),
    };

    await expect(
      executeWorkflowScript({
        args: null,
        body: 'return await agent("x", { title: "A", label: "B" });',
        capabilities,
      }),
    ).rejects.toThrow("must match");
    await expect(
      executeWorkflowScript({
        args: null,
        body: `return await agent("x", {
          outputSchema: { type: "string" },
          schema: { type: "number" },
        });`,
        capabilities,
      }),
    ).rejects.toThrow("must be structurally identical");
    await expect(
      executeWorkflowScript({
        args: null,
        body: 'phase(""); return null;',
        capabilities,
      }),
    ).rejects.toThrow("phase title must be a non-empty string");
  });

  it("rejects computationally unsafe dynamic agent schemas at the QuickJS boundary", async () => {
    const agent = vi.fn(async () => null);
    await expect(
      executeWorkflowScript({
        args: { keyword: "pattern" },
        body: `
          const schema = { type: "string" };
          schema[args.keyword] = "^(a+)+$";
          return await agent("x", { outputSchema: schema });
        `,
        capabilities: { agent, log: vi.fn(), phase: vi.fn() },
      }),
    ).rejects.toThrow(/pattern.*catastrophic backtracking.*Node host.*QuickJS/);
    expect(agent).not.toHaveBeenCalled();
  });

  it("interrupts runaway synchronous code", async () => {
    await expect(
      executeWorkflowScript({
        args: null,
        body: "while (true) {}",
        capabilities: { agent: async () => null, log: vi.fn(), phase: vi.fn() },
        limits: { synchronousDeadlineMs: 25 },
      }),
    ).rejects.toThrow();
  });

  it("cancels and safely tears down un-awaited host calls", async () => {
    let settle: ((value: { late: boolean }) => void) | undefined;
    const result = await executeWorkflowScript({
      args: null,
      body: 'agent("slow"); return "finished";',
      capabilities: {
        agent: () =>
          new Promise((resolve) => {
            settle = resolve;
          }),
        log: vi.fn(),
        phase: vi.fn(),
      },
    });

    expect(result).toBe("finished");
    settle?.({ late: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("wakes an awaiting workflow when cancelled", async () => {
    const controller = new AbortController();
    const execution = executeWorkflowScript({
      args: null,
      body: 'return await agent("never");',
      capabilities: {
        agent: (_prompt, _options, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              {
                once: true,
              },
            );
          }),
        log: vi.fn(),
        phase: vi.fn(),
      },
      signal: controller.signal,
    });

    controller.abort();
    await expect(execution).rejects.toThrow("Workflow cancelled");
  });

  it("bounds agent fan-out and total calls", async () => {
    let active = 0;
    let peak = 0;
    const result = await executeWorkflowScript({
      args: null,
      body: `
        const accepted = await Promise.all([0, 1, 2, 3].map((value) => agent(String(value))));
        let limited = false;
        try { await agent("too-many"); } catch { limited = true; }
        return { accepted, limited };
      `,
      capabilities: {
        async agent(prompt) {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
          return prompt;
        },
        log: vi.fn(),
        phase: vi.fn(),
      },
      limits: { maxAgentCalls: 4, maxConcurrentAgents: 2 },
    });

    expect(result).toEqual({ accepted: ["0", "1", "2", "3"], limited: true });
    expect(peak).toBe(2);
  });

  it("blocks alternate dynamic constructors and wall-clock time", async () => {
    const result = await executeWorkflowScript({
      args: null,
      body: `
        const blocked = (fn) => { try { fn(); return false; } catch { return true; } };
        return {
          date: typeof Date,
          arrowConstructor: blocked(() => (() => {}).constructor("return 1")()),
          asyncConstructor: blocked(() => (async () => {}).constructor("return 1")()),
        };
      `,
      capabilities: { agent: async () => null, log: vi.fn(), phase: vi.fn() },
    });

    expect(result).toEqual({
      date: "undefined",
      arrowConstructor: true,
      asyncConstructor: true,
    });
  });

  it("provides deterministic parallel, streaming pipeline, and budget helpers", async () => {
    const result = await executeWorkflowScript({
      args: null,
      body: `
        const values = await parallel([
          () => agent("one"),
          () => agent("two"),
        ]);
        const piped = await pipeline(values,
          (text, original, index) => text + ":" + original + ":" + index,
          (text) => text.toUpperCase(),
        );
        return { piped, budget: budget() };
      `,
      capabilities: {
        agent: async (prompt) => prompt,
        log: vi.fn(),
        phase: vi.fn(),
      },
      limits: { maxAgentCalls: 7, maxConcurrentAgents: 3 },
    });

    expect(result).toEqual({
      piped: ["ONE:ONE:0", "TWO:TWO:1"],
      budget: {
        agentCalls: 2,
        activeAgents: 0,
        queuedAgents: 0,
        maxAgentCalls: 7,
        maxConcurrentAgents: 3,
        totalTokens: null,
      },
    });
  });

  it("rejects invalid runtime limits before evaluating guest source", async () => {
    const run = (limits: never) =>
      executeWorkflowScript({
        args: null,
        body: "return 1;",
        capabilities: { agent: async () => null, log: vi.fn(), phase: vi.fn() },
        limits,
      });

    await expect(run({ maxAgentCalls: 0 } as never)).rejects.toThrow(
      "positive finite integer",
    );
    await expect(
      run({ maxConcurrentAgents: Number.POSITIVE_INFINITY } as never),
    ).rejects.toThrow("positive finite integer");
    await expect(run({ synchronousDeadlineMs: 1.5 } as never)).rejects.toThrow(
      "positive finite integer",
    );
    await expect(run({ maxAgentCalls: 1001 } as never)).rejects.toThrow(
      "cannot exceed",
    );
    await expect(run({ unknown: 1 } as never)).rejects.toThrow(
      "Unknown workflow runtime limit",
    );
    await expect(
      run({ maxAgentCalls: "1; globalThis.stolenEval = eval; 1" } as never),
    ).rejects.toThrow("positive finite integer");
  });

  it("rejects cyclic and exotic host values", async () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    const capabilities = {
      agent: async () => null,
      log: vi.fn(),
      phase: vi.fn(),
    };

    await expect(
      executeWorkflowScript({
        args: cyclic as never,
        body: "return null;",
        capabilities,
      }),
    ).rejects.toThrow("cycle");
    await expect(
      executeWorkflowScript({
        args: new Date() as never,
        body: "return null;",
        capabilities,
      }),
    ).rejects.toThrow("plain objects");
  });

  it("treats synchronous capability throws as agent rejections", async () => {
    const calls: string[] = [];
    const result = await executeWorkflowScript({
      args: null,
      body: `
        let firstRejected = false;
        try { await agent("first"); } catch { firstRejected = true; }
        return { firstRejected, second: await agent("second") };
      `,
      capabilities: {
        agent(prompt) {
          calls.push(prompt);
          if (prompt === "first") throw new Error("sync failure");
          return Promise.resolve("ok");
        },
        log: vi.fn(),
        phase: vi.fn(),
      },
      limits: { maxConcurrentAgents: 1 },
    });

    expect(result).toEqual({ firstRejected: true, second: "ok" });
    expect(calls).toEqual(["first", "second"]);
  });

  it("settles every parallel thunk and maps throws and rejections to null", async () => {
    const result = await executeWorkflowScript({
      args: null,
      body: `
        const events = [];
        const values = await parallel([
          () => { events.push("throw"); throw new Error("boom"); },
          async () => { events.push("reject"); await Promise.resolve(); throw new Error("nope"); },
          async () => { await Promise.resolve(); events.push("finish"); return 3; },
        ]);
        return { events, values };
      `,
      capabilities: { agent: async () => null, log: vi.fn(), phase: vi.fn() },
    });

    expect(result).toEqual({
      events: ["throw", "reject", "finish"],
      values: [null, null, 3],
    });
  });

  it("starts parallel agent calls in array order through the FIFO semaphore", async () => {
    const calls: string[] = [];
    const result = await executeWorkflowScript({
      args: null,
      body: `return await parallel([
        () => agent("first"),
        () => agent("second"),
        () => agent("third"),
      ]);`,
      capabilities: {
        async agent(prompt) {
          calls.push(prompt);
          await Promise.resolve();
          return prompt;
        },
        log: vi.fn(),
        phase: vi.fn(),
      },
      limits: { maxConcurrentAgents: 1 },
    });

    expect(calls).toEqual(["first", "second", "third"]);
    expect(result).toEqual(["first", "second", "third"]);
  });

  it("streams pipeline items without global stage barriers", async () => {
    const result = await executeWorkflowScript({
      args: null,
      body: `
        const events = [];
        let releaseFirst;
        const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
        const values = await pipeline([10, 20],
          async (value, original, index) => {
            events.push("stage1:" + index + ":" + value + ":" + original);
            if (index === 0) await firstGate;
            return value + 1;
          },
          (value, original, index) => {
            events.push("stage2:" + index + ":" + value + ":" + original);
            if (index === 1) releaseFirst();
            return value * 2;
          },
        );
        return { events, values };
      `,
      capabilities: { agent: async () => null, log: vi.fn(), phase: vi.fn() },
    });

    expect(result).toEqual({
      events: [
        "stage1:0:10:10",
        "stage1:1:20:20",
        "stage2:1:21:20",
        "stage2:0:11:10",
      ],
      values: [22, 42],
    });
  });

  it("stops failed and null pipeline chains independently", async () => {
    const result = await executeWorkflowScript({
      args: null,
      body: `
        const later = [];
        const values = await pipeline([0, 1, 2, null],
          async (value) => {
            if (value === 0) throw new Error("sync-shaped async failure");
            if (value === 1) return Promise.reject(new Error("rejection"));
            if (value === 2) return null;
            return value;
          },
          (_value, _original, index) => { later.push(index); return 99; },
        );
        return { later, values };
      `,
      capabilities: { agent: async () => null, log: vi.fn(), phase: vi.fn() },
    });

    expect(result).toEqual({ later: [], values: [null, null, null, null] });
  });

  it("validates helper collections before launching work and caps them at 4096", async () => {
    const result = await executeWorkflowScript({
      args: null,
      body: `
        let sideEffects = 0;
        const outcomes = {};
        try { await parallel([() => { sideEffects++; }, 2]); }
        catch (error) { outcomes.parallelType = error.message; }
        try { await parallel(new Array(4097).fill(() => null)); }
        catch (error) { outcomes.parallelBound = error.message; }
        try { await pipeline([1], (value) => { sideEffects++; return value; }, 2); }
        catch (error) { outcomes.pipelineType = error.message; }
        try { await pipeline(new Array(4097).fill(1), (value) => value); }
        catch (error) { outcomes.itemBound = error.message; }
        try { await pipeline([], ...new Array(4097).fill((value) => value)); }
        catch (error) { outcomes.stageBound = error.message; }
        return { outcomes, sideEffects };
      `,
      capabilities: { agent: async () => null, log: vi.fn(), phase: vi.fn() },
    });

    expect(result).toEqual({
      outcomes: {
        parallelType: "parallel entries must be functions",
        parallelBound: "parallel cannot exceed 4096 entries",
        pipelineType: "pipeline stages must be functions",
        itemBound: "pipeline cannot exceed 4096 items",
        stageBound: "pipeline cannot exceed 4096 stages",
      },
      sideEffects: 0,
    });
  });

  it("reports live deterministic call and concurrency budget without token estimates", async () => {
    const result = await executeWorkflowScript({
      args: null,
      body: `
        const calls = [agent("one"), agent("two")];
        const during = budget();
        await Promise.all(calls);
        return { during, after: budget() };
      `,
      capabilities: {
        async agent(prompt) {
          await Promise.resolve();
          return prompt;
        },
        log: vi.fn(),
        phase: vi.fn(),
      },
      limits: { maxAgentCalls: 5, maxConcurrentAgents: 1 },
    });

    expect(result).toEqual({
      during: {
        agentCalls: 2,
        activeAgents: 1,
        queuedAgents: 1,
        maxAgentCalls: 5,
        maxConcurrentAgents: 1,
        totalTokens: null,
      },
      after: {
        agentCalls: 2,
        activeAgents: 0,
        queuedAgents: 0,
        maxAgentCalls: 5,
        maxConcurrentAgents: 1,
        totalTokens: null,
      },
    });
  });

  it("bridges one nested workflow level with args, cancellation, and limits", async () => {
    const nested = vi.fn(async (nameOrRef, childArgs, context) => ({
      nameOrRef,
      childArgs,
      depth: context.depth,
      aborted: context.signal.aborted,
      maxAgentCalls: context.limits.maxAgentCalls,
      maxConcurrentAgents: context.limits.maxConcurrentAgents,
      schedulerSharesLimits: context.scheduler.limits === context.limits,
    }));
    const result = await executeWorkflowScript({
      args: null,
      body: `return await workflow("child/workflow", { answer: 42 });`,
      capabilities: {
        agent: async () => null,
        workflow: nested,
        log: vi.fn(),
        phase: vi.fn(),
      },
      limits: { maxAgentCalls: 9, maxConcurrentAgents: 2 },
    });

    expect(result).toEqual({
      nameOrRef: "child/workflow",
      childArgs: { answer: 42 },
      depth: 1,
      aborted: false,
      maxAgentCalls: 9,
      maxConcurrentAgents: 2,
      schedulerSharesLimits: true,
    });
    expect(nested).toHaveBeenCalledOnce();
  });

  it("shares one agent-call limit and budget across parent and child VMs", async () => {
    const capabilities: WorkflowCapabilities = {
      agent: async (prompt) => prompt,
      workflow: (_reference, childArgs, context) =>
        executeWorkflowScript({
          args: childArgs,
          body: `
            const first = await agent("child-first");
            let limited = false;
            try { await agent("child-over-limit"); }
            catch { limited = true; }
            return { first, limited, budget: budget() };
          `,
          capabilities,
          ...context,
        }),
      log: vi.fn(),
      phase: vi.fn(),
    };

    const result = await executeWorkflowScript({
      args: null,
      body: `
        const parent = await agent("parent-first");
        const child = await workflow("child");
        return { parent, child, budget: budget() };
      `,
      capabilities,
      limits: { maxAgentCalls: 2, maxConcurrentAgents: 2 },
    });

    expect(result).toEqual({
      parent: "parent-first",
      child: {
        first: "child-first",
        limited: true,
        budget: {
          agentCalls: 3,
          activeAgents: 0,
          queuedAgents: 0,
          maxAgentCalls: 2,
          maxConcurrentAgents: 2,
          totalTokens: null,
        },
      },
      budget: {
        agentCalls: 3,
        activeAgents: 0,
        queuedAgents: 0,
        maxAgentCalls: 2,
        maxConcurrentAgents: 2,
        totalTokens: null,
      },
    });
  });

  it("shares FIFO concurrency across overlapping parent and child agents", async () => {
    const starts: string[] = [];
    let active = 0;
    let peak = 0;
    const capabilities: WorkflowCapabilities = {
      async agent(prompt) {
        starts.push(prompt);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return prompt;
      },
      workflow: (_reference, childArgs, context) =>
        executeWorkflowScript({
          args: childArgs,
          body: `return await parallel([
            () => agent("child-one"),
            () => agent("child-two"),
          ]);`,
          capabilities,
          ...context,
        }),
      log: vi.fn(),
      phase: vi.fn(),
    };

    const result = await executeWorkflowScript({
      args: null,
      body: `return await parallel([
        () => workflow("child"),
        () => agent("parent-one"),
        () => agent("parent-two"),
      ]);`,
      capabilities,
      limits: { maxAgentCalls: 4, maxConcurrentAgents: 2 },
    });

    expect(result).toEqual([
      ["child-one", "child-two"],
      "parent-one",
      "parent-two",
    ]);
    expect(starts).toEqual([
      "parent-one",
      "parent-two",
      "child-one",
      "child-two",
    ]);
    expect(peak).toBe(2);
  });

  it("reports parent calls from budget inside a child VM", async () => {
    const capabilities: WorkflowCapabilities = {
      agent: async (prompt) => prompt,
      workflow: (_reference, childArgs, context) =>
        executeWorkflowScript({
          args: childArgs,
          body: `
            const before = budget();
            await agent("child");
            return { before, after: budget() };
          `,
          capabilities,
          ...context,
        }),
      log: vi.fn(),
      phase: vi.fn(),
    };

    const result = await executeWorkflowScript({
      args: null,
      body: `
        await agent("parent");
        return await workflow({ name: "child" });
      `,
      capabilities,
      limits: { maxAgentCalls: 5, maxConcurrentAgents: 1 },
    });

    expect(result).toEqual({
      before: {
        agentCalls: 1,
        activeAgents: 0,
        queuedAgents: 0,
        maxAgentCalls: 5,
        maxConcurrentAgents: 1,
        totalTokens: null,
      },
      after: {
        agentCalls: 2,
        activeAgents: 0,
        queuedAgents: 0,
        maxAgentCalls: 5,
        maxConcurrentAgents: 1,
        totalTokens: null,
      },
    });
  });

  it("accepts native workflow references and rejects invalid or exotic ones", async () => {
    const references: unknown[] = [];
    const result = await executeWorkflowScript({
      args: null,
      body: `
        const valid = [
          await workflow("named"),
          await workflow({ name: "named-object" }),
          await workflow({ script: "return 1;" }),
          await workflow({ scriptPath: "workflows/child.js" }),
        ];
        const inherited = Object.create({ inherited: true });
        inherited.name = "bad";
        const accessor = {};
        Object.defineProperty(accessor, "name", { get() { throw new Error("getter ran"); }, enumerable: true });
        const symbolic = { name: "bad" };
        symbolic[Symbol("extra")] = true;
        const invalid = [
          "",
          {},
          { name: "one", scriptPath: "two" },
          { unknown: "value" },
          { name: "" },
          { script: 42 },
          ["named"],
          inherited,
          accessor,
          symbolic,
        ];
        const errors = [];
        for (const reference of invalid) {
          try { await workflow(reference); errors.push("accepted"); }
          catch (error) { errors.push(error.message); }
        }
        return { valid, errors };
      `,
      capabilities: {
        agent: async () => null,
        workflow: async (reference) => {
          references.push(reference);
          return reference;
        },
        log: vi.fn(),
        phase: vi.fn(),
      },
    });

    expect(result).toEqual({
      valid: [
        "named",
        { name: "named-object" },
        { script: "return 1;" },
        { scriptPath: "workflows/child.js" },
      ],
      errors: [
        "workflow nameOrRef string must not be empty",
        "workflow reference must contain exactly one of name, script, or scriptPath",
        "workflow reference must contain exactly one of name, script, or scriptPath",
        "workflow reference must contain exactly one of name, script, or scriptPath",
        "workflow reference name must be a non-empty string",
        "workflow reference script must be a non-empty string",
        "workflow nameOrRef must be a non-empty string or a reference object",
        "workflow reference must be a plain JSON object",
        "workflow reference must contain an enumerable data property",
        "workflow reference must not contain symbol properties",
      ],
    });
    expect(references).toEqual([
      "named",
      { name: "named-object" },
      { script: "return 1;" },
      { scriptPath: "workflows/child.js" },
    ]);
  });

  it("gives an actionable error when nested workflows are not configured", async () => {
    await expect(
      executeWorkflowScript({
        args: null,
        body: `return await workflow("child");`,
        capabilities: { agent: async () => null, log: vi.fn(), phase: vi.fn() },
      }),
    ).rejects.toThrow("configure the workflow host capability");
  });

  it("rejects a nested workflow from a child VM before invoking the host", async () => {
    const nested = vi.fn(async () => null);
    await expect(
      executeWorkflowScript({
        args: null,
        body: `return await workflow("grandchild");`,
        depth: 1,
        capabilities: {
          agent: async () => null,
          workflow: nested,
          log: vi.fn(),
          phase: vi.fn(),
        },
      }),
    ).rejects.toThrow("one child level only");
    expect(nested).not.toHaveBeenCalled();
  });

  it("rejects invalid workflow depth before evaluating guest source", async () => {
    await expect(
      executeWorkflowScript({
        args: null,
        body: `return "evaluated";`,
        depth: 2,
        capabilities: { agent: async () => null, log: vi.fn(), phase: vi.fn() },
      } as never),
    ).rejects.toThrow("Workflow depth must be 0 or 1");
  });

  it("propagates root cancellation through an executing child VM", async () => {
    const controller = new AbortController();
    let markChildStarted: (() => void) | undefined;
    const childStarted = new Promise<void>((resolve) => {
      markChildStarted = resolve;
    });
    const capabilities: WorkflowCapabilities = {
      agent: (_prompt, _options, signal) =>
        new Promise((_resolve, reject) => {
          markChildStarted?.();
          signal.addEventListener(
            "abort",
            () => reject(new Error("child agent aborted")),
            { once: true },
          );
        }),
      workflow: (_reference, childArgs, context) =>
        executeWorkflowScript({
          args: childArgs,
          body: `return await agent("child-never");`,
          capabilities,
          ...context,
        }),
      log: vi.fn(),
      phase: vi.fn(),
    };
    const execution = executeWorkflowScript({
      args: null,
      body: `return await workflow("child");`,
      capabilities,
      signal: controller.signal,
    });

    await childStarted;
    controller.abort();
    await expect(execution).rejects.toThrow("Workflow cancelled");
  });

  it("tears down child VM calls without disturbing the parent VM", async () => {
    const calls: string[] = [];
    let detachedAborted = false;
    const capabilities: WorkflowCapabilities = {
      agent: (prompt, _options, signal) => {
        calls.push(prompt);
        if (prompt !== "child-detached") return Promise.resolve(prompt);
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              detachedAborted = true;
              reject(new Error("detached child stopped"));
            },
            { once: true },
          );
        });
      },
      workflow: (_reference, childArgs, context) =>
        executeWorkflowScript({
          args: childArgs,
          body: `
            agent("child-detached");
            await agent("child-barrier");
            return "child-done";
          `,
          capabilities,
          ...context,
        }),
      log: vi.fn(),
      phase: vi.fn(),
    };

    const result = await executeWorkflowScript({
      args: null,
      body: `
        const child = await workflow("child");
        const parent = await agent("parent-after-child");
        return { child, parent, budget: budget() };
      `,
      capabilities,
      limits: { maxAgentCalls: 3, maxConcurrentAgents: 2 },
    });

    expect(result).toEqual({
      child: "child-done",
      parent: "parent-after-child",
      budget: {
        agentCalls: 3,
        activeAgents: 0,
        queuedAgents: 0,
        maxAgentCalls: 3,
        maxConcurrentAgents: 2,
        totalTokens: null,
      },
    });
    expect(calls).toEqual([
      "child-detached",
      "child-barrier",
      "parent-after-child",
    ]);
    expect(detachedAborted).toBe(true);
  });

  it("cancels an awaited nested workflow and closes an un-awaited one", async () => {
    const awaitedController = new AbortController();
    let fireAndForgetAborted = false;
    const awaited = executeWorkflowScript({
      args: null,
      body: `return await workflow("awaited");`,
      signal: awaitedController.signal,
      capabilities: {
        agent: async () => null,
        workflow: (_name, _args, context) =>
          new Promise((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(new Error("nested aborted")),
              { once: true },
            );
          }),
        log: vi.fn(),
        phase: vi.fn(),
      },
    });
    awaitedController.abort();
    await expect(awaited).rejects.toThrow("Workflow cancelled");

    const result = await executeWorkflowScript({
      args: null,
      body: `workflow("detached"); return "done";`,
      capabilities: {
        agent: async () => null,
        workflow: (_name, _args, context) =>
          new Promise((_resolve) => {
            context.signal.addEventListener(
              "abort",
              () => {
                fireAndForgetAborted = true;
              },
              { once: true },
            );
          }),
        log: vi.fn(),
        phase: vi.fn(),
      },
    });
    expect(result).toBe("done");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fireAndForgetAborted).toBe(true);
  });

  it("blocks computed constructor access at the runtime boundary", async () => {
    const result = await executeWorkflowScript({
      args: null,
      body: `
        try {
          return (() => {})["con" + "structor"]("return 1")();
        } catch { return "blocked"; }
      `,
      capabilities: { agent: async () => null, log: vi.fn(), phase: vi.fn() },
    });
    expect(result).toBe("blocked");
  });
});
