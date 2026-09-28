# Unificação — implementação e validação

Atualizado em 26/09/2026. Referências: plano-unificacao.md v2, Avantpro ML 7.24.0 local e Anúncio Fácil Pro, commit 5d4fdf06b0f7ec100541bca845932a4d748a8717. As alterações anteriores do workspace foram preservadas.

## Implementado

- [x] 0.1 Identificação com regra de precisão e sanitização; pesquisa com fontes reais seguida de descrição, título e SEO; modo Bling econômico. A identificação tem revisão própria antes da composição do anúncio.
- [x] 0.2 Transporte Gemini com até cinco chaves próprias, fallback limitado, tempo total limitado e erros sem chaves.
- [x] 0.3 EAN por variação, geração em lote, checksum e proveniência.
- [x] 0.4 Matriz de SKU com regras de família, variações e kits.
- [x] 0.5 Indicador de NCM consultado na tabela oficial.
- [x] 0.6 Oito abas, edição, copiar conteúdo, regeneração individual, três categorias SEO e prévia de anúncio.
- [x] 0.7 Sete propostas de imagem, referência real, planejamento visual A/B/C e seleção de fatos confirmados para infográfico; revisão antes de aprovar imagens.
- [x] 0.8 Kit como nova ficha, preservando o original; SKU/EAN próprios e invalidação de logística, preços e vínculos externos.
- [x] 1 Leitura contextual de buscas e anúncios ML pelo content script, com validação da aba solicitante.
- [x] 2 Cards de concorrentes, preço, vendedor quando exibido, posição observada, patrocinados e CSV.
- [x] 3 Histórico de capturas, mínimo/mediana/máximo, histórico por anúncio e comparação manual de títulos/CTR persistida na ficha.
- [x] 4 Galeria em IndexedDB, corte central, enquadramento, redimensionamento, compressão, preenchimento branco e geração com fundo branco por IA.
- [x] 5 Código de OAuth ML com PKCE, tokens cifrados, consulta de comissão/categoria/atributos, upload de fotos, validação, revisão, publicação e atualização de preço/estoque simples.
- [x] Proteção persistente contra publicação duplicada, falha parcial de descrição e recuperação do anúncio ao reabrir o painel.
- [x] Typechecks da extensão, Gateway e testes; builds e verificação de isolamento de segredos.
- [x] Revisão visual local: cadastro, navegação, kit, imagens e prévia de anúncio.
- [ ] Homologação conectada: login ML, Gemini real, captura em página real ML e publicação em conta de teste.

## Decisões e limites

A ficha auditável continua sendo a fonte central. Dados pesquisados não viram automaticamente características confirmadas. Falha da pesquisa não produz fontes inventadas. Sugestões de IA ficam pendentes de revisão.

EAN interno com checksum válido não é registro GS1. Por isso, mantemos a identificação interna e não geramos prefixo 789 com aparência de GTIN registrado. Esses códigos internos não são enviados como GTIN ao ML.

As métricas representam capturas feitas pelo usuário. Não estimamos faturamento ou vendas ocultas; posição observada não significa ranking global. A comparação A/B recebe contagens manuais, sem alternar anúncios ou distribuir tráfego automaticamente.

O editor faz corte central e preenchimento branco; não inclui pincel de remoção de fundo nem segmentação determinística. A proposta Principal pode reconstruir o fundo por IA, com revisão obrigatória da fidelidade ao produto. O planejamento visual seleciona fatos já confirmados e pode usar menos de quatro pontos quando a ficha não sustenta mais afirmações.

Publicação suporta anúncios simples e adaptação de family_name para contas User Products. Publicação em lote de variações e multiwarehouse não está implementada. Estoque compartilhado User Products, Full e anúncios com variações ficam bloqueados no sincronizador simples e devem ser geridos no ML. O painel mostra esses limites, sem enviar quantidade para o endpoint errado. Taxas consultadas não incluem frete, impostos e outros custos do negócio.

A conexão ML usa a sessão autenticada do Gateway/Bling existente; não foi criado um segundo sistema de login. Desconectar remove as credenciais armazenadas pelo Copilot. Revogar a autorização no Mercado Livre continua sendo uma ação na conta ML.

## Ativação

O pacote da extensão está em `dist/`. Carregar essa pasta como extensão descompactada; ela é o Paulifest Copilot, não uma alteração na instalação original do Avantpro em Downloads.

O Gateway precisa do build atualizado (`npm run build:gateway`); as migrações são aplicadas na inicialização. Configurar no servidor, nunca na extensão:

```dotenv
ML_CLIENT_ID=ID_DO_APLICATIVO_ML
ML_CLIENT_SECRET=SEGREDO_DO_APLICATIVO_ML
ML_REDIRECT_URI=https://SEU_GATEWAY/auth/mercadolivre/callback
```

Cadastrar exatamente esse callback no aplicativo Mercado Livre. As três variáveis são opcionais em conjunto: sem elas a integração informa que está desabilitada; configuração parcial impede inicialização. No ambiente local inspecionado, as três estavam ausentes. Nenhuma credencial foi inventada, nenhuma publicação real foi feita e nenhum deploy foi realizado.

Depois da configuração do servidor: conectar o Gateway/Bling, usar Conectar Mercado Livre, concluir a autorização e clicar Verificar conexão ML. A publicação exige ficha/fotos revisadas, preparação validada e confirmação no painel. Se o painel for fechado durante o envio, Verificar conexão ML recupera o vínculo de publicações concluídas. Tentativas incertas não são repetidas automaticamente.

A chave Gemini é informada em Entrada → Configurar. O usuário pode fornecer até cinco chaves próprias separadas por vírgula. Geração completa, planejamento e imagens consomem a API do provedor.

## Evidências

A suíte usa PostgreSQL real temporário para sessão, OAuth, criptografia, concorrência, idempotência e recuperação; o transporte Mercado Livre é simulado. Os testes Gemini também simulam respostas. Isso verifica a implementação e não substitui homologação com serviços reais.

Comandos de reprodução:

```powershell
./scripts/test-local.ps1
npm run build
npm run build:gateway
npm run typecheck:tests
node scripts/verify-extension-isolation.mjs
```

A prévia HTTP local permite revisar a interface e persistência local. Recursos de Chrome (leitura da aba e mensagens para o background) exigem carregar `dist/` como extensão.

Resultado final em 26/09/2026: 536 testes aprovados, sem falhas; três verificações TypeScript aprovadas; builds da extensão e Gateway aprovados; isolamento de segredos aprovado; git diff --check sem erros de whitespace.

## Revisão de usabilidade após feedback — 26/09/2026

A abertura foi refeita: tela inicial com Criar produto, Buscar no Bling e Retomar rascunho. O editor tem quatro etapas (Produto, Revisão, Preço, Anúncio); fotos, kits, fontes e análise de mercado estão em Ferramentas extras. Conexões e contexto da página saíram do topo do cadastro.

O primeiro passo oferece foto/nome e distingue IA opcional de preenchimento manual. EAN, SKU e custo são recolhíveis. O modo de demonstração deixou de ser um botão junto ao nome do modelo. Salvar preço agora leva ao anúncio; a publicação ML fica em uma seção recolhida que explica seu requisito de conexão.

Validado pelo navegador: criação manual, geração de SKU a partir do nome, revisão, aplicação de preço, passagem ao anúncio, edição de descrição, retorno ao início, recarga e retomada sem perda dos dados. Tela inicial conferida em 390 × 780. Os 536 testes existentes passaram; build e isolamento passaram. Isso não constitui validação de Gemini, Bling ou ML com as contas reais do usuário.
