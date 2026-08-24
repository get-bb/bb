/**
 * Scope a compiled plugin stylesheet's `utilities` layer to that plugin's own
 * mounts by rewriting selectors, replacing the `@scope` at-rule that used to
 * do the same job.
 *
 * `@scope` is the semantically exact tool and it is why this code is not just
 * a nesting wrapper — but Safari 26 resolves scope containment per element per
 * scoped rule, with no selector bucketing. A plugin's whole utilities layer
 * inside one `@scope` block therefore turns every full style recalculation
 * into `elements × utilities` work. Measured on a 2,635-element page with the
 * `ask-user-question` plugin's 91KB sheet: 306ms as `@scope`, 11ms with no
 * scoping at all, 7ms with this rewrite. Eight plugin sheets pushed a single
 * style pass to 838ms, which is the dominant cost of the app in Safari and
 * invisible in Blink. bugs.webkit.org carries six `@scope` bugs, all
 * correctness, so there is no upstream fix to wait for.
 *
 * Each selector becomes two zero-specificity arms:
 *
 *     :where(<roots>) .flex-col,      // subject sits inside a scope root
 *     :where(<roots>).flex-col        // subject IS a scope root
 *
 * The second arm is load-bearing, not cosmetic. Portaled overlays put the
 * scope attribute on the very element that carries the plugin's utility
 * classes — shared-ui's `dialog.tsx` spreads `usePortalScopeProps()` onto the
 * styled `DialogPrimitive.Overlay` — so a descendant combinator alone would
 * leave every plugin dialog, sheet, dropdown, and tooltip unstyled.
 *
 * `:where()` adds no specificity, exactly like `@scope`, so cascade order
 * within the plugin's own sheet is unchanged: a later plain `.grid` still
 * loses to an earlier `@md:flex`.
 *
 * Versus `@scope` the second arm is marginally more permissive for a compound
 * selector whose subject is not its first compound (`@scope` would require a
 * strict ancestor to match `.a > .b`, this matches when the root itself is
 * `.a`). Descendant and child combinators keep that widening inside the scope
 * root's own subtree, so it cannot leak onto the host or another plugin's
 * pane — which is the property the scoping exists to guarantee.
 *
 * Sibling combinators are the exception. `[&~*]:hidden` compiles to
 * `.X { &~* { … } }`, and with the root itself as `.X` the subject is a
 * sibling of the root — a host element or another plugin's portal in
 * `document.body`. `@scope` never matched that (the subject must be in
 * scope), so the self arm is omitted when the selector, or any style rule
 * nested in it, has a top-level `+` or `~` combinator after its `&`. The
 * descendant arm still covers siblings that live inside a root.
 */

/**
 * At-rules whose bodies hold style rules that must be scoped too. Everything
 * else is copied verbatim on purpose: rewriting a `from`/`50%` keyframe
 * selector, a `@property` descriptor, or a `@font-face` block would corrupt
 * it.
 */
const NESTED_STYLE_RULE_AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "scope",
  "starting-style",
]);

/** A `prelude { body }` rule, or a `prelude ;` declaration when body is null. */
interface Statement {
  prelude: string;
  body: string | null;
}

/** The scope-root selector list a plugin's utilities are confined to. */
export function pluginScopeRoots(pluginId: string): string {
  // Second arm keeps portals styled on hosts whose portal-scope predates the
  // per-plugin id attribute (see shared-ui/src/lib/portal-scope.ts).
  return `[data-bb-plugin="${pluginId}"], [data-bb-plugin-root]:not([data-bb-plugin])`;
}

/**
 * Rewrite every selector in `css`'s top-level `@layer utilities` blocks so the
 * rules only reach elements at or inside `scopeRoots`. Other top-level blocks
 * — `@layer theme`, `@layer properties`, `@property`, `@keyframes` — are left
 * alone: theme variables must stay on `:root`, the registered-property
 * fallbacks are universal by design, and `@property` is invalid when nested.
 *
 * A plugin that uses no utility classes compiles to no utilities layer at
 * all, which is fine — there is nothing to leak. What is not fine is a class
 * rule landing OUTSIDE that layer, so this throws on one. That is the
 * difference between a loud build failure and silently shipping a plugin's
 * generic `.flex-col` as a global rule that collapses host layouts.
 */
export function scopePluginUtilities(css: string, scopeRoots: string): string {
  const scope = `:where(${scopeRoots})`;

  return splitStatements(css)
    .map((statement) => {
      if (statement.body === null) return statement.prelude;
      if (isUtilitiesLayer(statement.prelude)) {
        return `${statement.prelude}{${scopeStatements(statement.body, scope)}}`;
      }
      assertNoUnscopedClassRule(statement);
      return `${statement.prelude}{${statement.body}}`;
    })
    .join("");
}

/**
 * Tailwind emits every class selector into the `utilities` layer; the theme
 * layers carry variables and the registered-property fallbacks carry
 * universal selectors. A class rule anywhere else means a Tailwind change has
 * moved utilities out from under the scoping.
 */
function assertNoUnscopedClassRule(statement: Statement): void {
  if (statement.body === null) return;
  const prelude = statement.prelude.trim();

  if (!prelude.startsWith("@")) {
    if (!prelude.includes(".")) return;
    throw new Error(
      `Compiled plugin CSS has a class rule outside the utilities layer ` +
        `(${prelude.slice(0, 80)}). Its utilities would leak into the host ` +
        `page; check the Tailwind version against buildTailwindCss()'s input.`,
    );
  }

  const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
  if (!NESTED_STYLE_RULE_AT_RULES.has(name)) return;
  for (const nested of splitStatements(statement.body)) {
    assertNoUnscopedClassRule(nested);
  }
}

function isUtilitiesLayer(prelude: string): boolean {
  return /^@layer\s+utilities$/.test(prelude.trim());
}

function scopeStatements(css: string, scope: string): string {
  return splitStatements(css)
    .map((statement) => {
      if (statement.body === null) return statement.prelude;

      const prelude = statement.prelude.trim();
      if (prelude.startsWith("@")) {
        const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
        const body = NESTED_STYLE_RULE_AT_RULES.has(name)
          ? scopeStatements(statement.body, scope)
          : statement.body;
        return `${statement.prelude}{${body}}`;
      }

      const nestedSibling = hasNestedSiblingRule(statement.body);
      const selectors = splitSelectorList(prelude)
        .flatMap((selector) =>
          nestedSibling || hasSiblingCombinator(selector)
            ? [`${scope} ${selector}`]
            : [`${scope} ${selector}`, `${scope}${selector}`],
        )
        .join(",");
      return `${selectors}{${statement.body}}`;
    })
    .join("");
}

/**
 * Split a block body into top-level statements. String, escape, and paren
 * aware, so `content: "}"`, `.w-\[50\%\]`, and `:is(a, b)` all survive.
 */
function splitStatements(css: string): Statement[] {
  const statements: Statement[] = [];
  let preludeStart = 0;
  let parenDepth = 0;

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      index = findStringEnd(css, index);
      continue;
    }
    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    else if (parenDepth === 0 && char === ";") {
      statements.push({
        prelude: css.slice(preludeStart, index + 1),
        body: null,
      });
      preludeStart = index + 1;
    } else if (parenDepth === 0 && char === "{") {
      const blockEnd = findBlockEnd(css, index);
      statements.push({
        prelude: css.slice(preludeStart, index),
        body: css.slice(index + 1, blockEnd),
      });
      index = blockEnd;
      preludeStart = index + 1;
    }
  }

  const tail = css.slice(preludeStart);
  if (tail.trim().length > 0) statements.push({ prelude: tail, body: null });
  return statements;
}

/** Split a selector list on its top-level commas. */
function splitSelectorList(selectors: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let parenDepth = 0;

  for (let index = 0; index < selectors.length; index += 1) {
    const char = selectors[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      index = findStringEnd(selectors, index);
      continue;
    }
    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    else if (char === "," && parenDepth === 0) {
      parts.push(selectors.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(selectors.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * Whether any style rule nested in a rule body (directly or under a
 * conditional at-rule) can place its subject outside the parent's element —
 * i.e. has a sibling combinator after its `&`. Tailwind emits variants such
 * as `[&~*]:hidden` as nested `&~*` rules rather than flat selectors.
 */
function hasNestedSiblingRule(body: string): boolean {
  return splitStatements(body).some((statement) => {
    if (statement.body === null) return false;
    const prelude = statement.prelude.trim();
    if (prelude.startsWith("@")) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
      return (
        NESTED_STYLE_RULE_AT_RULES.has(name) &&
        hasNestedSiblingRule(statement.body)
      );
    }
    return (
      splitSelectorList(prelude).some(hasSiblingCombinator) ||
      hasNestedSiblingRule(statement.body)
    );
  });
}

/**
 * Whether a selector has a top-level `+` or `~` combinator after its last
 * top-level `&` (or anywhere, for a selector without `&` — including a
 * relative nested selector such as `~ *`). `.a ~ &` keeps its subject on the
 * parent element, so it does not count. Escapes, strings, `(...)` and `[...]`
 * are skipped so `.\[\&\~\*\]`, `[data-x~="a"]`, `calc(1px\+2px)` and
 * `:is(.peer ~ *)` do not count either.
 */
function hasSiblingCombinator(selector: string): boolean {
  let depth = 0;
  let found = false;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      index = findStringEnd(selector, index);
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (depth === 0 && char === "&") found = false;
    else if (depth === 0 && (char === "+" || char === "~")) found = true;
  }
  return found;
}

/** Index of the `}` closing the block that opens at `openIndex`. */
function findBlockEnd(css: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < css.length; index += 1) {
    const char = css[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      index = findStringEnd(css, index);
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("Unbalanced braces in compiled plugin CSS.");
}

/** Index of the quote closing the string that opens at `openIndex`. */
function findStringEnd(css: string, openIndex: number): number {
  const quote = css[openIndex];
  for (let index = openIndex + 1; index < css.length; index += 1) {
    const char = css[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === quote) return index;
  }
  throw new Error("Unterminated string in compiled plugin CSS.");
}
