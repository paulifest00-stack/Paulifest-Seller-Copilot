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
