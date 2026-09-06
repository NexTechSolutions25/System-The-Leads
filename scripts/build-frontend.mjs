import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist-frontend', { recursive: true });
for (const file of ['index.html','login.html','style.css','login.css','app.js','login.js','config.js','api-client.js']) cpSync(`public/${file}`, `dist-frontend/${file}`);
console.log('Front gerado em dist-frontend: somente HTML, CSS e JavaScript.');
