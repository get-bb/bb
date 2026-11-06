import { describe, expect, it } from "vitest";
import {
  OperationError,
  createOperationKernel,
  type Operation,
  type OperationCaller,
} from "../src/index.js";

interface Echo {
  text: string;
}

const echo: Operation<Echo> = {
  name: "test.echo",
  http: { method: "post", path: "/echo", status: 200, headers: {} },
  parse(raw) {
    const text =
      typeof raw === "object" && raw !== null
        ? Reflect.get(raw, "text")
        : undefined;
    if (typeof text !== "string") {
      throw new OperationError("invalid_input", "text is required");
    }
    return { text };
  },
};

const owner: OperationCaller = { user: "owner" };

describe("operation kernel", () => {
  it("parses the input and hands the implementation the caller and signal", async () => {
    const kernel = createOperationKernel<null>();
    const seen: unknown[] = [];
    kernel.implement(echo, (input, { caller, signal, http }) => {
      seen.push(caller, signal.aborted, http);
      return input.text.toUpperCase();
    });
    await expect(
      kernel.call(echo, { text: "hi", ignored: true }, { caller: owner }),
    ).resolves.toBe("HI");
    expect(seen).toEqual([owner, false, null]);
    await expect(
      kernel.call(echo, { text: 1 }, { caller: owner }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("names operations that are defined but not implemented, and refuses a second owner", async () => {
    const kernel = createOperationKernel<null>();
    kernel.define(echo);
    expect(kernel.unimplemented()).toEqual(["test.echo"]);
    await expect(
      kernel.call(echo, { text: "hi" }, { caller: owner }),
    ).rejects.toMatchObject({ code: "unimplemented" });
    kernel.implement(echo, (input) => input.text);
    expect(kernel.unimplemented()).toEqual([]);
    expect(() => kernel.implement(echo, (input) => input.text)).toThrow(
      "test.echo is already implemented",
    );
    expect(() => kernel.define({ ...echo })).toThrow(
      "test.echo is already defined",
    );
  });
});
