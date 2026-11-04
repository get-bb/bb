import { createVitest } from 'vitest/node';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const ctx = await createVitest('test', { root: resolve('apps/server'), config: resolve('apps/server/vitest.config.ts'), watch: false });
try {
  const specs = await ctx.globTestSpecifications();
  const matches = [];
  for (let index = 1; index <= 3; index++) {
    ctx.config.shard = { index, count: 3 };
    const selected = await new ctx.config.sequence.sequencer(ctx).shard(specs);
    console.log(`Shard ${index}/3: ${selected.length}/${specs.length} files`);
    if (selected.some(spec => spec.moduleId.replaceAll('\\', '/').endsWith('/plugin-update.test.ts'))) matches.push(`${index}/3`);
  }
  if (matches.length !== 1) throw new Error(`Expected one shard, got ${matches}`);
  console.log(`Affected shard: ${matches[0]}`);
  writeFileSync('affected-shard.txt', matches[0]);
} finally {
  await ctx.close();
}
