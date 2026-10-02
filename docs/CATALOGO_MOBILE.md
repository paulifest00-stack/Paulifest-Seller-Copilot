# Gateway para Scan & Fill

A extensão existente conserva seus endpoints. O catálogo mobile utiliza `/mobile/*` com a mesma autenticação GST, OAuth, criptografia e renovação coordenada do Gateway. `bootstrap` exige PostgreSQL e executa a nova migração automaticamente.

## Variáveis adicionais

```dotenv
GATEWAY_PUBLIC_URL=https://SEU_GATEWAY
GATEWAY_ALLOWED_WEB_ORIGINS=https://SEU_APP
```

A URL pública deve usar HTTPS; origens web são comparadas exatamente, sem wildcard. `GATEWAY_ALLOWED_EXTENSION_ORIGINS` continua necessário para a extensão. Nenhuma credencial deve entrar no frontend.

No Bling:
- Callback: `https://SEU_GATEWAY/auth/bling/callback`
- Webhooks: `https://SEU_GATEWAY/mobile/webhooks/bling`
- Escopos necessários: produtos (consultar/criar/alterar), categorias, depósitos/estoque, contatos, produtos fornecedores e dados básicos da empresa.

## Endpoints

| Rota | Uso |
|---|---|
| GET /mobile/products | query, cursor, limit, incompleteOnly |
| GET /mobile/products/:id | Ficha real, estoque físico e versão |
| GET /mobile/find?code=... | Busca exata por SKU/EAN |
| POST /mobile/products | Criar, com input e requestId |
| PATCH /mobile/products/:id | Editar com versão original |
| GET /mobile/categories | Categorias reais |
| GET /mobile/deposits | Depósitos ativos |
| GET /mobile/contacts?query=... | Contatos para vínculo de fornecedor |
| POST /mobile/images | Upload de data URL JPEG/PNG/WebP, até 2 MB |
| GET /mobile/images/:uuid | Foto pública com URL aleatória |
| POST /mobile/webhooks/bling | HMAC SHA256 do corpo original |
| GET /mobile/revision | Revisão de eventos da empresa autenticada |

Criação e alterações usam identificadores de operação persistidos. Repetir um resultado concluído devolve o resultado anterior. Repetir uma operação em andamento/incerta bloqueia uma segunda gravação. PostgreSQL advisory lock serializa mutações do catálogo para a mesma conexão/produto, mas não impede que outro aplicativo ou uma edição direta no Bling altere o produto entre leitura e PATCH.

Campos não editados não são encaminhados no PATCH. Pesos são kg, dimensões são convertidas para cm. Custo é gravado pelo recurso produtos fornecedores; estoque pelo recurso estoques com entrada/saída pela diferença do saldo físico total, usando depósitos ativos automaticamente. Erros depois de qualquer escrita pedem verificação de resultado parcial, sem retry automático da operação inteira.

As imagens são públicas por URL aleatória para acesso pelo Bling e persistidas como BYTEA. Para catálogos com grande volume de fotos, evoluir para object storage e definir retenção de imagens órfãs, eventos e operações. Nenhuma limpeza automática destrutiva foi adicionada.

Webhooks não armazenam o payload completo nem executam mutações. Apenas deduplicam eventId e contabilizam revisões por companyId; eventos fora de ordem não sobrescrevem o catálogo, pois a fonte segue sendo a API.

## Verificações desta rodada

`npm run test:mobile` compila o Gateway e executa testes focados com servidor HTTP Bling simulado e fake SQL repository. Não comprovam durabilidade ou concorrência real do PostgreSQL. Sem credenciais, publicação ou homologação na conta real. O teste de escopos, OAuth real, upload aceito pelo Bling, custo e estoque real deve ocorrer após configurar o servidor.

O `Dockerfile.gateway` fornece um empacotamento opcional para servidores que aceitem Docker. Sem Docker no ambiente desta rodada, a imagem não foi construída; o build TypeScript do Gateway foi verificado. Também é possível publicar com build `npm ci && npm run build:gateway` e start `npm run start:gateway`, configurando as variáveis no serviço de hospedagem.


## Simplificação do formulário
Custo consulta o registro padrão já existente em produtos/fornecedores, mesmo sem contato fornecedor nomeado. Se ele não existir, não cria um fornecedor fictício nem envia campos marcados readOnly pela API; devolve orientação para salvar o custo no Bling uma vez. Estoque calcula E/S pela diferença, com saídas distribuídas entre depósitos ativos para evitar saldo negativo. Resultados parciais continuam sem repetição automática.

## Descrição com IA
POST /mobile/description, autenticado com sessão Gateway, recebe fatos públicos do produto e retorna {description}. Configure OPENAI_API_KEY somente no servidor, opcional OPENAI_DESCRIPTION_MODEL (gpt-4.1-mini). Nenhum custo, saldo, fornecedor ou token Bling é transmitido ao provedor. A interface exibe a sugestão e só aplica após ação explícita; salvar o produto continua separado. Sem chave, retorna ai_not_configured. Não usa os créditos do Lovable.


## Categorias e Shopee
Sugestões pelo nome usam apenas categorias internas reais e nomes de vínculos já existentes. São sugestões por correspondência de palavras (incluindo alguns termos equivalentes), não classificações garantidas; o usuário escolhe antes de salvar.
O formulário consulta canais de venda ativos e categorias/lojas por conta. Ao selecionar a categoria interna, mostra o vínculo específico da loja (Shopee priorizada quando disponível). Para um primeiro vínculo, consulta anuncios/categorias pela integração e percorre a árvore. O servidor revalida o caminho e exige o último nível. A criação do vínculo é compartilhada por todos os produtos daquela categoria interna; a interface avisa esse alcance antes de confirmar. Não substitui vínculos existentes por inferência. Se a API do Bling rejeitar a árvore daquela integração, o primeiro vínculo precisa ser configurado no Bling; depois o catálogo consulta e usa o vínculo existente.
Campos customizados ativos do módulo Produtos são carregados conforme os agrupadores da categoria, quando a API disponibiliza o módulo e suas definições. Valores são salvos em camposCustomizados preservando idVinculo e os campos não alterados. Isto não cria automaticamente o mapeamento de atributos com a Shopee.
Descrição do formulário é gravada em descricaoCurta, exigida pelo fluxo Shopee. A descrição complementar existente é preservada; no primeiro salvamento, uma descrição complementar legada é aproveitada como descricaoCurta quando ela está vazia.
A revisão recolhida verifica os dados gerais publicados pelo Bling: nome, SKU, preço, peso bruto, dimensões até 70cm, descrição 10–5000 caracteres, imagem e categoria. Ela não certifica atributos da Shopee, vigência de categoria nem aprovação da exportação.
Escopos adicionais: canais de venda, categorias de lojas, anúncios/categorias e campos customizados (consulta), categorias de lojas (criação). Escopos ausentes exibem erro e não bloqueiam uma edição independente de preço/estoque.
Fontes: https://ajuda.bling.com.br/hc/pt-br/articles/360058302333-Categorias-da-Shopee e https://ajuda.bling.com.br/hc/pt-br/articles/4414423105815-Exporta%C3%A7%C3%A3o-de-produtos-para-a-Shopee .
