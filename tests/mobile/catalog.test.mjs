import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import {
  MobileCatalog,
  mapProduct,
  productPayload,
  validateMobileInput,
  verifyWebhook,
} from "../../dist-gateway/gateway/mobile/catalog.js";
import { emptyInput } from "../../dist-gateway/gateway/mobile/types.js";
import { GatewayApp } from "../../dist-gateway/gateway/http/app.js";
import { loadGatewayConfig } from "../../dist-gateway/gateway/config.js";
import { InMemoryGatewayRepository } from "../../dist-gateway/gateway/database/repository.js";
import { createGatewaySessionToken } from "../../dist-gateway/gateway/crypto/pairing-state.js";

const input = () => ({ ...emptyInput(), name: "Teste", sku: "TEST-1" });
test("maps dimensions, photos, fiscal origin and physical stock", () => {
  const p = mapProduct({
    id: 1,
    nome: "Teste",
    codigo: "TEST",
    dimensoes: { unidadeMedida: 2, largura: 120 },
    tributacao: { origem: 0, ncm: "95059000" },
    estoque: { saldoFisicoTotal: 15, saldoVirtualTotal: 12 },
    midia: {
      imagens: { internas: [{ link: "https://example.com/photo.jpg" }] },
    },
  });
  assert.equal(p.widthCm, 12);
  assert.equal(p.taxOrigin, "0");
  assert.equal(p.stock, 15);
  assert.equal(p.images[0].local, false);
});
test("patch preserves unedited fields and extra fiscal metadata", () => {
  const raw = {
    id: 1,
    nome: "Teste",
    codigo: "TEST-1",
    tributacao: { ncm: "95059000", origem: 0, nFCI: "preservar" },
  };
  const p = mapProduct(raw);
  const patch = productPayload({ ...p, ncm: "12345678" }, p, raw);
  assert.deepEqual(Object.keys(patch), ["tributacao"]);
  assert.equal(patch.tributacao.nFCI, "preservar");
  assert.equal(patch.tributacao.ncm, "12345678");
});
test("validates critical suggestions, GTIN, photos and numeric input before writing", () => {
  assert.throws(() => validateMobileInput({ ...input(), price: -1 }));
  assert.throws(() =>
    validateMobileInput({ ...input(), gtin: "1234567890123" }),
  );
  assert.throws(() =>
    validateMobileInput({ ...input(), origins: { ncm: "suggested" } }),
  );
  assert.throws(() =>
    validateMobileInput({
      ...input(),
      images: [{ url: "data:image/png;base64,AA" }],
    }),
  );
  assert.doesNotThrow(() =>
    validateMobileInput({ ...input(), gtin: "4006381333931" }),
  );
});
test("validates webhook HMAC over raw bytes and rejects spoofed messages", () => {
  const raw = Buffer.from('{"eventId":"evt-1"}');
  const secret = "test-secret";
  const signature =
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyWebhook(raw, signature, secret), true);
  assert.equal(verifyWebhook(Buffer.from("{}"), signature, secret), false);
  assert.equal(verifyWebhook(raw, "sha256=bad", secret), false);
});

class FakePool {
  operations = new Map();
  events = new Map();
  async connect() {
    return { query: this.query.bind(this), release() {} };
  }
  async query(sql, args = []) {
    const key = args[0] + ":" + args[1];
    if (sql.startsWith("INSERT INTO mobile_operations")) {
      if (this.operations.has(key)) return { rowCount: 0, rows: [] };
      this.operations.set(key, { payload_hash: args[2], status: "processing" });
      return { rowCount: 1, rows: [{}] };
    }
    if (sql.startsWith("SELECT * FROM mobile_operations"))
      return { rows: [this.operations.get(key)] };
    if (sql.includes("status='done'")) {
      Object.assign(this.operations.get(key), {
        status: "done",
        result: JSON.parse(args[2]),
      });
      return { rows: [] };
    }
    if (sql.includes("status=$3")) {
      this.operations.get(key).status = args[2];
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO bling_webhook_events")) {
      this.events.set(args[0], args);
      return { rows: [] };
    }
    return { rows: [] };
  }
}

async function fixture() {
  const pool = new FakePool();
  const products = new Map();
  const stocks = new Map();
  const stockWrites = [];
  let next = 100;
  let writes = 0;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer TEST-TOKEN");
    assert.equal(req.headers["enable-jwt"], "1");
    const url = new URL(req.url, "http://localhost");
    let data;
    if (req.method === "POST" && url.pathname === "/Api/v3/produtos") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const p = { id: next++, ...JSON.parse(body) };
      products.set(String(p.id), p);
      stocks.set(String(p.id), { 1: 0, 2: 5 });
      writes++;
      data = { id: p.id };
    } else if (req.method === "PATCH") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const id = url.pathname.split("/").pop();
      Object.assign(products.get(id), JSON.parse(body));
      writes++;
      data = { id: Number(id) };
    } else if (url.pathname === "/Api/v3/produtos") {
      data = [...products.values()].filter((p) => {
        const sku = url.searchParams.get("codigos[]"),
          gtin = url.searchParams.get("gtins[]");
        return (!sku || p.codigo === sku) && (!gtin || p.gtin === gtin);
      });
    } else if (url.pathname.startsWith("/Api/v3/produtos/"))
      data = products.get(url.pathname.split("/").pop());
    else if (url.pathname === "/Api/v3/estoques/saldos") {
      const id = Number(url.searchParams.get("idsProdutos[]"));
      const balances = stocks.get(String(id)) ?? { 1: 0, 2: 0 };
      data = [
        {
          produto: { id },
          saldoFisicoTotal: balances[1] + balances[2],
          depositos: [
            { id: 1, saldoFisico: balances[1] },
            { id: 2, saldoFisico: balances[2] },
          ],
        },
      ];
    } else if (url.pathname === "/Api/v3/depositos")
      data = [
        { id: 1, descricao: "Loja" },
        { id: 2, descricao: "Depósito" },
      ];
    else if (url.pathname === "/Api/v3/estoques" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      stockWrites.push(payload);
      const balances = stocks.get(String(payload.produto.id));
      balances[payload.deposito.id] = payload.quantidade;
      data = { id: 999 };
    } else data = [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const config = {
    ...loadGatewayConfig({ NODE_ENV: "test" }),
    blingBaseUrl: `http://127.0.0.1:${server.address().port}`,
    mobilePublicUrl: "https://example.com",
  };
  const tokens = {
    executeWithBlingAuth: (_connection, action) => action("TEST-TOKEN"),
  };
  const catalog = new MobileCatalog(pool, config, tokens, {});
  return {
    pool,
    products,
    stockWrites,
    catalog,
    config,
    get writes() {
      return writes;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
test("create, exact lookup, update and replay do not duplicate remote writes", async () => {
  const f = await fixture();
  try {
    const created = await f.catalog.mutate(
      "account",
      "request-123456789",
      input(),
    );
    assert.equal(created.id, "100");
    assert.equal(f.writes, 1);
    const replay = await f.catalog.mutate(
      "account",
      "request-123456789",
      input(),
    );
    assert.equal(replay.id, "100");
    assert.equal(f.writes, 1);
    const found = await f.catalog.find("account", "TEST-1");
    assert.equal(found.id, "100");
    const changed = await f.catalog.mutate(
      "account",
      "request-223456789",
      { ...created, name: "Atualizado" },
      created.id,
    );
    assert.equal(changed.name, "Atualizado");
    assert.equal(f.writes, 2);
    await assert.rejects(
      f.catalog.mutate(
        "account",
        "request-323456789",
        { ...created, name: "Desatualizado" },
        created.id,
      ),
      (e) => e.code === "conflict",
    );
    assert.equal(f.writes, 2);
  } finally {
    await f.close();
  }
});
test("HTTP routes require valid gateway session and isolate connection identity", async () => {
  const f = await fixture();
  const repo = new InMemoryGatewayRepository();
  const now = new Date().toISOString();
  await repo.saveConnection({
    id: "conn-test",
    status: "connected",
    createdAt: now,
    updatedAt: now,
  });
  await repo.createGatewaySession({
    id: "session-test",
    connectionId: "conn-test",
    clientSessionId: "client-test",
    tokenFamilyId: "family-test",
    refreshTokenHash: "hash",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    createdAt: now,
  });
  const token = createGatewaySessionToken(
    {
      connectionId: "conn-test",
      sessionId: "session-test",
      clientSessionId: "client-test",
    },
    f.config.jwtSecret,
    60,
  );
  const app = new GatewayApp({
    config: f.config,
    repository: repo,
    mobileCatalog: f.catalog,
  });
  const port = await app.listen(0);
  try {
    const unauthorized = await fetch(
      `http://127.0.0.1:${port}/mobile/products`,
    );
    assert.equal(unauthorized.status, 401);
    const response = await fetch(`http://127.0.0.1:${port}/mobile/products`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data.items, []);
    assert.equal(app.isOriginAllowed("https://evil.example"), false);
    const webhook = Buffer.from(
      JSON.stringify({
        eventId: "evt-1",
        companyId: 123,
        event: "product.updated",
      }),
    );
    const headers = {
      "X-Bling-Signature-256":
        "sha256=" +
        createHmac("sha256", f.config.blingClientSecret)
          .update(webhook)
          .digest("hex"),
    };
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/mobile/webhooks/bling`, {
        method: "POST",
        body: webhook,
        headers,
      });
      assert.equal(r.status, 200);
    }
    assert.equal(f.pool.events.size, 1);
  } finally {
    await app.close();
    await f.close();
  }
});

test("stock balance affects selected deposit and preserves other deposits", async () => {
  const f = await fixture();
  try {
    const created = await f.catalog.mutate(
      "account",
      "stock-create-123456",
      input(),
    );
    assert.equal(created.stock, 5);
    const adjusted = await f.catalog.mutate(
      "account",
      "stock-adjust-123456",
      { ...created, stock: 8, depositId: "1" },
      created.id,
    );
    assert.equal(adjusted.stock, 8);
    assert.equal(f.stockWrites.length, 1);
    assert.equal(f.stockWrites[0].deposito.id, 1);
    assert.equal(f.stockWrites[0].quantidade, 3);
    assert.equal(f.stockWrites[0].operacao, "B");
    await assert.rejects(
      f.catalog.mutate(
        "account",
        "stock-invalid-123456",
        { ...adjusted, name: "Não salvar", stock: 2, depositId: "1" },
        created.id,
      ),
      (e) => e.code === "validation",
    );
    assert.equal(f.products.get(created.id).nome, "Teste");
    assert.equal(f.stockWrites.length, 1);
  } finally {
    await f.close();
  }
});
