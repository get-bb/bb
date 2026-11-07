import { describe, expect, it } from "vitest";
import { moveStylesheetPropertiesToRegistry } from "./stylesheet-property-registry";

function propertyRule(
  name: string,
  syntax: string,
  initialValue: string | null,
): CSSRule {
  const rule = { name, syntax, inherits: false, initialValue, cssText: "" };
  return rule as unknown as CSSRule;
}

function styleRule(cssText: string): CSSRule {
  return { cssText } as unknown as CSSRule;
}

function sheetOf(rules: CSSRule[]) {
  return {
    cssRules: rules,
    deleteRule(index: number) {
      rules.splice(index, 1);
    },
  };
}

function registryRejecting(names: ReadonlySet<string>) {
  const definitions: PropertyDefinition[] = [];
  return {
    definitions,
    registerProperty(definition: PropertyDefinition) {
      if (names.has(definition.name)) throw new Error("already registered");
      definitions.push(definition);
    },
  };
}

describe("moveStylesheetPropertiesToRegistry", () => {
  it("registers each @property rule and removes it from its sheet", () => {
    const utility = styleRule(".shadow{box-shadow:var(--tw-shadow)}");
    const host = sheetOf([
      propertyRule("--tw-shadow", "*", "0 0 #0000"),
      utility,
      propertyRule("--tw-ring-color", "*", null),
    ]);
    const registry = registryRejecting(new Set());

    moveStylesheetPropertiesToRegistry([host], registry);

    expect(host.cssRules).toEqual([utility]);
    expect(registry.definitions).toEqual([
      { name: "--tw-ring-color", syntax: "*", inherits: false },
      {
        name: "--tw-shadow",
        syntax: "*",
        inherits: false,
        initialValue: "0 0 #0000",
      },
    ]);
  });

  it("removes a later identical rule and keeps a conflicting one", () => {
    const first = sheetOf([propertyRule("--tw-shadow", "*", "0 0 #0000")]);
    const conflicting = propertyRule("--tw-blur", "<length>", "0px");
    const second = sheetOf([
      propertyRule("--tw-shadow", "*", "0 0 #0000"),
      propertyRule("--tw-blur", "*", null),
    ]);
    const third = sheetOf([conflicting]);

    moveStylesheetPropertiesToRegistry(
      [first, second, third],
      registryRejecting(new Set()),
    );

    expect(first.cssRules).toEqual([]);
    expect(second.cssRules).toEqual([]);
    expect(third.cssRules).toEqual([conflicting]);
  });

  it("keeps a rule the registry rejects", () => {
    const rejected = propertyRule("--bb-taken", "*", null);
    const sheet = sheetOf([rejected]);

    moveStylesheetPropertiesToRegistry(
      [sheet],
      registryRejecting(new Set(["--bb-taken"])),
    );

    expect(sheet.cssRules).toEqual([rejected]);
  });

  it("skips sheets whose rules cannot be read", () => {
    const unreadable = {
      get cssRules(): CSSRule[] {
        throw new DOMException("cross-origin", "SecurityError");
      },
      deleteRule() {
        throw new Error("unreachable");
      },
    };
    const readable = sheetOf([propertyRule("--tw-shadow", "*", null)]);

    moveStylesheetPropertiesToRegistry(
      [unreadable, readable],
      registryRejecting(new Set()),
    );

    expect(readable.cssRules).toEqual([]);
  });
});
