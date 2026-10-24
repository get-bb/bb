interface PropertyRegistry {
  registerProperty(definition: PropertyDefinition): void;
}

interface PropertyRuleSheet {
  readonly cssRules: ArrayLike<CSSRule>;
  deleteRule(index: number): void;
}

function isPropertyRule(rule: CSSRule): rule is CSSPropertyRule {
  return "syntax" in rule && "inherits" in rule && "initialValue" in rule;
}

function definitionOf(rule: CSSPropertyRule): PropertyDefinition {
  return rule.initialValue === null
    ? { name: rule.name, syntax: rule.syntax, inherits: rule.inherits }
    : {
        name: rule.name,
        syntax: rule.syntax,
        inherits: rule.inherits,
        initialValue: rule.initialValue,
      };
}

function definitionKey(definition: PropertyDefinition): string {
  return JSON.stringify([
    definition.syntax,
    definition.inherits,
    definition.initialValue ?? null,
  ]);
}

function readableRules(sheet: PropertyRuleSheet): ArrayLike<CSSRule> | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

export function moveStylesheetPropertiesToRegistry(
  sheets: Iterable<PropertyRuleSheet>,
  registry: PropertyRegistry,
): void {
  const registered = new Map<string, string>();
  for (const sheet of sheets) {
    const rules = readableRules(sheet);
    if (rules === null) continue;
    for (let index = rules.length - 1; index >= 0; index -= 1) {
      const rule = rules[index];
      if (rule === undefined || !isPropertyRule(rule)) continue;
      const definition = definitionOf(rule);
      const key = definitionKey(definition);
      const existing = registered.get(definition.name);
      if (existing === undefined) {
        try {
          registry.registerProperty(definition);
        } catch {
          continue;
        }
        registered.set(definition.name, key);
      } else if (existing !== key) {
        continue;
      }
      sheet.deleteRule(index);
    }
  }
}
