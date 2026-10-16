import {quote,clear} from './quote.mjs';
let failures=0;const actual=[];
for(const order of [['north','south'],['south','north']]){clear();for(const market of order){const result=quote('A',market);const expected=market==='north'?100:80;actual.push({market,expected,result});if(result.amount!==expected||result.market!==market)failures++;}}
console.log(JSON.stringify({checks:4,failures,actual},null,2));process.exitCode=failures?1:0;
