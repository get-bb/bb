import { machineEnvironmentSetSchema } from "@bb/server-contract";

export function parseMachineEnvironmentImport(text: string) {
  const entries: { name: string; value: string }[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match)
      throw new Error(`Invalid variable on line ${index + 1}. Use KEY=value.`);
    const name = match[1]!;
    let value = match[2]!;
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      value = value.slice(1);
      const closingQuote = () => {
        for (let offset = 0; offset < value.length; offset++) {
          if (quote === '"' && value[offset] === "\\") {
            offset++;
            continue;
          }
          if (value[offset] === quote) return offset;
        }
        return -1;
      };
      while (closingQuote() < 0 && index + 1 < lines.length)
        value += `\n${lines[++index]}`;
      const end = closingQuote();
      if (end < 0 || !/^\s*(?:#.*)?$/u.test(value.slice(end + 1)))
        throw new Error(`Invalid quoted value for ${name}.`);
      value = value.slice(0, end);
      if (quote === '"')
        value = value.replace(/\\([nrt"\\])/g, (_, escaped: string) => {
          if (escaped === "n") return "\n";
          if (escaped === "r") return "\r";
          if (escaped === "t") return "\t";
          return escaped;
        });
    } else value = value.replace(/\s+#.*$/u, "").trim();
    if (entries.some((entry) => entry.name === name))
      throw new Error(`Duplicate variable: ${name}.`);
    if (
      !machineEnvironmentSetSchema.safeParse({
        name,
        value,
        note: null,
      }).success
    )
      throw new Error(`Invalid value for ${name}.`);
    entries.push({ name, value });
  }
  if (!entries.length) throw new Error("No variables found. Use KEY=value.");
  return entries;
}
