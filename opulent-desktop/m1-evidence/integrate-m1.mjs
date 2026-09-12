import fs from 'node:fs';
import path from 'node:path';
import ts from '/opulent/workspace/opulent-bb/node_modules/typescript/lib/typescript.js';
const root='/opulent/workspace/opulent-bb';
const dest=path.join(root,'packages/opulent-learning');
fs.mkdirSync(dest,{recursive:true});
for(const dir of fs.readdirSync('/opulent/workspace/opulent-desktop/packages')) {
  fs.mkdirSync(path.join(dest,'src',dir),{recursive:true});
  for(const name of fs.readdirSync('/opulent/workspace/opulent-desktop/packages/'+dir)) {
    if(!name.endsWith('.ts')) continue;
    let text=fs.readFileSync('/opulent/workspace/opulent-desktop/packages/'+dir+'/'+name,'utf8');
    text=text.replace('from "node:test"','from "vitest"');
    const ast=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);
    fs.writeFileSync(path.join(dest,'src',dir,name),ts.createPrinter({removeComments:true}).printFile(ast));
  }
}
const exports=Object.fromEntries(fs.readdirSync(path.join(dest,'src')).map(n=>['./'+n,{source:`./src/${n}/${n}.ts`,types:`./src/${n}/${n}.ts`,default:`./src/${n}/${n}.ts`}]));
fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({name:'@opulent/learning-contracts',version:'0.1.0',private:true,type:'module',exports,scripts:{typecheck:'tsc --noEmit',test:'vitest run --config vitest.config.ts'},devDependencies:{'@bb/tsconfig':'workspace:*','@types/node':'^22.0.0',typescript:'npm:@typescript/typescript6@^6.0.2',vitest:'^4.1.1'}},null,2)+'\n');
const conf=JSON.parse(fs.readFileSync('/opulent/workspace/opulent-desktop/tsconfig.json','utf8'));
conf.include=['src/**/*.ts'];fs.writeFileSync(path.join(dest,'tsconfig.json'),JSON.stringify(conf,null,2)+'\n');
for(const rel of ['apps/desktop/scripts/desktop-release-channel.mjs','apps/desktop/scripts/desktop-release-channel.d.mts','apps/desktop/test/electron-builder-config.test.ts']) {
 const p=path.join(root,rel);let s=fs.readFileSync(p,'utf8');
 s=s.replaceAll('dev.bb.desktop','ai.opulent.desktop').replaceAll('bb Nightly','Opulent Nightly').replaceAll('bb-nightly','opulent-nightly').replaceAll('"bb"','"Opulent"').replaceAll('https://github.com/get-bb/bb/releases/','https://github.com/OpulentiaAI/bb/releases/');
 s=s.replaceAll('linuxExecutableName: "Opulent"','linuxExecutableName: "opulent"').replaceAll('z.enum(["Opulent", "opulent-nightly"])','z.enum(["opulent", "opulent-nightly"])');fs.writeFileSync(p,s);
}
