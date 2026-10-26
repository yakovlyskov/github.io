import {build} from 'esbuild';
import {writeFile,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
const result=await build({entryPoints:['src/main.tsx'],bundle:true,minify:true,format:'esm',target:'es2022',outdir:'dist',entryNames:'app-[hash]',assetNames:'[name]-[hash]',metafile:true,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const js=Object.keys(result.metafile.outputs).find(s=>s.endsWith('.js')),css=Object.keys(result.metafile.outputs).find(s=>s.endsWith('.css'));
await writeFile('dist/index.html',`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#17352e"><meta name="description" content="Командная игра об A/B-тестах. Ведущий управляет раундами, участники принимают решения, команда обсуждает результаты."><meta name="referrer" content="strict-origin-when-cross-origin"><title>Growth Mission — командная игра</title><link rel="stylesheet" href="./${css.split('/').pop()}"><script type="module" src="./${js.split('/').pop()}"></script></head><body><div id="root"></div><noscript>Для совместной игры включите JavaScript в браузере.</noscript></body></html>`);
console.log('Built GitHub Pages game:',js,css);
