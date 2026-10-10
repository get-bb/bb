export type TableAlignment = "left" | "center" | "right" | null;

interface ParsedTable {
  alignments: TableAlignment[];
  header: string[];
  rows: string[][];
  nextLine: number;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function hasUnescapedPipe(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && !isEscaped(line, i)) return true;
  }
  return false;
}

function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !isEscaped(row, row.length - 1)) {
    row = row.slice(0, -1);
  }

  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "|" && !isEscaped(row, i)) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    if (row[i] === "|" && cell.endsWith("\\")) {
      cell = cell.slice(0, -1);
    }
    cell += row[i];
  }
  cells.push(cell.trim());
  return cells;
}

function parseTableAlignment(cell: string): TableAlignment | undefined {
  if (!/^:?-+:?$/.test(cell)) return undefined;
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

export function parseTable(
  lines: string[],
  startLine: number,
): ParsedTable | null {
  if (startLine + 1 >= lines.length) return null;
  const headerLine = lines[startLine];
  const delimiterLine = lines[startLine + 1];
  if (!hasUnescapedPipe(headerLine) || !hasUnescapedPipe(delimiterLine)) {
    return null;
  }

  const header = splitTableRow(headerLine);
  const delimiterCells = splitTableRow(delimiterLine);
  if (header.length !== delimiterCells.length) return null;

  const alignments: TableAlignment[] = [];
  for (const cell of delimiterCells) {
    const alignment = parseTableAlignment(cell);
    if (alignment === undefined) return null;
    alignments.push(alignment);
  }

  const rows: string[][] = [];
  let nextLine = startLine + 2;
  while (
    nextLine < lines.length &&
    lines[nextLine].trim() !== "" &&
    hasUnescapedPipe(lines[nextLine])
  ) {
    const cells = splitTableRow(lines[nextLine]).slice(0, header.length);
    while (cells.length < header.length) cells.push("");
    rows.push(cells);
    nextLine++;
  }

  return { alignments, header, rows, nextLine };
}
