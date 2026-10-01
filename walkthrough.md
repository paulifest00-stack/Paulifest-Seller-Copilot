# Implementação do Popup Nativo (Speed Dial v3)

**Data:** 30/09/2026
**Objetivo:** Substituir a injeção do iframe do painel lateral nos sites por uma arquitetura nativa e perfeitamente integrada às páginas, com inspiração no design da Apple e Emil Kowalski.

## 🛠️ O que foi feito

### 1. Refatoração Completa do `shadow-ui.ts` (Bling)
Toda a interface anterior baseada em iframe foi descartada. Agora temos um mini-app nativo que roda 100% dentro do Shadow DOM do site alvo.
* **Sistema de Navegação:** Implementamos uma pilha de navegação (stack nav) `push/pop` que emula a experiência de aplicativos móveis iOS.
* **Animações (Motion Design):** 
  * Curvas de Bézier adaptadas do Apple Design (`cubic-bezier(0.32, 0.72, 0, 1)` para push de tela, fade/slide progressivo para saídas).
  * Feedback imediato `scale(0.97)` em todos os botões no momento do clique (pointer-down) para gerar uma sensação tátil premium.
  * O Speed Dial recebeu *staggering* nas pills, ou seja, elas aparecem uma após a outra em um efeito de mola.
* **Glassmorphism:** Cabeçalho com o material `backdrop-filter: blur(16px)` mesclando as cores do site hospedeiro de forma fluida.
* **As telas nativas:**
  * **Catálogo:** Busca instantânea (debounced) direto do popup nativo.
  * **Status:** Indicação clara da conexão OAuth com o Bling, botão de Reconectar, sem forçar abertura de novas páginas.
  * **Produto:** Gestão rápida do Custo/Estoque do item aberto com animação suave de status (toasts dinâmicos).
  * **Preparação ML:** Checklist pré-vôo com tags coloridas se falta imagem, preço, nome etc.

### 2. Guard Routes Adaptadas
No arquivo `message-router.ts` (linha 121), relaxamos o bloqueio rígido do `BLING_SEARCH_PRODUCTS` e `BLING_CATALOG_PRODUCT`. Agora o background service worker permite essas rotas se a chamada vier do *content script* da extensão. Assim, o nosso popup consegue buscar dados com segurança total e exibir as informações na mesma aba.

### 3. Adaptação do `companion.ts` (Mercado Livre)
"O App completo integrado" — no ML também replicamos a arquitetura do popup. A calculadora de preços, leitura de mercado, resumos dos concorrentes (análise de página) agora rodam nestas telas rápidas. O design muda para uma paleta de cores Mercado Livre, e os cartões ganham proporções ajustadas em CSS com os mesmos comportamentos iOS de tela e transição.

## 🧪 Como testar
1. Acesse o **Bling** ou um anúncio do **Mercado Livre**.
2. Passe o mouse no FAB no canto da tela (azul no Bling, amarelo no ML).
3. Teste o clique nos botões das Pills, a interface fluida de telas "surgindo" da direita substituirá os saltos que você sentia antes.

> [!TIP]
> Essa nova arquitetura garante que nenhum scroll indesejado escape (overscroll behavior), as fontes da extensão não sejam sobrepostas por CSS alheio, e a responsividade permaneça afiada e coesa.
