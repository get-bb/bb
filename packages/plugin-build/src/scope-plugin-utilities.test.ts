import { describe, expect, it } from "vitest";
import {
  dropHostProvidedTailwind,
  pluginScopeRoots,
  scopePluginUtilities,
} from "./scope-plugin-utilities.js";

const ROOTS = pluginScopeRoots("demo");
const SCOPE = `:where(${ROOTS})`;

function scopeUtilities(utilities: string): string {
  return scopePluginUtilities(`@layer utilities{${utilities}}`, ROOTS);
}

describe("scopePluginUtilities", () => {
  it("preserves owned and anonymous portal roots", () => {
    expect(pluginScopeRoots("demo")).toBe(
      '[data-bb-plugin="demo"], [data-bb-plugin-root]:not([data-bb-plugin])',
    );
  });

  it("emits separate descendant and self rules per selector", () => {
    expect(scopeUtilities(".flex-col{flex-direction:column}")).toBe(
      `@layer utilities{${SCOPE} .flex-col{flex-direction:column}${SCOPE}.flex-col{flex-direction:column}}`,
    );
  });

  it("scopes each selector in a list", () => {
    expect(scopeUtilities(".a,.b{color:red}")).toBe(
      `@layer utilities{${SCOPE} .a,${SCOPE}.a,${SCOPE} .b,${SCOPE}.b{color:red}}`,
    );
  });

  it("preserves nesting specificity when the original selector list has different specificities", () => {
    expect(scopeUtilities(".a,#b{&:hover{color:red}}")).toBe(
      `@layer utilities{${SCOPE} .a,${SCOPE}.a,${SCOPE} #b,${SCOPE}#b{&:hover{color:red}}}`,
    );
  });

  it("keeps commas inside :is()/:not() out of the selector split", () => {
    const scoped = scopeUtilities(":is(.a,.b) > .c{color:red}");
    expect(scoped).toBe(
      `@layer utilities{${SCOPE} :is(.a,.b) > .c{color:red}${SCOPE}:is(.a,.b) > .c{color:red}}`,
    );
  });

  it("drops the self arm for sibling combinators so a portal root cannot reach host siblings", () => {
    const hidden = String.raw`.\[\&\~\*\]\:hidden`;
    expect(scopeUtilities(`${hidden}{&~*{display:none}}`)).toBe(
      `@layer utilities{${SCOPE} ${hidden}{&~*{display:none}}}`,
    );
    expect(scopeUtilities(`${hidden} ~ *{display:none}`)).toBe(
      `@layer utilities{${SCOPE} ${hidden} ~ *{display:none}}`,
    );
    expect(scopeUtilities(".a{+ .b{color:red}}")).toBe(
      `@layer utilities{${SCOPE} .a{+ .b{color:red}}}`,
    );
    expect(
      scopeUtilities(".a{@media (hover:hover){&:hover + .b{color:red}}}"),
    ).toBe(
      `@layer utilities{${SCOPE} .a{@media (hover:hover){&:hover + .b{color:red}}}}`,
    );
  });

  it("keeps both arms when a sibling combinator precedes & so the subject stays on the element", () => {
    expect(scopeUtilities(".x{.a ~ &{color:red}}")).toBe(
      `@layer utilities{${SCOPE} .x{.a ~ &{color:red}}${SCOPE}.x{.a ~ &{color:red}}}`,
    );
    expect(scopeUtilities(".x{&:hover{color:red}}")).toBe(
      `@layer utilities{${SCOPE} .x{&:hover{color:red}}${SCOPE}.x{&:hover{color:red}}}`,
    );
  });

  it("keeps both arms when + or ~ only appear escaped, in attributes, or inside :is()", () => {
    const peer = String.raw`.peer-checked\:hidden:is(:where(.peer):checked ~ *)`;
    expect(scopeUtilities(`${peer}{display:none}`)).toContain(
      `${SCOPE}${peer}`,
    );
    const attr = String.raw`[data-x~="a"].mt-\[calc\(1px\+2px\)\]`;
    expect(scopeUtilities(`${attr}{margin:0}`)).toContain(`${SCOPE}${attr}`);
  });

  it("keeps the scope in front of a pseudo-element so the selector stays valid", () => {
    expect(scopeUtilities(".content-x::before{content:'x'}")).toContain(
      `${SCOPE}.content-x::before`,
    );
  });

  it("survives escaped class names and braces inside strings", () => {
    const scoped = scopeUtilities(String.raw`.w-\[50\%\]{content:"}"}`);
    expect(scoped).toBe(
      `@layer utilities{${SCOPE} .w-\\[50\\%\\]{content:"}"}${SCOPE}.w-\\[50\\%\\]{content:"}"}}`,
    );
  });

  it("scopes rules nested in conditional at-rules", () => {
    const scoped = scopeUtilities(
      "@media (min-width:40rem){.md-flex{display:flex}}",
    );
    expect(scoped).toBe(
      `@layer utilities{@media (min-width:40rem){${SCOPE} .md-flex{display:flex}${SCOPE}.md-flex{display:flex}}}`,
    );
  });

  it("leaves keyframe selectors alone", () => {
    const scoped = scopeUtilities(
      "@keyframes spin{from{rotate:0deg}to{rotate:360deg}}",
    );
    expect(scoped).toBe(
      "@layer utilities{@keyframes spin{from{rotate:0deg}to{rotate:360deg}}}",
    );
  });

  it("leaves theme variables and @property registrations unscoped", () => {
    const css = [
      "@layer theme{:root{--color-red:red}}",
      '@property --tw-scale-x{syntax:"*";inherits:false}',
      "@layer utilities{.scale-x-50{--tw-scale-x:50%}}",
    ].join("");
    const scoped = scopePluginUtilities(css, ROOTS);
    expect(scoped).toContain("@layer theme{:root{--color-red:red}}");
    expect(scoped).toContain(
      '@property --tw-scale-x{syntax:"*";inherits:false}',
    );
    expect(scoped).toContain(`${SCOPE}.scale-x-50`);
  });

  it("preserves the license banner in readable optimized CSS", () => {
    const banner =
      "/*! tailwindcss v4.3.0 | MIT License | https://tailwindcss.com */";
    expect(
      scopePluginUtilities(`${banner}@layer utilities{.a{color:red}}`, ROOTS),
    ).toBe(
      `${banner}@layer utilities{${SCOPE} .a{color:red}${SCOPE}.a{color:red}}`,
    );
  });

  it("accepts a build with no utilities layer", () => {
    expect(scopePluginUtilities("@layer theme{:root{--a:1}}", ROOTS)).toBe(
      "@layer theme{:root{--a:1}}",
    );
  });

  it("throws when a class rule lands outside the utilities layer", () => {
    expect(() =>
      scopePluginUtilities(
        "@layer theme{.flex-col{flex-direction:column}}",
        ROOTS,
      ),
    ).toThrow(/class rule outside the utilities layer/);
  });

  it("allows the universal registered-property fallback layer", () => {
    const css =
      "@layer properties{@supports (top:1px){*,::before{--tw-blur:initial}}}" +
      "@layer utilities{.blur-sm{filter:blur(4px)}}";
    expect(() => scopePluginUtilities(css, ROOTS)).not.toThrow();
  });
});

describe("dropHostProvidedTailwind", () => {
  const HOST = [
    "@layer theme {\n  :root, :host {\n    --spacing: 0.25rem;\n    --color-red-500: oklch(63.7% 0.237 25.331);\n  }\n}",
    '@property --tw-blur {\n  syntax: "*";\n  inherits: false;\n}',
    '@property --tw-shadow {\n  syntax: "*";\n  inherits: false;\n  initial-value: 0 0 #0000;\n}',
  ].join("\n");

  it("drops registrations the host makes and their fallback declarations", () => {
    const css =
      "@layer properties{@supports (top:1px){*,::before{--tw-blur:initial;--tw-shadow:0 0 #0000;--x-own:1}}}" +
      "@layer utilities{.shadow{--tw-shadow:0 1px #000;box-shadow:var(--tw-shadow)}}" +
      '@property --tw-blur{syntax:"*";inherits:false}' +
      '@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}' +
      '@property --x-own{syntax:"*";inherits:false;initial-value:1}';
    expect(dropHostProvidedTailwind(css, HOST)).toBe(
      "@layer properties{@supports (top:1px){*,::before{--x-own:1}}}" +
        "@layer utilities{.shadow{--tw-shadow:0 1px #000;box-shadow:var(--tw-shadow)}}" +
        '@property --x-own{syntax:"*";inherits:false;initial-value:1}',
    );
  });

  it("keeps a registration whose descriptors differ from the host's", () => {
    const css =
      '@property --tw-shadow{syntax:"*";inherits:false;initial-value:none}';
    expect(dropHostProvidedTailwind(css, HOST)).toBe(css);
  });

  it("removes the fallback layer once every declaration in it is dropped", () => {
    const css =
      "@layer properties;@layer properties{@supports (top:1px){*{--tw-blur:initial}}}" +
      '@property --tw-blur{syntax:"*";inherits:false}' +
      "@layer utilities{.a{color:red}}";
    expect(dropHostProvidedTailwind(css, HOST)).toBe(
      "@layer properties;@layer utilities{.a{color:red}}",
    );
  });

  it("drops theme variables the host declares with the same value", () => {
    const css =
      "@layer theme{:root,:host{--spacing:0.25rem;--color-red-500:red;--text-xs:0.75rem}}" +
      "@layer utilities{.p-1{padding:calc(var(--spacing) * 1)}}";
    expect(dropHostProvidedTailwind(css, HOST)).toBe(
      "@layer theme{:root,:host{--color-red-500:red;--text-xs:0.75rem}}" +
        "@layer utilities{.p-1{padding:calc(var(--spacing) * 1)}}",
    );
  });

  it("removes the theme layer once the host declares all of it", () => {
    expect(
      dropHostProvidedTailwind(
        "@layer theme{:root,:host{--spacing:0.25rem}}@layer utilities{.a{color:red}}",
        HOST,
      ),
    ).toBe("@layer utilities{.a{color:red}}");
  });
});
