import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";
import { expect, it } from "vitest";
import {
  declarationId,
  sharedDeclarationEmit,
} from "./shared-declaration-emit.mjs";
import { normalizeBundledDts } from "./normalize-bundled-dts.mjs";

it("preserves inferred types, ambient declarations, and distinct workspace compiler options", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bb-shared-declarations-"));
  try {
    const sdk = path.join(root, "sdk");
    const contract = path.join(root, "contract");
    await mkdir(path.join(sdk, "node_modules/@bb"), { recursive: true });
    await mkdir(contract);
    await symlink(contract, path.join(sdk, "node_modules/@bb/contract"), "dir");
    await writeFile(
      path.join(contract, "package.json"),
      JSON.stringify({ name: "@bb/contract", types: "index.ts" }),
    );
    const entries = [path.join(sdk, "index.ts"), path.join(sdk, "other.ts")];
    await writeFile(
      entries[0],
      'export { value, nullable, ambientValue } from "@bb/contract";\nexport const own = [1, null];',
    );
    await writeFile(
      entries[1],
      'export { value } from "@bb/contract";\nexport const other = "second" as const;',
    );
    await writeFile(
      path.join(contract, "index.ts"),
      'export const value = { label: "hello", count: 1 } as const;\nexport const nullable = [1, null];\nexport const ambientValue = ambient;',
    );
    await writeFile(
      path.join(contract, "ambient.d.ts"),
      'declare const ambient: "ambient";',
    );
    await writeFile(
      path.join(sdk, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          moduleResolution: "node",
          target: "es2022",
        },
      }),
    );
    const resolveSource = (id) =>
      id === "@bb/contract" ? path.join(contract, "index.ts") : null;
    async function bundle(entry, plugins) {
      const build = await rollup({ input: entry, plugins });
      try {
        const { output } = await build.generate({ format: "es" });
        return normalizeBundledDts(output[0].code);
      } finally {
        await build.close();
      }
    }
    for (const strictNullChecks of [false, true]) {
      await writeFile(
        path.join(contract, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strictNullChecks,
            moduleResolution: "node",
            target: "es2022",
          },
        }),
      );
      const shared = sharedDeclarationEmit(entries, root, resolveSource);
      for (const entry of entries) {
        const actual = await bundle(declarationId(entry), [shared, dts()]);
        const expected = await bundle(entry, [
          { name: "workspace", resolveId: resolveSource },
          dts({ compilerOptions: { strictNullChecks } }),
        ]);
        expect(actual).toContain('readonly label: "hello"');
        if (entry === entries[0]) {
          expect(actual).toContain('declare const ambientValue: "ambient"');
          expect(actual.match(/declare const nullable: ([^;]+);/)[1]).toBe(
            expected.match(/declare const nullable: ([^;]+);/)[1],
          );
          expect(actual).toContain("declare const own: (number | null)[]");
        }
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
