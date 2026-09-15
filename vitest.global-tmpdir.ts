import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ACTIVE = Symbol.for("@bb/vitest-tmpdir-sandbox");

interface Sandbox {
  root: string;
  previous: string | undefined;
  references: number;
}

type SandboxHolder = { [ACTIVE]?: Sandbox };

export default function setup(): () => void {
  const holder = globalThis as SandboxHolder;
  let sandbox = holder[ACTIVE];
  if (sandbox === undefined) {
    const previous = process.env.TMPDIR;
    sandbox = {
      root: mkdtempSync(join(tmpdir(), "bb-vt-")),
      previous,
      references: 0,
    };
    holder[ACTIVE] = sandbox;
    process.env.TMPDIR = sandbox.root;
  }
  sandbox.references += 1;
  return () => {
    const active = holder[ACTIVE];
    if (active === undefined) return;
    active.references -= 1;
    if (active.references > 0) return;
    delete holder[ACTIVE];
    if (active.previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = active.previous;
    rmSync(active.root, { recursive: true, force: true });
  };
}
