# Checklist E2E — Fase 4C.4C: Validação de UX de Conexão Bling

> **Escopo:** Validação manual end-to-end da Fase 4C.4B implantada.
> **NÃO usar:** Credenciais reais de produção nesta fase.
> **Ambiente:** Extensão carregada como "unpacked" no Chrome com modo de desenvolvimento ativo.
> **Gateway:** Instância de staging/local com mock de handshake habilitado.

---

## PRÉ-CONDIÇÕES

- [ ] Extensão carregada via `chrome://extensions` → "Load Unpacked" (pasta `dist/`)
- [ ] Gateway local rodando em `http://localhost:3000` (staging OK)
- [ ] Sidebar aberta via ícone da extensão
- [ ] DevTools aberto na aba "Sources" (Service Worker) e na aba da Sidebar

---

## BLOCO A — Estado Inicial / Hidratação

### A.1 — Abertura com estado `disconnected`
- [ ] Storage limpo (sem sessão persistida)
- [ ] Sidebar aberta
- [ ] `BlingConnectionCard` aparece imediatamente com estado `disconnected`
- [ ] **Não há flash de "conectado" → "desconectado"** — hidratação ocorre antes da primeira renderização visível
- [ ] Botão "Conectar ao Bling" visível e clicável
- [ ] Dock no Bling ERP: não visível (sem aba Bling ativa)

**Como verificar:** DevTools Console da Sidebar → `BLING_GET_CONNECTION_STATUS` deve aparecer ANTES do primeiro render completo do card.

### A.2 — Reabertura com sessão `connected` existente
- [ ] Fechar e reabrir a Sidebar (sem fechar o Chrome)
- [ ] `BlingConnectionCard` deve aparecer com estado `connected` desde o primeiro frame
- [ ] **Sem flash de "disconnected"** no momento da reabertura

### A.3 — Restart do Service Worker com sessão ativa
- [ ] Ir para `chrome://extensions` → clicar "reload" na extensão
- [ ] Reabrir a Sidebar
- [ ] Card hidratar estado correto (`connected` ou `gateway_unreachable` se Gateway offline)
- [ ] **Não** deve aparecer estado falso de `disconnected` permanentemente

---

## BLOCO B — Fluxo de Conexão

### B.1 — `disconnected` → clicar "Conectar ao Bling"
- [ ] Card transiciona para estado `connecting` (spinner visível)
- [ ] Mensagem: "Iniciando conexão com o Bling..."
- [ ] **Nenhuma credencial exposta no console da Sidebar** (DevTools → Console)
- [ ] `pairingSecret` **não aparece** em nenhum log de mensagem

### B.2 — Estado `awaiting_oauth` (após abertura de aba OAuth)
- [ ] Aba OAuth abre no Bling (`auth.bling.com.br/...`)
- [ ] Card transiciona para estado `awaiting_oauth`
- [ ] Botão "Focar aba de autorização" visível
- [ ] Clicar "Focar aba de autorização" → aba OAuth ganha foco

**Verificação de segurança:** DevTools → Network (filtro Sidebar) → **zero** chamadas HTTP ao Gateway originadas da Sidebar.

### B.3 — Conclusão bem-sucedida do OAuth
- [ ] Usuário autoriza no Bling (staging/mock)
- [ ] Card transiciona para estado `connected`
- [ ] `lastRefreshAt` exibido corretamente (timestamp legível)
- [ ] Dock no Bling ERP: notificado via `BLING_CONNECTION_STATUS_CHANGED` (sem recarregar a aba)
- [ ] Botão "Preparar para ML" no Dock: habilitado (se produto com ID detectado)

---

## BLOCO C — Estados de Erro e Retry

### C.1 — `gateway_unreachable` (Gateway offline)
- [ ] Parar o Gateway local
- [ ] Clicar "Retry" no `BlingConnectionCard`
- [ ] **Nenhuma aba OAuth** é aberta pelo retry
- [ ] Card exibe estado `gateway_unreachable`
- [ ] Dock exibe notice: `"⚠️ Gateway temporariamente indisponível. Tente novamente em instantes."`
- [ ] **Semântica correta:** estado é `gateway_unreachable`, NÃO `disconnected`

### C.2 — `gateway_unreachable` → Gateway volta → Retry bem-sucedido
- [ ] Reiniciar Gateway
- [ ] Clicar "Retry" novamente no card
- [ ] Card transiciona para `connected` (**sem abrir nova aba OAuth**)
- [ ] Dock atualizado via broadcast

### C.3 — `session_expired` / `requires_reauth`
- [ ] Simular expiração de sessão (revogar token no Gateway staging)
- [ ] Card mostra estado `session_expired` ou `requires_reauth`
- [ ] Botão "Reconectar ao Bling" visível (inicia novo OAuth)

### C.4 — `refreshing`
- [ ] Card mostra estado `refreshing` com spinner
- [ ] Dock exibe notice: `"⏳ Renovando sessão com o Bling… aguarde."`
- [ ] Botão de ação desabilitado durante refresh

### C.5 — `configuration_error`
- [ ] Card mostra estado com instruções para suporte
- [ ] **Nenhuma URL interna** exposta na mensagem de erro visível para o usuário

---

## BLOCO D — Desconexão

### D.1 — `connected` → Desconectar com sucesso
- [ ] Clicar "Desconectar" no card
- [ ] Confirmação inline aparece (React state, **sem `window.confirm`**)
- [ ] Clicar "Confirmar desconexão"
- [ ] Card transiciona para `disconnected`
- [ ] Dock atualizado via broadcast
- [ ] `chrome.storage.local` limpo (DevTools → Application → Storage)

### D.2 — Desconexão com falha transitória (Gateway offline)
- [ ] Parar o Gateway
- [ ] Clicar "Desconectar" → confirmar
- [ ] **Card NÃO muda para `disconnected`** (falha transitória preserva estado)
- [ ] Card exibe `gateway_unreachable`
- [ ] Storage local **ainda tem** sessão (não foi limpo indevidamente)

---

## BLOCO E — Dock no Bling ERP (Auth-Awareness)

### E.1 — Dock com Bling `disconnected`
- [ ] Aba do Bling ERP aberta com produto detectado
- [ ] Botão "Preparar para ML" **desabilitado**
- [ ] Notice visível: `"🔗 Conecte o Bling pelo Copilot para continuar."`

### E.2 — Dock com Bling `connected`
- [ ] Conectar via Sidebar
- [ ] Dock atualizado **sem reload da aba** (via broadcast)
- [ ] Botão "Preparar para ML" **habilitado** (se produto com ID)
- [ ] Notice removido

### E.3 — Dock com `gateway_unreachable`
- [ ] Notice: `"⚠️ Gateway temporariamente indisponível. Tente novamente em instantes."`
- [ ] Botão "Preparar para ML" **desabilitado**

### E.4 — Dock com `refreshing`
- [ ] Notice: `"⏳ Renovando sessão com o Bling… aguarde."`
- [ ] Botão desabilitado

---

## BLOCO F — Segurança (Invariantes Arquiteturais)

- [ ] **F.1** DevTools → Network da Sidebar: **zero** chamadas HTTP ao Gateway durante toda a jornada
- [ ] **F.2** `pairingSecret` ausente em **todas** as mensagens de runtime interceptadas
- [ ] **F.3** Resposta de `BLING_FOCUS_OAUTH_TAB` contém **apenas** `{ok, focused}` — sem `oauthTabId`
- [ ] **F.4** `gatewayRefreshToken` e `gatewaySessionToken` **ausentes** nas respostas de `BLING_GET_CONNECTION_STATUS`
- [ ] **F.5** `BlingConnectionCard` **sempre visível** em todos os 9 estados (`disconnected`, `connecting`, `awaiting_oauth`, `connected`, `refreshing`, `requires_reauth`, `session_expired`, `gateway_unreachable`, `configuration_error`)

---

## BLOCO G — Concorrência / Race Conditions

### G.1 — Sidebar fechada durante `awaiting_oauth`
- [ ] Iniciar OAuth (awaiting_oauth)
- [ ] Fechar e reabrir a Sidebar
- [ ] Card mostra `awaiting_oauth` corretamente (hidratação via query, não assume `disconnected`)

### G.2 — Múltiplos cliques em "Conectar" (single-flight)
- [ ] Clicar "Conectar" várias vezes rapidamente
- [ ] **Uma** única aba OAuth aberta
- [ ] Status retorna `"Fluxo de conexão já em andamento."` nas chamadas subsequentes

### G.3 — Broadcast vs Query (race protection)
- [ ] Se broadcast `BLING_CONNECTION_STATUS_CHANGED` chegar enquanto query inicial processa → broadcast prevalece
- [ ] Sem flash de estado inconsistente

---

## BLOCO H — Regressão de Fases Anteriores

- [ ] Fluxo de cadastro de produto funciona normalmente com Bling conectado
- [ ] Ficha Central (SSOT) **não é alterada** pela conexão/desconexão
- [ ] Importação de produto Bling funciona após conexão estabelecida
- [ ] `chrome.storage.local` preserva dados de produto durante disconnect/reconnect

---

## CRITÉRIOS DE APROVAÇÃO

| Critério | Classificação |
|----------|---------------|
| Zero flash de estado enganoso na hidratação | ✅ Bloqueante |
| `pairingSecret` nunca exposto em mensagens | ✅ Bloqueante |
| `oauthTabId` ausente nas respostas de FOCUS_OAUTH_TAB | ✅ Bloqueante |
| Retry NÃO inicia novo OAuth | ✅ Bloqueante |
| `gateway_unreachable` ≠ `disconnected` (semântica distinta) | ✅ Bloqueante |
| Disconnect falha transitória: estado preservado | ✅ Bloqueante |
| Card sempre visível em todos os 9 estados | ✅ Bloqueante |
| Dock atualizado via broadcast (sem reload de aba) | ✅ Bloqueante |
| Nenhuma chamada HTTP da Sidebar ao Gateway | ✅ Bloqueante |
| GRT e GST ausentes de todas as mensagens de UI | ✅ Bloqueante |

---

*Gerado em Fase 4C.4B. Próxima fase: 4C.4C — Execução E2E seguindo este checklist.*

