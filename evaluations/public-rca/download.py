"""Fetch the first four labelled faults' day, without a full 9.5 GB download."""
from remote_zip import archive,Remote
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).parent
z=archive()
prefix='training_data_with_faults/training_data_with_faults/tar/2022-03-20-cloudbed2/metric/'
selected=[f for f in z.infolist() if f.filename.startswith(prefix) and f.filename.endswith('.csv') and f.filename[len(prefix):].split('/')[0] in ('container','node','service')]
start=min(f.header_offset for f in selected);end=max(f.header_offset+len(f.filename.encode())+4096+f.compress_size for f in selected)
print('prefetch',len(selected),'files; compressed span',end-start,flush=True)
r=z.fp;r.seek(start);data=r.read(end-start)
original=Remote.read

def cached(self,n=-1):
 amount=self.size-self.pos if n<0 else n
 if self.base==r.base and start<=self.pos and self.pos+amount<=end:
  b=data[self.pos-start:self.pos-start+amount];self.pos+=len(b);return b
 return original(self,n)
Remote.read=cached
entries=[]
for f in selected:
 b=z.read(f);rel=f.filename[len(prefix):];out=ROOT/'sources'/'metrics'/rel;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(b)
 entries.append({'archivePath':f.filename,'localPath':'sources/metrics/'+rel,'bytes':len(b),'zipCRC32':f'{f.CRC:08x}','sha256':hashlib.sha256(b).hexdigest()})
 print('extracted',rel,len(b),flush=True)
(ROOT/'source-files.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
