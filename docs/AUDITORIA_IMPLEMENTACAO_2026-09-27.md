# Auditoria integral da implementação — 27/09/2026

## Conclusão

A extensão ainda não implementa integralmente o plano de unificação nem a visão completa do produto. Há uma base operacional de cadastro e preparação, integrações externas com código pronto para homologação e versões básicas das funcionalidades de mercado/imagem. O checklist anterior de UNIFICACAO.md não deve ser interpretado como conclusão das fases inteiras.

Esta auditoria compara o código atual do workspace, plano-unificacao.md v2, VISAO_DO_PRODUTO.md e a estrutura dos arquivos locais Avantpro ML 7.24.0. A Avantpro foi inspecionada estaticamente, sem executar seu código. As fases 1–5 do plano v2 remetem a um plano v1 não fornecido aqui; portanto não há base para declarar equivalência completa com todos os recursos da Avantpro.

Legenda: **Implementado** = caminho identificado no código, não garantia de homologação externa; **Parcial** = falta parte do comportamento previsto; **Ausente** = não foi localizado um fluxo correspondente na implementação inspecionada. Serviços externos exigem teste real separado.

## Cadastro, ficha e conteúdo

| Funcionalidade | Estado | O que existe / o que falta |
|---|---|---|
| Ficha central, origem dos dados e conflitos | Parcial com regressões | Schema e validação existem. O novo adaptador promove sugestões pendentes e reescreve campos ao preparar anúncio; precisa preservar revisão e edição manual. |
| Novo produto sem IA | Implementado | Entrada manual, SKU, revisão, preço e anúncio. |
| Rascunhos e retomada | Implementado | Persistência local, biblioteca, exclusão individual e total. Falta recuperação de excluídos e backup completo com imagens. |
| Identificação por foto/nome | Implementado; homologação pendente | Gemini com tratamento de erro e resultado estruturado; não confirmado nesta auditoria com a chave real. |
| Pesquisa de produto | Parcial | Busca com grounding e referências; não equivale a conectores completos de fabricantes/catálogos nem pesquisa estruturada de GTIN real. |
| Pipeline identificação → pesquisa → anúncio | Parcial | As etapas existem, mas não formam uma jornada única com recuperação por etapa; falha na pesquisa bloqueia geração completa. |
| Modo Bling econômico | Parcial | Gera descrição com menos chamadas. Não corresponde a um gerador separado de cadastro ERP completo como SCHEMA_BLING do plano. |
| Título, descrição e regeneração | Implementado com ressalvas | Edição, geração individual, cópia e prévia. Não há regeneração contextual de todo campo; adaptador pode sobrescrever texto personalizado. |
| Palavras-chave | Implementado | Três grupos clicáveis. São sugestões, não volume de pesquisa medido. |
| SKU pai/filho | Implementado | Regras, editor de blocos e matriz; edição automática deve preservar identificadores já usados externamente. |
| EAN em lote | Implementado com adaptação | Códigos internos com checksum e origem, por variação. Não equivale a obter GTIN registrado do produto. |
| NCM | Implementado; homologação pendente | Tabela oficial, hierarquia, pesquisa e sugestões. Existência do código e adequação ao produto são verificações distintas. |
| Kit | Parcial | Nova ficha, SKU/EAN, quantidade e custo proporcional. Não recalcula embalagem real nem regenera automaticamente todo o conteúdo e fotos. |
| Atualização de campos dependentes | Parcial com regressões | Novo adaptador mantém informações relacionadas, mas aprova pendências e pode transformar medidas ausentes em texto aparentemente confirmado. |

## Bling

| Funcionalidade | Estado | O que existe / o que falta |
|---|---|---|
| OAuth e sessão Bling | Implementado; confirmar ambiente ativo | Gateway, tokens protegidos e sessões. Não auditado ao vivo nesta rodada. |
| Detecção de página e produto | Implementado; homologação pendente | Observador SPA, vínculo de ficha e dock contextual. |
| Catálogo e importação | Implementado; homologação pendente | Busca, importação/reconciliação, atalho do produto aberto e preparação para ML. |
| Custo e estoque em consulta rápida | Implementado; homologação pendente | Leitura via API, Quick View e custo na listagem. Não representa edição desses valores. |
| Cadastro de novo produto | Parcial | Preenche campos do formulário Bling; usuário salva no ERP. Criação direta via API não implementada. |
| Atualizar cadastro existente | Parcial | PATCH revisado de campos permitidos; não inclui escrita de custo/estoque. |
| Fluxo extensão → Bling → ML | Parcial | Peças existem; falta validação integral e retorno confiável da identidade do novo cadastro para continuar o fluxo. |

## Mercado Livre, concorrência e métricas

| Funcionalidade | Estado | O que existe / o que falta |
|---|---|---|
| Ler buscas e anúncios ML | Parcial | Captura solicitada pelo painel dos itens carregados; depende de seletores e ainda requer validação no site real. |
| Interface dentro da página ML | Ausente | Content script ML instala leitor de dados, não cards, barra de ferramentas e painel contextual equivalentes à Avantpro. |
| Comparar concorrentes | Parcial | Cards no painel com preço, vendedor quando exibido, patrocinado, posição observada e CSV. Não é análise completa de vendedor/catálogo. |
| Ranking | Parcial | Posição na captura atual; não há rastreamento contínuo de posição por palavra-chave. |
| Histórico de mercado | Parcial | Histórico das capturas manuais; não monitora anúncios automaticamente. |
| Vendas, visitas, conversão e faturamento | Ausente como dashboard integrado | Leitura de texto de vendas visível não é série histórica ou métrica autenticada do vendedor. |
| Testes A/B | Parcial | Comparação de textos e CTR com contagens manuais. Sem execução de experimento, alternância ou coleta automática. |
| Alertas e monitoramento contínuo | Ausente | Não encontrado fluxo de acompanhamento agendado com notificação de mudança. |
| OAuth ML | Implementado; homologação pendente | Código no Gateway, dependente da sessão Gateway/Bling; ativação em produção não confirmada. |
| Categoria e atributos | Parcial | Consulta por ID de categoria digitado e atributos. Falta descoberta/guiamento integrado da categoria e checklist contextual completo. |
| Calculadora de preço/lucro | Parcial | Cálculos e simulação existem. Consulta de comissão oficial é separada; modalidade e comissão não são uma única configuração compartilhada. |
| Publicação ML | Parcial; homologação pendente | Upload, validação, revisão, criação simples, descrição e proteção contra duplicidade. Falta confirmação operacional em conta real. |
| Publicação de variações / multidepósito | Ausente | Não implementada; cenário warehouse_management é bloqueado. |
| Alteração de anúncio existente | Parcial | Leitura, preço e estoque simples. Sem editor remoto completo de título, descrição, atributos e imagens. |
| Sincronização Bling ↔ ML | Parcial | Ações pontuais; sem rotina contínua, reconciliação automática ou suporte completo a estoque compartilhado, Full e variações. |

## Imagens e apresentação

| Funcionalidade | Estado | O que existe / o que falta |
|---|---|---|
| Galeria, principal, aprovação e download | Implementado | Armazenamento local IndexedDB. Backup e limpeza de imagens órfãs ainda precisam de tratamento. |
| Sete propostas de imagem IA | Implementado; homologação pendente | Geração individual usando referência. Qualidade e fidelidade precisam ser conferidas com produtos reais. |
| Infográfico de objeções | Parcial | Planeja proporção A/B/C e seleciona fatos conhecidos; não pesquisa avaliações/perguntas reais de compradores como fluxo específico. |
| Editor de imagens | Parcial | Corte central quadrado, enquadramento, tamanho, compressão e preenchimento branco. Sem recorte livre/posicionável ou remoção determinística de fundo. |
| Verificação de qualidade das fotos | Parcial | Aprovação manual; sem diagnóstico completo de resolução, nitidez e adequação por destino. |
| Apresentação semelhante à Avantpro | Parcial no Bling, ausente no ML | Dock no Bling e editor lateral. Falta superfície ML contextual com informações junto aos resultados e visão ampliada. |
| Configuração e diagnóstico | Parcial | Conexões e chaves têm interface, mas falta um estado consolidado: navegador/serviço/chave/permissão/conta, com teste e ação de correção. |

## Problemas confirmados na revisão anterior desta sessão

- `prepareBlingSheetForMlExport`: marca e descrição pendentes tornam-se aprovadas; título manual é substituído pelo nome formatado do Bling.
- `adaptSheetToTechnicalChanges`: altura conhecida com largura/comprimento ausentes produz descrição aprovada contendo `10 cm x 0 cm x 0 cm`.
- StepSheet usa valores de substituição de 1 cm/0,1 kg ao apagar campos numéricos.
- Calculadora persiste modalidade, mas MlPublishPanel inicializa sempre gold_special.
- Exclusão de rascunhos remove registros sem lixeira/restauração.

## Direção visual confirmada pelo usuário

O usuário confirmou painéis e informações dentro das páginas do Mercado Livre e do Bling, botão flutuante melhor estruturado, compatível e sem atrapalhar os controles, interface intuitiva e manutenção do side panel. As superfícies devem compartilhar a mesma ficha e estado; o painel lateral continua sendo uma opção de trabalho, sem ser substituído pelos painéis contextuais.

A experiência semelhante à Avantpro exige mudar onde as informações aparecem, além das cores:

1. Na busca ML: barra compacta de análise e informações junto aos cards; exibir somente dados disponíveis, com origem e horário.
2. No anúncio ML: botão flutuante discreto, painel contextual recolhível e visão ampliada de produto/concorrência/histórico.
3. No Bling: preservar dock, custo/estoque e atalhos de ficha, evitando duplicar o formulário do ERP.
4. Editor completo: ficha, preço, conteúdo e imagens na mesma identidade visual, abrindo quando houver trabalho de edição.
5. Painéis precisam minimizar, fechar e preservar preferências sem cobrir compra, preço, navegação ou outros controles do site.

A inspeção estática da Avantpro encontrou popup, estilos/componentes de sidebar, modais, métricas e visão de catálogo com colunas para gráficos/vendedores. Não foi feita comparação visual executando a extensão de terceiros, nem se propõe copiar seus mecanismos de desbloqueio ou serviços privados.

## Ordem para completar a implementação

1. Corrigir revisão automática, preservação de edição e valores ausentes.
2. Implementar a camada contextual ML e consolidar apresentação/diagnóstico.
3. Homologar os caminhos reais: identificar → revisar → cadastrar/importar Bling → precificar → publicar ML → recuperar resultado.
4. Unificar categoria, modalidade, tarifas e configuração de publicação.
5. Completar edição remota e variações/estoque conforme os tipos de conta usados.
6. Completar análise de concorrentes, tracking, métricas e experimentos com dados disponíveis e origem explícita.
7. Ampliar editor de imagem, backup e recuperação.

O plano v2 é referência de funcionalidades, não comprovação de entrega. Recursos locais testados, transporte externo simulado e homologação em conta real devem permanecer em colunas separadas no acompanhamento.

## Primeira etapa aplicada — 27/09/2026

- Preparação para ML preserva textos e estados de revisão; sugestões não são mais aprovadas em lote, incluindo imagens.
- Título e descrição manuais permanecem intactos nas atualizações técnicas; SKU de ficha com vínculo externo é preservado.
- Especificações automáticas omitem fatos pendentes e dimensões incompletas. Apagar medidas marca ausência, sem preencher 1 cm ou 0,1 kg; medidas aceitam decimais.
- Dock do Bling redesenhado: fundo claro, hierarquia, custo/estoque destacados, orientação conforme lista/cadastro e acesso ao painel lateral. Inicia recolhido quando não há preferência salva; mantém arraste e recolhimento.
- Mercado Livre recebeu painel inicial recolhível de leitura explícita, resumo da página, troca de lado, ocultação e abertura do painel lateral. Ainda não inclui anotações junto a cada card, persistência de posição nem a análise completa prevista.
- Prévia local `contextual-preview.html` usa o componente real do Bling com dados fictícios. Aparência e mudança entre lista, novo e cadastro existente verificadas no navegador. Isso não substitui teste dentro do Bling real.
- Pendentes: redesenho das informações inline do Bling, dados junto aos cards ML, integração completa de preço/modalidade e demais lacunas deste inventário. Nenhuma fase ampla deve ser marcada como concluída por esta entrega inicial.

## Segunda etapa contextual — 27/09/2026

Após o usuário considerar a primeira mudança superficial, a interação dentro das páginas foi ampliada:

- **Cadastro Bling:** central inserida antes do formulário, nome do produto, presença dos campos visíveis, custo/estoque consultados, acesso direto aos campos e orientação da próxima ação. As contagens medem preenchimento, não validam prontidão fiscal ou de publicação. Dados de custo/estoque só aparecem quando o ID corresponde ao produto atual.
- **Lista Bling:** resumo das linhas carregadas, custos disponíveis versus ausentes, busca local por nome/SKU/ID, filtro de custo ausente e localização da linha na tabela. A consulta pendente não é tratada como custo ausente. A informação duplicada de custo junto ao preço foi removida; a coluna permanece.
- **Identificadores:** atalhos incorporados à central, preservando SKU preenchido e nome manual; código gerado é apresentado como interno, não como GTIN registrado.
- **Mercado Livre:** resumo inserido acima da busca/produto e informações junto aos cards, incluindo posição observada e diferença para a mediana dos anúncios lidos. Sem alegar ranking global, vendas ou faturamento não disponíveis.
- **Convivência:** superfícies em Shadow DOM, central recolhível, botão flutuante começa compacto quando a central é montada; side panel preservado.
- **Validação:** TypeScript, build de produção e suíte local com 542 testes aprovados; prévia interativa com os componentes reais e dados fictícios conferida em tela larga e estreita. Atalho para campo vazio, atualização ao editar e filtro de custo ausente verificados no navegador.
- **Limite:** implantação depende de recarregar a extensão compilada e as páginas. Ainda falta homologar inserção, seletores e abertura do side panel nas páginas reais das contas do usuário. As demais funcionalidades pendentes da auditoria continuam abertas.

## Integração natural e edição de custo — 28/09/2026

Orientação do usuário: retirar a central grande e integrar ações aos controles originais do Bling. Esta orientação substitui a apresentação da etapa anterior.

- A central grande deixou de ser instalada nas páginas do Bling; side panel e botão flutuante permanecem.
- Ações Gerar SKU e Gerar EAN interno aparecem sob os campos correspondentes, preservando valores já preenchidos e emitindo eventos nativos do formulário.
- A tabela de produtos ganhou editor de custo na própria célula: editar, salvar, cancelar, validação de moeda e retorno de confirmação. Cadastro existente recebe o mesmo editor perto do custo/preço.
- Mercado Livre: resumo compacto e informações discretas nos anúncios, removendo o cabeçalho grande e o fundo de card da extensão.
- Gravação de custo implementada na cadeia content script → background → gateway → recurso oficial produtos/fornecedores. O DTO fornecedor do produto é uma projeção somente leitura; a implementação utiliza GET/PUT do vínculo, preserva os demais campos documentados, verifica produto, compara o custo anterior e confirma o valor com nova leitura. Não inventa um fornecedor quando não há vínculo.
- Origem da mensagem, frame principal, documento, URL, produto e presença da linha são verificados. Escritas simultâneas do mesmo produto são bloqueadas na instância da extensão; falhas posteriores ao envio não são repetidas automaticamente. A comparação do valor anterior não substitui uma transação atômica do servidor Bling.
- Contrato público consultado: https://developer.bling.com.br/referencia e https://developer.bling.com.br/build/assets/openapi-BVqLYFZn.json (28/09/2026).
- Validação: TypeScript da extensão, gateway e testes; builds de ambos; suíte local com 551 testes aprovados, incluindo custo zero, valor ausente, preservação de dados do fornecedor, vínculo incorreto, mudança concorrente, mensagem não autorizada e resposta incerta após PUT.
- UI verificada na prévia com dados fictícios: geração de SKU junto ao campo, edição de custo existente e inclusão de custo ausente na tabela. A prévia não envia dados ao Bling.
- Implantação pendente: recarregar extensão compilada, publicar a atualização do gateway e homologar na conta real. Alterações no serviço publicado não foram realizadas nesta etapa. O endpoint de fornecedores pode exigir permissões correspondentes no aplicativo Bling; erros são exibidos sem declarar sucesso.


### Correção de custo e controles — 28/09/2026

- Confirmado: produção estava em `b88588f`, sem suporte a `costUpdate`. A interface local sozinha não habilitava a gravação.
- Correção isolada publicada no repositório: `4923bb2`, somente cliente Bling, contrato de custo, validador e invalidação de cache. Demais alterações locais preservadas.
- O health da nova versão anuncia `bling-cost-update-v1`, para distinguir deploy ativo de código apenas enviado.
- Botões de SKU/EAN e custo receberam borda, foco, estados de edição e mensagens de resultado. Resposta ausente agora apresenta erro, sem sucesso falso.
- A gravação usa o vínculo produto/fornecedor e reconfirma o custo pela API; exige vínculo existente. Produto sem vínculo recebe instrução explícita.
- 551 testes passaram; gateway isolado compilado. Gravação em conta real ainda não homologada nesta sessão, pois só a prévia local está acessível ao navegador conectado.
