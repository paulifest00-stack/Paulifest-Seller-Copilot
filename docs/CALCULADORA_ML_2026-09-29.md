# Calculadora Mercado Livre — 29/09/2026

## Entrega

A etapa Preço foi refeita em três blocos: produto/conta, preço/custos e resultado por unidade. A tela não utiliza mais o provedor simulado. Comissão e cotação de frete são consultadas pelo Gateway com as credenciais da conta conectada; falhas não acionam tabelas fictícias.

- Reconhece links de anúncios MLB na aba ativa e lê campos conhecidos do cadastro em andamento. Apresenta o produto detectado para o usuário aplicar à ficha, evitando misturar custos de produtos diferentes.
- Consulta dados do anúncio pela API e distingue anúncios próprios de concorrentes. Categoria/preço de concorrentes podem servir de referência; logística e frete alheios não são tratados como custos da loja conectada.
- Busca sugestões de categoria pelo nome usando o preditor do Mercado Livre, com escolha explícita.
- Consulta tarifa considerando categoria, preço, Clássico/Premium, modo de envio e logística. Quando o frete retorna peso faturável, ele é incluído na consulta de tarifa.
- Consulta o frete do vendedor inclusive quando free_shipping=false. Utiliza list_cost da resposta em BRL; não aplica novamente descontos que já estejam incorporados no valor retornado.
- Deduz sale_fee_amount uma única vez: a tarifa fixa já integra esse total.
- Custo e imposto ausentes não viram zero. Frete não retornado fica pendente; um valor informado pelo usuário é identificado como manual.
- Mostra cada dedução em reais, sobra e margem. A opção de lucro desejado consulta a API para cada preço candidato, com limite de tentativas e verificação do resultado. Não presume que a comissão seja linear em todas as faixas.
- Mudar custos locais recalcula sem nova chamada externa; mudar parâmetros tarifários invalida a cotação. Cotações expiram em cinco minutos e resultados de requisições antigas não sobrescrevem dados editados.
- Persiste o rascunho por ficha e registra a cotação e os custos usados ao aplicar o preço. Um kit novo não herda contexto/cotação do anúncio original.
- Publicação passa a iniciar com o tipo de anúncio, condição e opção de frete escolhidos na calculadora. Sua consulta de comissão também usa a nova rota contextual.

## O que “real” significa aqui

A comissão é o valor retornado pelo endpoint oficial para os parâmetros consultados. O frete é uma cotação oficial para publicação/edição, não uma garantia do débito final de uma venda. Conciliação posterior com pedidos, cobranças efetivas, campanhas, armazenagem Full e despesas não informadas não faz parte desta entrega. A tela explicita os limites e a data da consulta.

A detecção do formulário usa campos DOM conhecidos; ainda precisa ser homologada nas páginas reais usadas pela loja. Páginas de catálogo sem item_id não são confundidas com anúncios individuais. Se uma tela não expuser os dados necessários, o fluxo oferece código/link do anúncio e busca de categoria pelo nome.

## Ativação pendente

As variáveis ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI estão ausentes no .env local inspecionado. O estado dessas variáveis no servidor publicado não foi verificado. A usuária informou não saber se o aplicativo já está configurado.

1. Verificar no ambiente de hospedagem do Gateway se existe um aplicativo ML configurado e um callback HTTPS cadastrado.
2. Configurar as três variáveis no servidor: ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI, terminando em /auth/mercadolivre/callback. Segredo fica no servidor, nunca no pacote da extensão nem em mensagens.
3. Publicar o Gateway atualizado (build:gateway, start:gateway). As novas rotas pricing-context, pricing-categories e pricing-quote exigem a sessão autenticada existente.
4. Recarregar a extensão a partir de dist/, conectar Gateway/Bling, clicar Conectar Mercado Livre e concluir a autorização. Clicar Verificar conexão ao retornar.
5. Homologar um anúncio próprio: conferir categoria, modalidade, logística, embalagem e preço; comparar a cotação com o painel do vendedor. Repetir com um cadastro novo e conferir comportamento quando frete/categoria estiverem ausentes.

Nenhum deploy, autorização nova, publicação ou alteração de anúncio real foi feito nesta entrega.

## Validação

569 testes passaram, incluindo 17 verificações novas e ampliação da cobertura HTTP autenticada. TypeScript da extensão/Gateway/testes, builds, isolamento do pacote e git diff --check aprovados.

Verificação visual no navegador em contêiner de 390 px: consulta, deduções, edição de custo sem nova consulta, preço para lucro desejado e aplicação mantendo Premium. A fixture tests/fixtures/pricing-preview.html declara respostas simuladas e não entra no build da extensão. Ela testa a interface, não a conexão real.

O Windows bloqueou psql.exe nesta sessão. A suíte foi executada com o driver pg já instalado, verificando data_directory do cluster descartável antes de executar testes. O banco foi encerrado após o uso. O helper temporário ficou em .test-runtime/run-pricing-review.mjs.

## Referências e reaproveitamento

A referência local Avantpro foi consultada para entender o fluxo de detecção e exibição das deduções. A implementação usa código próprio e os endpoints oficiais, sem importar seus pacotes ou dependências de backend.

- [Custos por vender — parâmetros de tarifa e total já incluindo taxa fixa](https://developers.mercadolivre.com.br/pt_br/comissao-por-vender)
- [Custos de envio — cotação por vendedor e list_cost](https://developers.mercadolivre.com.br/pt_br/atributos/custos-de-envio)
- [Domínios e categorias — preditor por título](https://developers.mercadolivre.com.br/pt_br/categorias-e-publicacoes)

Shopee permanece fora desta entrega, conforme a prioridade de concluir primeiro o Mercado Livre.
