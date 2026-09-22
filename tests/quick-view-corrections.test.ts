import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BlingProductClient } from '../src/gateway/integrations/bling/bling-product-client.ts';
import { QuickViewCache } from '../src/gateway/cache/quick-view-cache.ts';
import { GatewayClient } from '../src/background/gateway-client.ts';
import { MessageRouter } from '../src/background/message-router.ts';
import { tabContextManager } from '../src/background/tab-context-manager.ts';
import { restrictCredentialStorage } from '../src/background/storage-access.ts';
import { SidepanelContextSync, readPanelContext } from '../src/sidepanel/context-sync.ts';
import { MercadoLivreFeeProvider } from '../src/core/engines/pricing-calculator/fee-provider.ts';
import { createInitialSheet, createAuditedField } from '../src/core/schema/product.ts';
import { reconcileBlingPatch } from '../src/integrations/bling/reconciliation.ts';
import { loadSheet } from '../src/core/storage/storage.ts';
import type { BlingProductQuickView, ProductStockInfo } from '../src/shared/gateway-contracts.ts';
import type { TabContextState } from '../src/shared/tab-context-contracts.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function storage() {
  const map = new Map<string, any>();
  return { get: async (key: string) => map.get(key), set: async (key: string, value: unknown) => { map.set(key, value); }, remove: async (key: string) => { map.delete(key); } };
}
const qv = (id = '123'): BlingProductQuickView => ({ productId: id, costPrice: 8.42, stockInfo: { physicalTotal: 37, virtualTotal: 35, deposits: [{ depositId: 1, physicalBalance: 37, virtualBalance: 35 }], retrievedAt: '2026-09-21T00:00:00Z', source: 'bling_erp' }, retrievedAt: '2026-09-21T00:00:00Z' });
async function context(id = '123', instance = 'page', tabId = 900) {
  return tabContextManager.registerOrUpdateTab(tabId, { platform: 'bling', pageType: 'product_form_edit', pageInstanceId: instance, detectedProduct: { id }, url: 'https://www.bling.com.br/produtos/editar/' + id });
}
function request(router: MessageRouter, id = '123', instance = 'page', tabId = 900): Promise<any> {
  return new Promise(resolve => {
    void router.handleMessage({ type: 'BLING_GET_QUICK_VIEW', pageInstanceId: instance, payload: { productId: id } }, { tab: { id: tabId } as chrome.tabs.Tab }, resolve);
  });
}
async function runTest(name: string, fn: () => Promise<void> | void) {
  const oldChrome = (globalThis as any).chrome;
  const oldFetch = globalThis.fetch;
  try {
    delete (globalThis as any).chrome;
    await tabContextManager.clearAll();
    await fn(); console.log('  ✓ PASS: ' + name);
  } catch (error) { console.error('  ✗ FAIL: ' + name); console.error(error); process.exitCode = 1; }
  finally { (globalThis as any).chrome = oldChrome; globalThis.fetch = oldFetch; }
}
export async function runQuickViewCorrectionTests() {
  await runTest('Patch: atualização atômica recusa revisão antiga e autenticação invalidada', async () => {
    const original = await context();
    const next = await context('456');
    assert.equal(await tabContextManager.updateQuickView(900, original.contextRevision, {quickView: qv()}, () => true), undefined);
    assert.equal(await tabContextManager.updateQuickView(900, next.contextRevision, {quickView: qv('456')}, () => false), undefined);
    assert.equal((await tabContextManager.getTabState(900))?.uiState.quickView, null);
  });
  await runTest('Patch: 401 usa GRT atual depois da renovação automática', async () => {
    const client = new GatewayClient({localStorage: storage(), sessionStorage: storage()});
    await client.saveSession({gatewayRefreshToken: 'grt-0', gstExpiresAt: '2000-01-01T00:00:00Z', sessionGeneration: 1, updatedAt: 'now'});
    const tokens: string[] = []; let reads = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('/session/refresh')) {
        const body = JSON.parse(String(init?.body)); tokens.push(body.gatewayRefreshToken);
        return new Response(JSON.stringify({ok: true, gatewayRefreshToken: 'grt-' + tokens.length, gatewaySessionToken: 'gst-' + tokens.length, expiresInSeconds: 900}));
      }
      reads++;
      return reads === 1 ? new Response('{}', {status: 401}) : new Response(JSON.stringify({ok: true, quickView: qv()}));
    };
    assert.equal((await client.fetchBlingProductQuickView('123')).productId, '123');
    assert.deepEqual(tokens, ['grt-0', 'grt-1']); assert.equal(reads, 2);
  });
  await runTest('Patch: loading → success → refresh persiste e deduplica apenas em voo', async () => {
    await context(); const client = new GatewayClient(); const started = deferred<void>(); const result = deferred<BlingProductQuickView>(); let calls = 0;
    client.fetchBlingProductQuickView = async () => { calls++; started.resolve(); return result.promise; };
    const router = new MessageRouter(client); const first = request(router); await started.promise;
    assert.equal((await tabContextManager.getTabState(900))?.uiState.quickViewLoading, true);
    const second = request(router); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1); result.resolve(qv()); await Promise.all([first, second]);
    let state = (await tabContextManager.getTabState(900))!;
    assert.equal(state.uiState.quickView?.costPrice, 8.42); assert.equal(state.uiState.quickViewLoading, false);
    const revision = state.contextRevision;
    await tabContextManager.registerOrUpdateTab(900, {uiState: state.uiState});
    assert.equal((await tabContextManager.getTabState(900))?.contextRevision, revision);
    await request(router); assert.equal(calls, 2);
    state = (await tabContextManager.getTabState(900))!; assert.equal(state.uiState.quickView?.productId, '123');
  });
  await runTest('Patch: loading → error → retry → success persiste', async () => {
    await context(); const client = new GatewayClient(); const started = deferred<void>(); const result = deferred<BlingProductQuickView>();
    client.fetchBlingProductQuickView = async () => { started.resolve(); return result.promise; };
    const router = new MessageRouter(client); const pending = request(router); await started.promise;
    assert.equal((await tabContextManager.getTabState(900))?.uiState.quickViewLoading, true);
    result.reject(new Error('Falha controlada')); await pending;
    assert.equal((await tabContextManager.getTabState(900))?.uiState.quickViewError, 'Falha controlada');
    client.fetchBlingProductQuickView = async () => qv(); await request(router);
    assert.equal((await tabContextManager.getTabState(900))?.uiState.quickViewError, null);
    assert.equal((await tabContextManager.getTabState(900))?.uiState.quickViewLoading, false);
  });
  for (const change of ['product', 'document', 'route'] as const) {
    await runTest('Patch: invalida Quick View na mudança de ' + change, async () => {
      await context(); await tabContextManager.registerOrUpdateTab(900, {uiState: {quickView: qv(), quickViewError: 'antigo'}});
      const state = await tabContextManager.registerOrUpdateTab(900, change === 'product' ? {detectedProduct: {id: '456'}} : change === 'document' ? {pageInstanceId: 'new'} : {pageType: 'product_list'});
      assert.equal(state.uiState.quickView, null); assert.equal(state.uiState.quickViewError, null); assert.equal(state.uiState.quickViewLoading, false);
    });
  }
  for (const transition of ['logout', 'new-account'] as const) {
    await runTest('Patch: resposta em voo descartada após ' + transition, async () => {
      const client = new GatewayClient({localStorage: storage(), sessionStorage: storage()});
      await client.saveSession({gatewayRefreshToken: 'A-grt', gatewaySessionToken: 'A-gst', gstExpiresAt: new Date(Date.now()+600000).toISOString(), sessionGeneration: 1, updatedAt: 'now'});
      await context(); const router = new MessageRouter(client); const started = deferred<void>(); const response = deferred<Response>();
      globalThis.fetch = async () => { started.resolve(); return response.promise; };
      const pending = request(router); await started.promise;
      await client.clearSession();
      if (transition === 'new-account') await client.saveSession({gatewayRefreshToken: 'B-grt', gatewaySessionToken: 'B-gst', gstExpiresAt: new Date(Date.now()+600000).toISOString(), sessionGeneration: 1, updatedAt: 'now'});
      response.resolve(new Response(JSON.stringify({ok: true, quickView: qv()}), {status: 200}));
      assert.equal((await pending).ok, false);
      assert.equal((await tabContextManager.getTabState(900))?.uiState.quickView, null);
      if (transition === 'new-account') {
        globalThis.fetch = async (_url, init) => { assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer B-gst'); return new Response(JSON.stringify({ok: true, quickView: {...qv(), costPrice: 99}})); };
        assert.equal((await request(router)).quickView.costPrice, 99);
      }
    });
  }
  await runTest('Patch: Sidepanel relê aba relevante da própria janela e descarta leituras antigas', async () => {
    const a = await context('A', 'a', 901); const b = await context('B', 'b', 902);
    const router = new MessageRouter(new GatewayClient()); const sender = {id: 'ext', url: 'chrome-extension://ext/sidepanel.html'};
    let ownWindow = 2; const queries: chrome.tabs.QueryInfo[] = [];
    (globalThis as any).chrome = {
      windows: {getCurrent: async () => ({id: ownWindow})},
      runtime: {id: 'ext', getURL: (path: string) => 'chrome-extension://ext/' + path,
        sendMessage: async (message: unknown) => { let result: any; await router.handleMessage(message, sender, value => {result=value;}); return result; }},
      tabs: {query: async (query: chrome.tabs.QueryInfo) => {queries.push(query); return [{id: query.windowId === 1 ? 901 : 902}];}}
    };
    let visible: TabContextState | null = null;
    const panel = new SidepanelContextSync(readPanelContext, state => {visible=state;});
    await panel.refresh(); assert.equal((visible as TabContextState | null)?.tabId, b.tabId);
    // Notification from A triggers refresh; it cannot supply A's state to this panel.
    await panel.refresh(); assert.equal((visible as TabContextState | null)?.detectedProduct?.id, 'B');
    ownWindow=1; await panel.refresh(); assert.equal((visible as TabContextState | null)?.tabId, a.tabId);
    assert.deepEqual(queries.map(q => q.windowId), [2,2,1]);
    const old=deferred<TabContextState>(); let reads=0;
    const racing = new SidepanelContextSync(async () => ++reads === 1 ? old.promise : b, state => {visible=state;});
    const pending = racing.refresh(); await racing.refresh(); old.resolve(a); await pending;
    assert.equal((visible as TabContextState | null)?.tabId, b.tabId);
  });
  await runTest('Patch: LINK_SHEET usa sender.tab.id e valida Sidepanel', async () => {
    await context('A','page',901); await context('B','page',902); const router = new MessageRouter(new GatewayClient());
    let res: any;
    await router.handleMessage({type: 'LINK_SHEET_TO_TAB', tabId: 902, sheetId: 'sheetA'}, {tab: {id:901} as chrome.tabs.Tab}, v => {res=v;});
    assert.equal(res.state.tabId,901); assert.equal((await tabContextManager.getTabState(902))?.activeSheetId,undefined);
    await router.handleMessage({type: 'LINK_SHEET_TO_TAB', tabId: 902, sheetId: 'evil'}, {}, v => {res=v;}); assert.equal(res.ok,false);
    (globalThis as any).chrome={runtime:{id:'ext',getURL:(path:string)=>'chrome-extension://ext/'+path},tabs:{query:async()=>[{id:902}]}};
    const sender={id:'ext',url:'chrome-extension://ext/sidepanel.html'};
    await router.handleMessage({type:'LINK_SHEET_TO_TAB',tabId:901,sheetId:'wrong'},sender,v=>{res=v;});assert.equal(res.ok,false);
    await router.handleMessage({type:'LINK_SHEET_TO_TAB',tabId:902,sheetId:'right'},sender,v=>{res=v;});assert.equal(res.ok,true);
  });
  for (const balance of ['', '   ', null, undefined, -1, 'oops', Infinity]) {
    await runTest('Patch: saldo inválido não vira zero: ' + String(balance), async () => {
      globalThis.fetch=async()=>new Response(JSON.stringify({data:[{produto:{id:123},saldoFisicoTotal:balance,saldoVirtualTotal:0,depositos:[]}]}));
      await assert.rejects(()=>new BlingProductClient().fetchStockBalances('123','fake'),/Saldo ausente ou inválido/);
    });
  }
  await runTest('Patch: zero explícito, depósitos parciais e DTO sanitizado', async () => {
    globalThis.fetch=async()=>new Response(JSON.stringify({data:[{produto:{id:123},saldoFisicoTotal:'0',saldoVirtualTotal:0,depositos:[{saldoFisico:'0',saldoVirtual:0,access_token:'SECRET'}]}]}));
    const result=await new BlingProductClient().fetchStockBalances('123','fake');
    assert.equal(result?.physicalTotal,0);assert.equal(result?.virtualTotal,0);
    assert.equal(result?.deposits?.[0].depositId,undefined);assert.equal(result?.deposits?.[0].depositName,undefined);
    assert.equal(JSON.stringify(result).includes('SECRET'),false);
  });
  await runTest('Patch: estoque exige identidade do produto e rejeita resposta de outro ID', async () => {
    for(const produto of [undefined,{id:456}]) {
      globalThis.fetch=async()=>new Response(JSON.stringify({data:[{produto,saldoFisicoTotal:1,saldoVirtualTotal:1}]}));
      await assert.rejects(()=>new BlingProductClient().fetchStockBalances('123','fake'),/Identidade/);
    }
  });
  await runTest('Patch: custo usa fornecedor.precoCusto oficial, nunca preço de venda', async () => {
    for(const [raw,expected] of [[undefined,null],[0,0],[8.42,8.42]] as const) {
      globalThis.fetch=async(input)=>new Response(JSON.stringify(String(input).includes('/estoques/') ? {data:[]} : {data:{id:123,preco:999,precoCusto:444,fornecedor:{precoCusto:raw,access_token:'SECRET'}}}));
      const result=await new BlingProductClient().fetchQuickView('123','fake');
      assert.equal(result.costPrice,expected);assert.equal('stock' in result,false);assert.equal(JSON.stringify(result).includes('SECRET'),false);
    }
  });
  await runTest('Patch: stockInfo de produto A não entra na importação de B', async () => {
    await context('B');await tabContextManager.registerOrUpdateTab(900,{uiState:{quickView:qv('A')}});
    const client=new GatewayClient();client.fetchBlingProduct=async()=>({ok:true,product:{id:'B',nome:'Produto B'},warnings:[],unknownFields:[],retrievedAt:new Date().toISOString()});
    const router=new MessageRouter(client);let result:any;
    await router.handleMessage({type:'BLING_ACTION_TRIGGERED',pageInstanceId:'page',payload:{action:'prepare_mercadolivre'}},{tab:{id:900} as chrome.tabs.Tab},res=>{result=res;});
    assert.equal(result.ok,true);assert.equal((await loadSheet(result.sheetId))?.stockInfo,undefined);
  });
  await runTest('Patch: zero user_manual é preservado como conflito',()=>{
    const sheet=createInitialSheet();sheet.costPrice=createAuditedField(0,'user_manual',0,'edited');
    const result=reconcileBlingPatch(sheet,{patch:{costPrice:createAuditedField(8.42,'bling_erp',1,'pending_review')},warnings:[],unknownFields:[]});
    assert.equal(result.sheet.costPrice.value,0);assert.equal(result.sheet.costPrice.source,'user_manual');assert.equal(result.sheet.costPrice.status,'conflict');
  });
  await runTest('Patch: estoque igual em outra coleta/ordem não gera conflito',()=>{
    const stock: ProductStockInfo = {...qv().stockInfo!, deposits: [
      {depositId: 1, physicalBalance: 20, virtualBalance: 19},
      {depositId: 2, physicalBalance: 17, virtualBalance: 16}
    ]};const other:ProductStockInfo={...stock,retrievedAt:'2026-09-22T00:00:00Z',deposits:[...(stock.deposits??[])].reverse()};
    assert.notDeepEqual(stock.deposits, other.deposits);
    const sheet=createInitialSheet();sheet.stockInfo=createAuditedField(stock,'bling_erp',1,'approved');
    const result=reconcileBlingPatch(sheet,{patch:{stockInfo:createAuditedField(other,'bling_erp',1,'pending_review')},warnings:[],unknownFields:[]});
    assert.equal(result.conflictedFields.length,0);assert.ok(result.corroboratedFields.includes('stockInfo'));
  });
  await runTest('Patch: GRT restrito, falha de API bloqueia inicialização e UI não recebe credenciais',async()=>{
    const levels:string[]=[];const area={setAccessLevel:async(options:{accessLevel:string})=>{levels.push(options.accessLevel);}};
    await restrictCredentialStorage({local:area,session:area} as unknown as Pick<typeof chrome.storage,'local'|'session'>);
    assert.deepEqual(levels,['TRUSTED_CONTEXTS','TRUSTED_CONTEXTS']);
    await assert.rejects(()=>restrictCredentialStorage({local:{},session:{}} as any),/indisponível/);
    await assert.rejects(()=>restrictCredentialStorage({local:{setAccessLevel:async()=>{throw new Error('denied');}},session:area} as any),/denied/);
    const startup=fs.readFileSync('src/background/index.ts','utf8');assert.match(startup,/backgroundReady\.then\(\(\) => messageRouter\.handleMessage/);
    for(const file of ['src/sidepanel/App.tsx','src/content-scripts/index.ts']) assert.doesNotMatch(fs.readFileSync(file,'utf8'),/paulifest_grt|gatewayRefreshToken|gatewaySessionToken/);
  });
  await runTest('Patch: provider ML permanece simulado mesmo com token',async()=>{
    const provider=new MercadoLivreFeeProvider('configured');provider.setAccessToken('other');
    assert.equal(provider.isSimulated,true);
    const fees=await provider.getDynamicFees({marketplace:'mercadolivre',categoryId:'DEFAULT',listingType:'gold_special',price:100});
    assert.equal(fees.isSimulated,true);assert.match(fees.providerName,/Simulação/);assert.doesNotMatch(fees.providerName,/Oficial/);
  });
  await runTest('Patch: inst_mock enviado por content script não ativa simulação',async()=>{
    await context('123','inst_mock');const client=new GatewayClient();let calls=0;
    client.fetchBlingProductQuickView=async()=>{calls++;return {...qv(),costPrice:12};};
    const result=await request(new MessageRouter(client),'123','inst_mock');assert.equal(calls,1);assert.equal(result.quickView.costPrice,12);
    assert.equal((await tabContextManager.getTabState(900))?.uiState.isSimulatedMock,false);
  });
  await runTest('Patch: cache limitado, TTL e ticket invalidado por tenant',()=>{
    const cache=new QuickViewCache(60000,2);cache.set('A','1',qv('1'));cache.set('A','2',qv('2'));cache.set('B','3',qv('3'));
    assert.equal(cache.size(),2);assert.equal(cache.get('A','1'),null);assert.equal(cache.get('B','3')?.productId,'3');
    const a=cache.beginRead('A');const b=cache.beginRead('B');cache.clearForConnection('A');assert.equal(a.valid,false);assert.equal(b.valid,true);assert.equal(cache.get('A','2'),null);cache.endRead(a);cache.endRead(b);
    const oldNow=Date.now;try{cache.set('B','4',qv('4'),10);Date.now=()=>oldNow()+20;assert.equal(cache.get('B','4'),null);}finally{Date.now=oldNow;}
  });
  await runTest('Patch: anti-XSS estrutural sobre renderizador real',()=>{
    const source=fs.readFileSync('src/content-scripts/bling/shadow-ui.ts','utf8');
    const templates=[...source.matchAll(/innerHTML\s*=\s*`([\s\S]*?)`/g)];assert.equal(templates.length,1);
    const expressions=[...templates[0][1].matchAll(/\$\{([^}]+)\}/g)].map(match=>match[1]);
    assert.deepEqual(expressions,["this.currentUiState.isSimulatedMock ? 'SIMULAÇÃO 4B' : 'REAL 4D.2'"]);
    assert.match(source,/stockSpan\.textContent = stockText/);assert.match(source,/costSpan\.textContent = costText/);assert.match(source,/badge\.textContent = this\.currentUiState\.actionFeedback\.message/);
    assert.doesNotMatch(source,/outerHTML\s*=|insertAdjacentHTML\(/);
    assert.doesNotMatch(fs.readFileSync('src/sidepanel/App.tsx','utf8'),/dangerouslySetInnerHTML/);
  });
}
