import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it.each([false, true])(
  "gates step cursor controls on stdout TTY (%s)",
  (tty) => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
        process.stdout.isTTY = ${tty};
        const { endStep } = await import(${JSON.stringify(new URL("../src/lib/script-helpers.ts", import.meta.url).href)});
        endStep("✓", "Finished");
      `,
      ],
      { encoding: "utf8" },
    );
    expect(output).toBe(`${tty ? "\x1b[2K" : ""}  ✓  Finished\n`);
  },
);
