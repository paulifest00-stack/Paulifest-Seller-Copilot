import { gatewayLogger } from '../../security/logger.ts';
import type {
  GatewayBlingProductDTO,
  ProductStockInfo,
  BlingDepositBalance,
  BlingProductQuickView
} from '../../types/contracts.ts';

export interface BlingProductClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export const BLING_DOCUMENTED_PRODUCT_FIELDS = [
  'id',
  'nome',
  'codigo',
  'preco',
  'precoCusto',
  'tipo',
  'situacao',
  'formato',
  'descricaoCurta',
  'descricaoComplementar',
  'unidade',
  'pesoLiquido',
  'pesoBruto',
  'gtin',
  'gtinEmbalagem',
  'marca',
  'dimensoes',
  'tributacao',
  'midia',
  'imagensUrl',
  'estoque'
] as const;

export class BlingProductError extends Error {
  public status: number;
  public code: string;
  public retryAfterMs?: number;

  constructor(message: string, status: number, code: string, retryAfterMs?: number) {
    super(message);
    this.name = 'BlingProductError';
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, BlingProductError.prototype);
  }
}

export interface FetchProductResult {
  product: GatewayBlingProductDTO;
  warnings: string[];
  unknownFields: string[];
  retrievedAt: string;
}

export class BlingProductClient {
  static parseCostPrice = parseCostPrice;

  private baseUrl: string;
  private timeoutMs: number;

  constructor(options: BlingProductClientOptions = {}) {
    this.baseUrl = (options.baseUrl || 'https://api.bling.com.br').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs || 8000;
  }

  /**
   * Executa a busca de produto por ID na API v3 do Bling.
   * Endpoint oficial: GET /Api/v3/produtos/{idProduto}
   * Headers obrigatórios:
   * - Authorization: Bearer <accessToken>
   * - Accept: application/json
   * - enable-jwt: 1
   */
  async fetchProduct(productId: string, accessToken: string): Promise<FetchProductResult> {
    const trimmedId = productId.trim();
    if (!trimmedId) {
      throw new BlingProductError('ID do produto não pode ser vazio.', 400, 'INVALID_PRODUCT_ID');
    }

    const url = `${this.baseUrl}/Api/v3/produtos/${encodeURIComponent(trimmedId)}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'enable-jwt': '1'
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.message?.includes('timeout') || err?.code === 23) {
        gatewayLogger.warn(`[BlingProductClient] Timeout ao consultar produto #${trimmedId} no Bling (> ${this.timeoutMs}ms)`);
        throw new BlingProductError(`Tempo limite de ${this.timeoutMs}ms esgotado na consulta ao Bling.`, 504, 'BLING_TIMEOUT');
      }
      gatewayLogger.error(`[BlingProductClient] Falha de rede ao consultar produto #${trimmedId}:`, err?.message || err);
      throw new BlingProductError(`Erro de rede ao conectar à API do Bling: ${err?.message || 'Falha de conexão'}`, 502, 'BLING_NETWORK_ERROR');
    }

    // Tratamento semântico dos códigos de resposta HTTP
    if (response.status === 401) {
      // 401 deve propagar status 401 para permitir auto-refresh no BlingTokenManager
      throw new BlingProductError('Credencial do Bling não autorizada ou expirada (401).', 401, 'UNAUTHORIZED');
    }

    if (response.status === 403) {
      throw new BlingProductError('Permissão insuficiente para consultar produtos no Bling (403).', 403, 'BLING_FORBIDDEN');
    }

    if (response.status === 404) {
      throw new BlingProductError(`Produto #${trimmedId} não encontrado no Bling.`, 404, 'BLING_PRODUCT_NOT_FOUND');
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;
      const retryAfterMs = (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) ? retryAfterSeconds * 1000 : 5000;
      throw new BlingProductError('Limite de requisições excedido no Bling (429).', 429, 'BLING_RATE_LIMITED', retryAfterMs);
    }

    if (response.status >= 500) {
      throw new BlingProductError(`Erro interno do servidor Bling (${response.status}).`, 502, 'BLING_SERVER_ERROR');
    }

    if (!response.ok) {
      throw new BlingProductError(`Falha inesperada na API do Bling (HTTP ${response.status}).`, response.status, 'BLING_API_ERROR');
    }

    // Processamento do payload JSON retornado
    let jsonBody: any;
    try {
      jsonBody = await response.json();
    } catch {
      throw new BlingProductError('Resposta do Bling não contém JSON válido.', 422, 'INVALID_BLING_PAYLOAD');
    }

    if (!jsonBody || typeof jsonBody !== 'object' || !jsonBody.data || typeof jsonBody.data !== 'object') {
      throw new BlingProductError('Envelope da resposta do Bling inválido (propriedade "data" ausente ou não-objeto).', 422, 'INVALID_BLING_PAYLOAD');
    }

    const rawData = jsonBody.data as Record<string, unknown>;

    // Validação estrita de Identidade: ID retornado DEVE ser igual ao solicitado
    const returnedId = rawData.id !== undefined && rawData.id !== null ? String(rawData.id).trim() : '';
    if (!returnedId || returnedId !== trimmedId) {
      gatewayLogger.warn(`[BlingProductClient] Divergência de identidade de produto: solicitado=${trimmedId}, retornado=${returnedId}`);
      throw new BlingProductError(
        `Incoerência de identidade: ID retornado pelo Bling (#${returnedId}) difere do solicitado (#${trimmedId}).`,
        422,
        'INVALID_BLING_PAYLOAD'
      );
    }

    // Sanitização contra whitelist oficial e isolamento de campos desconhecidos
    const unknownFields: string[] = [];
    const warnings: string[] = [];
    const sanitizedProduct: GatewayBlingProductDTO = {};

    for (const key of Object.keys(rawData)) {
      if (!BLING_DOCUMENTED_PRODUCT_FIELDS.includes(key as any)) {
        unknownFields.push(key);
      }
    }

    // Cópia estrita dos campos da whitelist
    if (rawData.id !== undefined && rawData.id !== null) sanitizedProduct.id = rawData.id as any;
    if (typeof rawData.nome === 'string' && rawData.nome.trim()) sanitizedProduct.nome = rawData.nome.trim();
    if (rawData.codigo !== undefined && rawData.codigo !== null) sanitizedProduct.codigo = String(rawData.codigo).trim();
    if (rawData.preco !== undefined) sanitizedProduct.preco = rawData.preco as any;
    if (rawData.precoCusto !== undefined) sanitizedProduct.precoCusto = rawData.precoCusto as any;
    if (typeof rawData.tipo === 'string') sanitizedProduct.tipo = rawData.tipo;
    if (typeof rawData.situacao === 'string') sanitizedProduct.situacao = rawData.situacao;
    if (typeof rawData.formato === 'string') sanitizedProduct.formato = rawData.formato;
    if (typeof rawData.descricaoCurta === 'string') sanitizedProduct.descricaoCurta = rawData.descricaoCurta;
    if (typeof rawData.descricaoComplementar === 'string') sanitizedProduct.descricaoComplementar = rawData.descricaoComplementar;
    if (typeof rawData.unidade === 'string') sanitizedProduct.unidade = rawData.unidade;
    if (rawData.pesoLiquido !== undefined) sanitizedProduct.pesoLiquido = rawData.pesoLiquido as any;
    if (rawData.pesoBruto !== undefined) sanitizedProduct.pesoBruto = rawData.pesoBruto as any;
    if (rawData.gtin !== undefined) sanitizedProduct.gtin = rawData.gtin as any;
    if (rawData.gtinEmbalagem !== undefined) sanitizedProduct.gtinEmbalagem = rawData.gtinEmbalagem as any;
    if (typeof rawData.marca === 'string') sanitizedProduct.marca = rawData.marca;

    if (typeof rawData.dimensoes === 'object' && rawData.dimensoes !== null) {
      const dim = rawData.dimensoes as Record<string, unknown>;
      sanitizedProduct.dimensoes = {
        largura: dim.largura as any,
        altura: dim.altura as any,
        profundidade: dim.profundidade as any
      };
    }

    if (typeof rawData.tributacao === 'object' && rawData.tributacao !== null) {
      const trib = rawData.tributacao as Record<string, unknown>;
      sanitizedProduct.tributacao = {
        ncm: typeof trib.ncm === 'string' ? trib.ncm : undefined,
        origem: typeof trib.origem === 'number' ? trib.origem : undefined,
        cest: typeof trib.cest === 'string' ? trib.cest : undefined
      };
    }

    if (typeof rawData.midia === 'object' && rawData.midia !== null) {
      sanitizedProduct.midia = rawData.midia as any;
    }

    if (Array.isArray(rawData.imagensUrl)) {
      sanitizedProduct.imagensUrl = rawData.imagensUrl.filter(u => typeof u === 'string');
    }

    if (typeof rawData.estoque === 'object' && rawData.estoque !== null) {
      sanitizedProduct.estoque = rawData.estoque as Record<string, unknown>;
    }

    return {
      product: sanitizedProduct,
      warnings,
      unknownFields,
      retrievedAt: new Date().toISOString()
    };
  }

  /**
   * Consulta os saldos de estoque por depósito na API v3 Oficial do Bling.
   * Endpoint oficial: GET /Api/v3/estoques/saldos?idsProdutos[]={idProduto}
   * Mapeia para o contrato Schema v3 ProductStockInfo (Fact-or-Omit).
   */
  async fetchStockBalances(productId: string, accessToken: string): Promise<ProductStockInfo | null> {
    const trimmedId = productId.trim();
    if (!trimmedId) {
      throw new BlingProductError('ID do produto não pode ser vazio.', 400, 'INVALID_PRODUCT_ID');
    }

    const url = `${this.baseUrl}/Api/v3/estoques/saldos?idsProdutos[]=${encodeURIComponent(trimmedId)}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'enable-jwt': '1'
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.message?.includes('timeout') || err?.code === 23) {
        gatewayLogger.warn(`[BlingProductClient] Timeout ao consultar estoque #${trimmedId} no Bling (> ${this.timeoutMs}ms)`);
        throw new BlingProductError(`Tempo limite de ${this.timeoutMs}ms esgotado na consulta de estoque ao Bling.`, 504, 'BLING_TIMEOUT');
      }
      gatewayLogger.error(`[BlingProductClient] Falha de rede ao consultar estoque #${trimmedId}:`, err?.message || err);
      throw new BlingProductError(`Erro de rede ao conectar à API de estoque do Bling: ${err?.message || 'Falha de conexão'}`, 502, 'BLING_NETWORK_ERROR');
    }

    if (response.status === 401) {
      throw new BlingProductError('Credencial do Bling não autorizada ou expirada (401).', 401, 'UNAUTHORIZED');
    }

    if (response.status === 403) {
      throw new BlingProductError('Permissão insuficiente para consultar estoque no Bling (403).', 403, 'BLING_FORBIDDEN');
    }

    // Se a API retornar 404 para saldos deste produto, significa ausência de registro de estoque
    if (response.status === 404) {
      return null;
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;
      const retryAfterMs = (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) ? retryAfterSeconds * 1000 : 5000;
      throw new BlingProductError('Limite de requisições excedido no Bling (429).', 429, 'BLING_RATE_LIMITED', retryAfterMs);
    }

    if (response.status >= 500) {
      throw new BlingProductError(`Erro interno do servidor Bling (${response.status}).`, 502, 'BLING_SERVER_ERROR');
    }

    if (!response.ok) {
      throw new BlingProductError(`Falha inesperada na API de estoque do Bling (HTTP ${response.status}).`, response.status, 'BLING_API_ERROR');
    }

    let jsonBody: any;
    try {
      jsonBody = await response.json();
    } catch {
      throw new BlingProductError('Resposta de estoque do Bling não contém JSON válido.', 422, 'INVALID_BLING_PAYLOAD');
    }

    if (!jsonBody || typeof jsonBody !== 'object' || !Array.isArray(jsonBody.data)) {
      throw new BlingProductError('Envelope da resposta de estoque do Bling inválido (propriedade "data" ausente ou não-array).', 422, 'INVALID_BLING_PAYLOAD');
    }

    const rawList = jsonBody.data as unknown[];
    if (rawList.length === 0) {
      return null; // Fact-or-Omit: nenhum registro de saldo retornado
    }

    const deposits: BlingDepositBalance[] = [];

    for (const item of rawList) {
      if (!item || typeof item !== 'object') {
        throw new BlingProductError('Item do payload de estoque malformado.', 422, 'INVALID_BLING_PAYLOAD');
      }

      const rec = item as Record<string, any>;

      // Validação de divergência de produto caso produto esteja informado
      if (rec.produto && typeof rec.produto === 'object') {
        const returnedProdId = rec.produto.id !== undefined && rec.produto.id !== null ? String(rec.produto.id).trim() : '';
        if (returnedProdId && returnedProdId !== trimmedId) {
          gatewayLogger.warn(`[BlingProductClient] Divergência no saldo de estoque: solicitado=#${trimmedId}, retornado=#${returnedProdId}`);
          throw new BlingProductError(
            `Incoerência no retorno de estoque: produto #${returnedProdId} difere do solicitado #${trimmedId}.`,
            422,
            'INVALID_BLING_PAYLOAD'
          );
        }
      }

      // Validação e extração do depósito
      const depObj = typeof rec.deposito === 'object' && rec.deposito !== null ? rec.deposito : {};
      const depositId = depObj.id !== undefined && depObj.id !== null ? depObj.id : (rec.depositoId ?? 'default');
      const depositName = typeof depObj.nome === 'string' && depObj.nome.trim()
        ? depObj.nome.trim()
        : (typeof depObj.descricao === 'string' && depObj.descricao.trim() ? depObj.descricao.trim() : 'Geral');

      // Validação estrita dos saldos: podem ser 0, positivos ou negativos, mas devem ser números finitos
      const parseSaldo = (val: unknown, fieldName: string): number => {
        if (typeof val === 'number') {
          if (!Number.isFinite(val)) {
            throw new BlingProductError(`Campo "${fieldName}" contém número não-finito (NaN/Infinity).`, 422, 'INVALID_BLING_PAYLOAD');
          }
          return val;
        }
        if (typeof val === 'string') {
          const parsed = Number(val.trim().replace(',', '.'));
          if (!Number.isFinite(parsed)) {
            throw new BlingProductError(`Campo "${fieldName}" contém string numérica inválida.`, 422, 'INVALID_BLING_PAYLOAD');
          }
          return parsed;
        }
        throw new BlingProductError(`Campo "${fieldName}" de saldo ausente ou em formato inválido.`, 422, 'INVALID_BLING_PAYLOAD');
      };

      const physicalBalance = parseSaldo(rec.saldoFisico, 'saldoFisico');
      const virtualBalance = parseSaldo(rec.saldoVirtual, 'saldoVirtual');

      deposits.push({
        depositId,
        depositName,
        physicalBalance,
        virtualBalance
      });
    }

    if (deposits.length === 0) {
      return null;
    }

    const physicalTotal = Math.round(deposits.reduce((sum, d) => sum + d.physicalBalance, 0) * 10000) / 10000;
    const virtualTotal = Math.round(deposits.reduce((sum, d) => sum + d.virtualBalance, 0) * 10000) / 10000;

    return {
      physicalTotal,
      virtualTotal,
      deposits,
      retrievedAt: new Date().toISOString(),
      source: 'bling_erp'
    };
  }

  /**
   * Consulta Quick View combinada de produto (custo + metadados básicos) e saldos de estoque.
   * Não duplica SSOT nem cria mutações. Read-only.
   */
  async fetchQuickView(productId: string, accessToken: string): Promise<BlingProductQuickView> {
    const trimmedId = productId.trim();
    if (!trimmedId) {
      throw new BlingProductError('ID do produto não pode ser vazio.', 400, 'INVALID_PRODUCT_ID');
    }

    // Consulta em paralelo produto e saldos de estoque
    const [productResult, stockResult] = await Promise.all([
      this.fetchProduct(trimmedId, accessToken),
      this.fetchStockBalances(trimmedId, accessToken)
    ]);

    const costPrice = parseCostPrice(productResult.product.precoCusto);

    return {
      productId: trimmedId,
      sku: productResult.product.codigo,
      name: productResult.product.nome,
      costPrice,
      stock: stockResult,
      stockInfo: stockResult,
      unit: productResult.product.unidade,
      retrievedAt: new Date().toISOString()
    };
  }
}

/**
 * Validação e normalização de preço de custo segundo Fact-or-Omit:
 * - ausente / null / undefined / '' -> null (missing)
 * - 0 explícito -> 0 (preservado como fato auditado)
 * - positivo -> número arredondado a 2 casas
 * - negativo / NaN / malformado -> null (inválido, não fabricar custo)
 */
export function parseCostPrice(val: unknown): number | null {
  if (val === null || val === undefined || val === '') {
    return null;
  }
  let num: number;
  if (typeof val === 'number') {
    num = val;
  } else if (typeof val === 'string') {
    const cleaned = val.trim().replace(',', '.');
    if (!cleaned) return null;
    num = Number(cleaned);
  } else {
    return null;
  }

  if (Number.isNaN(num) || !Number.isFinite(num) || num < 0) {
    return null;
  }

  return Math.round(num * 100) / 100;
}
