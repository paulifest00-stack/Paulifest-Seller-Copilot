import { signRevision, mergeRevision } from "./revision.ts";
import { normalizeFiscalCode, normalizeFiscalInput } from "./fiscal.ts";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Pool } from "pg";
import type { GatewayConfig } from "../config.ts";
import { BlingTokenManager } from "../integrations/bling/bling-token-manager.ts";
import {
  BlingProductError,
  BlingProductClient,
} from "../integrations/bling/bling-product-client.ts";
import { emptyInput, type ProductInput, type Product } from "./types.ts";

type Raw = Record<string, any>;
const num = (v: unknown): number | null =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))
    ? Number(v)
    : null;
const text = (v: unknown) => (typeof v === "string" ? v : "");
const fail = (message: string, status = 422, code = "validation"): never => {
  throw new BlingProductError(message, status, code);
};
const canonical = (value: any): any => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const version = (product: Raw) =>
  "v2:" + createHash("sha256").update(JSON.stringify(canonical(product))).digest("hex");
/** Convert the desired total into entry/exit movements, preserving other balances. */
export function stockMovements(balance: Raw, deposits: Raw[], desired: number, preferred?: string) {
  const current = Number(balance?.saldoFisicoTotal ?? 0);
  const delta = Math.round((desired - current) * 1e8) / 1e8;
  if (!delta) return [];
  const active = deposits.filter(d => /^[1-9]\d*$/.test(String(d.id)));
  const chosen = preferred ? active.find(d => String(d.id) === preferred) :
    active.find(d => d.padrao === true) ?? active.find(d => balance?.depositos?.some((b: Raw) => String(b.id) === String(d.id))) ?? active[0];
  if (!chosen) return fail("Nenhum depósito ativo encontrado no Bling.");
  if (delta > 0) return [{ deposito: { id: Number(chosen.id) }, operacao: "E", quantidade: delta }];
  let remaining = -delta;
  const ordered = [chosen, ...active.filter(d => d.id !== chosen.id)];
  const moves: Raw[] = [];
  for (const deposit of ordered) {
    const available = Number(balance?.depositos?.find((b: Raw) => String(b.id) === String(deposit.id))?.saldoFisico ?? 0);
    const quantity = Math.min(remaining, Math.max(0, available));
    if (quantity > 0) moves.push({ deposito: { id: Number(deposit.id) }, operacao: "S", quantidade: quantity });
    remaining = Math.round((remaining - quantity) * 1e8) / 1e8;
    if (!remaining) break;
  }
  if (remaining > 1e-8) fail("Não há saldo suficiente nos depósitos ativos para esse ajuste.");
  return moves;
}
export function validGtin(code: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const ds = code.split("").map(Number);
  const check = ds.pop();
  return (
    (10 -
      (ds.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0) %
        10)) %
      10 ===
    check
  );
}
export function mapProduct(raw: Raw): Product {
  const dimensions = raw.dimensoes ?? {};
  const factor =
    dimensions.unidadeMedida === 0
      ? 100
      : dimensions.unidadeMedida === 2
        ? 0.1
        : 1;
  const images = [
    ...(raw.midia?.imagens?.externas ?? []),
    ...(raw.midia?.imagens?.internas ?? []),
  ]
    .map((i: Raw) => ({ url: text(i.link ?? i.url), local: false }))
    .filter((i: { url: string }) => i.url);
  if (!images.length && raw.imagemURL)
    images.push({ url: raw.imagemURL, local: false });
  const product: Product = {
    ...emptyInput(),
    id: String(raw.id),
    remoteId: String(raw.id),
    status: raw.situacao === "I" ? "inactive" : "active",
    name: text(raw.nome),
    sku: text(raw.codigo),
    gtin: text(raw.gtin),
    gtinPackage: text(raw.gtinEmbalagem),
    ncm: normalizeFiscalCode(text(raw.tributacao?.ncm)),
    cest: normalizeFiscalCode(text(raw.tributacao?.cest)),
    taxOrigin:
      raw.tributacao?.origem == null ? "" : String(raw.tributacao.origem),
    category: raw.categoria?.id ? String(raw.categoria.id) : "",
    brand: text(raw.marca),
    unit: text(raw.unidade) || "UN",
    price: num(raw.preco),
    cost: num(raw.fornecedor?.precoCusto ?? raw.precoCusto),
    stock: num(raw.estoque?.saldoFisicoTotal),
    netWeightKg: num(raw.pesoLiquido),
    grossWeightKg: num(raw.pesoBruto),
    widthCm:
      num(dimensions.largura) === null
        ? null
        : Number(dimensions.largura) * factor,
    heightCm:
      num(dimensions.altura) === null
        ? null
        : Number(dimensions.altura) * factor,
    depthCm:
      num(dimensions.profundidade) === null
        ? null
        : Number(dimensions.profundidade) * factor,
    description: text(raw.descricaoCurta) || text(raw.descricaoComplementar),
    customFields: (raw.camposCustomizados ?? []).map((f: Raw) => ({ id: String(f.idCampoCustomizado), value: text(f.valor), item: text(f.item) })),
    images,
    origins: {},
    syncStatus: "synced",
    updatedAt: text(raw.dataAlteracao) || "",
  };
  const { updatedAt, origins, syncStatus, ...editable } = product;
  product.version = version(editable);
  return product;
}
export function validateMobileInput(input: ProductInput) {
  if (!input || typeof input !== "object") fail("Cadastro inválido.");
  for (const key of [
    "name",
    "sku",
    "gtin",
    "gtinPackage",
    "ncm",
    "cest",
    "taxOrigin",
    "category",
    "brand",
    "unit",
    "description",
  ] as const)
    if (typeof input[key] !== "string") fail(`Campo inválido: ${key}.`);
  if (!input.name.trim() || input.name.length > 120 || !input.sku.trim())
    fail("Informe nome (até 120 caracteres) e SKU.");
  if (input.description.length > 5000) fail("Descrição deve ter até 5.000 caracteres.");
  if (!["active", "inactive"].includes(input.status))
    fail("Situação inválida.");
  for (const k of ["gtin", "gtinPackage"] as const)
    if (input[k] && !validGtin(input[k])) fail("GTIN/EAN inválido.");
  if (input.gtinPackage.length === 14)
    fail("O GTIN da embalagem deve ter 8, 12 ou 13 dígitos.");
  if (input.ncm && !/^\d{8}$/.test(normalizeFiscalCode(input.ncm))) fail("NCM deve ter 8 dígitos.");
  if (input.cest && !/^\d{7}$/.test(normalizeFiscalCode(input.cest)))
    fail("CEST deve ter 7 dígitos.");
  if (input.taxOrigin && !/^[0-8]$/.test(input.taxOrigin))
    fail("Origem fiscal inválida.");
  if (input.category && !/^[1-9]\d*$/.test(input.category))
    fail("Escolha uma categoria do Bling.");
  for (const k of [
    "price",
    "cost",
    "stock",
    "netWeightKg",
    "grossWeightKg",
    "widthCm",
    "heightCm",
    "depthCm",
  ] as const)
    if (
      input[k] !== null &&
      (typeof input[k] !== "number" ||
        !Number.isFinite(input[k]) ||
        input[k]! < 0)
    )
      fail("Valores numéricos inválidos.");
  if (
    !Array.isArray(input.images) ||
    input.images.length > 10 ||
    input.images.some(
      (i) => typeof i?.url !== "string" || !i.url.startsWith("https://"),
    )
  )
    fail("Envie as fotos antes de salvar.");
  if (input.customFields !== undefined && (!Array.isArray(input.customFields) || input.customFields.length > 100 || input.customFields.some(f => !/^[1-9]\d*$/.test(f.id) || typeof f.value !== "string" || f.value.length > 5000 || (f.item !== undefined && typeof f.item !== "string")))) fail("Atributos inválidos.");
  const critical = [
    "sku",
    "gtin",
    "gtinPackage",
    "ncm",
    "cest",
    "taxOrigin",
    "price",
    "cost",
    "stock",
    "netWeightKg",
    "grossWeightKg",
    "widthCm",
    "heightCm",
    "depthCm",
  ];
  if (critical.some((k) => (input.origins as Raw)?.[k] === "suggested"))
    fail("Confirme os dados críticos sugeridos antes de salvar.");
}
export function productPayload(
  input: ProductInput,
  previous?: Product,
  raw?: Raw,
): Raw {
  input = normalizeFiscalInput(input);
  const out: Raw = {};
  const mapping: Record<string, string> = {
    name: "nome",
    sku: "codigo",
    gtin: "gtin",
    gtinPackage: "gtinEmbalagem",
    brand: "marca",
    unit: "unidade",
    price: "preco",
    netWeightKg: "pesoLiquido",
    grossWeightKg: "pesoBruto",
    description: "descricaoCurta",
  };
  for (const [key, destination] of Object.entries(mapping)) {
    const value = (input as unknown as Raw)[key];
    if (!previous || value !== (previous as unknown as Raw)[key] || (key === "description" && value && !raw?.descricaoCurta)) {
      if (value === null) {
        if (previous && (previous as unknown as Raw)[key] !== null)
          fail("Para limpar preço ou peso, informe zero.");
      } else
        out[destination] =
          typeof value === "string" && ["name", "sku"].includes(key)
            ? value.trim()
            : value;
    }
  }
  if (!previous) {
    out.tipo = "P";
    out.formato = "S";
  }
  if (!previous || input.status !== previous.status)
    out.situacao = input.status === "active" ? "A" : "I";
  if (input.category && (!previous || input.category !== previous.category))
    out.categoria = { id: Number(input.category) };
  if (previous?.category && !input.category)
    fail("Para remover a categoria, use o Bling.");
  if (
    !previous ||
    ["ncm", "cest", "taxOrigin"].some(
      (k) => (input as unknown as Raw)[k] !== (previous as unknown as Raw)[k],
    )
  )
    out.tributacao = {
      ...(raw?.tributacao ?? {}),
      ncm: input.ncm,
      cest: input.cest,
      ...(input.taxOrigin !== "" ? { origem: Number(input.taxOrigin) } : {}),
    };
  if (previous?.taxOrigin && !input.taxOrigin)
    fail("Para limpar a origem fiscal, use o Bling.");
  if (
    !previous ||
    ["widthCm", "heightCm", "depthCm"].some(
      (k) => (input as unknown as Raw)[k] !== (previous as unknown as Raw)[k],
    )
  )
    out.dimensoes = {
      unidadeMedida: 1,
      largura: input.widthCm ?? 0,
      altura: input.heightCm ?? 0,
      profundidade: input.depthCm ?? 0,
    };
  if (
    !previous ||
    JSON.stringify(input.images.map((i) => i.url)) !==
      JSON.stringify(previous.images.map((i) => i.url))
  )
    out.midia = {
      video: raw?.midia?.video ?? { url: "" },
      imagens: { imagensURL: input.images.map((i) => ({ link: i.url })) },
    };
  if (input.customFields && JSON.stringify(input.customFields) !== JSON.stringify(previous?.customFields ?? [])) {
    const fields = [...(raw?.camposCustomizados ?? [])];
    for (const field of input.customFields) {
      const old = fields.findIndex((f: Raw) => String(f.idCampoCustomizado) === field.id);
      const next = { ...(old >= 0 ? fields[old] : {}), idCampoCustomizado: Number(field.id), valor: field.value, item: field.item ?? "" };
      if (old >= 0) fields[old] = next; else fields.push(next);
    }
    out.camposCustomizados = fields;
  }
  return out;
}
export function verifyWebhook(
  raw: Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(
    Buffer.from(signature.slice(7), "hex"),
    createHmac("sha256", secret).update(raw).digest(),
  );
}

export class MobileCatalog {
  private queues = new Map<string, Promise<unknown>>();
  constructor(
    private pool: Pool,
    private config: GatewayConfig,
    private tokens: BlingTokenManager,
    private legacy: BlingProductClient,
  ) {}
  private async request(
    connection: string,
    path: string,
    method = "GET",
    body?: Raw,
  ): Promise<any> {
    const previous = this.queues.get(connection) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        await new Promise((r) => setTimeout(r, 360));
        return this.tokens.executeWithBlingAuth(connection, async (token) => {
          let response: Response;
          try {
            response = await fetch(
              `${this.config.blingBaseUrl}/Api/v3/${path}`,
              {
                method,
                headers: {
                  Authorization: `Bearer ${token}`,
                  "enable-jwt": "1",
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(15000),
              },
            );
          } catch {
            fail(
              method === "GET"
                ? "Não foi possível consultar o Bling."
                : "Resultado da gravação incerto. Atualize o produto antes de tentar novamente.",
              502,
              method === "GET" ? "unknown" : "write_uncertain",
            );
          }
          if (!response!.ok) {
            const status = response!.status;
            fail(
              status === 403
                ? "O aplicativo Bling não tem os escopos necessários."
                : status === 429
                  ? "Limite do Bling atingido. Aguarde e tente novamente."
                  : `Bling rejeitou a operação (HTTP ${status}).`,
              status,
              status === 401
                ? "unauthorized"
                : status === 404
                  ? "not_found"
                  : status === 400
                    ? "validation"
                    : "unknown",
            );
          }
          if (response!.status === 204) return null;
          const data = (await response!.json()) as Raw;
          return data.data;
        });
      });
    this.queues.set(connection, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(connection) === next) this.queues.delete(connection);
    }
  }
  async get(connection: string, id: string) {
    if (!/^[1-9]\d*$/.test(id)) fail("Produto inválido.");
    const raw = await this.request(connection, `produtos/${id}`);
    if (!raw || String(raw.id) !== id) fail("Identidade do produto inválida.");
    const balance = await this.request(
      connection,
      `estoques/saldos?idsProdutos[]=${id}`,
    );
    if (
      !Array.isArray(balance) ||
      balance.length > 1 ||
      (balance[0] && String(balance[0].produto?.id) !== id)
    )
      fail("Saldo de outro produto recebido.");
    raw.estoque = {
      ...raw.estoque,
      saldoFisicoTotal: balance[0]?.saldoFisicoTotal ?? null,
    };
    const product = mapProduct(raw);
    product.version = signRevision(product, connection, this.config.jwtSecret);
    return { raw, product, balance: balance[0] };
  }
  async list(
    connection: string,
    query: string,
    page: number,
    limit: number,
    incomplete: boolean,
  ) {
    if (query && page === 1) {
      const found = await this.find(connection, query);
      if (found) {
        const missing =
          [
            found.name,
            found.sku,
            found.gtin,
            found.ncm,
            found.price,
            found.grossWeightKg,
          ].filter((v) => v == null || v === "").length +
          (found.images.length ? 0 : 1);
        return {
          items:
            incomplete && missing === 0
              ? []
              : [
                  {
                    id: found.id,
                    name: found.name,
                    sku: found.sku,
                    gtin: found.gtin,
                    price: found.price,
                    stock: found.stock,
                    status: found.status,
                    syncStatus: "synced",
                    updatedAt: found.updatedAt,
                    thumbnail: found.images[0]?.url,
                    missingCount: missing,
                  },
                ],
        };
      }
    }
    const params = new URLSearchParams({
      pagina: String(page),
      limite: String(limit),
      criterio: "5",
      tipo: "P",
    });
    if (query) params.set("nome", query);
    const rows = await this.request(connection, `produtos?${params}`);
    if (!Array.isArray(rows)) fail("Lista inválida.");
    const items = rows.map((raw: Raw) => {
      const p = mapProduct(raw);
      const missing =
        ["name", "sku", "gtin", "ncm", "price", "grossWeightKg"].filter(
          (k) =>
            (p as unknown as Raw)[k] == null || (p as unknown as Raw)[k] === "",
        ).length + (p.images.length ? 0 : 1);
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        gtin: p.gtin,
        price: p.price,
        stock: p.stock,
        status: p.status,
        syncStatus: "synced",
        updatedAt: p.updatedAt,
        thumbnail: p.images[0]?.url,
        missingCount: missing,
      };
    });
    // List payload omits fiscal and weight data: do not claim an accurate completeness score.
    if (incomplete) {
      for (let i = 0; i < rows.length; i++) {
        const { product: p } = await this.get(connection, String(rows[i].id));
        items[i].missingCount =
          [p.name, p.sku, p.gtin, p.ncm, p.price, p.grossWeightKg].filter(
            (v) => v == null || v === "",
          ).length + (p.images.length ? 0 : 1);
      }
    }
    return {
      items: incomplete
        ? items.filter((i: Raw) => i.missingCount > 0)
        : items.map((i: Raw) => ({ ...i, missingCount: 0 })),
      nextCursor: rows.length === limit ? String(page + 1) : undefined,
    };
  }
  async find(connection: string, code: string) {
    for (const key of /^\d{8,14}$/.test(code)
      ? ["gtins[]", "codigos[]"]
      : ["codigos[]"]) {
      const params = new URLSearchParams({
        [key]: code,
        criterio: "5",
        limite: "100",
      });
      const rows = await this.request(connection, `produtos?${params}`);
      if (!Array.isArray(rows)) fail("Busca inválida.");
      for (const row of rows) {
        const product = (await this.get(connection, String(row.id))).product;
        if (
          key === "gtins[]"
            ? product.gtin === code || product.gtinPackage === code
            : product.sku.toUpperCase() === code.toUpperCase()
        )
          return product;
      }
    }
    return null;
  }
  async categories(connection: string) {
    let rows: Raw[] = [];
    for (let page = 1; page <= 100; page++) {
      const batch = await this.request(
        connection,
        `categorias/produtos?pagina=${page}&limite=100`,
      );
      if (!Array.isArray(batch)) fail("Categorias inválidas.");
      rows.push(...batch);
      if (batch.length < 100) {
        const byId = new Map(rows.map(r => [String(r.id), r]));
        const path = (r: Raw, seen = new Set<string>()): string => {
          const id = String(r.id), name = text(r.descricao ?? r.nome);
          if (seen.has(id)) return name;
          seen.add(id);
          const parent = byId.get(String(r.categoriaPai?.id));
          return parent ? `${path(parent, seen)} › ${name}` : name;
        };
        return rows.map(r => ({ id: String(r.id), name: path(r) })).sort((a,b) => a.name.localeCompare(b.name, "pt-BR"));
      }
    }
    return fail("Quantidade de categorias excedida.");
  }
  private async pages(connection: string, endpoint: string) {
    const rows: Raw[] = [];
    for (let page = 1; page <= 100; page++) {
      const batch = await this.request(connection, `${endpoint}${endpoint.includes("?") ? "&" : "?"}pagina=${page}&limite=100`);
      if (!Array.isArray(batch)) return fail("Resposta de categorias inválida.");
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
    return fail("Há categorias demais para carregar. Refine a busca.");
  }
  async stores(connection: string) {
    return (await this.pages(connection, "canais-venda?situacao=1")).map(r => ({ id: String(r.id), name: text(r.descricao), type: text(r.tipo) }));
  }
  private async store(connection: string, storeId: string) {
    if (!/^[1-9]\d*$/.test(storeId)) return fail("Loja inválida.");
    const store = (await this.stores(connection)).find(r => r.id === storeId);
    if (!store) return fail("Loja não encontrada ou desativada.");
    return store;
  }
  async categoryLinks(connection: string, storeId: string) {
    await this.store(connection, storeId);
    return (await this.pages(connection, `categorias/lojas?idLoja=${storeId}`))
      .filter(r => String(r.loja?.id) === storeId)
      .map(r => ({ id: String(r.id), categoryId: String(r.categoriaProduto?.id), code: String(r.codigo), name: text(r.descricao) }));
  }
  async marketplaceCategories(connection: string, storeId: string, parent = "") {
    const store = await this.store(connection, storeId);
    if (parent && !/^[A-Za-z0-9_-]{1,80}$/.test(parent)) return fail("Categoria inválida.");
    const rows = await this.request(connection, `anuncios/categorias?${new URLSearchParams({ idLoja: storeId, tipoIntegracao: store.type, ...(parent ? { idCategoria: parent } : {}) })}`);
    if (!Array.isArray(rows)) return fail("O Bling não disponibilizou a árvore desta loja.");
    return rows.filter(r => String(r.id) !== parent).map((r: Raw) => ({ id: String(r.id), name: text(r.nome ?? r.descricao) }));
  }
  async linkCategory(connection: string, body: Raw) {
    const lock = await this.pool.connect();
    try {
      await lock.query("SELECT pg_advisory_lock(hashtext($1))", [`category-link:${connection}:${body?.storeId}:${body?.categoryId}`]);
    const storeId = String(body?.storeId ?? ""), categoryId = String(body?.categoryId ?? "");
    if (!(await this.categories(connection)).some(c => c.id === categoryId)) return fail("Escolha uma categoria interna existente.");
    const path = body?.path;
    if (!Array.isArray(path) || !path.length || path.length > 10) return fail("Selecione a categoria da loja até o último nível.");
    let parent = "", leaf: { id: string; name: string } | undefined;
    for (const id of path) {
      if (typeof id !== "string") return fail("Categoria inválida.");
      leaf = (await this.marketplaceCategories(connection, storeId, parent)).find(r => r.id === id);
      if (!leaf) return fail("A árvore da loja mudou. Escolha novamente a categoria.");
      parent = leaf.id;
    }
    if (!leaf || (await this.marketplaceCategories(connection, storeId, leaf.id)).length) return fail("Selecione o último nível da categoria da loja.");
    const links = await this.categoryLinks(connection, storeId);
    const existing = links.filter(l => l.categoryId === categoryId);
    if (existing.length) {
      if (existing.length === 1 && existing[0]!.code === leaf.id) return existing[0];
      return fail("Esta categoria interna já possui vínculo nesta loja. Use outra categoria interna ou altere o vínculo no Bling.", 409, "conflict");
    }
    // Shared mapping: user reviews this scope explicitly in the form.
    await this.request(connection, "categorias/lojas", "POST", {
      loja: { id: Number(storeId) }, categoriaProduto: { id: Number(categoryId) }, codigo: leaf.id, descricao: leaf.name,
    });
    const saved = (await this.categoryLinks(connection, storeId)).find(l => l.categoryId === categoryId && l.code === leaf!.id);
    if (!saved) return fail("Vínculo enviado, mas não confirmado. Atualize os vínculos antes de tentar novamente.", 409, "write_uncertain");
    return saved;
    } finally {
      await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [`category-link:${connection}:${body?.storeId}:${body?.categoryId}`]);
      lock.release();
    }
  }
  async categoryFields(connection: string, categoryId: string) {
    if (categoryId && !/^[1-9]\d*$/.test(categoryId)) return fail("Categoria inválida.");
    const modules = await this.request(connection, "campos-customizados/modulos");
    const module = Array.isArray(modules) ? modules.find((r: Raw) => String(r.modulo).toLowerCase() === "produtos") : undefined;
    if (!module?.id) return [];
    const base = await this.pages(connection, `campos-customizados/modulos/${module.id}`);
    const result: Raw[] = [];
    for (const field of base.filter(f => f.situacao === 1)) {
      const f = await this.request(connection, `campos-customizados/${field.id}`);
      if (f.agrupadores?.length && !f.agrupadores.some((g: Raw) => String(g.id) === categoryId)) continue;
      result.push({ id: String(field.id), name: text(f.nome ?? field.nome), required: f.obrigatorio === true, options: (f.opcoes ?? []).map((o: Raw) => text(o.nome)) });
    }
    return result;
  }
  async contacts(connection: string, query: string) {
    const rows = await this.request(
      connection,
      `contatos?${new URLSearchParams({ pesquisa: query, criterio: "1", limite: "30" })}`,
    );
    if (!Array.isArray(rows)) fail("Contatos inválidos.");
    return rows.map((r: Raw) => ({ id: String(r.id), name: text(r.nome) }));
  }
  async deposits(connection: string) {
    return await this.request(connection, "depositos?situacao=1&limite=100");
  }
  async mutate(
    connection: string,
    requestId: string,
    input: ProductInput,
    id?: string,
  ) {
    validateMobileInput(input);
    input = normalizeFiscalInput(input);
    if (!/^[\w-]{16,100}$/.test(requestId))
      fail("Identificador de operação ausente.");
    const hash = createHash("sha256")
      .update(JSON.stringify({ id, input }))
      .digest("hex");
    const claim = await this.pool.query(
      "INSERT INTO mobile_operations(connection_id,request_id,payload_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING request_id",
      [connection, requestId, hash],
    );
    if (!claim.rowCount) {
      const existing = (
        await this.pool.query(
          "SELECT * FROM mobile_operations WHERE connection_id=$1 AND request_id=$2",
          [connection, requestId],
        )
      ).rows[0];
      if (existing.payload_hash !== hash)
        fail("Esta operação já foi usada com outros dados.", 409, "conflict");
      if (existing.status === "done") return existing.result;
      fail(
        "Operação anterior em andamento ou com resultado incerto. Consulte o Bling antes de repetir.",
        409,
        "conflict",
      );
    }
    const lock = await this.pool.connect();
    let productId = id;
    let changed = false;
    try {
      await lock.query("SELECT pg_advisory_lock(hashtext($1))", [
        `mobile:${connection}:${id ?? "create"}`,
      ]);
      const current = id ? await this.get(connection, id) : undefined;
      if (current) {
        if (input.version?.startsWith("v3.")) {
          input = mergeRevision(input, current.product, connection, this.config.jwtSecret);
        } else if (input.version !== mapProduct(current.raw).version) {
          fail("Esta edição foi aberta com uma referência antiga. Reabra o produto para carregar os dados atuais.", 409, "conflict");
        }
      }
      if (input.stock !== null && input.stock !== (current?.product.stock ?? 0) && current)
        stockMovements(current.balance, await this.deposits(connection), input.stock, input.depositId);
      const found = await this.find(connection, input.sku);
      if (found && found.id !== id)
        fail(`SKU já usado em ${found.name}.`, 409, "duplicate");
      if (input.gtin) {
        const found = await this.find(connection, input.gtin);
        if (found && found.id !== id)
          fail(`EAN já usado em ${found.name}.`, 409, "duplicate");
      }
      if (current && input.cost !== null && input.cost !== current.product.cost && !current.raw.fornecedor?.id) {
        const links = await this.request(connection, `produtos/fornecedores?idProduto=${id}&limite=100`);
        const matching = Array.isArray(links) ? links.filter((l: Raw) => String(l.produto?.id) === id) : [];
        if (!matching.some((l: Raw) => l.padrao === true) && matching.length !== 1)
          fail("O Bling não retornou um registro de custo padrão. Salve o custo uma vez no Bling e recarregue aqui.");
      }
      if (current && input.cost === null && current.product.cost !== null)
        fail("Para zerar o custo, informe zero.");
      const payload = productPayload(input, current?.product, current?.raw);
      if (Object.keys(payload).length) {
        changed = true;
        const result = await this.request(
          connection,
          id ? `produtos/${id}` : "produtos",
          id ? "PATCH" : "POST",
          payload,
        );
        productId = String(result?.id ?? id ?? "");
        if (!/^[1-9]\d*$/.test(productId))
          fail(
            "Gravação recebida, mas ID não confirmado. Consulte o Bling.",
            502,
            "write_uncertain",
          );
      }
      await this.pool.query(
        "UPDATE mobile_operations SET product_id=$3 WHERE connection_id=$1 AND request_id=$2",
        [connection, requestId, productId],
      );
      if (input.cost !== null && input.cost !== current?.product.cost) {
        changed = true;
        await this.tokens.executeWithBlingAuth(connection, (token) =>
          this.legacy.updateProduct(
            productId!,
            {
              costUpdate: {
                value: input.cost!,
                expected: current?.product.cost ?? null,
                ...(input.supplierId ? { supplierId: input.supplierId } : {}),
              },
            },
            token,
          ),
        );
      }
      if (
        input.stock !== null &&
        input.stock !== (current?.product.stock ?? 0)
      ) {
        const fresh = await this.get(connection, productId!);
        if (current && fresh.product.stock !== current.product.stock)
          fail("Estoque alterado durante o salvamento.", 409, "conflict");
        const moves = stockMovements(fresh.balance, await this.deposits(connection), input.stock, input.depositId);
        for (const movement of moves) {
          changed = true;
          await this.request(connection, "estoques", "POST", {
            produto: { id: Number(productId) }, ...movement,
            observacoes: "Ajuste pelo catálogo Paulifest: saldo desejado " + input.stock,
          });
        }
      }
      const final = (await this.get(connection, productId!)).product;
      if (input.stock !== null && final.stock !== input.stock)
        fail(
          "Produto salvo, mas saldo ainda não confirmado. Recarregue.",
          409,
          "write_uncertain",
        );
      await this.pool.query(
        "UPDATE mobile_operations SET status='done',result=$3 WHERE connection_id=$1 AND request_id=$2",
        [connection, requestId, JSON.stringify(final)],
      );
      return final;
    } catch (error) {
      await this.pool.query(
        "UPDATE mobile_operations SET status=$3 WHERE connection_id=$1 AND request_id=$2",
        [connection, requestId, changed ? "uncertain" : "failed"],
      );
      if (changed)
        fail(
          `A gravação pode ter sido parcial. ${error instanceof BlingProductError ? error.message : "Não foi possível confirmar a etapa final."} Consulte o produto ${productId ?? "pelo SKU"} no Bling antes de repetir.`,
          409,
          "write_uncertain",
        );
      throw error;
    } finally {
      await lock
        .query("SELECT pg_advisory_unlock(hashtext($1))", [
          `mobile:${connection}:${id ?? "create"}`,
        ])
        .catch(() => {});
      lock.release();
    }
  }
  async upload(connection: string, data: string) {
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
      data,
    );
    if (!match) fail("Foto inválida.");
    const content = Buffer.from(match![2], "base64");
    if (content.length > 2 * 1024 * 1024 || content.length < 12)
      fail("Foto deve ter até 2 MB.");
    const mime = `image/${match![1]}`;
    const valid =
      match![1] === "jpeg"
        ? content[0] === 255 && content[1] === 216
        : match![1] === "png"
          ? content
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : content.toString("ascii", 0, 4) === "RIFF" &&
            content.toString("ascii", 8, 12) === "WEBP";
    if (!valid) fail("Conteúdo da imagem inválido.");
    if (!this.config.mobilePublicUrl)
      fail("A URL pública do Gateway precisa ser configurada.");
    const id = randomUUID();
    await this.pool.query(
      "INSERT INTO mobile_images(id,connection_id,content,mime) VALUES($1,$2,$3,$4)",
      [id, connection, content, mime],
    );
    return {
      url: `${this.config.mobilePublicUrl}/mobile/images/${id}`,
      local: false,
    };
  }
  async image(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return undefined;
    return (
      await this.pool.query(
        "SELECT content,mime FROM mobile_images WHERE id=$1",
        [id],
      )
    ).rows[0];
  }
  async webhook(raw: Buffer, signature: string) {
    if (!verifyWebhook(raw, signature, this.config.blingClientSecret))
      fail("Assinatura inválida.", 401, "unauthorized");
    const event = JSON.parse(raw.toString("utf8"));
    if (
      typeof event.eventId !== "string" ||
      !event.eventId ||
      event.eventId.length > 150 ||
      !/^\d+$/.test(String(event.companyId)) ||
      !/^((product|stock)\.(created|updated|deleted)|virtual_stock\.updated)$/.test(
        event.event,
      )
    )
      fail("Evento não suportado.");
    await this.pool.query(
      "INSERT INTO bling_webhook_events(event_id,company_id,event) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [event.eventId, String(event.companyId), event.event],
    );
  }
  async revision(connection: string) {
    let company = (
      await this.pool.query(
        "SELECT company_id FROM mobile_companies WHERE connection_id=$1",
        [connection],
      )
    ).rows[0]?.company_id;
    if (!company) {
      const info = await this.request(connection, "empresas/me/dados-basicos");
      company = String(info?.id ?? "");
      if (!/^\d+$/.test(company)) fail("Empresa não identificada.");
      await this.pool.query(
        "INSERT INTO mobile_companies(connection_id,company_id) VALUES($1,$2) ON CONFLICT(connection_id) DO UPDATE SET company_id=$2",
        [connection, company],
      );
    }
    const row = (
      await this.pool.query(
        "SELECT count(*)::text AS revision FROM bling_webhook_events WHERE company_id=$1",
        [company],
      )
    ).rows[0];
    return { revision: row.revision };
  }
}
