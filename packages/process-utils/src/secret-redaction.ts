function secretVariants(values: readonly string[]): string[] {
  const patterns = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const lf = value.replaceAll("\r\n", "\n");
    patterns.add(value);
    patterns.add(value.replaceAll("\n", "\r\n"));
    patterns.add(lf);
    patterns.add(lf.replaceAll("\n", "\r\n"));
  }
  return [...patterns].sort((a, b) => b.length - a.length);
}

export function redactSecretText(
  text: string,
  values: readonly string[],
): string {
  const patterns = secretVariants(values);
  if (patterns.length === 0) return text;
  let output = "";
  for (let index = 0; index < text.length;) {
    const match = patterns.find((secret) => text.startsWith(secret, index));
    if (match) {
      output += "[redacted]";
      index += match.length;
    } else {
      output += text[index];
      index += 1;
    }
  }
  return output;
}

export function createSecretStreamRedactor(
  source: readonly string[] | (() => readonly string[]),
) {
  let pending = "";
  const known = new Set<string>();
  function secrets(): string[] {
    for (const value of typeof source === "function" ? source() : source) {
      if (!value) continue;
      for (const variant of secretVariants([value])) known.add(variant);
    }
    return [...known].sort((a, b) => b.length - a.length);
  }
  return {
    push(chunk: string): string {
      const patterns = secrets();
      const text = pending + chunk;
      pending = "";
      if (patterns.length === 0) return text;
      let output = "";
      for (let index = 0; index < text.length;) {
        const remaining = text.length - index;
        if (
          patterns.some(
            (secret) =>
              remaining < secret.length && secret.startsWith(text.slice(index)),
          )
        ) {
          pending = text.slice(index);
          break;
        }
        const match = patterns.find((secret) => text.startsWith(secret, index));
        if (match) {
          output += "[redacted]";
          index += match.length;
        } else {
          output += text[index];
          index += 1;
        }
      }
      return output;
    },
    flush(): string {
      const output = pending ? "[redacted]" : "";
      pending = "";
      known.clear();
      return output;
    },
  };
}
