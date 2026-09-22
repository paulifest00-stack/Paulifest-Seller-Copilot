# Patch corretivo 4D.2 — evidências para reauditoria

Data: 2026-09-21. Escopo: correções de Quick View, estoque, sessão, cache e testes. Sem avanço para 4D.3, commit, push, escrita no Bling ou publicação no Mercado Livre.

## Correções e decisões

- Quick View mantém loading, sucesso, erro e retry em TabContextManager, inclusive quando nenhuma outra propriedade muda. Mudanças de produto, documento, rota ou plataforma limpam resultado e erro. Atualizações com revisão antiga são recusadas.
- O background não mantém cache de resultados/TTL. Deduplica somente chamadas simultâneas por identidade de autenticação, aba, produto, documento e revisão. A Promise é removida ao terminar.
- Gateway mantém cache volátil por conexão autenticada + produto, TTL padrão de 60 segundos e máximo padrão de 1.000 entradas. Configuração: GATEWAY_QUICK_VIEW_CACHE_TTL_MS e GATEWAY_QUICK_VIEW_CACHE_MAX_ENTRIES. Inserções removem expirados e expulsam entradas mais antigas quando necessário; leituras removem a entrada expirada solicitada. Cache não é persistido.
- Desconectar invalida entradas e tickets de leituras em andamento. Antes de inserir resposta, Gateway verifica novamente conexão e sessão duráveis. O cliente mantém geração monotônica de autenticação do worker; início de conexão, troca de conta e desconexão invalidam respostas e estados anteriores. Refresh normal mantém a identidade; retry após 401 usa o GRT atualizado.
- Inicialização bloqueia mensagens até restringir storage, reidratar contexto e limpar Quick Views anteriores. Não reutiliza resultado persistido de outro ciclo do worker como consulta atual.
- Sidepanel usa broadcasts como sinal de atualização e relê a aba ativa da própria janela. Leituras antigas são descartadas. LINK_SHEET_TO_TAB usa sender.tab.id para content scripts; aceita seleção de aba pelo Sidepanel somente de URL/id da extensão confiável e após validar a aba ativa da janela.
- Consulta isolada e hidratação de ficha não chamam saveSheet. Somente ações explícitas de edição/importação persistem. Importação recusa estoque Quick View de outro produto.
- stockInfo é o contrato único. Valores vazios, whitespace, null, undefined, não finitos e negativos não viram zero. Zero explícito é válido. ID/nome de depósito ausentes não são fabricados.
- Reconciliação preserva zero manual e registra conflito quando necessário; estoque é comparado por saldos e depósitos, ignorando retrievedAt e ordem. Campos de template missing sem fato continuam importáveis.
- storage.local (GRT) e storage.session (GST) são restritos a TRUSTED_CONTEXTS antes do roteamento. Falha/ausência dessa API bloqueia inicialização segura. Manifest exige Chrome 114+. Essa proteção exclui content scripts; não isola o background das páginas confiáveis da própria extensão. Mensagens de UI não transportam GRT, GST ou tokens Bling.
- connectionId no JWT é legível: assinatura não é criptografia. Não é segredo nem autoridade fornecida pela UI. A autoridade de conexão/tenant é derivada pelo Gateway da sessão validada.
- MercadoLivreFeeProvider continua estimativa/simulação mesmo com token configurado. pageInstanceId=inst_mock não habilita mock de produção; mock exige injeção explícita de teste.

## Contrato oficial Bling

Fontes consultadas em 2026-09-21: [referência oficial](https://developer.bling.com.br/referencia) e [OpenAPI publicada pelo site oficial](https://developer.bling.com.br/build/assets/openapi-BVqLYFZn.json).

- Produto: GET /Api/v3/produtos/{idProduto}. Custo na resposta: data.fornecedor.precoCusto (ProdutoFornecedorDTO), preço de custo do produto no fornecedor. Não usar data.preco, precoCompra ou precoCusto na raiz como substitutos. O DTO interno normalizado continua expondo precoCusto; evidência registra fornecedor.precoCusto.
- Estoque: GET /Api/v3/estoques/saldos?idsProdutos[]={id}. data é lista de registros de produto, cada um com produto.id, saldoFisicoTotal, saldoVirtualTotal e depositos. A resposta deve corresponder ao ID solicitado.
- Saldo físico total representa o saldo físico do produto. Saldo virtual total desconsidera os produtos reservados. Cada depósito contém id, saldoFisico e saldoVirtual; nome não é retornado nesse schema.
- Lista data vazia significa ausência de informação no parser; totais não são inventados pela soma de depósitos. Resposta malformada falha. HTTP 404 de saldos não é convertido em ausência: o contrato publicado lista 200/400 para esse endpoint.
- O schema oficial requer ID de depósito; a normalização aceita um depósito parcial sem inventar ID, preservando somente saldos válidos. Saldos negativos são rejeitados conforme a regra solicitada para esta fase, não como alegação de que o ERP nunca os produza.

Exemplo mínimo sintético, com formato derivado do schema (não é captura de conta real):

```json
{"data":[{"produto":{"id":123},"saldoFisicoTotal":37,"saldoVirtualTotal":35,"depositos":[{"id":1,"saldoFisico":37,"saldoVirtual":35}]}]}
```

Pendência documental restrita: o código já enviava enable-jwt: 1; sua obrigatoriedade não foi confirmada no material consultado. Mantido por compatibilidade, sem alegação de requisito oficial. Endpoints, caminho de custo, formato e significado dos saldos foram confirmados. Homologação autenticada contra conta real não foi realizada.

## Testes e quality gates

Execução real: 394 testes aprovados, zero falhas; 29 na suíte corretiva e 29 na suíte Quick View/estoque. PostgreSQL 17.11 dedicado em loopback, porta 55432, banco paulifest_test, sem uso de banco de produção.

Os testes fracos 20/25/26/27/28 foram corrigidos/substituídos: cache real após desconexão; proveniência do custo; fluxo real do router sem escrita de ficha; formatação sem simulação de DOM; fluxo HTTP Gateway → cliente → router → estado do Dock e sincronizador do Sidepanel sem credenciais. Acrescentados testes de desconexão durante leitura, transições de estado, revisão/autenticação antiga, duas janelas, autoridade do sender, saldos inválidos/zero, produto divergente, reconciliação manual/temporal, storage restrito, simulação ML, inst_mock e limite/expiração do cache. Asserções estruturais anti-XSS complementam testes de comportamento; não equivalem a execução visual no Chrome.

| Gate | Resultado |
| --- | --- |
| npm test | PASS — 394 testes |
| npx tsc --noEmit | PASS |
| npm run typecheck:gateway | PASS |
| npm run typecheck:tests | PASS — duas suítes Quick View e dependências importadas |
| npm run build:gateway | PASS |
| npm run build | PASS |
| npm run verify:extension-isolation | PASS — 8 arquivos verificados |
| git diff --check | PASS |

## Arquivos do patch

- Background: gateway-client.ts, index.ts, message-router.ts, tab-context-manager.ts e novo storage-access.ts.
- Gateway: cache/quick-view-cache.ts, config.ts, crypto/pairing-state.ts, http/app.ts, integrations/bling/bling-product-client.ts.
- Contratos/UI: shared/gateway-contracts.ts, shared/tab-context-contracts.ts, content-scripts/bling/shadow-ui.ts, sidepanel/App.tsx e novo sidepanel/context-sync.ts.
- Dados: integrations/bling/bling-to-sheet.mapper.ts, integrations/bling/reconciliation.ts e core/engines/pricing-calculator/fee-provider.ts.
- Testes: quick-view-and-stock.test.ts, novo quick-view-corrections.test.ts, index.test.ts, extension-product-integration.test.ts, gateway-auth-orchestration.test.ts, gateway-product-read.test.ts e message-router.test.ts.
- Configuração/documentação: package.json, public/manifest.json, novo tsconfig.tests.json, README.md e este relatório.

## Limites e riscos restantes

A reauditoria continua necessária. Testes integrados executam módulos reais com APIs externas/Chrome controladas; não houve homologação visual de duas janelas no Chrome nem OAuth/leituras autenticadas ao vivo do Bling. Cache/tickets são locais ao processo do Gateway; implantação horizontal precisa de invalidação coordenada caso se exija remoção imediata em todas as réplicas. A autenticação durável continua obrigatória antes de servir cache. GRT fica acessível a contextos confiáveis da extensão, como definido pela API MV3. Nenhuma taxa real do Mercado Livre foi integrada neste patch.


## Reauditoria e correções de 2026-09-22

A execução anterior de 420 testes não eliminava a corrida durante persistência: o gate adiava navegação/logout até depois da resposta, mantendo artificialmente válido o contexto original. Esse comportamento foi rejeitado na reauditoria e corrigido nesta rodada autorizada. Os testes anteriores de save/link também foram corrigidos: agora exigem invalidação imediata e resposta sem sucesso.

O gate passou a ser uma fila FIFO somente de importações. Não intercepta mutações de aba ou autenticação. A identidade é revalidada após cada espera relevante, incluindo aquisição da fila/lock, leitura dos snapshots, gravação local e persistência do vínculo. O vínculo só entra na memória e é publicado após a última barreira; não há await entre essa barreira e a resposta.

A camada de SSOT coordena leituras e escritas do worker/Sidepanel usando o mesmo Web Lock por origem. Uma gravação iniciada enquanto válida pode tornar-se stale durante a API assíncrona: nesse caso, restaura a ficha anterior e o ponteiro ativo (ou remove a nova ficha), sem sucesso. Leitores/editores da camada SSOT aguardam a conclusão/restauração. Isso é compensação de escrita, não alegação de que uma chamada de storage já iniciada possa ser cancelada. A ficha-base também é comparada novamente sob lock para não sobrescrever edição ocorrida enquanto se aguardava o gate.

A persistência de contexto é ordenada por aba. Mutações em memória são imediatas; uma tentativa de vínculo obsoleta repara somente a projeção persistida a partir do contexto atual, sem restaurar um contexto antigo em memória. Callbacks de portas encerradas não interrompem a entrega às demais requests duplicadas. Quick View também revalida o estado após a persistência e antes de publicar a resposta.

Base da coordenação entre páginas e workers: [especificação Web Locks do W3C](https://www.w3.org/TR/web-locks/). Os testes desta rodada executaram o LockManager disponível no Node 24, além dos módulos reais do projeto, com storage/rede Chrome controlados. Não houve validação visual em Chrome real.

Validação desta rodada: 430 testes aprovados (36 de corrida/importação, 29 corretivos Quick View, 29 Quick View/estoque e todas as suítes anteriores). PostgreSQL 17.11 dedicado em 127.0.0.1:55432, banco paulifest_test. Os 26 testes de importação anteriores foram revisados/ampliados para 36. typecheck:tests abrange as três suítes relevantes e suas dependências. Todos os gates solicitados foram repetidos; resultados finais constam da entrega.

Riscos/limites: a compensação exige que o storage volte a aceitar escrita; falha também na restauração é propagada explicitamente, sem sucesso. Encerramento abrupto do processo entre operações não tem recuperação transacional por journal neste patch. APIs de storage pendentes mantêm a fila de SSOT aguardando, mas não impedem invalidação de contexto/autenticação. Não se libera o lock por timeout deixando uma gravação atrasada correr solta. Homologação Bling/Chrome, obrigatoriedade de enable-jwt e coordenação de múltiplas réplicas do Gateway permanecem pendências futuras; não houve escrita no Bling ou publicação no Mercado Livre.

Resultado final de 2026-09-22: npm test (430 testes), npx tsc --noEmit, typecheck:gateway, typecheck:tests, build:gateway, build, verify:extension-isolation e git diff --check aprovados. Reauditoria local aprovada para commit, com os limites acima explícitos. O usuário autorizou commit local após aprovação; push não autorizado nem realizado.
