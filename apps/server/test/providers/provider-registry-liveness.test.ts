import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const registryUrl = new URL(
  "../../src/services/providers/provider-registry.ts",
  import.meta.url,
).href;

it("finishes pending provider boot waits before an otherwise idle process exits", async () => {
  await Promise.all(
    ["whenRegistrationsSettled()", 'whenProviderRegistered("missing")'].map(
      async (wait) => {
        const { stdout, stderr } = await execFileAsync(
          process.execPath,
          [
            "--conditions=source",
            "--import",
            "tsx",
            "--input-type=module",
            "--eval",
            `
              import { createProviderRegistryService } from ${JSON.stringify(registryUrl)};
              const registry = createProviderRegistryService({ deferRegistrationsSettled: true });
              registry.${wait}.then(() => console.log("wait completed"));
            `,
          ],
          { timeout: 40_000 },
        );
        expect(stderr).toBe("");
        expect(stdout.trim()).toBe("wait completed");
      },
    ),
  );
}, 45_000);
