"""Fetch three previously unused public cases; never place label-bearing names in actor workspaces."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json, subprocess, hashlib

HERE = Path(__file__).resolve().parent
REVISION = json.loads((HERE/'research/hf-dataset.json').read_text())['sha']
CASES = {
    'mb-01': 're2tt_ts-order-service_loss_1',
    'mb-02': 're3tt_ts-route-service_f3_1',
    'mb-03': 're3ob_adservice_f5_1',
}

def fetch(item):
    alias, case, name = item
    target = HERE/'sources'/case/name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        url = f'https://huggingface.co/datasets/phamquiluan/RCAEval/resolve/{REVISION}/{case}/{name}'
        temp = target.with_suffix(target.suffix+'.part')
        subprocess.run(['/usr/bin/curl','--location','--fail','--silent','--show-error','--retry','2','--connect-timeout','20','--max-time','600','--proxy','http://127.0.0.1:7897',url,'-o',str(temp)],check=True)
        temp.replace(target)
    return {'alias':alias,'case':case,'file':name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}

if __name__=='__main__':
    wanted=[(alias,case,name) for alias,case in CASES.items() for name in ['metrics.parquet','logs.parquet','traces.parquet','inject_time.txt']]
    result=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for item in pool.map(fetch,wanted):
            result.append(item)
            print(json.dumps({k:v for k,v in item.items() if k!='sha256'}),flush=True)
    (HERE/'research/download-receipt.json').write_text(json.dumps({'repository':'phamquiluan/RCAEval','revision':REVISION,'files':result},indent=2))
