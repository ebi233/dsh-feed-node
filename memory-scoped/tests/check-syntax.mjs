import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const lib=fileURLToPath(new URL('../lib/',import.meta.url));
for(const name of readdirSync(lib).filter(x=>/\.(js|mjs)$/.test(x)))execFileSync(process.execPath,['--check',join(lib,name)],{stdio:'inherit'});
console.log('PASS: all memory module sources parse');
