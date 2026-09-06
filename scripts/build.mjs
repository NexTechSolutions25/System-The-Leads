import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
for (const dir of ['public', 'sql']) cpSync(dir, `dist/${dir}`, { recursive: true });
for (const name of ['br-municipios.json', 'py-distritos.json']) cpSync(`src/${name}`, `dist/src/${name}`);
cpSync('.env.example', 'dist/.env.example');
const pkg = JSON.parse(readFileSync('package.json', 'utf8').replace(/^\uFEFF/, ''));
pkg.scripts = { start: 'node src/server.js', worker: 'node src/worker.js', 'db:check': 'node scripts/check-db.js', 'db:migrate': 'node scripts/migrate-sqlite.js' };
pkg.engines = { node: '24.x' };
writeFileSync('dist/package.json', JSON.stringify(pkg, null, 2) + '\n');
cpSync('package-lock.json', 'dist/package-lock.json');
writeFileSync('dist/LEIA-ME.txt', `PACOTE NODE.JS - NEXTECH LEADS

Extraia este pacote na raiz de uma aplicacao Node.js 24, nao como site estatico em public_html.
Instale dependencias: npm ci --omit=dev
Inicie o painel: npm start
Execute a captacao em processo separado: npm run worker
Configure MySQL e Redis remotos nas variaveis da hospedagem; .env.example e apenas um modelo sem senhas.
Para analise mobile no Linux, instale Chromium e dependencias do Playwright.

PENDENCIAS ANTES DO ACESSO PUBLICO:
O projeto ainda exige adaptar a validacao de dominio e o proxy HTTPS para a hospedagem escolhida.
HOST deve permitir escuta externa; mudar somente HOST nao resolve a validacao de dominio atual.
Importe o banco/usuario ou providencie o administrador: primeiro cadastro pela internet e bloqueado.
Este pacote compila o sistema, mas nao configura automaticamente a hospedagem.
Nenhuma senha, conta cadastrada ou banco local foi incluido.
`);
console.log('dist gerada com servidor compilado, painel, SQL e catalogos.');
