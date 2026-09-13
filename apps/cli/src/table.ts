import Table from "cli-table3";

interface BorderlessTableOptions {
  head: string[];
  colWidths: number[];
  trimTrailingWhitespace?: boolean;
}

const BORDERLESS_TABLE_OPTIONS = {
  chars: {
    top: "",
    "top-mid": "",
    "top-left": "",
    "top-right": "",
    bottom: "",
    "bottom-mid": "",
    "bottom-left": "",
    "bottom-right": "",
    left: "",
    "left-mid": "",
    mid: "-",
    "mid-mid": "  ",
    right: "",
    "right-mid": "",
    middle: "  ",
  },
  style: {
    head: [],
    border: [],
    ["padding-left"]: 0,
    ["padding-right"]: 0,
  },
};

export function renderBorderlessTable(
  options: BorderlessTableOptions,
  rows: string[][],
): string {
  const table = new Table({
    ...BORDERLESS_TABLE_OPTIONS,
    head: options.head,
    colWidths: options.colWidths,
  });

  for (const row of rows) {
    table.push(row);
  }

  const rendered = table.toString();
  if (!options.trimTrailingWhitespace) {
    return rendered;
  }
  return rendered
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

export function printBorderlessTable(
  options: BorderlessTableOptions,
  rows: string[][],
): void {
  console.log("");
  console.log(renderBorderlessTable(options, rows));
  console.log("");
}

export function columnWidths(
  rows: string[][],
  minimums: readonly number[],
): number[] {
  return minimums.map((minimum, index) =>
    Math.max(minimum, ...rows.map((row) => row[index].length)),
  );
}

export function truncateCell(value: string, maxWidth: number): string {
  const singleLine = value.replace(/\s+/gu, " ");
  if (singleLine.length <= maxWidth) return singleLine;
  return `${singleLine.slice(0, maxWidth - 1)}…`;
}
