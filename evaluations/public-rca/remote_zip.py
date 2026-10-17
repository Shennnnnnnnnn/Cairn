"""Read selected entries from a public stored nested ZIP using HTTP Range.
Never executes downloaded code. Checks archive CRC via Python zipfile.
"""
import io,json,subprocess,zipfile,hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
URL='https://zenodo.org/api/records/19176851/files/aiops2022.zip/content'
SIZE=9506493153
class Remote(io.RawIOBase):
 def __init__(self,url=URL,size=SIZE,base=0):self.url=url;self.size=size;self.base=base;self.pos=0
 def seekable(self):return True
 def readable(self):return True
 def tell(self):return self.pos
 def seek(self,off,whence=0):
  self.pos=off if whence==0 else self.pos+off if whence==1 else self.size+off
  return self.pos
 def read(self,n=-1):
  if n<0:n=self.size-self.pos
  n=min(n,self.size-self.pos)
  if n<=0:return b''
  chunk_start=(self.pos//65536)*65536
  chunk_end=min(self.size,max(self.pos+n,chunk_start+65536))
  start=self.base+chunk_start;end=self.base+chunk_end-1
  cache=Path(__file__).with_name('sources')/'ranges';cache.mkdir(exist_ok=True,parents=True)
  def fetch(pair):
   a,b=pair;target=cache/hashlib.sha256(f'{self.url}:{a}-{b}'.encode()).hexdigest()
   if target.exists():return target.read_bytes()
   for attempt in range(3):
    temporary=target.with_suffix('.part')
    result=subprocess.run(['curl','-L','--fail','--max-time','60','-sS','-r',f'{a}-{b}',self.url,'-o',str(temporary)])
    if result.returncode==0 and temporary.stat().st_size==b-a+1:
     temporary.replace(target);return target.read_bytes()
   raise RuntimeError(f'Range download failed: {a}-{b}')
  if end-start>2*1024*1024:
   pairs=[(i,min(end,i+1024*1024-1)) for i in range(start,end+1,1024*1024)]
   with ThreadPoolExecutor(max_workers=4) as pool:data=b''.join(pool.map(fetch,pairs))
  else:data=fetch((start,end))
  b=data[self.pos-chunk_start:self.pos-chunk_start+n]
  self.pos+=len(b);return b

def archive():
 outer=zipfile.ZipFile(Remote())
 entry=outer.getinfo('training_data_with_faults.zip')
 assert entry.compress_type==0
 remote=Remote();remote.seek(entry.header_offset);header=remote.read(30)
 import struct
 n,e=struct.unpack_from('<HH',header,26)
 base=entry.header_offset+30+n+e
 return zipfile.ZipFile(Remote(size=entry.file_size,base=base))
if __name__=='__main__':
 import sys
 z=archive()
 if len(sys.argv)==1:
  rows=[{'name':f.filename,'size':f.file_size,'compressed':f.compress_size,'crc':f.CRC} for f in z.infolist()]
  Path(__file__).with_name('sources').mkdir(exist_ok=True)
  Path(__file__).with_name('sources').joinpath('archive-index.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
  print('entries',len(rows));print('\n'.join(f"{r['name']} {r['compressed']}" for r in rows[:30]))
 else:
  name=sys.argv[1];out=Path(sys.argv[2]);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(z.read(name));print(name,out.stat().st_size)
