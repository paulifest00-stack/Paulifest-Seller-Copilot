# Visão do produto — Paulifest Seller Copilot

Atualização de 24/09/2026: o usuário pediu geração de números EAN-13 aleatórios com dígito verificador para vínculo. Esta orientação substitui a proibição de geração no texto original abaixo. A implementação distingue código gerado de GTIN registrado: gera número de circulação interna, preserva proveniência e revisão, e também preenche SKU vazio. Não promete aceitação como GTIN no ML. Consulte STATUS_ATUAL.md para limites.

Contexto fornecido pelo usuário em 23/09/2026. Descreve a visão completa, não uma lista de funcionalidades já entregues.

PROJETO: PAULIFEST SELLER COPILOT

Quero construir uma extensão Chrome chamada Paulifest Seller Copilot.

A ideia da extensão é funcionar como um copiloto inteligente para quem vende online e trabalha principalmente com:

- Bling ERP
- Mercado Livre

Ela não deve ser apenas um “conector” entre sistemas.

Ela deve ser uma ferramenta que acompanha o seller no dia a dia, entende qual produto ele está vendo, reúne e organiza os dados desse produto, ajuda a criar cadastros, ajuda a preparar anúncios, identifica problemas, calcula preços e, futuramente, executa ações no Bling e no Mercado Livre com confirmação do usuário.

O objetivo principal é reduzir ao máximo:

- ficar trocando de aba;
- ficar entrando e saindo de telas do Bling;
- copiar SKU manualmente;
- procurar EAN;
- procurar NCM;
- procurar custo;
- procurar estoque;
- copiar peso e dimensões;
- montar título manualmente;
- criar descrição do zero;
- fazer conta de precificação em planilha;
- descobrir depois que faltava alguma informação para anunciar.

A extensão deve funcionar como uma espécie de “central do produto”.

==================================================
1. IDEIA CENTRAL
==================================================

Quando estou trabalhando com um produto, quero que a extensão entenda:

“Qual produto é esse?”

e monte uma ficha central daquele item.

Essa ficha deve concentrar tudo que sabemos sobre o produto.

Exemplos:

- nome;
- título;
- SKU;
- EAN / GTIN;
- NCM;
- marca;
- modelo;
- descrição;
- categoria;
- peso;
- dimensões;
- custo;
- preço atual;
- preço sugerido;
- estoque;
- atributos;
- características;
- imagens;
- referências no Bling;
- referências no Mercado Livre;
- informações encontradas por pesquisa;
- informações sugeridas por IA.

Essa ficha central é a principal fonte de verdade da extensão.

Ela não deve simplesmente juntar dados e escolher um valor escondido.

A extensão precisa mostrar:

- de onde veio cada informação;
- se aquela informação é confiável;
- se está faltando;
- se existe conflito;
- se foi preenchida manualmente;
- se veio do Bling;
- se foi encontrada por pesquisa;
- se foi inferida pela IA.

==================================================
2. PRINCÍPIO MAIS IMPORTANTE: NÃO INVENTAR
==================================================

A extensão nunca deve inventar fatos para completar um cadastro.

Se não sabemos:

→ deixar como ausente.

Se duas fontes discordarem:

→ mostrar conflito.

Se a IA apenas inferiu:

→ deixar explícito que é uma sugestão/inferência.

Exemplo:

Se não sabemos o custo:

não mostrar R$ 0,00.

R$ 0,00 pode ser um custo real.

Então:

custo desconhecido = ausente

custo explicitamente zero = R$ 0,00 real.

Mesma ideia para estoque, peso, EAN, NCM etc.

==================================================
3. FLUXO 1 — CRIAR UM PRODUTO NOVO NO BLING
==================================================

Uma das funções principais da extensão deve ser ajudar na criação de produtos novos no Bling.

Exemplo:

Estou cadastrando um produto que ainda não existe no ERP.

A extensão deve me ajudar a montar esse cadastro.

Ela pode ajudar com:

- criação/sugestão do nome do produto;
- criação de um título organizado;
- geração de SKU;
- busca de EAN/GTIN real;
- validação do EAN encontrado;
- pesquisa de NCM;
- sugestão de NCM com evidência;
- marca;
- modelo;
- descrição;
- peso;
- dimensões;
- características;
- categoria;
- organização de atributos;
- identificação do que ainda está faltando.

SKU pode ser gerado pela própria extensão seguindo um padrão.

EAN/GTIN NÃO deve ser inventado.

Se o produto já possui um código real, devemos localizar e validar.

Se não houver um código válido, o sistema deve dizer que está ausente ou tratar como produto sem GTIN quando isso for aplicável.

NCM também não deve ser tratado como chute.

A extensão pode pesquisar fontes públicas, sugerir o NCM mais provável e mostrar a evidência, mas o usuário deve conseguir confirmar.

A experiência ideal seria algo assim:

PRODUTO IDENTIFICADO

Nome sugerido:
[Balão Metalizado Número 5 Dourado 40 Polegadas]

SKU sugerido:
[BAL-NUM5-DOU-40]

EAN:
[Não encontrado]

NCM sugerido:
[9503....]
Fonte: pesquisa / catálogo
Confiança: alta

Peso:
[ausente]

Dimensões:
[ausentes]

Descrição:
[gerar descrição]

E então a extensão vai me ajudando a completar o produto.

No futuro, depois da minha confirmação:

[CRIAR NO BLING]

==================================================
4. FLUXO 2 — PEGAR PRODUTO EXISTENTE NO BLING
==================================================

Outro fluxo principal:

Eu já tenho o produto cadastrado no Bling.

Abro a ficha dele.

A extensão identifica automaticamente qual produto estou visualizando.

Ela consulta o Bling e traz para o painel:

- nome;
- SKU;
- EAN;
- custo;
- estoque;
- preço;
- marca;
- peso;
- dimensões;
- descrição;
- outros dados disponíveis.

Quero evitar precisar navegar por várias telas do Bling só para descobrir informações.

Exemplo de visualização rápida:

Produto:
Caixa de Isopor 1kg

SKU:
CX-ISO-1KG

EAN:
789XXXXXXXXXX

Estoque disponível:
35 un

Estoque físico:
37 un

Custo:
R$ 8,42

Preço atual:
R$ 15,90

Esse Quick View deve ficar visível enquanto trabalho.

==================================================
5. FLUXO 3 — BLING → MERCADO LIVRE
==================================================

Esse é um dos fluxos mais importantes do produto.

Eu tenho um item no Bling e quero fazer um anúncio no Mercado Livre.

Hoje o processo normalmente exige:

- abrir Bling;
- pegar SKU;
- voltar ao Mercado Livre;
- voltar ao Bling;
- pegar EAN;
- voltar;
- pegar peso;
- voltar;
- pegar dimensões;
- pensar título;
- escrever descrição;
- calcular preço;
- verificar estoque;
- etc.

A extensão deve eliminar isso.

Quando o produto já estiver na ficha central, eu quero conseguir trabalhar no anúncio com tudo disponível no Sidepanel.

Ela deve trazer:

- SKU;
- EAN;
- título;
- marca;
- peso;
- dimensões;
- custo;
- estoque;
- descrição;
- imagens;
- demais atributos conhecidos.

E ainda ajudar a transformar aquele cadastro do Bling em um bom anúncio de marketplace.

==================================================
6. TÍTULO PARA MERCADO LIVRE
==================================================

A extensão deve ajudar a criar um título forte para o Mercado Livre.

Não simplesmente copiar o nome do Bling.

Exemplo:

Nome no Bling:

“Caixa Isopor 1kg”

Título sugerido para ML:

“Caixa Térmica de Isopor 1kg Conservação Alimentos Bebidas”

A IA pode gerar sugestões com base nos dados reais da ficha.

Ela também pode usar palavras-chave e informações relevantes quando disponíveis.

Mas não deve inventar características.

==================================================
7. DESCRIÇÃO DO PRODUTO
==================================================

A extensão também deve gerar uma descrição para o anúncio.

Ela deve usar os dados reais da ficha.

Exemplo:

- material;
- tamanho;
- capacidade;
- indicação de uso;
- conteúdo da embalagem;
- características;
- cuidados;
- informações técnicas.

Se algum dado não existir:

não inventar.

A descrição pode ser comercial e bem escrita, mas fatos técnicos precisam vir da ficha ou de pesquisa confiável.

==================================================
8. ATRIBUTOS DO MERCADO LIVRE
==================================================

No futuro, queremos que a extensão entenda:

“Para esta categoria do Mercado Livre, quais atributos são obrigatórios?”

E compare com o que já temos.

Exemplo:

Cadastro atual:

✅ Marca
✅ Modelo
✅ EAN
✅ Peso
✅ Dimensões
❌ Material
❌ Cor
⚠ Capacidade não confirmada

A extensão deve funcionar como um checklist inteligente.

Ela não apenas traz os dados.

Ela mostra o que ainda falta para conseguir anunciar bem.

==================================================
9. FICHA CENTRAL / CENTRAL PRODUCT SHEET
==================================================

A extensão deve possuir uma ficha central auditável do produto.

Essa ficha é o cérebro da aplicação.

Ela precisa distinguir dados de várias fontes.

Exemplo:

Título:
“Caixa Térmica Isopor 1kg”
Fonte: IA
Status: pendente de revisão

SKU:
CX-ISO-1KG
Fonte: usuário
Status: aprovado

EAN:
7891234567890
Fonte: Bling
Status: aprovado

NCM:
3923....
Fonte: pesquisa
Confiança: 82%
Status: pendente de revisão

Peso:
180 g
Fonte: Bling

Se Bling disser uma coisa e uma pesquisa disser outra:

não escolher escondido.

Mostrar conflito.

==================================================
10. CONFLITOS
==================================================

Exemplo:

Peso no Bling:
180 g

Peso encontrado em catálogo:
210 g

A extensão deve mostrar:

CONFLITO

Bling ERP:
180 g

Catálogo:
210 g

E eu escolho o valor correto.

Minha decisão deve ficar registrada como decisão manual.

O histórico não deve ser simplesmente apagado.

==================================================
11. CAMPOS AUSENTES
==================================================

A extensão deve ser muito boa em mostrar o que falta.

Exemplo:

Produto 74% completo

✅ Nome
✅ SKU
✅ Custo
✅ Estoque
✅ Peso
❌ EAN
❌ NCM
⚠ Dimensões precisam de revisão
⚠ Título ML ainda não aprovado

Assim o vendedor consegue rapidamente completar a ficha.

==================================================
12. IA COMO ASSISTENTE
==================================================

A IA pode ajudar em várias partes:

- identificar o produto;
- criar título;
- criar descrição;
- sugerir SKU;
- organizar atributos;
- procurar informações;
- sugerir NCM;
- encontrar possíveis EANs;
- interpretar embalagem/foto;
- identificar dados faltantes;
- sugerir categoria;
- ajudar com SEO do anúncio.

Mas a IA não deve funcionar como fonte absoluta.

Sempre que estiver inferindo algo:

mostrar como sugestão.

==================================================
13. PESQUISA NA INTERNET / CATÁLOGOS
==================================================

Uma função futura muito importante é pesquisa assistida.

Exemplo:

Produto:
Freegells Extra Forte 27,9g

A extensão pode pesquisar:

- fabricantes;
- distribuidores;
- catálogos;
- bancos públicos;
- lojas confiáveis;
- fontes oficiais quando houver.

E tentar encontrar:

- EAN;
- peso;
- dimensões;
- NCM;
- descrição oficial;
- marca;
- modelo;
- informações técnicas.

Resultado:

EAN encontrado:
789....

Fonte:
Fabricante X

Confiança:
Alta

[USAR NA FICHA]

==================================================
14. PRECIFICAÇÃO
==================================================

A extensão deve funcionar também como calculadora de preço.

Ela já possui a ideia de separar:

- custo do produto;
- preço atual;
- preço sugerido.

O preço de venda deve considerar coisas como:

- custo de aquisição;
- comissão do marketplace;
- tarifa fixa;
- frete;
- imposto;
- embalagem;
- outros custos operacionais;
- publicidade/Ads;
- outras deduções configuradas.

==================================================
15. CALCULADORA REVERSA DE LUCRO
==================================================

Uma das funções principais:

Eu não quero precisar descobrir manualmente qual preço colocar.

Quero poder dizer:

“Quero que sobrem R$ 20 de lucro.”

A extensão calcula:

Preço sugerido:
R$ 49,90

E mostra:

Preço de venda:
R$ 49,90

- Comissão ML:
R$ X

- Tarifa fixa:
R$ X

- Frete:
R$ X

- Impostos:
R$ X

- Custo do produto:
R$ X

- Embalagem:
R$ X

- Publicidade:
R$ X

= Lucro:
R$ 20,00

Nada deve ficar escondido.

==================================================
16. TAXAS DO MERCADO LIVRE
==================================================

No estágio final do produto, queremos consultar as taxas reais do Mercado Livre.

A calculadora deve saber:

- categoria;
- tipo de anúncio;
- comissão;
- tarifa fixa;
- condições de frete;
- custos aplicáveis.

Enquanto a integração real não estiver pronta:

qualquer resultado simulado deve aparecer claramente como:

ESTIMATIVA / SIMULAÇÃO.

Nunca como taxa oficial.

==================================================
17. QUICK VIEW
==================================================

Enquanto navego no Bling, quero informações rápidas sem abrir outras páginas.

Exemplo:

PAULIFEST COPILOT

Estoque:
35 disponível
37 físico

Custo:
R$ 8,42

Preço:
R$ 15,90

SKU:
CX-ISO-1KG

EAN:
789...

Isso economiza navegação.

==================================================
18. EDIÇÃO RÁPIDA NO BLING
==================================================

Futuramente também quero conseguir alterar informações do Bling diretamente pela extensão.

Principalmente:

estoque

e

preço de custo.

Exemplo:

Estoque atual:
37

Novo estoque:
[50]

Custo atual:
R$ 8,42

Novo custo:
[R$ 8,90]

[ATUALIZAR NO BLING]

Mas essas ações precisam ser seguras.

Nunca atualizar automaticamente sem eu saber.

Precisamos de:

- confirmação;
- dry-run quando possível;
- validação;
- auditoria;
- prevenção contra atualização acidental.

==================================================
19. PUBLICAÇÃO NO MERCADO LIVRE
==================================================

Objetivo futuro:

Depois que a ficha estiver completa e revisada:

[PREPARAR ANÚNCIO]

A extensão monta:

- título;
- descrição;
- categoria;
- atributos;
- SKU;
- GTIN;
- preço;
- estoque;
- imagens;
- condições comerciais.

Eu reviso.

Depois:

[PUBLICAR NO MERCADO LIVRE]

A publicação real só deve acontecer depois de confirmação.

==================================================
20. EDIÇÃO DE ANÚNCIOS EXISTENTES
==================================================

Também queremos suportar produtos que já estão anunciados.

Exemplo:

O anúncio já existe no ML.

A extensão pode mostrar:

Preço ML:
R$ 49,90

Preço calculado ideal:
R$ 54,90

Estoque Bling:
20

Estoque ML:
18

Título atual:
...

Título sugerido:
...

E então ajudar a revisar ou sincronizar.

==================================================
21. FLUXO INVERSO — EXTENSÃO → BLING → ML
==================================================

Nem todo produto precisa começar no Bling.

Podemos ter fluxo:

Tenho um produto novo.

A extensão pesquisa/identifica.

Monta a ficha.

Eu reviso.

→ cria no Bling.

Depois:

→ prepara anúncio ML.

Depois:

→ publica no ML.

Então a ficha central é independente das plataformas.

Bling e Mercado Livre são destinos/fontes conectados a ela.

==================================================
22. IMAGENS
==================================================

No futuro a extensão também pode ajudar com imagens.

Exemplo:

- verificar se a imagem tem boa qualidade;
- organizar imagens;
- sugerir ordem;
- criar fundo branco;
- adaptar para marketplace;
- gerar imagens complementares com IA quando adequado.

Mas sem falsificar características reais do produto.

==================================================
23. DETECÇÃO AUTOMÁTICA DA TELA
==================================================

A extensão deve entender onde eu estou.

Exemplo:

Estou na lista de produtos do Bling.

→ Quick View / ferramentas rápidas.

Estou editando produto.

→ ficha contextual.

Estou criando produto.

→ assistente de cadastro.

Estou no Mercado Livre criando anúncio.

→ assistente de anúncio.

Estou editando anúncio.

→ comparação e otimização.

Eu não quero ficar dizendo toda hora para a extensão qual produto estou trabalhando.

==================================================
24. SIDEPANEL COMO CENTRAL DE OPERAÇÃO
==================================================

A interface principal deve ser o Sidepanel do Chrome.

Ele acompanha a tela atual.

Ele funciona como meu copiloto enquanto uso Bling ou Mercado Livre.

Idealmente:

não abrir dezenas de popups.

O vendedor trabalha normalmente no site e a extensão fica do lado.

==================================================
25. AUTOMAÇÃO COM HUMANO NO CONTROLE
==================================================

A filosofia é:

automatizar o trabalho chato

sem esconder decisões importantes.

Pode automatizar:

- pesquisa;
- preenchimento;
- organização;
- cálculo;
- comparação;
- sugestão;
- importação;
- validação.

Mas ações importantes precisam ser explícitas.

Especialmente:

- alterar ERP;
- alterar estoque;
- alterar custo;
- publicar anúncio;
- editar anúncio.

==================================================
26. EXPERIÊNCIA IDEAL NO DIA A DIA
==================================================

Um exemplo completo:

Chegou um produto novo na loja.

Abro cadastro novo no Bling.

Copilot detecta.

Eu digito:

“Freegells Extra Forte 27,9g”

Ele pesquisa.

Encontra:

marca;
EAN;
possível NCM;
peso;
informações do fabricante.

Gera:

SKU.

Sugere:

nome de cadastro;
descrição.

Eu confirmo.

Produto criado no Bling.

Depois quero vender no Mercado Livre.

Abro o produto.

Copilot já sabe qual é.

A ficha já contém:

SKU
EAN
peso
NCM
custo
estoque
marca
descrição.

Ele verifica o que o Mercado Livre precisa.

Faltam dois atributos.

Eu completo.

Ele cria um título melhor.

Gera descrição.

Eu digo:

“Quero lucrar R$ 12 por unidade.”

Ele calcula o preço.

Mostra todas as deduções.

Eu reviso tudo.

Depois:

PUBLICAR.

Esse é o tipo de experiência que queremos.

==================================================
27. O QUE O PRODUTO NÃO DEVE VIRAR
==================================================

Não quero:

uma extensão cheia de telas técnicas.

Não quero:

um ERP novo dentro do navegador.

Não quero:

uma IA que inventa informação.

Não quero:

uma automação perigosa que altera tudo sozinha.

Não quero:

ter que preencher as mesmas coisas várias vezes.

Não quero:

ficar copiando informação entre Bling e Mercado Livre.

==================================================
28. DEFINIÇÃO FINAL DO PRODUTO
==================================================

A melhor definição até agora é:

O Paulifest Seller Copilot é um assistente inteligente de cadastro, enriquecimento, revisão, precificação e publicação de produtos entre Bling ERP e marketplaces, começando pelo Mercado Livre.

Ele transforma dados espalhados em uma ficha central auditável.

Ele ajuda o vendedor a:

IDENTIFICAR
→ PESQUISAR
→ CADASTRAR
→ IMPORTAR
→ ENRIQUECER
→ VALIDAR
→ REVISAR
→ PRECIFICAR
→ PREPARAR
→ SINCRONIZAR
→ PUBLICAR.

Sempre mantendo o vendedor no controle.

==================================================
29. PRINCÍPIOS QUE DEVEM GUIAR O DESENVOLVIMENTO
==================================================

1. Fact-or-Omit:
se não sabemos, não inventamos.

2. CentralProductSheet:
uma ficha central é a fonte de verdade.

3. Proveniência:
todo dado deve ter origem conhecida quando possível.

4. Conflito explícito:
fontes divergentes não são resolvidas escondido.

5. Humano soberano:
a decisão final é do usuário.

6. IA como copiloto:
não como fonte mágica de fatos.

7. Segurança:
tokens/segredos não vão para UI.

8. Automação segura:
mutações remotas precisam de confirmação.

9. Transparência financeira:
mostrar todas as deduções.

10. Reutilização:
informação encontrada uma vez deve acompanhar o produto durante todo o fluxo.

==================================================
30. OBJETIVO DE NEGÓCIO
==================================================

No final, quero conseguir cadastrar e anunciar produtos de forma muito mais rápida.

A extensão deve eliminar grande parte do trabalho repetitivo de seller.

Em vez de trabalhar assim:

Bling
→ planilha
→ Google
→ Bling
→ Mercado Livre
→ calculadora
→ Bling
→ Mercado Livre

quero trabalhar assim:

Bling / Mercado Livre
+
Paulifest Seller Copilot aberto ao lado.

A extensão traz contexto, pesquisa, dados, checklist, precificação e automação.

Eu apenas reviso e decido.

==================================================

Esse é o conceito completo do produto.

Ao trabalhar neste projeto, não reduza a ideia apenas a:
“integração Bling → Mercado Livre”.

É uma plataforma de assistência operacional para o ciclo completo de um produto:

do primeiro cadastro
até sua publicação e manutenção no marketplace.

O foco inicial é Bling + Mercado Livre, mas a arquitetura deve permitir futuramente adicionar outros marketplaces e fontes de dados sem reconstruir o produto inteiro.