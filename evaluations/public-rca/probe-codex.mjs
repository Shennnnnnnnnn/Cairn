// Synthetic integration probe nested under the real Git repository. No domain inputs/labels.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runCodex,save,assertCairnProtocol} from './codex-driver.mjs';
const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../..');
const root=mkdtempSync(join(here,'runs/probe-codex-git-')),work=join(root,'workspace');mkdirSync(work);
const implementation=resolve(process.argv[2]??join(here,'runs/2026-10-17-codex-sol-xhigh-round7b/implementation-after'));
const git=spawnSync('git',['-C',work,'rev-parse','--show-toplevel'],{encoding:'utf8'});
if(git.status!==0||resolve(git.stdout.trim())!==repo)throw new Error('Probe must be nested under the real repository Git ancestor');
const marker='alpha\n',artifacts=['marker.txt'];writeFileSync(join(work,'marker.txt'),marker);
cpSync(join(here,'probe-verifier.mjs'),join(root,'verifier.frozen.mjs'));
const verifyCommand=[process.execPath,join(root,'verifier.frozen.mjs')];
save(join(root,'probe.manifest.json'),{kind:'Synthetic native Codex/MCP/hook/host-verifier probe; no RCA data or labels',createdAt:new Date().toISOString(),root,work,implementation,gitAncestor:repo,artifacts,verifyCommand,verifierSha256:createHash('sha256').update(readFileSync(join(root,'verifier.frozen.mjs'))).digest('hex'),evaluationBudgets:null});
console.log(JSON.stringify({event:'probe_start',root,implementation}));
const metrics=await runCodex({work,dir:root,implementation,verifyCommand,artifacts,
 common:'这是无领域数据或答案的合成接入探针。只调用 Cairn 五个工具，不联网、不调用其他模型或子代理、不读取其他材料。SessionStart hook 提供的原生 session_id 是真实身份，首次调用采用该值，不猜身份。',
 prompt:'宿主已在本次 cwd 预置 marker.txt，完整内容为 alpha 后跟换行。保持文件不变。调用 cairn_start，目标为保存 marker，单一条件为 marker 文件保留 alpha；cairn_checkpoint 保存一条 key=marker 的 supported finding，text 说明 marker.txt 保存 alpha，basis 为宿主提供的 marker 值，references:["marker.txt"]，covers:["c1"]；最后 cairn_finish {}，让宿主对实际文件运行独立验收。不调用其他工具，不读取文件，不自行写入验证结论。'});
let protocol,error;
try{
 const launch=JSON.parse(readFileSync(join(root,'launch.json'),'utf8'));
 protocol=assertCairnProtocol({work,metrics,verifyCommand,artifacts,launch,tools:JSON.parse(readFileSync(join(root,'initial.tools.json'),'utf8'))});
 if(!protocol.singleTaskGoal)throw new Error('Synthetic probe must have exactly one successful cairn_start receipt');
 const task=protocol.tasks[0],snapshot=task.artifacts?.find(a=>a.path===join(work,'marker.txt'));
 if(task.status!=='completed'||!task.claims.length||task.verification?.status!=='passed'||task.verification.epoch!==task.owner.epoch)throw new Error('Synthetic task did not complete with a current passing host verifier');
 if(snapshot?.sha256!==createHash('sha256').update(marker).digest('hex')||readFileSync(join(work,'marker.txt'),'utf8')!==marker)throw new Error('Required marker artifact is missing or changed');
 if(metrics.actualModels.length!==1||metrics.actualModels[0]!=='gpt-6.1-sol'||metrics.actualEfforts.length!==1||metrics.actualEfforts[0]!=='xhigh')throw new Error('Native model/effort metadata differs');
 if(metrics.exitCode!==0||metrics.turnFailed)throw new Error('Native Codex probe did not end normally');
 save(join(root,'initial.cairn-tasks.json'),protocol.tasks);
}catch(failure){error=failure.message;}
const result={kind:'Synthetic native Codex/MCP/hook/host-verifier probe, no RCA input or labels',root,implementation,metrics,protocol:protocol?{...protocol,tasks:undefined}:undefined,success:!error,...(error?{error}:{})};
save(join(root,'probe.metrics.json'),result);
const formal=join(here,'runs/2026-10-17-codex-sol-xhigh-round7b');
if(result.success&&implementation===join(formal,'implementation-after')){
 const path=join(formal,'manifest.json'),manifest=JSON.parse(readFileSync(path,'utf8'));
 if(manifest.arms.some(arm=>existsSync(join(formal,arm))))throw new Error('Do not change a formal manifest after any actor starts');
 if(manifest.correctedProbeSha256)throw new Error('A successful formal probe is already sealed; do not replace it');
 cpSync(join(root,'probe.metrics.json'),join(formal,'corrected-probe.json'));
 manifest.correctedProbeSha256=createHash('sha256').update(readFileSync(join(formal,'corrected-probe.json'))).digest('hex');manifest.correctedProbeRun=root;
 save(path,manifest);
}
console.log(JSON.stringify(result));if(!result.success)process.exitCode=1;
