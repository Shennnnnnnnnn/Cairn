import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync, readdirSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { userHome, workspace } from './paths.js';
import { CairnError, type Host } from './core/types.js';
import { VERSION } from './version.js';

export type Target=Exclude<Host,'mcp'>;
type Change={file:string;kind:'json'|'toml'|'array'|'file';keys?:string[];before?:unknown;value:unknown};
type Receipt={target:Target;version:string;installedAt:string;plugin:string;changes:Change[];ownedPaths?:string[];ownedContent?:Record<string,string>};
const shellQuote=(value:string)=>`'${value.replaceAll("'","'\\''")}'`;
const codexRegistration=/^\s*\[\s*mcp_servers\s*\.\s*(?:cairn|"cairn"|'cairn')\s*\]\s*(?:#.*)?$/m;
// Codex stdio MCP filters inherited variables. Forward names, never freeze host values.
const codexEnvironment=['CAIRN_DB','CAIRN_WORKSPACE','CAIRN_VERIFY_COMMAND','CAIRN_VERIFY_ARTIFACTS','CAIRN_VERIFY_TIMEOUT_MS','CAIRN_DEADLINE','CAIRN_SUBMIT_RESERVE_MS'];
function fingerprint(path:string):string|undefined{
 if(!existsSync(path))return;
 const hash=createHash('sha256');
 const visit=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(dir,entry.name);hash.update(JSON.stringify([file.slice(path.length),entry.isDirectory()?'dir':entry.isSymbolicLink()?'link':'file']));if(entry.isDirectory())visit(file);else hash.update(entry.isSymbolicLink()?readlinkSync(file):readFileSync(file));}};
 visit(path);return hash.digest('hex');
}
function expectedContent(receipt:Receipt,path:string){return receipt.ownedContent?.[path]??fingerprint(join(receipt.plugin,'skills/cairn'));}
const readJson=(file:string):any=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
function write(file:string,value:string){mkdirSync(dirname(file),{recursive:true});const temp=`${file}.cairn-${process.pid}`;writeFileSync(temp,value,{mode:0o600});renameSync(temp,file);}
function set(object:any,keys:string[],value:unknown){let o=object;for(const key of keys.slice(0,-1))o=o[key]??={};const last=keys.at(-1)!;if(value===undefined)delete o[last];else o[last]=value;}
function get(object:any,keys:string[]){return keys.reduce((o,k)=>o?.[k],object);}
export function location(target:Target,scope:'project'|'user',root?:string){
 const base=resolve(root??(scope==='user'?userHome():workspace()));
 const dir=join(base,'.cairn','installations',target);
 return {base,dir,plugin:join(dir,'plugin'),receipt:join(dir,'receipt.json'),scope,target};
}
export function install(target:Target,scope:'project'|'user'='project',root?:string,bundles=resolve(dirname(fileURLToPath(import.meta.url)),'plugins')){
 const loc=location(target,scope,root),source=join(bundles,target);
 if(!existsSync(source))throw new CairnError('missing_build','Build Cairn before installing: npm run build');
 const previous:Receipt|undefined=existsSync(loc.receipt)?readJson(loc.receipt):undefined;
 const changes:Change[]=[];
 const ownedPaths:string[]=[];
 const planJson=(file:string,keys:string[],value:unknown)=>{
  const data=readJson(file),old=get(data,keys),owned=previous?.changes.find(c=>c.file===file&&JSON.stringify(c.keys)===JSON.stringify(keys));
  if(old!==undefined&&!owned&&JSON.stringify(old)!==JSON.stringify(value))throw new CairnError('install_conflict',`Existing registration at ${file}: ${keys.join('.')}`);
  if(owned&&JSON.stringify(old)!==JSON.stringify(owned.value)&&JSON.stringify(old)!==JSON.stringify(value))throw new CairnError('install_conflict',`Cairn registration was edited at ${file}: ${keys.join('.')}; keep or resolve the edit before updating`);
  changes.push({file,kind:'json',keys,before:owned?owned.before:old,value});
 };
 if(target==='pi'){
  const file=join(loc.base,scope==='user'?'.pi/agent/settings.json':'.pi/settings.json'),settings=readJson(file);
  if(settings.packages!==undefined&&!Array.isArray(settings.packages))throw new CairnError('invalid_config','Pi packages must be an array');
  const old=previous?.changes.find(c=>c.kind==='array');
  changes.push({file,kind:'array',value:loc.plugin,before:old?.before??(settings.packages??[]).includes(loc.plugin)});
 }else if(target==='claude'){
  const file=join(loc.base,'.claude','settings.json');
  planJson(file,['extraKnownMarketplaces','cairn-local'],{source:{source:'directory',path:loc.dir}});
  planJson(file,['enabledPlugins','cairn@cairn-local'],true);
 }else if(target==='dsh'){
  const file=join(loc.dir,'cordis.patch.json'),value=JSON.stringify([{insert:[{id:'cairn',name:join(loc.plugin,'runtime/dsh-extension.mjs')}]},{id:'headless-runner',inject:['headlessStartup','cairnReady']}],null,2)+'\n';
  const old=existsSync(file)?readFileSync(file,'utf8'):undefined,owned=previous?.changes.find(c=>c.file===file&&c.kind==='file');
  if(old!==undefined&&old!==value&&(!owned||old!==owned.value))throw new CairnError('install_conflict',`The DSH overlay was edited at ${file}; preserve it before updating`);
  changes.push({file,kind:'file',before:owned?owned.before:old,value});
 }else{
  const file=join(loc.base,'.codex','config.toml'),current=existsSync(file)?readFileSync(file,'utf8'):'';
  const previousBlock=previous?.changes.find(c=>c.kind==='toml'&&c.file===file);
  if(previousBlock&&!current.includes(previousBlock.value as string))throw new CairnError('install_conflict','The managed Codex MCP registration was edited; keep or resolve the edit before updating');
  const unmanaged=previousBlock?current.replace(previousBlock.value as string,''):current;
  if(codexRegistration.test(unmanaged)||unmanaged.includes('# BEGIN CAIRN MANAGED'))throw new CairnError('install_conflict','Codex already has a cairn MCP registration outside this installer');
  // Project-scoped direct registration needs no user-level plugin-cache activation.
  // The same directory remains a valid native marketplace plugin for distribution.
  const block=`# BEGIN CAIRN MANAGED\n[mcp_servers.cairn]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${[join(loc.plugin,'runtime/cairn.mjs'),'mcp','--host','codex'].map(s=>JSON.stringify(s)).join(', ')}]\nenv_vars = ${JSON.stringify(codexEnvironment)}\n# END CAIRN MANAGED`;
  changes.push({file,kind:'toml',value:block});
  const hookFile=join(loc.base,'.codex/hooks.json'),hooks=readJson(hookFile);
  const template=readJson(join(source,'hooks/hooks.json'));
  for(const event of Object.keys(template.hooks)){
   const entries=get(hooks,['hooks',event]);if(entries!==undefined&&!Array.isArray(entries))throw new CairnError('invalid_config',`Codex hooks.${event} must be an array`);
   const owned=previous?.changes.find(c=>c.file===hookFile&&JSON.stringify(c.keys)===JSON.stringify(['hooks',event]));
   if(owned&&!(entries??[]).some((value:unknown)=>JSON.stringify(value)===JSON.stringify(owned.value)))throw new CairnError('install_conflict',`Cairn hooks.${event} was edited or removed; keep or resolve the edit before updating`);
   changes.push({file:hookFile,kind:'array',keys:['hooks',event],value:{hooks:[{type:'command',command:`${shellQuote(process.execPath)} ${shellQuote(join(loc.plugin,'scripts/hook.mjs'))}`,timeout:['Interrupt','SessionEnd'].includes(event)?3:5}]}});
  }
  const skill=join(loc.base,'.agents/skills/cairn');
  if(existsSync(skill)&&!previous?.ownedPaths?.includes(skill))throw new CairnError('install_conflict','An existing cairn skill is not owned by this installer');
  if(existsSync(skill)&&previous&&fingerprint(skill)!==expectedContent(previous,skill))throw new CairnError('install_conflict',`The installed Cairn skill was edited at ${skill}; keep or resolve the edit before updating`);
  ownedPaths.push(skill);
 }
 // Preflight completes before any configuration or plugin files are modified.
 mkdirSync(loc.dir,{recursive:true});
 const staging=join(loc.dir,`plugin-${process.pid}`);rmSync(staging,{recursive:true,force:true});cpSync(source,staging,{recursive:true});
 if(target==='claude'||target==='codex'){
  const mcpFile=join(staging,'.mcp.json'),mcp=readJson(mcpFile);mcp.mcpServers.cairn.command=process.execPath;write(mcpFile,JSON.stringify(mcp,null,2)+'\n');
  const hookFile=join(staging,'hooks/hooks.json'),hookConfig=readJson(hookFile);
  for(const entries of Object.values(hookConfig.hooks) as any[])for(const entry of entries)for(const hook of entry.hooks??[])if(hook.type==='command')hook.command=`${shellQuote(process.execPath)} ${shellQuote(join(loc.plugin,'scripts/hook.mjs'))}`;
  write(hookFile,JSON.stringify(hookConfig,null,2)+'\n');
 }
 rmSync(loc.plugin,{recursive:true,force:true});renameSync(staging,loc.plugin);
 for(const path of ownedPaths){rmSync(path,{recursive:true,force:true});cpSync(join(loc.plugin,'skills/cairn'),path,{recursive:true});}
 if(target==='codex')write(join(loc.dir,'.agents/plugins/marketplace.json'),JSON.stringify({name:'cairn-local',plugins:[{name:'cairn',source:{source:'local',path:'./plugin'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]},null,2));
 if(target==='claude')write(join(loc.dir,'.claude-plugin/marketplace.json'),JSON.stringify({name:'cairn-local',owner:{name:'Cairn'},plugins:[{name:'cairn',source:'./plugin'}]},null,2));
 for(const c of changes){
  if(c.kind==='file')write(c.file,c.value as string);
  else if(c.kind==='toml'){
   const original=existsSync(c.file)?readFileSync(c.file,'utf8'):'';
   const prior=previous?.changes.find(p=>p.kind==='toml'&&p.file===c.file);
   write(c.file,`${(prior?original.replace(prior.value as string,''):original).trimEnd()}\n\n${c.value}\n`);
  }else{
   const data=readJson(c.file);
   if(c.kind==='array'){
    const keys=c.keys??['packages'],old=previous?.changes.find(p=>p.file===c.file&&JSON.stringify(p.keys??['packages'])===JSON.stringify(keys));
    set(data,keys,[...(get(data,keys)??[]).filter((p:unknown)=>JSON.stringify(p)!==JSON.stringify(c.value)&&(!old||JSON.stringify(p)!==JSON.stringify(old.value))),c.value]);
   }else set(data,c.keys!,c.value);
   write(c.file,JSON.stringify(data,null,2)+'\n');
  }
 }
 const receipt:Receipt={target,version:VERSION,installedAt:new Date().toISOString(),plugin:loc.plugin,changes,ownedPaths,ownedContent:Object.fromEntries(ownedPaths.map(path=>[path,fingerprint(path)!]))};
 write(loc.receipt,JSON.stringify(receipt,null,2));
 return {target,scope,plugin:loc.plugin,...(target==='dsh'?{patch:join(loc.dir,'cordis.patch.json')}:{}),next:target==='dsh'?`Load the owned overlay with dsh --profile headless --patch ${shellQuote(join(loc.dir,'cordis.patch.json'))}. Existing DSH profiles and model settings are preserved.`:target==='codex'?'Restart a trusted project session, then review and trust Cairn hooks with /hooks.':'Start a new CLI session and load Cairn. Existing model and approval settings are preserved.'};
}
export function uninstall(target:Target,scope:'project'|'user'='project',root?:string){
 const loc=location(target,scope,root);if(!existsSync(loc.receipt))return {removed:false};
 const receipt:Receipt=readJson(loc.receipt),retained:string[]=[];
 for(const c of receipt.changes){
  if(!existsSync(c.file))continue;
  if(c.kind==='file'){
   if(readFileSync(c.file,'utf8')!==c.value){retained.push(c.file);continue;}
   if(typeof c.before==='string')write(c.file,c.before);else rmSync(c.file);
  }else if(c.kind==='toml'){
   const data=readFileSync(c.file,'utf8');if(data.includes(c.value as string))write(c.file,data.replace(c.value as string,''));else retained.push(c.file);
  }else{
   const data=readJson(c.file);
   if(c.kind==='array'){
    const keys=c.keys??['packages'],entries=get(data,keys)??[];
    if(!Array.isArray(entries)){retained.push(c.file);continue;}
    if(!entries.some((p:unknown)=>JSON.stringify(p)===JSON.stringify(c.value))&&entries.some((p:unknown)=>JSON.stringify(p).includes(receipt.plugin))){retained.push(c.file);continue;}
    if(!c.before)set(data,keys,entries.filter((p:unknown)=>JSON.stringify(p)!==JSON.stringify(c.value)));
   }
   else if(JSON.stringify(get(data,c.keys!))===JSON.stringify(c.value))set(data,c.keys!,c.before);else{retained.push(c.file);continue;}
   write(c.file,JSON.stringify(data,null,2)+'\n');
  }
 }
 for(const path of receipt.ownedPaths??[])if(existsSync(path)&&fingerprint(path)!==expectedContent(receipt,path))retained.push(path);
 // Keep a modified registration and its executable target usable until explicitly resolved.
 if(!retained.length){rmSync(loc.dir,{recursive:true,force:true});for(const path of receipt.ownedPaths??[])rmSync(path,{recursive:true,force:true});}
 return {removed:!retained.length,retained,taskData:'preserved'};
}
export function installationStatus(target:Target,scope:'project'|'user'='project',root?:string){
 const loc=location(target,scope,root),receipt:Receipt|undefined=existsSync(loc.receipt)?readJson(loc.receipt):undefined;
 const executable=target==='claude'?'claude':target;
 const run=spawnSync(executable,['--version'],{encoding:'utf8',timeout:5000});
 return {target,scope,executable:run.error?undefined:executable,version:run.status===0?run.stdout.trim():undefined,installed:!!receipt,plugin:receipt?.plugin,runtimeExists:receipt?existsSync(join(receipt.plugin,'runtime','cairn.mjs')):false,installedAt:receipt?.installedAt};
}
