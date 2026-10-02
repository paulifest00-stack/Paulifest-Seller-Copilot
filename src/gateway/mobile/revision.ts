import { createHmac, timingSafeEqual } from "node:crypto";
import { BlingProductError } from "../integrations/bling/bling-product-client.ts";
import type { Product, ProductInput } from "./types.ts";

const fields = ["status", "name", "sku", "gtin", "gtinPackage", "ncm", "cest",
  "taxOrigin", "category", "brand", "unit", "price", "cost", "stock",
  "netWeightKg", "grossWeightKg", "widthCm", "heightCm", "depthCm",
  "description", "customFields", "images"] as const;
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function snapshot(product: ProductInput | Product): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of fields)
    result[key] = key === "images" ? product.images.map(i => ({ url: i.url }))
      : key === "customFields" ? product.customFields ?? [] : product[key];
  return canonical(result);
}
const equal = (a: any, b: any) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function signRevision(product: Product, connection: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ connection, id: product.id, fields: snapshot(product) })).toString("base64url");
  return "v3." + payload + "." + createHmac("sha256", secret).update(payload).digest("hex");
}
export function mergeRevision(input: ProductInput, current: Product, connection: string, secret: string): ProductInput {
  const token = input.version;
  const invalid = (): never => { throw new BlingProductError("Esta edição foi aberta com uma referência antiga ou inválida. Reabra o produto para carregar os dados atuais.", 409, "conflict"); };
  if (typeof token !== "string" || token.length > 100000) return invalid();
  const match = /^v3\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
  if (!match) return invalid();
  const signature = createHmac("sha256", secret).update(match[1]!).digest();
  if (!timingSafeEqual(signature, Buffer.from(match[2]!, "hex"))) return invalid();
  let baseline: any;
  try { baseline = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")); } catch { return invalid(); }
  if (baseline?.id !== current.id || baseline?.connection !== connection || !baseline.fields) return invalid();
  const submitted = snapshot(input), fresh = snapshot(current);
  const merged = { ...input };
  for (const key of fields) {
    if (equal(submitted[key], baseline.fields[key])) {
      (merged as any)[key] = (current as any)[key];
    } else if (!equal(fresh[key], baseline.fields[key]) && !equal(fresh[key], submitted[key])) {
      const label = key === "stock" ? "O estoque" : key === "cost" ? "O preço de custo" : "O campo " + key;
      throw new BlingProductError(label + " mudou no Bling enquanto você editava. Recarregue e confira esse valor antes de salvar.", 409, "conflict");
    }
  }
  merged.version = current.version;
  return merged;
}
