import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { encryptPayload, decryptPayload } from '../../crypto/aes-gcm.ts';
import { MlApiClient, MlApiError } from './api-client.ts';
import { quotePricing, readPricingContext } from './pricing.ts';
import { buildMlPayload, validateMlDraft } from '../../../integrations/mercadolivre/listing.ts';
import type { MlPreparedListing } from '../../../shared/mercadolivre-contracts.ts';

export interface MlConfig { clientId: string; clientSecret: string; redirectUri: string }
export function loadMlConfig(env: Record<string, string | undefined>): MlConfig | undefined {
  const values = [env.ML_CLIENT_ID?.trim(), env.ML_CLIENT_SECRET?.trim(), env.ML_REDIRECT_URI?.trim()];
  if (values.every(v => !v)) return;
  if (values.some(v => !v)) throw new Error('Configure ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI juntos.');
  const url = new URL(values[2]!);
  if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password || url.pathname !== '/auth/mercadolivre/callback') throw new Error('ML_REDIRECT_URI deve ser HTTPS e terminar em /auth/mercadolivre/callback, sem parâmetros.');
  return { clientId: values[0]!, clientSecret: values[1]!, redirectUri: url.href };
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const validItemId = (id: unknown): id is string => typeof id === 'string' && /^MLB\d{6,}$/.test(id);

export class MlService {
  constructor(private pool: Pool, private config: MlConfig, private encryptionKey: Buffer, private api = new MlApiClient()) {}
  private async locked<T>(owner: string, action: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect(); let acquired = false;
    try {
      await db.query("SET statement_timeout = '5000'");
      await db.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', ['paulifest-ml:' + owner]); acquired = true;
      await db.query('SET statement_timeout = 0');
      return await action(db);
    } finally {
      try { await db.query('SET statement_timeout = 0'); if (acquired) await db.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', ['paulifest-ml:' + owner]); }
      finally { db.release(); }
    }
  }
  private async assertSession(db: PoolClient, owner: string, sessionId: string) {
    const session = await db.query('SELECT s.id FROM gateway_sessions s WHERE s.id=$1 AND s.connection_id=$2 AND s.revoked_at IS NULL AND EXISTS (SELECT 1 FROM gateway_refresh_tokens t WHERE t.session_id=s.id AND t.revoked_at IS NULL AND t.expires_at > NOW())', [sessionId, owner]);
    if (!session.rows.length) throw new Error('A sessão mudou. Reconecte o Gateway.');
  }
  async start(owner: string, sessionId: string) {
    return this.locked(owner, async db => {
      await this.assertSession(db, owner, sessionId);
      const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
      await db.query('DELETE FROM ml_oauth_states WHERE expires_at < NOW() OR connection_id=$1', [owner]);
      await db.query("INSERT INTO ml_oauth_states(state_hash,connection_id,session_id,verifier,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '5 minutes')", [hash(state), owner, sessionId, encryptPayload(verifier, this.encryptionKey)]);
      const url = new URL('https://auth.mercadolivre.com.br/authorization');
      url.search = new URLSearchParams({ response_type: 'code', client_id: this.config.clientId, redirect_uri: this.config.redirectUri, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
      return { authorizationUrl: url.href };
    });
  }
  async callback(code: string, state: string): Promise<void> {
    if (!code || code.length > 2048 || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error('Autorização inválida ou expirada.');
    const row = (await this.pool.query('SELECT connection_id FROM ml_oauth_states WHERE state_hash=$1 AND expires_at > NOW()', [hash(state)])).rows[0];
    if (!row) throw new Error('Autorização inválida ou já utilizada.');
    await this.locked(row.connection_id, async db => {
      const pending = (await db.query('DELETE FROM ml_oauth_states WHERE state_hash=$1 AND expires_at > NOW() RETURNING *', [hash(state)])).rows[0];
      if (!pending) throw new Error('Autorização já utilizada.');
      await this.assertSession(db, pending.connection_id, pending.session_id);
      const tokens = await this.api.token({ grant_type: 'authorization_code', client_id: this.config.clientId, client_secret: this.config.clientSecret, redirect_uri: this.config.redirectUri, code, code_verifier: decryptPayload(pending.verifier, this.encryptionKey) });
      await this.assertSession(db, pending.connection_id, pending.session_id);
      await db.query('INSERT INTO ml_connections(connection_id,seller_id,tokens,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(connection_id) DO UPDATE SET seller_id=EXCLUDED.seller_id,tokens=EXCLUDED.tokens,expires_at=EXCLUDED.expires_at,updated_at=NOW()', [pending.connection_id, String(tokens.user_id), encryptPayload(JSON.stringify(tokens), this.encryptionKey), new Date(Date.now() + tokens.expires_in * 1000)]);
    });
  }
  private async access(db: PoolClient, owner: string): Promise<{ token: string; sellerId: string }> {
    const row = (await db.query('SELECT * FROM ml_connections WHERE connection_id=$1', [owner])).rows[0];
    if (!row) throw new Error('Conecte sua conta Mercado Livre.');
    let tokens = JSON.parse(decryptPayload(row.tokens, this.encryptionKey));
    if (new Date(row.expires_at).getTime() < Date.now() + 30000) {
      tokens = await this.api.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: this.config.clientId, client_secret: this.config.clientSecret });
      if (String(tokens.user_id) !== row.seller_id) throw new Error('A conta retornada pelo Mercado Livre mudou. Reconecte.');
      await db.query('UPDATE ml_connections SET tokens=$2,expires_at=$3,updated_at=NOW() WHERE connection_id=$1', [owner, encryptPayload(JSON.stringify(tokens), this.encryptionKey), new Date(Date.now() + tokens.expires_in * 1000)]);
    }
    return { token: tokens.access_token, sellerId: row.seller_id };
  }
  async status(owner: string) {
    const row = (await this.pool.query('SELECT seller_id FROM ml_connections WHERE connection_id=$1', [owner])).rows[0];
    const operations = row ? (await this.pool.query('SELECT id,sheet_id,state,item_id,result,updated_at FROM ml_operations WHERE connection_id=$1 AND seller_id=$2 ORDER BY updated_at DESC LIMIT 100', [owner, row.seller_id])).rows.map(op => ({ id: op.id, sheetId: op.sheet_id, state: op.state, itemId: op.item_id, updatedAt: op.updated_at, warning: op.result?.warning, error: op.result?.error })) : [];
    return { configured: true, connected: Boolean(row), sellerId: row?.seller_id, operations };
  }
  async disconnect(owner: string) {
    return this.locked(owner, async db => {
      await db.query('DELETE FROM ml_oauth_states WHERE connection_id=$1', [owner]);
      await db.query('DELETE FROM ml_connections WHERE connection_id=$1', [owner]);
      return { connected: false };
    });
  }
  async category(owner: string, id: string) {
    if (!/^MLB\d+$/.test(id)) throw new Error('Categoria MLB inválida.');
    return this.locked(owner, async db => {
      const { token } = await this.access(db, owner);
      const [category, attributes] = await Promise.all([this.api.request('/categories/' + id, token), this.api.request('/categories/' + id + '/attributes', token)]);
      if (category?.id !== id || !Array.isArray(attributes)) throw new Error('Categoria retornada é inválida.');
      return { category, attributes };
    });
  }
  async pricingCategories(owner: string, title: unknown) {
    if (typeof title !== 'string' || title.trim().length < 3 || title.length > 250) throw new Error('Informe o nome do produto, com 3 a 250 caracteres.');
    return this.locked(owner, async db => {
      const { token } = await this.access(db, owner);
      const rows = await this.api.request('/sites/MLB/domain_discovery/search?' + new URLSearchParams({ q: title.trim(), limit: '4' }), token);
      if (!Array.isArray(rows)) throw new Error('O ML não retornou sugestões de categoria.');
      return { categories: rows.filter(r => /^MLB\d+$/.test(r?.category_id) && typeof r.category_name === 'string').slice(0, 4).map(r => ({ id: r.category_id, name: r.category_name })) };
    });
  }
  async pricingContext(owner: string, itemId: unknown) {
    return this.locked(owner, async db => {
      const { token, sellerId } = await this.access(db, owner);
      return readPricingContext(this.api, token, sellerId, itemId);
    });
  }
  async pricingQuote(owner: string, raw: unknown) {
    return this.locked(owner, async db => {
      const { token, sellerId } = await this.access(db, owner);
      return quotePricing(this.api, token, sellerId, raw);
    });
  }
  async quote(owner: string, categoryId: string, price: number, listingType: string) {
    if (!/^MLB\d+$/.test(categoryId) || !Number.isFinite(price) || price <= 0 || !['gold_special', 'gold_pro'].includes(listingType)) throw new Error('Informe categoria, preço e tipo de anúncio para consultar taxas.');
    return this.locked(owner, async db => {
      const { token } = await this.access(db, owner);
      const params = new URLSearchParams({ category_id: categoryId, price: String(price), listing_type_id: listingType, currency_id: 'BRL' });
      return { fees: await this.api.request('/sites/MLB/listing_prices?' + params, token), queriedAt: new Date().toISOString(), price, categoryId, listingType };
    });
  }
  async upload(owner: string, dataUrl: unknown) {
    if (typeof dataUrl !== 'string' || dataUrl.length > 6_000_000) throw new Error('Foto inválida ou maior que o limite.');
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('Envie uma foto JPEG, PNG ou WebP.');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length < 16 || bytes.length > 4_500_000) throw new Error('Foto inválida ou muito grande.');
    const validMagic = match[1] === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : match[1] === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!validMagic) throw new Error('O conteúdo não corresponde ao tipo de imagem informado.');
    return this.locked(owner, async db => {
      const { token } = await this.access(db, owner);
      const form = new FormData(); form.append('file', new Blob([bytes], { type: match[1] }), 'produto.' + match[1].split('/')[1]);
      const result = await this.api.request('/pictures/items/upload', token, 'POST', form);
      if (typeof result?.id !== 'string' || !/^[A-Za-z0-9_-]{5,128}$/.test(result.id)) throw new Error('O Mercado Livre não retornou o identificador da foto.');
      await db.query('INSERT INTO ml_pictures(connection_id,picture_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [owner, result.id]);
      return { pictureId: result.id };
    });
  }
  async prepare(owner: string, sessionId: string, raw: unknown): Promise<MlPreparedListing> {
    const draft = validateMlDraft(raw);
    return this.locked(owner, async db => {
      await this.assertSession(db, owner, sessionId);
      const { token, sellerId } = await this.access(db, owner);
      const published = (await db.query("SELECT id,state,item_id FROM ml_operations WHERE connection_id=$1 AND sheet_id=$2 AND state IN ('publishing','published','uncertain') LIMIT 1", [owner, draft.sheetId])).rows[0];
      if (published) throw new Error(`Esta ficha já tem publicação ${published.state}${published.item_id ? ': ' + published.item_id : ''}. Confira o resultado antes de criar outro anúncio.`);
      const pictures = await db.query('SELECT picture_id FROM ml_pictures WHERE connection_id=$1 AND picture_id=ANY($2::varchar[])', [owner, draft.pictureIds]);
      if (pictures.rows.length !== draft.pictureIds.length) throw new Error('Envie as fotos revisadas por esta conexão antes de publicar.');
      const [account, category, attributes] = await Promise.all([this.api.request('/users/me', token), this.api.request('/categories/' + draft.categoryId, token), this.api.request('/categories/' + draft.categoryId + '/attributes', token)]);
      if (String(account.id) !== sellerId || account.site_id !== 'MLB') throw new Error('Conta Mercado Livre Brasil inválida.');
      if (category.id !== draft.categoryId || category.settings?.listing_allowed === false || category.children_categories?.length) throw new Error('Escolha uma categoria final que permita anúncios.');
      const maxTitle = Math.min(120, Number(category.settings?.max_title_length) || 60);
      const isUp = Array.isArray(account.tags) && account.tags.includes('user_product_seller');
      if (Array.from(isUp ? draft.familyName : draft.title).length > maxTitle) throw new Error(`O nome ultrapassa ${maxTitle} caracteres permitidos pela categoria.`);
      if (category.settings?.max_pictures_per_item && draft.pictureIds.length > category.settings.max_pictures_per_item) throw new Error('Quantidade de fotos excede o limite da categoria.');
      if (!Array.isArray(attributes)) throw new Error('Não foi possível validar os atributos da categoria.');
      const required = attributes.filter((a: any) => a.tags?.required && !a.tags?.read_only).map((a: any) => a.id);
      const missing = required.filter((id: string) => !draft.attributes.some(a => a.id === id) && id !== 'SELLER_SKU');
      if (missing.length) throw new Error('Preencha os atributos obrigatórios: ' + missing.join(', '));
      const payload = buildMlPayload(draft, account.tags || []);
      const validation = await this.api.request('/items/validate', token, 'POST', payload);
      if (Array.isArray(validation?.cause) && validation.cause.some((c: any) => c.type === 'error')) throw new Error('O Mercado Livre rejeitou a validação: ' + validation.cause.filter((c: any) => c.type === 'error').map((c: any) => c.message).join('; '));
      await this.assertSession(db, owner, sessionId);
      const fingerprint = hash(JSON.stringify({ payload, description: draft.description, sellerId }));
      const id = randomUUID();
      const saved = (await db.query("INSERT INTO ml_operations(id,connection_id,seller_id,sheet_id,payload_hash,payload,description,endpoint,state) VALUES($1,$2,$3,$4,$5,$6,$7,'/items','prepared') ON CONFLICT(connection_id,sheet_id,payload_hash) DO UPDATE SET updated_at=NOW() WHERE ml_operations.state='prepared' RETURNING id,updated_at", [id, owner, sellerId, draft.sheetId, fingerprint, payload, draft.description])).rows[0];
      if (!saved) throw new Error('Existe uma tentativa anterior com estes dados. Confira o histórico de publicação.');
      const warnings = (Array.isArray(validation?.cause) ? validation.cause : []).filter((c: any) => c.type !== 'error').map((c: any) => String(c.message || c.code));
      if (isUp) warnings.push('Conta User Products: o Mercado Livre gera o título a partir do nome da família e dos atributos.');
      return { id: saved.id, hash: fingerprint, payload, description: draft.description, account: { id: sellerId, nickname: String(account.nickname || sellerId) }, warnings, expiresAt: new Date(new Date(saved.updated_at).getTime() + 600000).toISOString() };
    });
  }
  async publish(owner: string, sessionId: string, id: string, expectedHash: string) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Revisão de publicação inválida.');
    return this.locked(owner, async db => {
      await this.assertSession(db, owner, sessionId);
      const op = (await db.query('SELECT * FROM ml_operations WHERE id=$1 AND connection_id=$2 AND payload_hash=$3', [id, owner, expectedHash])).rows[0];
      if (!op) throw new Error('A revisão não pertence a esta conexão.');
      if (op.state === 'published') return op.result;
      if (op.state !== 'prepared') throw new Error(`Tentativa ${op.state}. Confira sua conta Mercado Livre antes de tentar publicar novamente.`);
      if (new Date(op.updated_at).getTime() < Date.now() - 600000) throw new Error('A revisão expirou. Prepare novamente.');
      const { token, sellerId } = await this.access(db, owner);
      if (sellerId !== op.seller_id) throw new Error('A conta mudou desde a revisão. Prepare novamente.');
      const competing = (await db.query("SELECT id FROM ml_operations WHERE connection_id=$1 AND sheet_id=$2 AND id<>$3 AND state IN ('published','publishing','uncertain')", [owner, op.sheet_id, id])).rows[0];
      if (competing) throw new Error('Esta ficha já tem outra tentativa de publicação.');
      await db.query("UPDATE ml_operations SET state='publishing',updated_at=NOW() WHERE id=$1", [id]);
      let item: any;
      try { item = await this.api.request(op.endpoint, token, 'POST', op.payload); }
      catch (e) {
        const uncertain = !(e instanceof MlApiError) || e.uncertain;
        await db.query('UPDATE ml_operations SET state=$2,result=$3,updated_at=NOW() WHERE id=$1', [id, uncertain ? 'uncertain' : 'failed', { error: e instanceof Error ? e.message : 'Falha de publicação.' }]);
        throw e;
      }
      if (!validItemId(item?.id) || String(item.seller_id) !== sellerId) { await db.query("UPDATE ml_operations SET state='uncertain',updated_at=NOW() WHERE id=$1", [id]); throw new Error('A resposta de publicação exige conferência na conta Mercado Livre. Não repita automaticamente.'); }
      const result: Record<string, unknown> = { itemId: item.id, userProductId: item.user_product_id || null, permalink: item.permalink, status: item.status, descriptionSaved: false };
      // Save the item identity before posting the description: never create it again after partial success.
      await db.query("UPDATE ml_operations SET state='published',item_id=$2,result=$3,updated_at=NOW() WHERE id=$1", [id, item.id, result]);
      if (op.description) {
        try { await this.api.request('/items/' + item.id + '/description', token, 'POST', { plain_text: op.description }); result.descriptionSaved = true; }
        catch { result.warning = 'Anúncio criado; a descrição precisa ser completada no Mercado Livre.'; }
        await db.query('UPDATE ml_operations SET result=$2,updated_at=NOW() WHERE id=$1', [id, result]);
      }
      return result;
    });
  }
  async item(owner: string, id: string) {
    if (!validItemId(id)) throw new Error('ID de anúncio MLB inválido.');
    return this.locked(owner, async db => {
      const { token, sellerId } = await this.access(db, owner);
      const item = await this.api.request('/items/' + id, token);
      if (String(item.seller_id) !== sellerId || item.id !== id) throw new Error('O anúncio não pertence à conta conectada.');
      return { itemId: item.id, title: item.title, price: item.price, quantity: item.available_quantity, status: item.status, lastUpdated: item.last_updated, userProductId: item.user_product_id || null, permalink: item.permalink };
    });
  }
  async sync(owner: string, sessionId: string, raw: any) {
    if (!raw || !validItemId(raw.itemId) || raw.confirmed !== true || typeof raw.expectedLastUpdated !== 'string') throw new Error('Revise a comparação antes de atualizar.');
    const patch: Record<string, number> = {};
    if (raw.price !== undefined) { if (!Number.isFinite(raw.price) || raw.price <= 0 || raw.price > 1e8) throw new Error('Preço inválido.'); patch.price = raw.price; }
    if (raw.quantity !== undefined) { if (!Number.isSafeInteger(raw.quantity) || raw.quantity < 0 || raw.quantity > 1e6) throw new Error('Estoque inválido.'); patch.available_quantity = raw.quantity; }
    if (!Object.keys(patch).length) throw new Error('Escolha ao menos um campo para sincronizar.');
    return this.locked(owner, async db => {
      await this.assertSession(db, owner, sessionId);
      const { token, sellerId } = await this.access(db, owner);
      const item = await this.api.request('/items/' + raw.itemId, token);
      if (item.id !== raw.itemId || String(item.seller_id) !== sellerId) throw new Error('O anúncio não pertence à conta conectada.');
      if (item.last_updated !== raw.expectedLastUpdated) throw new Error('O anúncio mudou. Recarregue a comparação.');
      if ('available_quantity' in patch && (item.user_product_id || item.shipping?.logistic_type === 'fulfillment' || item.variations?.length)) throw new Error('Estoque compartilhado, Full ou com variações exige gestão específica. Atualize no Mercado Livre.');
      const response = await this.api.request('/items/' + raw.itemId, token, 'PUT', patch);
      if (response?.id !== raw.itemId) throw new Error('Confira o resultado no Mercado Livre antes de repetir a atualização.');
      return { itemId: response.id, price: response.price, quantity: response.available_quantity, lastUpdated: response.last_updated };
    });
  }
}

