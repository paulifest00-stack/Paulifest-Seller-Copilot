# Estado atual — 24/09/2026

A visão integral está em [VISAO_DO_PRODUTO.md](VISAO_DO_PRODUTO.md). O produto cobre o ciclo completo de assistência ao seller, começando por Bling e Mercado Livre. Este relatório descreve o checkout local, não uma implantação publicada.

## Implementado no código

- Extensão MV3, Sidepanel React, detecção contextual no Bling e ficha central com proveniência, estados de revisão e conflitos.
- Gateway separado com OAuth Bling, sessões, persistência PostgreSQL e leitura/importação de produtos.
- Quick View de custo e estoque; precificação por margem e lucro desejado; integração de identificação/conteúdo com IA.
- Mudanças locais anteriores a esta revisão: SKU automático, título específico do Bling, assistente de formulário, custo na listagem e atualização parcial de produtos existentes com confirmação.

Essas mudanças locais não foram publicadas ou homologadas ao vivo nesta rodada.

## Ajuste solicitado: gerar códigos EAN-13

O usuário esclareceu em 24/09/2026 que deseja geração aleatória, não apenas validação. Implementado botão Gerar EAN-13 na entrada, revisão da ficha e assistente do formulário Bling.

- Geração aleatória com Web Crypto, 13 dígitos e checksum módulo 10, usando prefixo 20 para circulação interna.
- A validade garantida é matemática; não há registro GS1 nem garantia de aceitação pelo Mercado Livre como GTIN.
- Um código existente é preservado. Na ficha, o código fica persistido com origem explícita e pendente de revisão; a aprovação permite incluí-lo na atualização confirmada do Bling.
- Atualização de 24/09: EAN e SKU agora são independentes, conforme o padrão pai/filho solicitado. Gerar EAN preserva o SKU, inclusive vazio.
- Código gerado não é enviado à IA/pesquisa como evidência de identidade de catálogo.
- Cinco testes novos passaram: checksum, aplicação/revisão, preservação, persistência e isolamento da identificação.
- Não existe ainda publicação/sincronização real no ML nem verificação de unicidade contra todo o catálogo remoto. Geração aleatória não é garantia global de exclusividade.

Referências: [identificadores ML](https://developers.mercadolivre.com.br/pt_br/identificadores-de-produtos), [SKU na publicação](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos), [prefixos internos GS1](https://www.gs1.org/docs/barcodes/SummaryOfGS1MOPrefixes20-29.pdf).

## Correções desta revisão

1. O envio ao Bling aceita apenas campos aprovados ou editados. Sugestões pendentes não são promovidas silenciosamente a dados do ERP.
2. A confirmação mostra valores e unidades; alterações da ficha ou do contexto exigem nova revisão. O Background compara o conteúdo confirmado com o conteúdo persistido antes de enviar.
3. Erros inesperados na confirmação deixam de manter o botão preso em carregamento.
4. O Gateway valida tipo, formato e dígito verificador do GTIN antes da requisição externa. Validade matemática não comprova que o GTIN pertence ao produto.
5. Testes isolados do arquivo .env de produção: duas falhas de URL desapareceram após essa correção.
6. O runner prossegue para as demais suítes após uma exceção, mas mantém saída de falha. Testes destrutivos exigem banco local chamado paulifest_test.
7. A checagem TypeScript de testes passou a abranger também atualização Bling, SKU e injetor de custo.

Contrato PATCH e resposta 200 conferidos na [especificação oficial do Bling](https://developer.bling.com.br/build/assets/openapi-BVqLYFZn.json), rota /produtos/{idProduto}. Nenhuma atualização de produto real foi executada.

## Correções de IA, conteúdo e cadastro novo (24/09/2026)

- Usuária relatou HTTP 400 no Gemini. O transporte agora informa a mensagem do Google, sem expor a chave, e orienta em erros de chave, permissão, modelo e cota. Usa cabeçalho x-goog-api-key, MIME correto da imagem, timeout e leitura de respostas divididas/bloqueadas.
- Modelo atualizado de gemini-2.0-flash para gemini-3.5-flash-lite. [Calendário oficial do Google](https://ai.google.dev/gemini-api/docs/deprecations). Adicionada permissão para generativelanguage.googleapis.com no manifest. Salvar a chave não é apresentado como validação da conexão.
- Na Ficha: geração de descrição em texto simples, edição, cópia e aprovação; botão de otimização de título para até 60 caracteres sem cortar palavras. IA usa fatos da ficha e resultados ficam pendentes de revisão. Respostas antigas não sobrescrevem edição ou outro produto.
- Importação prioriza a descrição complementar completa do Bling quando disponível, com proveniência correspondente.
- Iniciar Novo Produto espera a persistência antes de vincular a ficha; rascunho vazio permanece aberto e eventos repetidos da mesma tela nova não desfazem o vínculo. Troca de documento continua limpando o vínculo. Entrada não exige CMV para abrir a ficha.
- Dock em cadastro novo abre/cria rascunho local sem ID remoto. Ficha mostra prévia de nome, SKU, EAN, marca e descrição aprovados/editados e permite preencher campos vazios visíveis no cadastro aberto. Campos ocupados ou não encontrados são informados, e o usuário salva pelo próprio Bling. Não há POST automático criando produto.
- Assistente do formulário tem Gerar SKU e Gerar EAN-13; removido Conferir dígito.

## Evidências de validação

- Suíte local completa: 484 testes aprovados, zero falhas, com PostgreSQL descartável paulifest_test em loopback. Inclui 12 regressões de IA e cadastro novo.
- scripts/test-local.ps1 prepara/usa o cluster portátil em .test-runtime e o encerra após a execução. Não usa o banco de produção.
- TypeScript da extensão e testes, build da extensão/content script e isolamento do pacote: aprovados.
- Interface compilada conferida no navegador local: Iniciar Novo Produto, avançar sem custo, descrição editável, aprovação e mensagem de chave ausente.
- A chave real da usuária não foi utilizada. O retorno HTTP 400 exato ainda precisa ser retestado na conta; os cenários HTTP foram testados com respostas controladas.
- Chrome autenticado/Bling real não está acessível pelo navegador disponível nesta rodada. Preenchimento do formulário foi testado com DOM controlado, preservação de campos e rejeição de navegação concorrente. Não houve cadastro ou alteração remota.

## Próxima sequência

1. Recarregar a extensão a partir de dist no Chrome e atualizar a página do Bling para carregar o novo content script e a permissão Gemini.
2. Com a chave já configurada, gerar título/descrição e conferir a resposta real do Google. Em caso de falha, a mensagem detalhada identifica a causa sem mostrar a chave.
3. Abrir Incluir cadastro no Bling, criar a ficha, revisar valores, preencher e salvar um produto de teste no ERP. Confirmar os seletores reais, inclusive eventual editor rico de descrição; campos não suportados podem ser copiados da ficha.
4. Finalizar publicação/sincronização real do Mercado Livre e substituir pesquisa/taxas simuladas por integrações reais.

## Ainda pendente na visão do produto

- Pesquisa real de EAN e dados de fabricantes/catálogos. NCM já possui consulta da tabela oficial e sugestões para revisão; classificação definitiva continua humana.
- Taxas reais do Mercado Livre (as atuais continuam simulação).
- Checklist de atributos conectado à categoria real do ML.
- Homologação do preenchimento assistido e salvamento de produto novo no Bling real; criação direta via API ainda não implementada.
- Edição segura de custo e estoque; a whitelist atual de atualização não inclui esses campos.
- Preparação/publicação/edição de anúncios no ML e manutenção entre canais.
- Tratamento de imagens.

Apenas marcar como concluída uma etapa com evidência correspondente; não confundir mocks, testes locais, build ou código presente com homologação real.

## Nome, SKU, NCM e interface — ajustes posteriores de 24/09

- Nome no Bling curto e em maiúsculas, separado do título ML; prompt de IA, entrada, revisão, importação e preenchimento refletem essa distinção.
- SKU pai/filho conforme [SKU_PADRAO.md](SKU_PADRAO.md), com blocos ajustáveis. Os 11 exemplos de nomes/variações da usuária estão cobertos por teste.
- Descrição não exige aprovar o nome antes de gerar. Nome pendente da IA pode alimentar o rascunho; atributos conflitantes ou não revisados continuam fora do contexto.
- NCM: download público oficial Siscomex, filtro de vigência e código de 8 dígitos, hierarquia completa para descrições como Outros. Com chave, IA propõe até três códigos, aceitos apenas se encontrados na tabela; sem chave, busca textual. Nenhuma sugestão é aprovada automaticamente. NCM aprovado pode preencher o novo cadastro.
- Endpoint oficial acessado com sucesso nesta rodada. Testes cobrem tabela inválida, datas, hierarquia e rejeição de códigos inventados. A prévia HTTP local não conseguiu acessar o endpoint pelo navegador; consulta na extensão exige recarregar a nova permissão de host e ainda requer conferência no Chrome real.
- Interface: detalhes técnicos e auditoria recolhidos, removidos textos de fases e dicas técnicas, botão Aprovar identificável, código pai/variação com ajustes sob demanda.
- 484 testes aprovados na suíte completa. Interface compilada conferida com entrada em minúsculas e SKU POPTPC150-AZ. Geração Gemini com chave real continua pendente de teste na conta da usuária.
