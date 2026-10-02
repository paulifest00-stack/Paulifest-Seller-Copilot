import { test } from "node:test";
import assert from "node:assert/strict";
import { signRevision, mergeRevision } from "../../dist-gateway/gateway/mobile/revision.js";
import { mapProduct } from "../../dist-gateway/gateway/mobile/catalog.js";
const secret = "test-revision-secret";
function product() {
  const p = mapProduct({ id: 1, nome: "Produto", codigo: "SKU", preco: 10,
    fornecedor: { precoCusto: 4 }, estoque: { saldoFisicoTotal: 5 } });
  p.version = signRevision(p, "account", secret);
  return p;
}
test("an unrelated price change does not block a stock edit or overwrite the new price", () => {
  const original = product(), current = { ...original, price: 12 };
  current.version = signRevision(current, "account", secret);
  const merged = mergeRevision({ ...original, stock: 10 }, current, "account", secret);
  assert.equal(merged.price, 12);
  assert.equal(merged.stock, 10);
  assert.equal(merged.cost, 4);
});
test("cost-only editing preserves current stock and other externally changed fields", () => {
  const original = product(), current = { ...original, stock: 3, name: "Novo nome" };
  const merged = mergeRevision({ ...original, cost: 7 }, current, "account", secret);
  assert.equal(merged.cost, 7);
  assert.equal(merged.stock, 3);
  assert.equal(merged.name, "Novo nome");
});
test("real changes in the edited field still require review", () => {
  const original = product();
  assert.throws(() => mergeRevision({ ...original, stock: 10 }, { ...original, stock: 3 }, "account", secret), /estoque mudou/);
  assert.throws(() => mergeRevision({ ...original, cost: 7 }, { ...original, cost: 8 }, "account", secret), /preço de custo mudou/);
});
test("already-achieved desired values and image metadata do not create false conflicts", () => {
  const original = product(), current = { ...original, stock: 10 };
  assert.equal(mergeRevision({ ...original, stock: 10 }, current, "account", secret).stock, 10);
  const withImage = { ...original, images: [{ url: "https://example.com/image.jpg", local: false }] };
  withImage.version = signRevision(withImage, "account", secret);
  assert.doesNotThrow(() => mergeRevision({ ...withImage, images: [{ url: "https://example.com/image.jpg" }] }, withImage, "account", secret));
});
test("snapshots cannot be forged or reused on another product or account", () => {
  const original = product();
  for (const [current, account, token] of [
    [{ ...original, id: "2" }, "account", original.version],
    [original, "another", original.version],
    [original, "account", original.version.slice(0, -1) + (original.version.endsWith("0") ? "1" : "0")],
  ]) assert.throws(() => mergeRevision({ ...original, version: token }, current, account, secret));
});
