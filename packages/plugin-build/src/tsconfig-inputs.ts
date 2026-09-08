import { stat } from "node:fs/promises";
import { parse, TSConfckCache, type TSConfckParseResult } from "tsconfck";

export async function tsconfigInputs(
  files: Iterable<string>,
): Promise<string[]> {
  const found = new Set<string>();
  const cache = new TSConfckCache<TSConfckParseResult>();
  function collect(result: TSConfckParseResult): void {
    if (!result.tsconfigFile || found.has(result.tsconfigFile)) return;
    found.add(result.tsconfigFile);
    for (const parent of result.extended ?? []) collect(parent);
    for (const reference of result.referenced ?? []) collect(reference);
    if (result.solution) collect(result.solution);
  }
  for (const file of files) {
    if (
      await stat(file)
        .then((entry) => entry.isFile())
        .catch(() => false)
    )
      collect(await parse(file, { cache }));
  }
  return [...found];
}
