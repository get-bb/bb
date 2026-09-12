from pathlib import Path
import json
root = Path('/opulent/workspace/opulent-bb')
phrases = ['bb hit an error', 'Reload bb', 'bb restores', 'bb couldn', 'Update bb', 'bb reloads', 'your bb and', 'Turn bb into', 'with bb plugins', 'bb — ', 'bb homepage', 'so bb can', 'this bb yet', 'this bb server', 'bb update available', 'bb updates available', "bb's own", 'bb desktop app', 'New bb skill', 'new bb skill', 'use in bb can', 'Ships with bb', 'Updates with bb', 'bb (built-in)', 'full bb ', 'Dismiss bb ', 'next bb release', 'bb app', 'Relaunch bb', 'bb daemon', 'Manage bb and', 'every bb window', 'bb server', 'bb users', 'bb project', 'Repositories bb can', 'catalog bb validated', "bb's primary", 'Could not open bb', 'Could not stop the running bb', 'Open bb again', 'open bb again', 'Another bb started', 'so bb stopped', 'bb did not stop', 'bb could not stop', 'The bb at', 'running bb', 'Quit bb', 'About bb', 'Starting bb', 'Restart bb', 'bb is starting']
for area in ['apps/app/src','apps/desktop/src','apps/desktop/test']:
    for p in (root/area).rglob('*'):
        if p.suffix not in ['.ts','.tsx']: continue
        s=p.read_text(); t=s
        for phrase in phrases: t=t.replace(phrase,phrase.replace('bb','Opulent'))
        if p.name=='desktop-update-provider.ts':
            t=t.replace('"bb" | "bb Nightly"','"Opulent" | "Opulent Nightly"').replace('nightly ? "bb Nightly" : "bb"','nightly ? "Opulent Nightly" : "Opulent"')
        if p.name=='AppLayout.tsx': t=t.replace('"/": { title: "bb" }','"/": { title: "Opulent" }')
        if p.name=='SkillsCollection.tsx': t=t.replace('provider === "bb" ? "bb" :','provider === "bb" ? "Opulent" :')
        if p.name in ['SidebarUpdatesBadge.tsx','UpdatePluginDialog.tsx']:
            t=t.replace('\n              bb\n','\n              Opulent\n')
        if p.name=='local-view.ts': t=t.replace('<title>bb</title>','<title>Opulent</title>')
        if 'update-provider' in p.name or 'update-check' in p.name or 'electron-builder-config' in p.name:
            t=t.replace('https://github.com/get-bb/bb/releases/','https://github.com/OpulentiaAI/bb/releases/')
            t=t.replace('"bb Nightly"','"Opulent Nightly"')
        if t!=s: p.write_text(t)
p=root/'apps/app/index.html'; s=p.read_text(); p.write_text(s.replace('content="bb"','content="Opulent"').replace('<title>bb</title>','<title>Opulent</title>'))
p=root/'apps/app/public/manifest.webmanifest'; d=json.loads(p.read_text()); d['name']='Opulent'; d['short_name']='Opulent'; p.write_text(json.dumps(d,indent=2)+'\n')
p=root/'apps/desktop/electron-builder.config.json'; d=json.loads(p.read_text()); d['appId']='ai.opulent.desktop'; d['productName']='Opulent'; d['linux']['executableName']='opulent'; d['publish'][0]['url']='https://github.com/OpulentiaAI/bb/releases/download/desktop-latest/'; p.write_text(json.dumps(d,indent=2)+'\n')
p=root/'apps/desktop/package.json'; d=json.loads(p.read_text()); d['description']='Opulent desktop shell, based on bb'; d['scripts']['desktop:build']=d['scripts']['desktop:build'].replace('--publish always','--publish never'); p.write_text(json.dumps(d,indent=2)+'\n')
