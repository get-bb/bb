const NESTED_STYLE_RULE_AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "scope",
  "starting-style",
]);

interface Statement {
  prelude: string;
  body: string | null;
}

export function pluginScopeRoots(pluginId: string): string {
  return `[data-bb-plugin="${pluginId}"], [data-bb-plugin-root]:not([data-bb-plugin])`;
}

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

export function dropHostProvidedTailwind(css: string, hostCss: string): string {
  const hostStatements = splitStatements(hostCss);
  const hostRegistrations = new Set(
    hostStatements.flatMap((statement) => {
      const registration = propertyRegistration(statement);
      return registration === null ? [] : [registration.key];
    }),
  );
  const hostThemeDeclarations = new Set(
    hostStatements
      .filter((statement) => isLayer(statement, "theme"))
      .flatMap((statement) => declarationsIn(statement.body ?? "")),
  );
  const dropped = new Set<string>();
  const kept = splitStatements(css).filter((statement) => {
    const registration = propertyRegistration(statement);
    if (registration === null || !hostRegistrations.has(registration.key))
      return true;
    dropped.add(registration.name);
    return false;
  });
  return kept
    .map((statement) => {
      if (statement.body === null) return statement.prelude;
      const body = isLayer(statement, "properties")
        ? dropDeclarations(statement.body, (declaration) =>
            dropped.has(declaration.slice(0, declaration.indexOf(":"))),
          )
        : isLayer(statement, "theme")
          ? dropDeclarations(statement.body, (declaration) =>
              hostThemeDeclarations.has(declaration),
            )
          : statement.body;
      return body === null ? "" : `${statement.prelude}{${body}}`;
    })
    .join("");
}

function isLayer(statement: Statement, name: string): boolean {
  return (
    statement.body !== null &&
    statement.prelude.trim().replace(/\s+/g, " ") === `@layer ${name}`
  );
}

function propertyRegistration(
  statement: Statement,
): { name: string; key: string } | null {
  if (statement.body === null) return null;
  const name = /^@property\s+(--[\w-]+)$/.exec(statement.prelude.trim())?.[1];
  if (name === undefined) return null;
  return { name, key: `${name}{${declarationsIn(statement.body).join(";")}}` };
}

function normalizeDeclaration(declaration: string): string | null {
  const text = declaration.replace(/\s+/g, " ").trim().replace(/;$/, "");
  const colon = text.indexOf(":");
  if (colon <= 0) return null;
  return `${text.slice(0, colon).trim()}:${text.slice(colon + 1).trim()}`;
}

function declarationsIn(css: string): string[] {
  return splitStatements(css).flatMap((statement) => {
    if (statement.body !== null) return declarationsIn(statement.body);
    const declaration = normalizeDeclaration(statement.prelude);
    return declaration === null ? [] : [declaration];
  });
}

function dropDeclarations(
  css: string,
  drop: (declaration: string) => boolean,
): string | null {
  const kept = splitStatements(css).flatMap((statement) => {
    if (statement.body === null) {
      const declaration = normalizeDeclaration(statement.prelude);
      return declaration !== null && drop(declaration)
        ? []
        : [statement.prelude];
    }
    const body = dropDeclarations(statement.body, drop);
    return body === null ? [] : [`${statement.prelude}{${body}}`];
  });
  return kept.length === 0 ? null : kept.join("");
}

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
      const originalSelectors = splitSelectorList(prelude);
      const selectors = originalSelectors.flatMap((selector) =>
        nestedSibling || hasSiblingCombinator(selector)
          ? [`${scope} ${selector}`]
          : [`${scope} ${selector}`, `${scope}${selector}`],
      );
      return (
        originalSelectors.length === 1 ? selectors : [selectors.join(",")]
      )
        .map((selector) => `${selector}{${statement.body}}`)
        .join("");
    })
    .join("");
}

function splitStatements(css: string): Statement[] {
  const statements: Statement[] = [];
  let preludeStart = 0;
  let parenDepth = 0;

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (char === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      if (end < 0)
        throw new Error("Unterminated comment in compiled plugin CSS.");
      if (
        parenDepth === 0 &&
        css.slice(preludeStart, index).trim().length === 0
      ) {
        statements.push({
          prelude: css.slice(preludeStart, end + 2),
          body: null,
        });
        preludeStart = end + 2;
      }
      index = end + 1;
      continue;
    }
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
