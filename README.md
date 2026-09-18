# Paulifest Seller Copilot 🚀

> Assistente inteligente oficial para sellers, integrando Mercado Livre e Bling ERP com Ficha Central Auditável (SSOT), motor de precificação determinístico e identificação assistida por IA.

---

## 📌 Status do Projeto: Fase 3 Concluída (Checkpoint de Arquitetura & Testes)

- [x] **Fase 1 — Fundação & Detecção de Contexto:**
  - Arquitetura Manifest V3 com `side_panel` nativo e React 19 + TypeScript + Vite + Tailwind CSS.
  - Design System Apple / Emil Kowalski com microinterações fluídas.
  - Reconhecimento automático de abas Mercado Livre, Bling ERP e Neutras.
- [x] **Fase 2 — Ficha Central & Precificação Determinística:**
  - Ficha Central do Produto com proveniência de dados (`AuditedField<T>`), evidências e rastreabilidade.
  - Validação rigorosa de EAN/GTIN (GS1 módulo-10) permitindo "Produto sem GTIN".
  - Motor de Precificação determinístico (`PricingCalculator`) com margem líquida direta, reversa e break-even, desacoplado de taxas fixas chumbadas (`IMarketplaceFeeProvider`).
- [x] **Fase 3 — Identificação Automática, Pesquisa e Proveniência Auditável:**
  - Gateway desacoplado `AIProvider` (com `GeminiAIProvider` e `MockAIProvider`).
  - Regra inegociável **Fact-or-Omit**: campos sem evidência visual ou documental permanecem `missing` e nunca são inventados.
  - Hierarquia de fontes determinística por Tiers (Tier 1 Fabricante $\to$ Tier 2 Marca $\to$ Tier 3 Ficha Técnica $\to$ Tier 4 Distribuidor $\to$ Tier 5 GS1 $\to$ Tier 6 Marketplace).
  - Verificação de identidade do produto e bloqueio de contaminação por variantes divergentes.
  - 28 testes automatizados cobrindo todos os 18 cenários de auditoria.

---

## 🔬 Estado da Pesquisa Técnica (`IResearchProvider`)

- **`IResearchProvider`:** Interface desacoplada e arquitetura preparada para suportar provedores de enriquecimento técnico.
- **`MockResearchProvider`:** Implementação concreta atual utilizada para testes e homologação local, com catálogo controlado e fontes rastreáveis.
- **`RealResearchProvider`:** Pendência futura de pesquisa externa em tempo real (web scraping / APIs oficiais).
- **Transparência:** Nenhum dado simulado do mock é apresentado silenciosamente como pesquisa em tempo real. A interface avisa explicitamente quando o Modo Demonstração está em uso.

---

## 🔑 Configuração da Chave de IA

- A chave da API Gemini nunca é mantida no código, em arquivos `.env` ou versionada no Git.
- O usuário configura sua própria chave diretamente na interface da Sidebar (`chrome.storage.local`).
- A ausência de chave alerta o vendedor sobre a configuração pendente e bloqueia o provider real, permitindo alternar para o Modo Demonstração de forma transparente.
- A tela central de **"Configurações & Integrações"** está planejada para a próxima etapa, unificando as credenciais de IA, Bling, Mercado Livre e Provedores de Pesquisa.

---

## 🎯 Direcionamento Oficial para a Próxima Fase

A próxima etapa não implementará autofill ou publicação cega, mas priorizará:

1. **Dois Níveis de Interface:**
   - **Sidebar:** Centro de inteligência, Ficha Central (SSOT), identificação, precificação e resolução de conflitos.
   - **Integração Contextual Injetada:** Botões e ações acionáveis diretamente nas telas do Bling e do Mercado Livre (ex: *"Preparar para Mercado Livre"*, seleção de itens na listagem para carga na extensão, revisão em tela).
2. **Fluxo Bidirecional do Bling:**
   - `Bling → Extensão → Mercado Livre`: Importar produto existente do Bling, carregar na Ficha Central preservando a origem, enriquecer dados faltantes, precificar e preparar anúncio.
   - `Extensão → Bling → Mercado Livre`: Produto novo identificado na extensão (foto/EAN/nome) com Ficha Central validada e cadastrado no Bling antes da publicação.

---

## 🛠️ Como Carregar a Extensão no Google Chrome

### 1. Pré-requisitos e Build
```bash
npm install
npm test          # Executa a suíte completa de 28 testes unitários
npm run build     # Compila o bundle Manifest V3 em dist/
```

### 2. Ativar no Chrome
1. Abra `chrome://extensions` no Chrome.
2. Ative o **"Modo do desenvolvedor"** no canto superior direito.
3. Clique em **"Carregar sem compactação"** e selecione a pasta `dist` deste repositório.
4. Abra o painel lateral do Chrome e use o **Paulifest Seller Copilot**!

---

## 📁 Estrutura do Projeto

```
Paulifest-Seller-Copilot/
├── dist/                          # Pacote compilado para o Chrome (ignorado no Git)
├── docs/
│   ├── AUDITORIA_AVANTPRO.md      # Relatório de engenharia reversa e benchmarking
│   └── ESPECIFICACAO_V1.md        # Especificação técnica e arquitetura de dados V1
├── public/
│   ├── icons/                     # Ícones oficiais (16, 32, 48 e 128px)
│   └── manifest.json              # Manifesto MV3
├── scripts/
│   └── generate_icons.py          # Gerador autoral dos assets visuais
├── src/
│   ├── background/                # Service Worker e Detecção de Contexto
│   ├── content-scripts/           # Observador leve de páginas
│   ├── core/
│   │   ├── engines/               # Motores de Precificação, EAN, Fact-or-Omit e Truth
│   │   ├── schema/                # Schemas canônicos da Ficha Central e Precificação
│   │   ├── services/              # Gateways de IA e Provedores de Pesquisa
│   │   └── storage/               # Camada de persistência local auditável
│   ├── sidepanel/                 # Aplicação React da Sidebar nativa
│   └── styles/                    # Design System Tailwind CSS e Apple Blur
├── tests/                         # Suíte de testes unitários (28 cenários)
└── package.json
```