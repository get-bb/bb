import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isMap, isScalar, parseAllDocuments, visit } from "yaml";

const e2eRoot = fileURLToPath(new URL("../../../e2e", import.meta.url));

function yamlFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return yamlFiles(path);
    return /\.ya?ml$/u.test(entry.name) ? [path] : [];
  });
}

function flowSource(path: string): string {
  return readFileSync(join(e2eRoot, path), "utf8");
}

describe("Mobile E2E flow boundaries", () => {
  it("resolves every runFlow file in stock flows", () => {
    for (const path of yamlFiles(e2eRoot)) {
      for (const document of parseAllDocuments(readFileSync(path, "utf8"))) {
        expect(document.errors, path).toEqual([]);
        visit(document, {
          Pair(_index, { key, value }) {
            if (!isScalar(key) || key.value !== "runFlow") return;
            const include = isMap(value)
              ? value.get("file")
              : isScalar(value)
                ? value.value
                : undefined;
            if (typeof include !== "string") return;
            expect(
              statSync(resolve(dirname(path), include), {
                throwIfNoEntry: false,
              })?.isFile(),
              `${path} → ${include}`,
            ).toBe(true);
          },
        });
      }
    }
  });

  it("routes every bb scheme link through the native-confirmation helper", () => {
    for (const path of yamlFiles(e2eRoot)) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(
        /^\s*- openLink: "bb:\/\//mu,
      );
    }
  });

  it("uses one direct-server pairing boundary in every shell flow", () => {
    for (const flow of [
      "flows/shell-launch.yaml",
      "flows/shell-deep-link.yaml",
      "flows/shell-send.yaml",
      "flows/shell-send-sidebar-swipe.yaml",
    ]) {
      expect(flowSource(flow), flow).toContain(
        "- runFlow: ../subflows/pair-direct-server.yaml",
      );
    }

    const pairing = flowSource("subflows/pair-direct-server.yaml");
    expect(pairing).toContain('visible: ".*(Not now|Ask anything).*"');
    expect(pairing).toContain('- tapOn: "Not now"');
    expect(pairing).toContain('- assertNotVisible: "Not now"');
    expect(pairing).toContain('id: "shell-webview"');
  });
});
