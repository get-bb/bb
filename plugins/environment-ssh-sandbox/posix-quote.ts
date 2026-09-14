export function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function posixCommand(argv: readonly string[]): string {
  if (argv.length === 0) throw new Error("SSH remote command is empty");
  return argv.map(posixQuote).join(" ");
}
