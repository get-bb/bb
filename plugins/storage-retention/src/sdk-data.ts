import type { BbPluginApi } from "@get-bb/plugin-sdk";
export async function readThreads(bb: BbPluginApi, signal?: AbortSignal) {
  const rows: Awaited<ReturnType<typeof bb.sdk.threads.list>> = [];
  for (let offset = 0; ; offset += 500) {
    signal?.throwIfAborted();
    const page = await bb.sdk.threads.list({
      includeHidden: true,
      limit: 500,
      offset,
      signal,
    });
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
