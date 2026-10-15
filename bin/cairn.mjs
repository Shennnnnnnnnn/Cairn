#!/usr/bin/env node
if(Number(process.versions.node.split('.')[0])<24){
 process.stderr.write('Cairn requires Node.js 24 or newer.\n');process.exitCode=1;
}else await import('../dist/cairn.mjs');
