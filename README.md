# Paulifest Seller Copilot

Extensão Chrome Manifest V3 para ficha central auditável, precificação e integração de leitura com Bling, com Gateway separado.

## Estado atual

Patch corretivo da fase 4D.2 reauditado localmente e aprovado para commit em 2026-09-22. A execução final aprovou 430 testes; os checks de TypeScript, builds e isolamento do pacote passaram. Homologação autenticada no Bling e visual no Chrome permanecem pendências futuras. A fase 4D.3 não foi iniciada.

Quick View consulta custo e estoque sem salvar a ficha. Há um único cache de resultados no Gateway, isolado por conexão/produto, com TTL padrão de 60 segundos e limite de 1.000 entradas. Background deduplica somente requisições simultâneas. Estado é invalidado por navegação e mudanças de autenticação; Sidepanel consulta a aba ativa da própria janela.

A integração de taxas do Mercado Livre continua simulada, mesmo quando um token é configurado. Publicação no marketplace e escrita de produtos no Bling não fazem parte deste patch. Pesquisa técnica usa MockResearchProvider; pesquisa externa real permanece futura.

Detalhes de correções, arquivos, evidências oficiais do Bling, testes e limitações: [relatório 4D.2](docs/phase-4d2-corrections.md).

## Validação e build

Use Node.js, npm e PostgreSQL dedicado a testes. DATABASE_URL deve apontar exclusivamente para o banco descartável paulifest_test; nunca use credenciais de produção. A suíte inclui migrações e operações de persistência reais.

```powershell
npm install
$env:DATABASE_URL='postgresql://USUARIO:SENHA@127.0.0.1:PORTA/paulifest_test'
npm test
npx tsc --noEmit
npm run typecheck:gateway
npm run typecheck:tests
npm run build:gateway
npm run build
npm run verify:extension-isolation
git diff --check
```

Os testes Quick View e de corrida de importação também têm verificação TypeScript dedicada; esse comando não abrange todos os testes legados. Builds geram dist/, dist-gateway/ e dist-test/, ignorados pelo Git.

Para carregar a extensão, use Chrome 114+, habilite modo desenvolvedor em chrome://extensions e selecione dist/ em “Carregar sem compactação”. Configure e execute o Gateway separadamente conforme os documentos de configuração em docs/; o pacote da extensão não inclui o backend.

## Gateway operacional

O Gateway público usa obrigatoriamente PostgreSQL; o repositório em memória fica restrito a testes com injeção explícita. Na inicialização ele valida o banco, executa as migrações pendentes sob advisory lock e só então abre a porta HTTP. Se configuração, banco ou migração falharem, o processo encerra sem publicar um servidor parcial.

Variáveis obrigatórias em produção:

```text
NODE_ENV=production
DATABASE_URL=postgresql://...
DATABASE_SSL_CA_PATH=config/certs/supabase-prod-ca-2021.crt
BLING_CLIENT_ID=...
BLING_CLIENT_SECRET=...
BLING_REDIRECT_URI=https://SEU_GATEWAY/auth/bling/callback
GATEWAY_ENCRYPTION_KEY=... # 32 bytes em hex/base64 ou frase derivada por SHA-256
GATEWAY_JWT_SECRET=...     # mínimo de 32 caracteres
GATEWAY_ALLOWED_EXTENSION_ORIGINS=chrome-extension://ID_REAL
GATEWAY_TRUST_PROXY=true
```

`GATEWAY_PORT` tem precedência sobre `PORT`; provedores que injetam somente `PORT` são suportados. Para executar localmente, copie as variáveis para um arquivo `.env` ignorado pelo Git e rode:

```powershell
npm run build:gateway
npm run start:gateway:local
```

Em hospedagem, use `npm run build:gateway` no build e `npm run start:gateway` no start. Para apontar o pacote da extensão ao serviço publicado, compile com `VITE_APP_ENV=production` e `VITE_GATEWAY_URL=https://SEU_GATEWAY`. O `BLING_REDIRECT_URI` deve ser cadastrado exatamente como link de redirecionamento no aplicativo do Bling.

## Credenciais e simulação

Tokens Bling permanecem no Gateway. GRT fica em storage.local e GST em storage.session, ambos restritos a TRUSTED_CONTEXTS antes de processar mensagens; falha nessa proteção bloqueia a inicialização segura. A API permite acesso a páginas confiáveis da extensão, mas exclui content scripts. Credenciais não são enviadas à UI por mensagens.

connectionId presente no JWT é legível e não deve ser tratado como segredo. O Gateway deriva autoridade da sessão autenticada, nunca de um tenant declarado pela UI. A chave Gemini é configurada pelo usuário na Sidebar; não deve ser versionada.

## Estrutura

- src/background/: sessões, mensagens e contexto por aba.
- src/content-scripts/: detecção e Dock contextual.
- src/sidepanel/: interface React e ficha.
- src/core/: schema, armazenamento e motores.
- src/integrations/: mapeamento e reconciliação.
- src/gateway/: OAuth, PostgreSQL, integrações e cache.
- tests/: testes unitários e de integração.
- docs/: especificações, auditorias e evidências.
