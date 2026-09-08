export function createSecretStreamRedactor(
  source: readonly string[] | (() => readonly string[]),
) {
  let pending = "";
  const known = new Set<string>();
  function secrets(): string[] {
    for (const value of typeof source === "function" ? source() : source) {
      if (!value) continue;
      known.add(value);
      known.add(value.replaceAll("\n", "\r\n"));
      const lf = value.replaceAll("\r\n", "\n");
      known.add(lf);
      known.add(lf.replaceAll("\n", "\r\n"));
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
