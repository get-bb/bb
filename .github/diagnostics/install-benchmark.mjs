import { cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=process.cwd();
const output=join(root,'diagnostic-results');
mkdirSync(output,{recursive:true});
const filter=JSON.parse(readFileSync('scripts/ci-test-shards.json','utf8'))['windows-tests'].find(s=>s.shard==='packages-other').filter;
const results=[];
for(const [index,variant] of ['before','after','after','before'].entries()) {
 const cwd=join(process.env.RUNNER_TEMP,`bb-install-${index}`);
 cpSync(root,cwd,{recursive:true,filter:source=>!relative(root,source).split(/[\\/]/).some(part=>['.git','node_modules','diagnostic-results'].includes(part))});
 const env={...process.env,CI:'true',npm_config_store_dir:join(process.env.RUNNER_TEMP,`bb-cold-store-${index}`),APP_SHARD:'false',SERVER_SHARD:'false',PLUGIN_SHARD:'false',OTHER_PACKAGES_SHARD:'true',MOBILE_TESTS:'true',TEST_FILTERS:filter,TURBO_CACHE_DIR:join(cwd,'.turbo/cache')};
 const install=variant==='before'?'pnpm install --frozen-lockfile --ignore-scripts':'bash .github/diagnostics/install-selected.sh';
 for(const [phase,command] of [['install',install],['test',`pnpm exec turbo run test ${filter} --continue --concurrency=2 --summarize --output-logs=new-only`]]) {
  const start=performance.now();
  const result=spawnSync(command,{cwd,env,shell:true,encoding:'utf8',maxBuffer:128*1024*1024});
  writeFileSync(join(output,`${index}-${variant}-${phase}.log`),result.stdout+result.stderr);
  results.push({index,variant,phase,status:result.status,seconds:(performance.now()-start)/1000});
  writeFileSync(join(output,'install-status.json'),JSON.stringify(results,null,2));
  if(result.status!==0) {process.exitCode=1;if(phase==='install')break;}
 }
}
