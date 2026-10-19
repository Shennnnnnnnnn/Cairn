import {verifyMulticaDelivery} from './multica-platform.js';

let input='';
for await(const chunk of process.stdin)input+=chunk;
const task=JSON.parse(input),cwd=task.owner?.cwd;
const changed=process.env.CAIRN_MULTICA_SESSION_ID&&task.owner?.sessionId!==process.env.CAIRN_MULTICA_SESSION_ID;
const result=changed?{status:'failed',summary:'The verifier belongs to another native task session'}:typeof cwd==='string'?verifyMulticaDelivery(cwd):{status:'failed',summary:'Task owner working directory is missing'};
process.stdout.write(JSON.stringify({ok:result.status==='passed',issues:result.status==='passed'?[]:[{message:result.summary}],method:'contract',scope:'Current Issue report delivery and artifact hashes; diagnosis correctness is not independently assessed'}));
