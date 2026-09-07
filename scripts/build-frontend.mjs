import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const out = 'dist-frontend';
mkdirSync(out, { recursive: true });
const names = {};
for (const file of ['style.css','login.css','app.js','login.js','config.js','api-client.js']) {
 const text = file === 'config.js' ? 'window.NEXTECH_API_URL = "https://system-the-leads.onrender.com";\n' : readFileSync(`public/${file}`, 'utf8');
 const hash = createHash('sha256').update(text).digest('hex').slice(0,12);
 const name = file.replace(/\.(js|css)$/, `.${hash}.$1`);
 names[file] = name;
 writeFileSync(`${out}/${name}`, text);
}
for (const file of ['index.html','login.html']) {
 let html = readFileSync(`public/${file}`, 'utf8');
 for (const [original, versioned] of Object.entries(names)) html = html.replaceAll(`./${original}`, `./${versioned}`);
 writeFileSync(`${out}/${file}`, html);
}
writeFileSync(`${out}/.htaccess`, `<IfModule mod_headers.c>
<FilesMatch "^(index|login)\\.html$">
Header set Cache-Control "no-cache, no-store, must-revalidate"
</FilesMatch>
</IfModule>
`);
writeFileSync('data/frontend-release-files.json', JSON.stringify(['index.html','login.html','.htaccess',...Object.values(names)]));
console.log('Front versionado gerado com API do Render configurada.');
