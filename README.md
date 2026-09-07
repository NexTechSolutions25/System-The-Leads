# NexTech Leads — Brasil e Paraguai

Aplicação local de captação, qualificação e aprovação comercial. Inclui API Express/TypeScript, MySQL persistente (SQLite opcional), BullMQ/Redis, interface web e Google Places API (New). Nenhum endpoint envia mensagens.

## Login e MySQL — primeiro acesso

O banco padrão agora é MySQL. A integração foi testada com MySQL 8.4 em uma instância isolada; a conexão com seu servidor depende da configuração preenchida no `.env`.

1. Abra o arquivo `.env` já criado na raiz do projeto.
2. Preencha `MYSQL_PASSWORD="sua senha do MySQL"`. Os demais campos apontam para `127.0.0.1:3306`, banco `nextech_leads`, usuário `root`.
3. Execute `npm run db:check` para confirmar a conexão. AppUser, AppSession, AppMeta e AppMutex são criadas automaticamente. O SQL alternativo é `sql/mysql-auth.sql`.
4. Inicie API e worker e abra http://127.0.0.1:3000/login.
5. No primeiro acesso, escolha seu usuário e sua senha do painel (mínimo 8 caracteres). O primeiro cadastro só é permitido pelo computador do servidor, enquanto não existir usuário.

Não há senha padrão. A senha do painel é diferente da senha do MySQL. O painel usa hash scrypt com sal aleatório, cookies HttpOnly/SameSite=Strict, sessões de 12 horas e limitação de tentativas. O token de sessão é armazenado como hash. A API exige sessão; o antigo APP_TOKEN foi removido. Cookies recebem Secure quando a requisição chega por HTTPS. O deployment local usa HTTP em loopback.

**Sair** encerra a sessão. Em **Configuração**, você pode trocar a senha; isso encerra todas as sessões. Usuários, sessões, campanhas e leads ficam no mesmo MySQL. Se MySQL estiver indisponível, a tela informa o problema: não há fallback silencioso para SQLite.

## Executar

Requisitos: Node.js 24, MySQL 8.4 e Redis 7 ou superior. Para análise visual, Edge no Windows ou Chromium do Playwright.

```powershell
npm install
# Se .env ainda não existir, copie .env.example. Preserve um .env já preenchido.
# Se Docker estiver instalado e precisar iniciar Redis:
docker compose up -d redis
npm start
```

Em outro terminal:

```powershell
npm run worker
```

Para desenvolvimento, `npm run dev` e `npm run worker:dev` reiniciam os processos quando arquivos ou `.env` mudam. No modo normal, reinicie ambos após alterar a configuração do MySQL.

API e worker devem usar as mesmas configurações MYSQL_* e REDIS_URL. As filas são separadas por banco para não misturar SQLite, MySQL e testes. Mantenha API, worker e Redis ativos para campanhas programadas. O agendador não depende de uma automação do Codex.

O Redis portátil em `data/redis` é auxiliar de desenvolvimento e escuta somente em `127.0.0.1:6379`; nenhum serviço Windows foi instalado. Processos precisam ser iniciados novamente após reiniciar o computador.

## Importar o SQLite anterior (opcional)

O arquivo `data/leads.sqlite` original foi preservado. Para manter os registros antigos, configure a senha do MySQL e, antes de criar novas campanhas nele, pare o worker e execute:

```powershell
npm run db:migrate
```

O comando copia os dados em uma transação, preservando o arquivo de origem. Exige destino sem campanhas/leads, impede reimportação acidental e copia os bloqueios de contato. Não importa usuários/sessões. Agendas importadas ficam pausadas para revisão; execuções em andamento são marcadas como canceladas. Depois, inicie o worker e reative as agendas desejadas.

Para testes com SQLite, configure explicitamente `DB_DRIVER=sqlite` e `DATABASE_PATH`. MySQL indisponível não ativa esse modo automaticamente.

## Modos e integração real

Sem `GOOGLE_PLACES_API_KEY`, o provedor `demonstration` cria exclusivamente registros sintéticos, marcados em cada lead e no banner. Esses registros não têm números de contato nem links de WhatsApp operacionais. Seu fluxo passa pela mesma fila, persistência, qualificação e aprovação.

Com chave configurada, o sistema seleciona Google Places. Uma chave inválida gera falha explícita; nunca existe fallback silencioso para empresas fictícias. A integração faz Text Search (New) com máscaras de campos, paginação e Place Details. A chave só é enviada pelo servidor no cabeçalho da API do Google.

**Uma chave do Google Places não autoriza, por si só, construir uma base permanente de leads com o conteúdo da API.** As políticas padrão limitam armazenamento/caching; `place_id` tem uma exceção específica. Como este módulo persiste contatos, evidências e qualificações em CRM, a execução Google fica bloqueada por padrão até existir autorização contratual expressa para esse uso. A variável abaixo é uma declaração de uma autorização que você já possui, não uma forma de obter ou contornar a licença:

```env
LEAD_PROVIDER=google_places
GOOGLE_PLACES_API_KEY=sua_chave
GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED=true
```

Antes de ativar, confirme o escopo e a retenção permitidos no seu contrato. Se o contrato exigir expiração/remoção automática ou não permitir esse uso, não habilite esta integração para CRM: implemente um provedor licenciado com sua política de retenção. O módulo não afirma conformidade jurídica automática. Há, portanto, uma diferença deliberada em relação ao pedido “apenas fornecer a chave”: respeitar as permissões da fonte também é requisito do pedido.

Documentação oficial consultada:

- [Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Políticas e atribuição do Google Places](https://developers.google.com/maps/documentation/places/web-service/policies)
- [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers)

`LeadProvider` está definido em `src/types.ts`; implementações ficam em `src/providers.ts`. Para adicionar uma fonte autorizada, implemente `searchCompanies` e `getCompanyDetails`, normalize o resultado e registre a seleção em `provider()`. O callback `Meter` centraliza reservas de consumo e retentativas. Campos não disponíveis permanecem ausentes. CNPJ/RUC são opcionais no contrato de dados; Google Places não os fornece neste adaptador.

`OPENAI_API_KEY` está reservado, mas não é utilizado nesta versão. As mensagens são modelos determinísticos em português/espanhol e a pontuação é explicável; nenhum dado comercial é enviado a um modelo de linguagem.

## Campanhas

1. Escolha país, região e uma cidade, lista de cidades, região inteira ou busca nacional.
2. Informe segmento, palavras-chave, serviço, idioma, limite de empresas, pontuação mínima, consultas e orçamento.
3. Crie a campanha e clique em **Iniciar captação**.
4. Acompanhe o monitor e revise as empresas na **Fila de aprovação**.
5. Edite a mensagem, aprove e transfira para o pipeline.
6. Se houver WhatsApp publicamente identificado, revise a mensagem e abra a conversa. O envio ocorre exclusivamente no WhatsApp, por ação humana.
7. Para agendar, escolha periodicidade/horário/dias ao criar e clique em **Ativar agenda** no cartão. **Pausar agenda** remove execuções futuras; cancele separadamente uma execução que já começou.

Datas são armazenadas em UTC. Agendas usam `America/Sao_Paulo` ou `America/Asuncion` e são mantidas no Redis por BullMQ. Há pausa/retomada/cancelamento cooperativos entre etapas: uma requisição já em andamento pode terminar. Retentativas usam backoff; o cursor e os identificadores processados permitem retomar sem criar novos registros duplicados. Há bloqueio Redis por execução para evitar processamento simultâneo do mesmo run.

A busca é expandida em lotes **cidade × palavra-chave × segmento**. Não se usa consulta genérica para o país. O limite de leads considera candidatos processados; empresas fora da cidade/país são rejeitadas, portanto o total salvo pode ser menor. O catálogo não garante que o provedor encontrará todas as empresas de um território.

## Geografia

Os arquivos internos versionáveis contêm:

- 27 UFs e 5.571 municípios obtidos da [API de localidades do IBGE](https://servicodados.ibge.gov.br/api/v1/localidades/municipios).
- 17 departamentos, Assunção e 263 distritos do [catálogo público do INE / CNPV 2022](https://www.datos.gov.py/dataset/base-de-datos-geojson-geoespacial-de-departamentos-distritos-ciudades-y-barrios-de-todo-el), licença de informação pública do Governo Paraguaio.

Extração em 05/09/2026. O catálogo paraguaio usa distritos/municípios como unidades de pesquisa. Alterações territoriais posteriores ao Censo 2022 podem não estar presentes; “todas” se refere ao catálogo disponibilizado. Os nomes originais são preservados; comparação ignora acentos sem remover caracteres da exibição e das consultas.

## Análise de sites

Configure os domínios cujos termos você verificou que autorizam o acesso automatizado:

```env
WEBSITE_ALLOWED_HOSTS=empresa.com.br,www.empresa.com.br,empresa.com.py
# Opcional: navegador alternativo
BROWSER_EXECUTABLE_PATH=
```

Sem essa permissão, o resultado é `permissao_pendente`, sem penalidade por falha técnica inventada. O analisador:

- Verifica `robots.txt`, bloqueios HTTP, timeout, espaçamento entre acessos e limites de conteúdo.
- Recusa IPs privados/reservados e IPv6; fixa o endereço DNS validado na conexão para reduzir risco de SSRF/rebinding.
- Não segue redirecionamentos automaticamente. Não acessa login, CAPTCHA ou plataformas sociais.
- Examina HTTPS, resposta aproximada, título, descrição, viewport, CTA, formulário, links de catálogo/serviços, idioma e tecnologias visíveis no HTML.
- Identifica WhatsApp apenas em link público `wa.me`/`api.whatsapp.com`, e-mails de função comercial em `mailto:` e link de perfil Instagram publicado no próprio site.
- Testa uma amostra de até três links internos; não afirma que auditou todos os links do site.
- Renderiza HTML em viewport 390×844 sem executar scripts nem permitir tráfego externo. Carrega no máximo três folhas de estilo da mesma origem, se permitidas. Com CSS incompleto, o resultado móvel é inconclusivo. Isso verifica layout básico, não certifica interações JavaScript ou todo o funcionamento móvel.

No Linux, instale o navegador para essa etapa:

```sh
npx playwright install chromium
```

As observações incluem URLs, horários e limites do teste. Site não informado significa **não informado pelo provedor**, nunca prova de inexistência. A mensagem não afirma ter encontrado um problema não verificado.

## Consumo e limites

`GOOGLE_SEARCH_REQUEST_USD` e `GOOGLE_DETAILS_REQUEST_USD` são estimativas configuráveis em USD por consulta. Os valores de exemplo não são cotação de preços vigentes. Ajuste ao SKU efetivamente faturado, impostos e contrato.

Cada tentativa reserva custo antes da requisição, inclusive falhas ambíguas. O sistema encerra parcialmente antes de exceder `maxCost` ou `maxRequests`. Custos são estimados, não uma reconciliação da fatura do Google. O controle de orçamento é por execução; agendas renovam esse limite a cada run. Configure também cotas financeiras no provedor se desejar limite agregado.

`PROVIDER_INTERVAL_MS` limita globalmente o início de consultas através do Redis. `WORKER_CONCURRENCY` limita jobs simultâneos. O analisador de sites tem limite próprio de páginas/tamanho e espaçamento por host dentro do processo do worker. O deployment local pressupõe um processo worker; uma expansão para vários hosts exige coordenação compartilhada adicional da análise de sites e migração do banco local.

## Persistência, revisão e privacidade

MySQL com InnoDB, pool de conexões, transações e índices de identidade. SQLite permanece disponível explicitamente para testes e compatibilidade. As entidades solicitadas existem como tabelas: Country, Region, City, LeadProvider, ProviderCredential, CampaignRun, CampaignLocation, CapturedLead, WebsiteAnalysis, QualificationResult, ApprovalQueue, ScheduledCampaign, ProviderUsage e CollectionEvidence, além de Campaign/Pipeline e índices de supressão. Os dados de cada entidade são documentos JSON tipados pela aplicação; não se trata de um esquema analítico normalizado com colunas para todos os atributos.

A deduplicação compara identificador externo, telefones, e-mail, domínio/localidade, nome/endereço e proximidade geográfica. A atualização automática preenche campos vazios e acrescenta evidências. Valores existentes não são sobrescritos silenciosamente; snapshots preservam a procedência. Empresas homônimas/franquias com contatos compartilhados podem precisar de revisão antes de importar dados de outra fonte.

As credenciais permanecem em variáveis de ambiente. ProviderCredential armazena apenas a referência à variável, nunca o segredo; nenhuma API retorna a chave. `.env` e `data/` estão no `.gitignore`.

**Não contatar** bloqueia a empresa e remove aprovação/pipeline. **Excluir** e **Remover dados identificáveis** removem registro, análise, qualificação e evidências. Persistem hashes de identidade para impedir recaptura: isso é pseudonimização para supressão, não promessa de anonimização irreversível. Backups externos são responsabilidade do operador e precisam da mesma política de exclusão/retenção.

O sistema escuta em loopback, valida Host/Origin e exige sessão autenticada. Alterações exigem JSON e cabeçalho próprio, além do cookie SameSite. Esta versão possui um administrador; não inclui gestão multiusuário/RBAC. Antes de publicar em rede, configure HTTPS e uma política de acesso apropriada.

## Testes e verificação

```sh
npm run check
npm test
npm run test:ui
npm run test:worker
```

Os testes unitários/integração usam banco separado, fixtures sintéticas e respostas HTTP de teste. Cobrem normalização BR/PY, WhatsApp público, categoria desconhecida, dois idiomas, geografia, deduplicação, supressão após exclusão, SSRF, contrato da API Google, paginação, captura persistente, cancelamento, limite financeiro, ausência de fallback em erro real e renderização móvel.

`tests/ui-smoke.mjs` requer TEST_LOGIN_PASSWORD (e opcionalmente TEST_LOGIN_USERNAME), API, worker e Redis ativos e usa Edge no caminho padrão Windows. Cria uma campanha de demonstração pela interface, acompanha captura BullMQ, edita/aprova um lead, transfere ao pipeline e ativa/pausa uma agenda. Também verifica erros do navegador e largura em celular. Os registros fictícios desse teste ficam visíveis e identificados no workspace local.

O teste adicional `npm run test:worker` foi executado com Redis/BullMQ ativos e verificou disparo automático, captura no Paraguai, mensagens em espanhol, pausa/retomada, deduplicação, supressão após exclusão e cancelamento. Os 13 testes de `npm test`, a checagem TypeScript e os testes de interface passaram.

**Validação externa pendente:** nenhuma consulta com chave Google real nem envio/contato externo foi realizado. O adaptador foi verificado contra respostas controladas; a validação de credencial, faturamento e contrato precisa ocorrer no ambiente autorizado do operador.

Os testes `npm run test:mysql` e `npm run test:migration` passaram em uma instância MySQL isolada na porta 13307. Criam bases sintéticas e verificam autenticação, cookies, revogação, captura BullMQ, Unicode e importação sem alterar o SQLite. Exigem uma instância dedicada, configurável por TEST_MYSQL_PORT/TEST_MYSQL_PASSWORD.

## Estrutura

- `src/server.ts`: API e proteção de acesso.
- `src/worker.ts`, `src/engine.ts`, `src/queue.ts`: fila, execução, retentativas, limites e agenda.
- `src/providers.ts`, `src/types.ts`: contrato e provedores.
- `src/analysis.ts`, `src/mobile.ts`: análise pública e layout móvel.
- `src/leads.ts`, `src/normalize.ts`, `src/qualification.ts`: identidade, supressão e qualificação.
- `src/db.ts`, `src/geography.ts`: persistência e catálogo territorial.
- `public/`: interface responsiva sem bibliotecas de frontend externas.
- `tests/`: verificação automatizada e teste de interface.

## Front na Hostinger e API no Render

Execute `npm run build:frontend`. Envie o CONTEUDO de `dist-frontend` para a pasta publica da Hostinger. O pacote contem somente oito arquivos HTML/CSS/JS; nao envie o pacote Node anterior.

Em `config.js`, preencha `window.NEXTECH_API_URL` com a origem HTTPS da API (sem barra final). Nunca coloque senha ou chave nesse arquivo publico. Os caminhos relativos tambem permitem hospedar o front em subpastas.

No Render configure HOST=0.0.0.0, TRUST_PROXY=1, FRONTEND_ORIGINS com a origem exata HTTPS do front (sem caminho ou barra final) e ALLOWED_HOSTS com o hostname da API personalizada. O hostname automatico RENDER_EXTERNAL_HOSTNAME tambem e aceito. No modo gratuito descrito abaixo, configure somente MySQL remoto. Fora dele, configure tambem REDIS_URL; execute `npm start` no servico web e `npm run worker` em um worker separado. O cadastro inicial remoto continua bloqueado: importe o administrador no banco de destino.

Prefira front e API em subdominios HTTPS do mesmo dominio, por exemplo painel.seudominio.com e api.seudominio.com, mantendo COOKIE_CROSS_SITE=false. Se usar dominios diferentes (Hostinger + onrender.com), configure COOKIE_CROSS_SITE=true; navegadores que bloqueiam cookies de terceiros ainda podem impedir o login. A conexao e o login completos devem ser validados com os enderecos reais antes do uso.

Validacao local da separacao: compilacao TypeScript, preflight da origem permitida, bloqueio de origem desconhecida e presenca dos recursos estaticos passaram. Nao representa um teste de hospedagem real.

## Modo gratuito no Render

No Render, o modo gratuito e ativado automaticamente, a menos que FREE_MODE=false tenha sido definido explicitamente. Para fixar a escolha, use FREE_MODE=true. A fila fica no MySQL ja contratado e o processamento ocorre dentro da API existente. Nao e necessario criar Redis nem Background Worker. O render.yaml atual define somente o servico web Free; nenhuma credencial ou metadado privado do banco e incluido.

Neste modo, GOOGLE_PLACES_API_KEY e ignorada. A captacao consulta empresas reais cadastradas no OpenStreetMap, pela API publica Overpass, sem chave ou API paga. Nao existe fallback ficticio em caso de erro ou resultado vazio; registros antigos de demonstracao ficam ocultos na lista de leads gratuita. A Hostinger continua sujeita ao plano que ja existe; esta mudanca nao adiciona servicos pagos nem garante isencao de limites de trafego da hospedagem.

Use Iniciar captacao. Agendas sao recusadas porque o servico gratuito pode suspender. As tarefas ficam persistidas no banco; a API retoma as pendentes quando estiver executando novamente. Pausas e cancelamentos sao verificados durante a execucao. Uma trava com prazo de expiracao evita processamento simultaneo entre instancias durante trocas de deploy; apos encerramento abrupto, a retomada pode aguardar ate dois minutos. Nao ha garantia de execucao continua ou exatamente uma vez em caso de interrupcao externa, mas a deduplicacao de leads permanece ativa.

Validacao: npm run test:free usa banco isolado, Redis inexistente e chave Google ficticia para verificar que a chave e ignorada, tarefas usam respostas controladas OpenStreetMap com custo zero, agendas sao recusadas e registros sobrevivem ao reinicio. Os testes gerais continuam disponiveis em npm test.

### Fonte gratuita e contatos

Uma cidade e no maximo uma palavra-chave por campanha; ate 100 estabelecimentos por consulta. O painel limita consultas novas a uma por minuto e reutiliza a ultima busca identica por 24 horas. Resultados dependem da cobertura comunitaria; pode haver zero empresas ou nenhum telefone. Nao existe garantia de atualidade, disponibilidade ou quantidade.

Telefone e WhatsApp sao campos distintos. WhatsApp so e preenchido quando contact:whatsapp/whatsapp estiver publicado explicitamente no registro da empresa; telefone comum nao e tratado como WhatsApp. Nao ha envio automatico. Cada resultado inclui o link da origem. Dados: [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright). Preserve a atribuicao e observe as condicoes da licenca ao redistribuir bases.

A indisponibilidade da API publica gera erro visivel, nunca empresas inventadas. Fixtures sinteticas ficam apenas nos testes isolados.

Endpoint usado: https://maps.mail.ru/osm/tools/overpass/api/interpreter, listado no wiki OpenStreetMap como livre para uso em projetos. A consulta identifica o aplicativo, tem prazo de resposta e nao tenta contornar limitacoes do servidor.
