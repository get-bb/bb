type DiffLine = { op: " " | "+" | "-"; text: string };

const MAX_CELLS = 4_000_000;
const CONTEXT = 2;

function middle(a: string[], b: string[]): DiffLine[] {
  const n = a.length,
    m = b.length;
  if (n * m > MAX_CELLS)
    return [
      ...a.map((text) => ({ op: "-" as const, text })),
      ...b.map((text) => ({ op: "+" as const, text })),
    ];
  const table = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[at(i, j)] =
        a[i] === b[j]
          ? table[at(i + 1, j + 1)]! + 1
          : Math.max(table[at(i + 1, j)]!, table[at(i, j + 1)]!);
  const lines: DiffLine[] = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ op: " ", text: a[i]! });
      i++;
      j++;
    } else if (table[at(i + 1, j)]! >= table[at(i, j + 1)]!)
      lines.push({ op: "-", text: a[i++]! });
    else lines.push({ op: "+", text: b[j++]! });
  }
  while (i < n) lines.push({ op: "-", text: a[i++]! });
  while (j < m) lines.push({ op: "+", text: b[j++]! });
  return lines;
}

export function diffText(before: string, after: string): string {
  if (before === after) return "";
  const a = before.split("\n"),
    b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const lines: DiffLine[] = [
    ...a.slice(0, start).map((text) => ({ op: " " as const, text })),
    ...middle(a.slice(start, a.length - end), b.slice(start, b.length - end)),
    ...a.slice(a.length - end).map((text) => ({ op: " " as const, text })),
  ];
  const out: string[] = [];
  let skipped = false;
  lines.forEach((line, index) => {
    const near = lines
      .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
      .some((l) => l.op !== " ");
    if (!near) {
      if (!skipped) out.push("…");
      skipped = true;
      return;
    }
    skipped = false;
    out.push(`${line.op} ${line.text}`);
  });
  return out.join("\n");
}
