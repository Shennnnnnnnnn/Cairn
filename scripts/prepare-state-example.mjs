#!/usr/bin/env node
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const args=process.argv.slice(2);
if(args.length && (args.length!==2||args[0]!=='--root'))throw new Error('Usage: node scripts/prepare-state-example.mjs [--root NEW_DIR]');
const root=args.length?resolve(args[1]):mkdtempSync(join(tmpdir(),'cairn-live-state-'));
if(args.length&&existsSync(root))throw new Error('Choose a new directory; existing data is never replaced');
mkdirSync(join(root,'fixtures'),{recursive:true});
const save=(name,value)=>writeFileSync(join(root,name),value);
const prices=['A','B','C','D'].flatMap((sku,index)=>[
  {sku,market:'north',amount:100+index*25},
  {sku,market:'south',amount:80+index*30},
]);
const requests=['A','B','C','D'].flatMap(sku=>[{sku,market:'north'},{sku,market:'south'}]);
save('fixtures/catalog.json',JSON.stringify({source:'Synthetic local exercise; not production data',currency:'CNY',prices},null,2)+'\n');
save('fixtures/requests.json',JSON.stringify({source:'Synthetic local exercise; not production traffic',requests},null,2)+'\n');
save('quote.mjs',`const cache=new Map();
export function clearCache(){cache.clear();}
export function quote(sku,market,prices){
  const key=sku;
  if(cache.has(key))return cache.get(key);
  const item=prices.find(price=>price.sku===sku&&price.market===market);
  if(!item)throw new Error('Unknown SKU or market');
  const result={sku,market,amount:item.amount};
  cache.set(key,result);return result;
}
`);
save('reproduce.mjs',`import {readFileSync} from 'node:fs';
import {quote,clearCache} from './quote.mjs';
const {prices}=JSON.parse(readFileSync(new URL('./fixtures/catalog.json',import.meta.url)));
const {requests}=JSON.parse(readFileSync(new URL('./fixtures/requests.json',import.meta.url)));
clearCache();
const results=requests.map(request=>{
 const actual=quote(request.sku,request.market,prices),expected=prices.find(row=>row.sku===request.sku&&row.market===request.market);
 return {request,actual,expected:expected.amount,ok:actual.amount===expected.amount&&actual.market===request.market};
});
const failed=results.filter(row=>!row.ok).length;
console.log(JSON.stringify({source:'synthetic local reproduction',failed,total:results.length,results},null,2));
process.exitCode=failed?1:0;
`);
save('README.md','# 合成地区报价串价排查\n\n这是离线演练，不连接生产系统。运行 `node reproduce.mjs` 复现地区报价不一致；fixtures 提供价格表与请求顺序。请定位原因，修复 quote.mjs，并验证不同地区、请求顺序和缓存复用。\n');
console.log(JSON.stringify({root,problem:'Synthetic regional quote cache defect',reproduce:'node reproduce.mjs',database:join(root,'.cairn/state.db')}));
