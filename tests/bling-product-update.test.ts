import { parseCostInput, parseStockInput } from '../src/shared/cost.ts';
import assert from 'node:assert/strict';
import { createAuditedField, createInitialSheet } from '../src/core/schema/product.ts';
import { buildBlingProductUpdatePatch, BlingSheetPatchError } from '../src/integrations/bling/sheet-to-bling-patch.ts';
import { BlingProductClient } from '../src/gateway/integrations/bling/bling-product-client.ts';
import { GatewayClient, GatewayProductError } from '../src/background/gateway-client.ts';
import { MessageRouter } from '../src/background/message-router.ts';
import { tabContextManager } from '../src/background/tab-context-manager.ts';
import { saveSheet } from '../src/core/storage/storage.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function gatewayStorage() {
  const values = new Map<string, any>();
  return {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: unknown) => { values.set(key, value); },
    remove: async (key: string) => { values.delete(key); }
  };
}

async function run(name: string, fn: () => Promise<void> | void) {
  const oldChrome = (globalThis as any).chrome;
  const oldFetch = globalThis.fetch;
  try {
    await tabContextManager.clearAll();
    await fn();
    console.log('  ✓ PASS: ' + name);
  } catch (error) {
    console.error('  ✗ FAIL: ' + name);
    console.error(error);
    process.exitCode = 1;
  } finally {
    (globalThis as any).chrome = oldChrome;
    globalThis.fetch = oldFetch;
  }
}

async function setupRouter() {
  const values = new Map<string, any>();
  const local = {
    get: async (key: string) => ({ [key]: structuredClone(values.get(key)) }),
    set: async (items: Record<string, unknown>) => { for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value)); },
    remove: async (key: string) => { values.delete(key); }
  };
  (globalThis as any).chrome = {
    runtime: { id: 'extension-id', getURL: (path: string) => `chrome-extension://extension-id/${path}`, lastError: undefined },
    tabs: { query: async () => [{ id: 900 }] },
    storage: { local }
  };
  const sheet = createInitialSheet();
  sheet.titleBling = createAuditedField('Cafeteira Elétrica 220V', 'user_manual', 1, 'edited');
  sheet.sku = createAuditedField('CAF-220V', 'user_manual', 1, 'approved');
  sheet.ean = createAuditedField('7894900011517', 'user_manual', 1, 'approved');
  await saveSheet(sheet);
  const state = await tabContextManager.registerOrUpdateTab(900, {
    platform: 'bling', pageType: 'product_form_edit', pageInstanceId: 'document-A',
    detectedProduct: { id: '123' }, activeSheetId: sheet.id,
    url: 'https://www.bling.com.br/produtos.php#edit/123'
  });
  const client = new GatewayClient();
  let calls = 0;
  client.updateBlingProduct = async (id, patch) => {
    calls++;
    return { ok: true, productId: id, updatedFields: Object.keys(patch) as any, retrievedAt: new Date().toISOString() };
  };
  const router = new MessageRouter(client);
  const request = () => new Promise<any>(resolve => {
    void router.handleMessage({
      type: 'BLING_UPDATE_PRODUCT', tabId: 900, pageInstanceId: state.pageInstanceId,
      contextRevision: state.contextRevision, productId: '123', sheetId: sheet.id, confirmed: true, confirmedPatch: JSON.stringify(buildBlingProductUpdatePatch(sheet))
    }, { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html' }, resolve);
  });
  return { sheet, state, client, router, local, request, calls: () => calls };
}

export async function runBlingProductUpdateTests() {
  await run('Custo: moeda brasileira, zero e entradas inválidas', () => {
    assert.equal(parseCostInput('1.234,56'),1234.56);assert.equal(parseCostInput('12.50'),12.5);assert.equal(parseCostInput('0'),0);
    for(const invalid of ['', ' ', '-1', 'NaN', '1.2,3', '10,123', 'Infinity', '1e3'])assert.equal(parseCostInput(invalid),null);
  });
  await run('Custo: grava no vínculo correto preservando compra e fornecedor, confirma leitura', async () => {
    const calls:any[]=[];let cost=5;
    globalThis.fetch=async(url,init)=>{
      calls.push({url:String(url),init});
      if(init?.method==='PUT'){cost=JSON.parse(String(init.body)).precoCusto;return new Response('{}');}
      return new Response(JSON.stringify({data:String(url).endsWith('/produtos/123')?{id:123,fornecedor:{id:456}}:{id:456,produto:{id:123},fornecedor:{id:789},descricao:'Copo',codigo:'FORN-COP',precoCompra:4,precoCusto:cost,padrao:true,garantia:3}}));
    };
    const result=await new BlingProductClient().updateProduct('123',{costUpdate:{value:0,expected:5}},'token-test');
    const write=calls.find(c=>c.init.method==='PUT');
    assert.ok(write.url.endsWith('/produtos/fornecedores/456'));
    assert.deepEqual(JSON.parse(write.init.body),{descricao:'Copo',codigo:'FORN-COP',precoCompra:4,padrao:true,produto:{id:123},fornecedor:{id:789},garantia:3,precoCusto:0});
    assert.deepEqual(result.updatedFields,['costUpdate']);assert.equal(calls.length,4);
  });
  await run('Custo: cria vínculo em produtos/fornecedores quando fornecedor.id é 0 e supplierId é informado', async () => {
    const calls:any[]=[];let createdCost=0;
    globalThis.fetch=async(url,init)=>{
      calls.push({url:String(url),init});
      if(init?.method==='POST'){createdCost=JSON.parse(String(init.body)).precoCusto;return new Response(JSON.stringify({data:{id:555}}));}
      if(String(url).endsWith('/produtos/123'))return new Response(JSON.stringify({data:{id:123,fornecedor:{id:0,precoCusto:0}}}));
      return new Response(JSON.stringify({data:{id:555,produto:{id:123},fornecedor:{id:789},precoCusto:createdCost}}));
    };
    const result=await new BlingProductClient().updateProduct('123',{costUpdate:{value:18.5,expected:0,supplierId:'789'}},'token-test');
    const post=calls.find(c=>c.init?.method==='POST');
    assert.ok(post.url.endsWith('/produtos/fornecedores'));
    assert.deepEqual(JSON.parse(post.init.body),{produto:{id:123},fornecedor:{id:789},precoCusto:18.5,precoCompra:18.5,padrao:true});
    assert.deepEqual(result.updatedFields,['costUpdate']);
  });
  await run('Custo: alteração concorrente e vínculo errado não provocam escrita', async () => {
    for(const data of [{id:456,produto:{id:123},precoCusto:8},{id:456,produto:{id:999},precoCusto:5}]){
      let writes=0;
      globalThis.fetch=async(url,init)=>{if(init?.method==='PUT')writes++;return new Response(JSON.stringify({data:String(url).endsWith('/produtos/123')?{id:123,fornecedor:{id:456}}:data}));};
      await assert.rejects(new BlingProductClient().updateProduct('123',{costUpdate:{value:12,expected:5}},'token-test'));
      assert.equal(writes,0);
    }
  });
  await run('Custo: sem fornecedor não inventa vínculo, valor inválido não chega à rede', async () => {
    let calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({data:{id:123}}));};
    await assert.rejects(new BlingProductClient().updateProduct('123',{costUpdate:{value:12,expected:null}},'token-test'),/fornecedor/);assert.equal(calls,1);
    for(const value of [NaN,-1,Infinity,1.001])await assert.rejects(new BlingProductClient().updateProduct('123',{costUpdate:{value,expected:null}},'token-test'));
    assert.equal(calls,1);
  });
  await run('Custo: falha depois de enviar PUT não repete gravação', async () => {
    let writes=0;
    globalThis.fetch=async(url,init)=>{if(init?.method==='PUT'){writes++;throw new Error('network');}return new Response(JSON.stringify({data:String(url).endsWith('/produtos/123')?{id:123,fornecedor:{id:456}}:{id:456,produto:{id:123},precoCusto:5}}));};
    await assert.rejects(new BlingProductClient().updateProduct('123',{costUpdate:{value:12,expected:5}},'token-test'),/confirmar/);assert.equal(writes,1);
  });
  await run('Custo: remetente estrangeiro, iframe e documento antigo bloqueados', async () => {
    const env=await setupRouter();
    const message={type:'BLING_UPDATE_COST',productId:'123',pageInstanceId:env.state.pageInstanceId,expectedUrl:env.state.url,value:12,expected:5,confirmed:true};
    for(const sender of [{id:'other',frameId:0,url:env.state.url,tab:{id:900}},{id:'extension-id',frameId:1,url:env.state.url,tab:{id:900}}]){
      const response=await new Promise<any>(resolve=>env.router.handleMessage(message,sender as any,resolve));assert.equal(response.ok,false);
    }
    const response=await new Promise<any>(resolve=>env.router.handleMessage({...message,pageInstanceId:'old'},{id:'extension-id',frameId:0,url:env.state.url,tab:{id:900}} as any,resolve));
    assert.equal(response.ok,false);assert.equal(env.calls(),0);
  });
  await run('Custo: linha não comprovada pelo documento bloqueia gravação', async () => {
    const env=await setupRouter();(globalThis as any).chrome.tabs.sendMessage=async()=>({ok:false});
    const response=await new Promise<any>(resolve=>env.router.handleMessage({type:'BLING_UPDATE_COST',productId:'123',pageInstanceId:env.state.pageInstanceId,expectedUrl:env.state.url,value:12,expected:5,confirmed:true},{id:'extension-id',frameId:0,url:env.state.url,tab:{id:900}} as any,resolve));
    assert.equal(response.ok,false);assert.equal(env.calls(),0);
  });

  await run('Custo: origem e produto comprovados enviam somente o custo confirmado', async () => {
    const env=await setupRouter();
    await tabContextManager.registerOrUpdateTab(900,{platform:'bling',pageType:'product_list',pageInstanceId:'document-A',url:'https://www.bling.com.br/produtos.php'});
    (globalThis as any).chrome.tabs.sendMessage=async()=>({ok:true});
    let patch:any;env.client.updateBlingProduct=async(id,body)=>{patch=body;return {ok:true,productId:id,updatedFields:['costUpdate'],retrievedAt:'now'};};
    const response=await new Promise<any>(resolve=>env.router.handleMessage({type:'BLING_UPDATE_COST',productId:'123',pageInstanceId:'document-A',expectedUrl:'https://www.bling.com.br/produtos.php',value:0,expected:null,confirmed:true},{id:'extension-id',frameId:0,url:'https://www.bling.com.br/produtos.php',tab:{id:900}} as any,resolve));
    assert.equal(response.ok,true);assert.equal(response.cost,0);assert.deepEqual(patch,{costUpdate:{value:0,expected:null}});
  });
  await run('Custo: 401 na confirmação após PUT não permite repetição automática', async () => {
    let writes=0;
    globalThis.fetch=async(url,init)=>{
      if(init?.method==='PUT'){writes++;return new Response('{}');}
      if(writes)return new Response('{}',{status:401});
      return new Response(JSON.stringify({data:String(url).endsWith('/produtos/123')?{id:123,fornecedor:{id:456}}:{id:456,produto:{id:123},precoCusto:5}}));
    };
    await assert.rejects(new BlingProductClient().updateProduct('123',{costUpdate:{value:12,expected:5}},'token-test'),(error:any)=>error.code==='COST_WRITE_UNCONFIRMED'&&error.status!==401);
    assert.equal(writes,1);
  });
  await run('Estoque: parseStockInput valida inteiros/decimais e BLING_UPDATE_STOCK lança Entrada (+delta) ou Saída (-delta)', async () => {
    assert.equal(parseStockInput('15'), 15);
    assert.equal(parseStockInput('10,5 un'), 10.5);
    assert.equal(parseStockInput('-3'), null);

    let currentSimulatedStock = 5;
    let postPayload: any = null;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (init?.method === 'POST' && u.endsWith('/estoques')) {
        postPayload = JSON.parse(String(init.body));
        if (postPayload.operacao === 'E') currentSimulatedStock += postPayload.quantidade;
        if (postPayload.operacao === 'S') currentSimulatedStock -= postPayload.quantidade;
        return new Response(JSON.stringify({ data: { id: 999 } }), { status: 201 });
      }
      if (u.includes('/estoques/saldos')) {
        return new Response(JSON.stringify({
          data: [{
            produto: { id: 123 },
            saldoFisicoTotal: currentSimulatedStock,
            saldoVirtualTotal: currentSimulatedStock,
            depositos: [{ id: 777, saldoFisico: currentSimulatedStock, saldoVirtual: currentSimulatedStock }]
          }]
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    // Caso 1: Estoque estava 5 e editou para 10 -> Lançamento de Entrada ('E') de quantidade 5
    const resEntrada = await new BlingProductClient({ baseUrl: 'https://api.bling.test/Api/v3' }).updateProduct('123', { stockUpdate: { value: 10, expected: 5 } }, 'token-test');
    assert.equal(resEntrada.ok, true);
    assert.deepEqual(postPayload, {
      produto: { id: 123 },
      deposito: { id: 777 },
      operacao: 'E',
      quantidade: 5,
      observacoes: 'Entrada de +5 un (5 -> 10) via Paulifest Seller Copilot'
    });
    assert.equal(currentSimulatedStock, 10);

    // Caso 2: Estoque estava 5 e editou para 2 -> Lançamento de Saída ('S') de quantidade 3
    currentSimulatedStock = 5;
    const resSaida = await new BlingProductClient({ baseUrl: 'https://api.bling.test/Api/v3' }).updateProduct('123', { stockUpdate: { value: 2, expected: 5 } }, 'token-test');
    assert.equal(resSaida.ok, true);
    assert.deepEqual(postPayload, {
      produto: { id: 123 },
      deposito: { id: 777 },
      operacao: 'S',
      quantidade: 3,
      observacoes: 'Saída de 3 un (5 -> 2) via Paulifest Seller Copilot'
    });
    assert.equal(currentSimulatedStock, 2);

    const env = await setupRouter();
    await tabContextManager.registerOrUpdateTab(900, { url: 'https://www.bling.com.br/produtos.php', domain: 'www.bling.com.br', pageType: 'product_list', isSupported: true, pageInstanceId: 'document-A' });
    (globalThis as any).chrome.tabs.sendMessage = async () => ({ ok: true });
    let gatewayPatch: any;
    env.client.updateBlingProduct = async (id, body) => {
      gatewayPatch = body;
      return { ok: true, productId: id, updatedFields: ['stockUpdate'], retrievedAt: 'now' };
    };
    const routerRes = await new Promise<any>(resolve => env.router.handleMessage(
      { type: 'BLING_UPDATE_STOCK', productId: '123', pageInstanceId: 'document-A', expectedUrl: 'https://www.bling.com.br/produtos.php', value: 10, expected: 5, confirmed: true },
      { id: 'extension-id', frameId: 0, url: 'https://www.bling.com.br/produtos.php', tab: { id: 900 } } as any,
      resolve
    ));
    assert.equal(routerRes.ok, true);
    assert.equal(routerRes.stock, 10);
    assert.deepEqual(gatewayPatch, { stockUpdate: { value: 10, expected: 5 } });
  });
  await run('Bling write: Fact-or-Omit preserva edição manual e omite ausentes', () => {
    const sheet = createInitialSheet();
    sheet.titleBling = createAuditedField('  Título final  ', 'user_manual', 1, 'edited');
    sheet.sku = createAuditedField('SKU-FINAL', 'user_manual', 1, 'approved');
    sheet.costPrice = createAuditedField(42, 'user_manual', 1, 'approved');
    const patch = buildBlingProductUpdatePatch(sheet);
    assert.deepEqual(patch, { nome: 'TÍTULO FINAL', codigo: 'SKU-FINAL' });
    assert.equal('costPrice' in patch, false);
  });

  await run('Bling write: sugestões pendentes não são enviadas antes da revisão', () => {
    const sheet = createInitialSheet();
    sheet.sku = createAuditedField('SKU-APROVADO');
    sheet.titleBling = createAuditedField('Sugestão', 'ai_generated', 0.9, 'pending_review');
    sheet.ncm = createAuditedField('12345678', 'ai_generated', 0.9, 'pending_review');
    sheet.suggestedSalePrice = createAuditedField(49.9, 'rule_engine', 1, 'pending_review');
    assert.deepEqual(buildBlingProductUpdatePatch(sheet), {
      codigo: 'SKU-APROVADO'
    });
  });

  await run('Bling write: alteração da ficha após revisão bloqueia envio', async () => {
    const env = await setupRouter();
    const changed = structuredClone(env.sheet);
    changed.sku.value = 'SKU-NAO-REVISADO';
    await saveSheet(changed);
    const result = await env.request();
    assert.equal(result.ok, false);
    assert.equal(result.stale, true);
    assert.equal(env.calls(), 0);
  });

  await run('Bling write: Gateway rejeita GTIN com checksum inválido antes da rede', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('Não deve chamar a rede'); };
    await assert.rejects(() => new BlingProductClient().updateProduct('123', { gtin: '7894900011518' }, 'access'), /GTIN inválido/);
    assert.equal(calls, 0);
  });

  await run('Bling write: conflito e GTIN inválido bloqueiam a operação', () => {
    const conflict = createInitialSheet(); conflict.hasUnresolvedConflicts = true;
    assert.throws(() => buildBlingProductUpdatePatch(conflict), BlingSheetPatchError);
    const invalid = createInitialSheet();
    invalid.title = createAuditedField('Produto', 'user_manual', 1, 'approved');
    invalid.ean = createAuditedField('7894900011518', 'user_manual', 1, 'approved');
    assert.throws(() => buildBlingProductUpdatePatch(invalid), /EAN\/GTIN.*inválido/);
  });

  await run('Bling write: cliente envia PATCH oficial e valida identidade retornada', async () => {
    let seen: any;
    globalThis.fetch = async (url, init) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ data: { id: 123 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const result = await new BlingProductClient({ baseUrl: 'https://api.bling.test' }).updateProduct('123', { nome: 'Produto' }, 'access');
    assert.equal(seen.init.method, 'PATCH');
    assert.equal(seen.init.headers['enable-jwt'], '1');
    assert.deepEqual(JSON.parse(seen.init.body), { nome: 'Produto' });
    assert.equal(result.productId, '123');
  });

  await run('Bling write: SESSION_REVOKED após escrita não repete PATCH automaticamente', async () => {
    const client = new GatewayClient({ localStorage: gatewayStorage(), sessionStorage: gatewayStorage() });
    await client.saveSession({ gatewaySessionToken: 'gst', gatewayRefreshToken: 'grt', gstExpiresAt: '2099-01-01T00:00:00.000Z', sessionGeneration: 1, updatedAt: 'now' });
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ ok: false, error: 'SESSION_REVOKED', message: 'revogada após escrita' }), { status: 401 });
    };
    await assert.rejects(() => client.updateBlingProduct('123', { nome: 'Produto' }),
      (err: unknown) => err instanceof GatewayProductError && err.code === 'SESSION_REVOKED');
    assert.equal(calls, 1);
  });

  await run('Bling write: mudança real durante loadSheet não chama Gateway', async () => {
    const env = await setupRouter();
    const started = deferred<void>(), release = deferred<void>();
    const original = env.local.get;
    env.local.get = async key => { const value = await original(key); started.resolve(); await release.promise; return value; };
    const pending = env.request(); await started.promise;
    await tabContextManager.registerOrUpdateTab(900, { detectedProduct: { id: '456' } });
    release.resolve();
    const result = await pending;
    assert.equal(result.ok, false); assert.equal(result.stale, true); assert.equal(env.calls(), 0);
  });

  await run('Bling write: content script não pode forjar confirmação de escrita', async () => {
    const env = await setupRouter();
    const result = await new Promise<any>(resolve => {
      void env.router.handleMessage({
        type: 'BLING_UPDATE_PRODUCT', tabId: 900, pageInstanceId: env.state.pageInstanceId,
        contextRevision: env.state.contextRevision, productId: '123', sheetId: env.sheet.id, confirmed: true
      }, { tab: { id: 900 } as chrome.tabs.Tab }, resolve);
    });
    assert.equal(result.ok, false); assert.match(result.error, /sidebar/); assert.equal(env.calls(), 0);
  });

  await run('Bling write: mudança durante PATCH nunca retorna sucesso e sinaliza efeito remoto possível', async () => {
    const env = await setupRouter();
    const started = deferred<void>(), upstream = deferred<any>();
    env.client.updateBlingProduct = async () => { started.resolve(); return upstream.promise; };
    const pending = env.request(); await started.promise;
    await tabContextManager.registerOrUpdateTab(900, { pageInstanceId: 'document-B' });
    upstream.resolve({ ok: true, productId: '123', updatedFields: ['nome'], retrievedAt: new Date().toISOString() });
    const result = await pending;
    assert.equal(result.ok, false); assert.equal(result.stale, true); assert.equal(result.remoteUpdateMayHaveCompleted, true);
  });

  await run('Bling write: happy path e clique duplicado executam um único PATCH', async () => {
    const env = await setupRouter();
    const started = deferred<void>(), upstream = deferred<any>();
    env.client.updateBlingProduct = async (_id, patch) => { (env as any).count = ((env as any).count || 0) + 1; started.resolve(); await upstream.promise; return { ok: true, productId: '123', updatedFields: Object.keys(patch) as any, retrievedAt: 'now' }; };
    const first = env.request(); await started.promise; const second = env.request();
    await new Promise(resolve => setImmediate(resolve));
    upstream.resolve(null);
    const [a, b] = await Promise.all([first, second]);
    assert.equal((env as any).count, 1); assert.equal(a.ok, true); assert.deepEqual(a, b);
  });
}
