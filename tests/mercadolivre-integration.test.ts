import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadMigrationDefinitions } from '../src/gateway/database/migrator.ts';
import { MlService, loadMlConfig } from '../src/gateway/integrations/mercadolivre/ml-service.ts';
import { MlApiClient, MlApiError } from '../src/gateway/integrations/mercadolivre/api-client.ts';
import { GatewayApp } from '../src/gateway/http/app.ts';
import { loadGatewayConfig } from '../src/gateway/config.ts';
import { PostgresGatewayRepository } from '../src/gateway/database/postgres-repository.ts';
import { createGatewaySessionToken } from '../src/gateway/crypto/pairing-state.ts';
import { exampleDraft } from './unification.test.ts';

class FakeMlApi extends MlApiClient {
  creates = 0; refreshes = 0; tags: string[] = []; descriptionFailure = false; publishFailure = false; tokenCalls = 0;
  lastPayload: any; price = 29.9; version = '2026-09-25T00:00:00Z';
  override async token(params: Record<string, string>) {
    assert.ok(params.client_secret === 'ml-test-secret');
    if (params.grant_type === 'authorization_code') assert.ok(params.code_verifier.length >= 43);
    if (params.grant_type === 'refresh_token') this.refreshes++;
    this.tokenCalls++;
    return { access_token: 'ml-access-test', refresh_token: 'ml-refresh-test-' + this.tokenCalls, expires_in:3600,user_id:123 };
  }
  override async request(path: string, token: string, method = 'GET', body?: any): Promise<any> {
    assert.equal(token,'ml-access-test');
    if (path === '/users/me') return {id:123,site_id:'MLB',nickname:'Teste',tags:this.tags};
    if (path === '/categories/MLB1234') return {id:'MLB1234',name:'Copos',settings:{listing_allowed:true,max_title_length:60,max_pictures_per_item:12},children_categories:[]};
    if (path === '/categories/MLB1234/attributes') return [{id:'BRAND',name:'Marca',tags:{required:true}}];
    if (path.startsWith('/sites/MLB/listing_prices?')) return [{sale_fee_amount:4.5,sale_fee_details:{fixed_fee:2}}];
    if (path === '/pictures/items/upload') { assert.ok(body instanceof FormData); return {id:'picture-test'}; }
    if (path === '/items/validate') { this.lastPayload=body; return {}; }
    if (path === '/items' && method === 'POST') { this.creates++; if(this.publishFailure) throw new MlApiError(502,'Resposta perdida',true); this.lastPayload=body; return {id:'MLB123456789',seller_id:123,status:'active',permalink:'https://produto.mercadolivre.com.br/MLB-123456789-copo',user_product_id:this.tags.includes('user_product_seller')?'MLBU1234':null}; }
    if (path.endsWith('/description')) { if(this.descriptionFailure) throw new MlApiError(400,'Descrição recusada'); return {}; }
    if (path === '/items/MLB123456789') { if(method === 'PUT') {this.price=body.price ?? this.price; this.version='2026-09-25T01:00:00Z';} return {id:'MLB123456789',seller_id:123,title:'Copo',price:this.price,available_quantity:5,last_updated:this.version}; }
    if (path === '/items/MLB999999999') return {id:'MLB999999999',seller_id:999,last_updated:this.version};
    throw new Error('Rota inesperada no teste: ' + method + ' ' + path);
  }
}

export async function runMlIntegrationTests() {
  const connectionString = process.env.DATABASE_URL || '';
  const target = new URL(connectionString);
  if (!['127.0.0.1','localhost','[::1]'].includes(target.hostname) || target.pathname !== '/paulifest_test') throw new Error('Testes ML exigem PostgreSQL descartável local paulifest_test.');
  const schema = 'test_ml_' + randomUUID().replace(/-/g,'');
  const admin = new pg.Pool({connectionString});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({connectionString,options:`-c search_path=${schema}`,max:8});
  let app: GatewayApp | undefined;
  async function test(name: string, fn: () => unknown | Promise<unknown>) {
    try { await fn(); console.log('  ✓ PASS: Mercado Livre: ' + name); }
    catch(e) {console.error('  ✗ FAIL: Mercado Livre: '+name,e);process.exitCode=1;}
  }
  try {
    for(const migration of loadMigrationDefinitions()) await pool.query(migration.sql);
    const owner='ml-owner', session='ml-session';
    await pool.query("INSERT INTO bling_connections(id,status) VALUES($1,'disconnected')",[owner]);
    await pool.query('INSERT INTO gateway_sessions(id,connection_id,client_session_id) VALUES($1,$2,$3)',[session,owner,'client-test']);
    await pool.query("INSERT INTO gateway_refresh_tokens(id,session_id,family_id,token_hash,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day')",[randomUUID(),session,randomUUID(),'token-test']);
    const api=new FakeMlApi(), key=Buffer.alloc(32,7);
    const config={clientId:'test-app',clientSecret:'ml-test-secret',redirectUri:'https://example.com/auth/mercadolivre/callback'};
    const service=new MlService(pool,config,key,api);
    await test('configuração é opcional mas parcial e redirect inseguro falham',() => { assert.equal(loadMlConfig({}),undefined);assert.throws(()=>loadMlConfig({ML_CLIENT_ID:'x'}));assert.throws(()=>loadMlConfig({ML_CLIENT_ID:'x',ML_CLIENT_SECRET:'y',ML_REDIRECT_URI:'http://example.com/auth/mercadolivre/callback'})); });
    await test('OAuth usa state de uso único e PKCE; banco guarda tokens cifrados',async() => {
      const result=await service.start(owner,session), url=new URL(result.authorizationUrl);
      assert.equal(url.origin,'https://auth.mercadolivre.com.br');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('client_secret'),null);
      const state=url.searchParams.get('state')!;
      await service.callback('test-code',state);await assert.rejects(service.callback('test-code',state));
      const stored=await pool.query('SELECT tokens FROM ml_connections WHERE connection_id=$1',[owner]);assert.ok(!JSON.stringify(stored.rows).includes('ml-access-test'));assert.equal((await service.status(owner)).sellerId,'123');
    });
    await test('renovação concorrente executa uma única troca de refresh token',async()=>{await pool.query("UPDATE ml_connections SET expires_at=NOW()-INTERVAL '1 minute' WHERE connection_id=$1",[owner]);const before=api.refreshes;await Promise.all([service.quote(owner,'MLB1234',20,'gold_special'),service.quote(owner,'MLB1234',30,'gold_special'),service.quote(owner,'MLB1234',40,'gold_special')]);assert.equal(api.refreshes-before,1);});
    await test('NCM e preço não influenciam requisitos da categoria ML',async()=>{const meta=await service.category(owner,'MLB1234');assert.equal(meta.attributes[0].id,'BRAND');const quote=await service.quote(owner,'MLB1234',29.9,'gold_special');assert.equal(quote.fees[0].sale_fee_amount,4.5);await assert.rejects(service.category(owner,'../../users/me'));});
    await test('upload valida conteúdo e associa foto à conexão',async()=>{await assert.rejects(service.upload(owner,'data:image/png;base64,YWJj'));const bytes=Buffer.alloc(20);bytes[0]=255;bytes[1]=216;const image=await service.upload(owner,'data:image/jpeg;base64,'+bytes.toString('base64'));assert.equal(image.pictureId,'picture-test');});
    await test('preparação recusa fotos alheias e atributos ausentes',async()=>{await assert.rejects(service.prepare(owner,session,{...exampleDraft(),pictureIds:['unknown-photo']}));await assert.rejects(service.prepare(owner,session,{...exampleDraft(),attributes:[]}));});
    await test('publicação concorrente é idempotente e persiste ID antes da descrição',async()=>{
      const draft={...exampleDraft(),sheetId:'sheet-success'};const prepared=await service.prepare(owner,session,draft);api.descriptionFailure=true;const before=api.creates;
      const [a,b]=await Promise.all([service.publish(owner,session,prepared.id,prepared.hash),service.publish(owner,session,prepared.id,prepared.hash)]);
      assert.equal(api.creates-before,1);assert.equal(a.itemId,'MLB123456789');assert.equal(b.itemId,a.itemId);assert.ok(a.warning);assert.equal(a.descriptionSaved,false);
      await assert.rejects(service.prepare(owner,session,draft),/já tem publicação/);api.descriptionFailure=false;
    });
    await test('status recupera publicação sem expor payload ou tokens e respeita titularidade',async()=>{
      const status=await service.status(owner);const recovered=status.operations.find(op=>op.sheetId==='sheet-success');
      assert.equal(recovered?.itemId,'MLB123456789');assert.equal(recovered?.state,'published');
      assert.ok(!JSON.stringify(status).includes('ml-access-test'));assert.ok(!JSON.stringify(status).includes('picture-test'));
      assert.deepEqual((await service.status('other')).operations,[]);
    });
    await test('revisão adulterada, expirada ou de outra conexão é rejeitada',async()=>{
      const prepared=await service.prepare(owner,session,{...exampleDraft(),sheetId:'sheet-expiry'});
      await assert.rejects(service.publish(owner,session,prepared.id,'0'.repeat(64)));
      await pool.query("UPDATE ml_operations SET updated_at=NOW()-INTERVAL '11 minutes' WHERE id=$1",[prepared.id]);
      await assert.rejects(service.publish(owner,session,prepared.id,prepared.hash),/expirou/);
      await assert.rejects(service.publish('other',session,prepared.id,prepared.hash));
    });
    await test('resposta incerta nunca é repetida como nova criação',async()=>{
      const draft={...exampleDraft(),sheetId:'sheet-uncertain'}, prepared=await service.prepare(owner,session,draft);api.publishFailure=true;const before=api.creates;
      await assert.rejects(service.publish(owner,session,prepared.id,prepared.hash));await assert.rejects(service.publish(owner,session,prepared.id,prepared.hash),/uncertain/);await assert.rejects(service.prepare(owner,session,draft));assert.equal(api.creates-before,1);api.publishFailure=false;
    });
    await test('preparação User Products envia family_name e remove title',async()=>{api.tags=['user_product_seller'];const prepared=await service.prepare(owner,session,{...exampleDraft(),sheetId:'sheet-up'});assert.equal(prepared.payload.family_name,'Copo');assert.equal(prepared.payload.title,undefined);assert.ok(prepared.warnings.length);api.tags=[];});
    await test('sincronização confere titularidade e versão antes da escrita',async()=>{
      await assert.rejects(service.item(owner,'MLB999999999'),/não pertence/);
      await assert.rejects(service.sync(owner,session,{itemId:'MLB123456789',confirmed:true,expectedLastUpdated:'old',price:30}),/mudou/);
      const remote=await service.item(owner,'MLB123456789');const result=await service.sync(owner,session,{itemId:remote.itemId,confirmed:true,expectedLastUpdated:remote.lastUpdated,price:35});assert.equal(result.price,35);
    });
    await test('rotas HTTP exigem GST, origem permitida e confirmação explícita',async()=>{
      const gatewayConfig=loadGatewayConfig({NODE_ENV:'test'});app=new GatewayApp({config:gatewayConfig,repository:new PostgresGatewayRepository(pool),mlService:service});const port=await app.listen(0);const base=`http://127.0.0.1:${port}`;
      assert.equal((await fetch(base+'/integrations/mercadolivre/status')).status,401);
      const gst=createGatewaySessionToken({connectionId:owner,clientSessionId:'client-test',sessionId:session},gatewayConfig.jwtSecret,900);
      const headers={Authorization:'Bearer '+gst,'Content-Type':'application/json',Origin:'chrome-extension://test'};
      const status=await fetch(base+'/integrations/mercadolivre/status',{headers});assert.equal(status.status,200);assert.equal((await status.json()).sellerId,'123');
      const rejected=await fetch(base+'/integrations/mercadolivre/publish',{method:'POST',headers,body:JSON.stringify({})});assert.equal(rejected.status,422);
      assert.equal((await fetch(base+'/integrations/mercadolivre/status',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
      const callback=await fetch(base+'/auth/mercadolivre/callback?state=bad&code=secret');assert.equal(callback.status,400);assert.equal(callback.headers.get('referrer-policy'),'no-referrer');assert.ok(!(await callback.text()).includes('secret'));
    });
    await test('sessão revogada invalida callback pendente',async()=>{const pending=new URL((await service.start(owner,session)).authorizationUrl);const before=api.tokenCalls;await pool.query('UPDATE gateway_sessions SET revoked_at=NOW() WHERE id=$1',[session]);await assert.rejects(service.callback('test-code',pending.searchParams.get('state')!));assert.equal(api.tokenCalls,before);});
    await test('desconexão remove tokens e estados OAuth',async()=>{await service.disconnect(owner);assert.equal((await service.status(owner)).connected,false);assert.equal((await pool.query('SELECT count(*)::int AS n FROM ml_oauth_states WHERE connection_id=$1',[owner])).rows[0].n,0);});
  } finally {await app?.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
