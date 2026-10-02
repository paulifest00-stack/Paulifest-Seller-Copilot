/**
 * Domain model, independent of any ERP payload shape.
 * Adapters map ERP fields <-> these fields (see docs/INTEGRACAO.md).
 */

/** Where a field value came from. Absent = loaded from the data source as-is. */
export type FieldOrigin = "confirmed" | "suggested";

export type ProductStatus = "active" | "inactive";
export type SyncStatus = "synced" | "pending" | "error";

export interface ProductImage {
  /** Remote URL, or data URL while the photo has not been uploaded yet. */
  url: string;
  /** True while the image only exists on this device. */
  local?: boolean | undefined;
}

export interface Product {
  /** Stable id used by the screens. For remote adapters this is the ERP id. */
  id: string;
  /** ERP id once the product exists there. */
  remoteId?: string | undefined;
  /** Opaque concurrency token (e.g. ERP last-modified). Sent back on update to detect conflicts. */
  version?: string | undefined;
  status: ProductStatus;
  name: string;
  sku: string;
  gtin: string;
  /** GTIN of the packaging/box (tributário), optional. */
  gtinPackage: string;
  ncm: string;
  cest: string;
  /** Fiscal origin code 0–8. Empty = not informed. */
  taxOrigin: string;
  category: string;
  brand: string;
  unit: string;
  price: number | null;
  cost: number | null;
  stock: number | null;
  netWeightKg: number | null;
  grossWeightKg: number | null;
  widthCm: number | null;
  heightCm: number | null;
  depthCm: number | null;
  description: string;
  customFields?: { id: string; value: string; item?: string }[];
  images: ProductImage[];
  origins: Partial<Record<EditableField, FieldOrigin>>;
  syncStatus: SyncStatus;
  updatedAt: string;
}

export type EditableField = Exclude<
  keyof Product,
  | "id"
  | "remoteId"
  | "version"
  | "origins"
  | "syncStatus"
  | "updatedAt"
  | "images"
  | "customFields"
>;

/** Payload for create/update. Screens never set ids/sync metadata. */
export type ProductInput = Omit<
  Product,
  "id" | "remoteId" | "syncStatus" | "updatedAt"
> & { depositId?: string | undefined; supplierId?: string | undefined };

/** Lightweight shape for lists; remote adapters may return fewer fields here. */
export type ProductSummary = Pick<
  Product,
  | "id"
  | "name"
  | "sku"
  | "gtin"
  | "price"
  | "stock"
  | "status"
  | "syncStatus"
  | "updatedAt"
> & {
  thumbnail?: string | undefined;
  missingCount: number;
};

export const emptyInput = (): ProductInput => ({
  status: "active",
  name: "",
  sku: "",
  gtin: "",
  gtinPackage: "",
  ncm: "",
  cest: "",
  taxOrigin: "",
  category: "",
  brand: "",
  unit: "UN",
  price: null,
  cost: null,
  stock: null,
  netWeightKg: null,
  grossWeightKg: null,
  widthCm: null,
  heightCm: null,
  depthCm: null,
  description: "",
  customFields: [],
  images: [],
  origins: {},
});

export const toInput = (p: Product): ProductInput => {
  const { id: _i, remoteId: _r, syncStatus: _s, updatedAt: _u, ...rest } = p;
  return rest;
};
