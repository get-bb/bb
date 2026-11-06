import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it } from "vitest";
import {
  OperationError,
  createOperationKernel,
  defineOperation,
  deny,
  type HookPolicy,
  type OperationCaller,
} from "../src/index.js";

interface Echo {
  text: string;
}

function setup(hooks: HookPolicy = "answer") {
  const storage = new AsyncLocalStorage<OperationCaller>();
  const warnings: string[] = [];
  const kernel = createOperationKernel<null>({
    currentCaller: () => storage.getStore() ?? null,
    enter: (caller, work) => storage.run(caller, work),
    warn: (message, fields) => warnings.push(`${message} ${fields.plugin}`),
    hookBudgetMs: 50,
  });
  const echo = defineOperation<Echo, string>({
    name: "test.echo",
    kind: "write",
    hooks,
    parse: (raw) => {
      if (
        typeof raw !== "object" ||
        raw === null ||
        typeof Reflect.get(raw, "text") !== "string"
      ) {
        throw new Error("text is required");
      }
      return raw as Echo;
    },
  });
  const seen: OperationCaller[] = [];
  kernel.implement(echo, (input, { caller }) => {
    seen.push(caller);
    return input.text;
  });
  return { kernel, echo, warnings, seen, storage };
}

const appCaller: OperationCaller = {
  user: "owner",
  door: "app",
  thread: null,
  via: [],
};

describe("operation kernel", () => {
  it("runs hooks outermost by tier and lets rewrite hooks change input and output", async () => {
    const { kernel } = setup("rewrite");
    const order: string[] = [];
    kernel
      .scope("installed-plugin", "installed")
      .hook("test.echo", async (input, next) => {
        order.push("installed");
        return `${await next(input)}!`;
      });
    kernel
      .scope("product-plugin", "product")
      .hook("test.echo", async (input, next) => {
        order.push("product");
        return next({ text: `${(input as Echo).text.toUpperCase()}` });
      });
    kernel.scope("policy-plugin", "policy").hook("test.echo", (input, next) => {
      order.push("policy");
      return next(input);
    });
    await expect(
      kernel.call("test.echo", { text: "hi" }, { caller: appCaller }),
    ).resolves.toBe("HI!");
    expect(order).toEqual(["policy", "installed", "product"]);
  });

  it("ignores what observe hooks pass and return", async () => {
    const { kernel } = setup("observe");
    kernel
      .scope("watcher", "installed")
      .hook("test.echo", async (_input, next) => {
        await next({ text: "changed" });
        return "replaced";
      });
    await expect(kernel.call("test.echo", { text: "hi" })).resolves.toBe("hi");
  });

  it("refuses through deny on answer operations", async () => {
    const { kernel } = setup("answer");
    kernel.scope("policy", "installed").hook("test.echo", (input) => {
      if ((input as Echo).text === "no") deny("not allowed");
      return "answered";
    });
    await expect(
      kernel.call("test.echo", { text: "no" }),
    ).rejects.toMatchObject({
      code: "denied",
      plugin: "policy",
      message: "not allowed",
    });
    await expect(kernel.call("test.echo", { text: "yes" })).resolves.toBe(
      "answered",
    );
  });

  it("skips a failing hook unless it is registered fail-closed", async () => {
    const { kernel, warnings } = setup("answer");
    const scope = kernel.scope("flaky", "installed");
    const remove = scope.hook("test.echo", () => {
      throw new Error("boom");
    });
    await expect(kernel.call("test.echo", { text: "hi" })).resolves.toBe("hi");
    expect(warnings).toEqual(["An operation hook failed flaky"]);
    remove();
    scope.hook(
      "test.echo",
      () => {
        throw new Error("boom");
      },
      { failClosed: true },
    );
    await expect(
      kernel.call("test.echo", { text: "hi" }),
    ).rejects.toBeInstanceOf(OperationError);
  });

  it("rejects fail-closed hooks on operations that cannot be refused", () => {
    const { kernel } = setup("rewrite");
    expect(() =>
      kernel
        .scope("strict", "installed")
        .hook("test.echo", (input, next) => next(input), { failClosed: true }),
    ).toThrow("test.echo cannot be refused by a hook");
  });

  it("requires rewrite hooks to call next", async () => {
    const { kernel, warnings } = setup("rewrite");
    kernel.scope("lazy", "installed").hook("test.echo", () => "skipped");
    await expect(kernel.call("test.echo", { text: "hi" })).resolves.toBe("hi");
    expect(warnings).toEqual(["An operation hook failed lazy"]);
  });

  it("times out a hook on its own time, not the time spent beneath it", async () => {
    const { kernel } = setup("rewrite");
    kernel.scope("slow", "installed").hook("test.echo", async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return "late";
    });
    await expect(kernel.call("test.echo", { text: "hi" })).resolves.toBe("hi");
  });

  it("only runs a hook when its match equals the input", async () => {
    const { kernel } = setup("rewrite");
    kernel
      .scope("picky", "installed")
      .hook("test.echo", async (input, next) => `${await next(input)}?`, {
        match: { text: "a" },
      });
    await expect(kernel.call("test.echo", { text: "a" })).resolves.toBe("a?");
    await expect(kernel.call("test.echo", { text: "b" })).resolves.toBe("b");
  });

  it("adds the calling plugin to via and keeps the outer caller", async () => {
    const { kernel, seen, storage } = setup();
    const scope = kernel.scope("helper", "product");
    await storage.run({ ...appCaller, thread: "thr_1" }, () =>
      scope.call("test.echo", { text: "hi" }),
    );
    expect(seen.at(-1)).toEqual({
      user: "owner",
      door: "app",
      thread: "thr_1",
      via: ["helper"],
    });
  });

  it("propagates the caller into nested calls made by the implementation", async () => {
    const { kernel, seen } = setup();
    const outer = defineOperation<Echo, string>({
      name: "test.outer",
      kind: "write",
      parse: (raw) => raw as Echo,
    });
    const plugin = kernel.scope("outer-plugin", "installed");
    plugin.implement(
      outer,
      (input) => plugin.call("test.echo", input) as Promise<string>,
    );
    await kernel.call("test.outer", { text: "hi" }, { caller: appCaller });
    expect(seen.at(-1)?.via).toEqual(["outer-plugin"]);
  });

  it("calls operations that take or return bytes by name, with the result as is", async () => {
    const { kernel } = setup();
    const raw = defineOperation({
      name: "test.raw",
      internal: true,
      parse: (value) => value,
    });
    kernel.implement(raw, () => new Response("bytes", { status: 201 }));
    const result = await kernel.call("test.raw", {});
    expect(result).toBeInstanceOf(Response);
    expect(await (result as Response).text()).toBe("bytes");
  });

  it("forgets everything a disposed scope registered", async () => {
    const { kernel } = setup("rewrite");
    const scope = kernel.scope("temp", "installed");
    const extra = defineOperation<Echo, string>({
      name: "temp.op",
      parse: (raw) => raw as Echo,
    });
    scope.implement(extra, (input) => input.text);
    scope.hook("test.echo", async (input, next) => `${await next(input)}!`);
    scope.dispose();
    expect(kernel.operation("temp.op")).toBeNull();
    await expect(kernel.call("test.echo", { text: "hi" })).resolves.toBe("hi");
    expect(() => scope.hook("test.echo", (input, next) => next(input))).toThrow(
      'Plugin "temp" was unloaded',
    );
  });

  it("lists operations with owners, doors and hook chains", () => {
    const { kernel } = setup();
    kernel
      .scope("policy", "installed")
      .hook("test.echo", (input, next) => next(input), { failClosed: true });
    expect(kernel.inspect()).toEqual([
      {
        name: "test.echo",
        kind: "write",
        hooks: "answer",
        owner: "core",
        internal: false,
        doors: [],
        http: null,
        chain: [
          {
            plugin: "policy",
            tier: "installed",
            failClosed: true,
            match: null,
          },
        ],
      },
    ]);
  });

  it("validates a result a hook produced, and trusts the implementation's own", async () => {
    const { kernel } = setup("answer");
    const checked = defineOperation<Echo, string>({
      name: "test.checked",
      kind: "write",
      hooks: "answer",
      parse: (raw) => raw as Echo,
      checkOutput: (output) =>
        typeof output === "string" ? null : "expected a string",
    });
    kernel.implement(checked, () => 42 as unknown as string);
    await expect(kernel.call("test.checked", { text: "a" })).resolves.toBe(42);
    const scope = kernel.scope("bad-hook", "installed");
    const remove = scope.hook("test.checked", () => ({ not: "a string" }));
    await expect(
      kernel.call("test.checked", { text: "a" }),
    ).rejects.toMatchObject({
      code: "invalid_output",
      plugin: "bad-hook",
      message:
        "bad-hook returned an invalid result for test.checked: expected a string",
    });
    remove();
    scope.hook("test.checked", async (input, next) => `${await next(input)}!`);
    await expect(kernel.call("test.checked", { text: "a" })).resolves.toBe(
      "42!",
    );
  });

  it("collects votes in order, stops on a stopping vote, and hands them to the implementation", async () => {
    const { kernel } = setup();
    const decide = defineOperation<Echo, string>({
      name: "test.decide",
      kind: "write",
      hooks: "vote",
      parse: (raw) => raw as Echo,
      checkVote: (value) =>
        value === "go" || value === "wait" || value === "stop"
          ? null
          : "not a decision",
      stopVoting: (value) => value === "stop",
      hookFailure: (plugin, detail) => new Error(`${plugin}: ${detail}`),
    });
    kernel.implement(decide, (_input, { votes }) =>
      votes.map((entry) => `${entry.plugin}=${String(entry.value)}`).join(","),
    );
    const first = kernel.scope("first", "installed");
    first.hook("test.decide", () => "wait");
    const second = kernel.scope("second", "product");
    second.hook("test.decide", (input) =>
      (input as Echo).text === "halt" ? "stop" : "go",
    );
    const third = kernel.scope("third", "product");
    third.hook("test.decide", () => "go");
    await expect(kernel.call("test.decide", { text: "x" })).resolves.toBe(
      "first=wait,second=go,third=go",
    );
    await expect(kernel.call("test.decide", { text: "halt" })).resolves.toBe(
      "first=wait,second=stop",
    );
    third.dispose();
    const bad = kernel.scope("bad", "product");
    bad.hook("test.decide", () => "maybe");
    await expect(kernel.call("test.decide", { text: "x" })).rejects.toThrow(
      "bad: returned an invalid decision: not a decision",
    );
    bad.dispose();
    const broken = kernel.scope("broken", "product");
    broken.hook("test.decide", () => {
      throw new Error("down");
    });
    await expect(kernel.call("test.decide", { text: "x" })).rejects.toThrow(
      "broken: down",
    );
  });

  it("runs serialized calls one at a time", async () => {
    const { kernel } = setup();
    const events: string[] = [];
    const serial = defineOperation<Echo, string>({
      name: "test.serial",
      kind: "write",
      serialized: true,
      parse: (raw) => raw as Echo,
    });
    kernel.implement(serial, async (input) => {
      events.push(`start ${input.text}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push(`end ${input.text}`);
      return input.text;
    });
    await Promise.all([
      kernel.call("test.serial", { text: "a" }),
      kernel.call("test.serial", { text: "b" }),
    ]);
    expect(events).toEqual(["start a", "end a", "start b", "end b"]);
  });
});
