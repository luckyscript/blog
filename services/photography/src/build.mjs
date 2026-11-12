import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderSite} from './render.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const data=JSON.parse(await fs.readFile(path.join(root,'src/content.json'),'utf8'));
const {pages,photos,albums}=renderSite(data);
await fs.writeFile(path.join(dist,'photos.js'),`window.PORTFOLIO_PHOTOS = ${JSON.stringify(photos,null,2)};\nwindow.PORTFOLIO_ALBUMS = ${JSON.stringify(albums,null,2)};\n`);
for(const p of pages){const dir=path.join(dist,p.route);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'index.html'),p.html);}
await fs.writeFile(path.join(root,'src/routes.json'),JSON.stringify(pages.map(({page,route,title})=>({page,route,title})),null,2)+'\n');
console.log(`Built ${pages.length} pages · ${photos.length} photos · ${albums.length} collections`);
