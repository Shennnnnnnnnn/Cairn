import assert from 'node:assert/strict';
import {quote,clear} from './quote.mjs';
clear();const first=quote('A','north');let mutationRejected=false;
try{Object.assign(first,{amount:-999,market:'south'});}catch(error){if(error instanceof TypeError)mutationRejected=true;else throw error;}
const second=quote('A','north');
console.log(JSON.stringify({case:'caller mutation must not poison subsequent quote',mutationRejected,actual:second,expected:{sku:'A',market:'north',amount:100}}));
assert.equal(second.market,'north');assert.equal(second.amount,100);
console.log('caller mutation regression passed');
