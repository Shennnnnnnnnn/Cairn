const prices = {north:100,south:80};
const cache=new Map();
export function quote(sku,market){
  if(!Object.hasOwn(prices,market))throw new Error('unknown market');
  if(!cache.has(sku))cache.set(sku,{sku,market,amount:prices[market]});
  return cache.get(sku);
}
export function clear(){cache.clear();}
