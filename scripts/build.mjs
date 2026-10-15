import { build } from 'esbuild';
import { mkdir, cp, writeFile, chmod, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root=resolve(import.meta.dirname,'..'),dist=join(root,'dist');
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
const options={bundle:true,platform:'node',format:'esm',target:'node24',banner:{js:'import {createRequire as __cairnCreateRequire} from "node:module"; const require=__cairnCreateRequire(import.meta.url);'},logLevel:'warning'};
await build({...options,entryPoints:[join(root,'src/cli.ts')],outfile:join(dist,'cairn.mjs')});
await build({...options,entryPoints:[join(root,'src/adapters/pi-extension.ts')],outfile:join(dist,'pi-extension.mjs')});
const json=async(path,value)=>{await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,JSON.stringify(value,null,2)+'\n');};
for(const host of ['pi','claude','codex']){
 const dir=join(dist,'plugins',host);await mkdir(join(dir,'runtime'),{recursive:true});
 await cp(join(dist,'cairn.mjs'),join(dir,'runtime/cairn.mjs'));
 await cp(join(root,'skills'),join(dir,'skills'),{recursive:true});
 await cp(join(root,'profiles'),join(dir,'profiles'),{recursive:true});
 if(host==='pi'){
  await cp(join(dist,'pi-extension.mjs'),join(dir,'runtime/pi-extension.mjs'));
  await json(join(dir,'package.json'),{name:'cairn-pi',version:'1.0.0',type:'module',pi:{extensions:['./runtime/pi-extension.mjs'],skills:['./skills/cairn']}});continue;
 }
 await json(join(dir,host==='claude'?'.claude-plugin/plugin.json':'.codex-plugin/plugin.json'),{name:'cairn',version:'1.0.0',author:{name:'Cairn contributors'},description:'Goals, evidence and recovery for agent tasks',skills:'./skills/',mcpServers:'./.mcp.json',...(host==='codex'?{hooks:'./hooks/hooks.json'}:{})});
 await json(join(dir,'.mcp.json'),{mcpServers:{cairn:{command:'node',args:['${CLAUDE_PLUGIN_ROOT}/runtime/cairn.mjs','mcp','--host',host]}}});
 await mkdir(join(dir,'scripts'),{recursive:true});
 await writeFile(join(dir,'scripts/hook.mjs'),`process.argv.splice(2,0,"hook","--host",${JSON.stringify(host)});\nawait import("../runtime/cairn.mjs");\n`);
 const events=['SessionStart','PreToolUse','PostToolUse','PreCompact','Stop','SessionEnd'];
 if(host==='claude')events.push('PostToolUseFailure');else events.push('Interrupt','PostCompact');
 await json(join(dir,'hooks/hooks.json'),{hooks:Object.fromEntries(events.map(event=>[event,[{hooks:[{type:'command',command:'node "${CLAUDE_PLUGIN_ROOT}/scripts/hook.mjs"',timeout:['Interrupt','SessionEnd'].includes(event)?3:5}]}]]))});
}
await chmod(join(root,'bin/cairn.mjs'),0o755);
console.log('Built shared runtime and self-contained Pi, Claude Code and Codex plugin bundles.');
