export type ParsedCaption = {
  attributes: TrendyolAttributeInput[];
  barcode?: string;
  categoryId?: number;
  description?: string;
  dimensionalWeight: number;
  issues: string[];
  listPrice?: number;
  productMainId?: string;
  quantity: number;
  salePrice?: number;
  stockCode?: string;
  title?: string;
  vatRate: number;
};

export type TrendyolAttributeInput = {
  attributeId: number;
  attributeValueId?: number;
  attributeValueIds?: number[];
  customAttributeValue?: string;
};

type ProductCaptionDefaults = {
  attributes: TrendyolAttributeInput[];
  categoryId: number;
  dimensionalWeight: number;
  quantity: number;
  vatRate: number;
};

const figyfunAnimalFigureDefaults: ProductCaptionDefaults = {
  attributes: [
    { attributeId: 1192, attributeValueId: 10617344 },
    { attributeId: 1156, attributeValueId: 1225110 },
    { attributeId: 279, attributeValueId: 1256866 },
    { attributeId: 767, attributeValueId: 290274 },
  ],
  categoryId: 4498,
  dimensionalWeight: 1,
  quantity: 1000,
  vatRate: 20,
};

const figyfunHomeDecorDefaults: ProductCaptionDefaults = {
  attributes: [
    { attributeId: 348, attributeValueId: 686230 },
    { attributeId: 18, attributeValueId: 314396 },
    { attributeId: 20, attributeValueId: 170 },
    { attributeId: 47, customAttributeValue: "Çok Renkli" },
    { attributeId: 14, attributeValueId: 1198412 },
    { attributeId: 1192, attributeValueId: 10617344 },
  ],
  categoryId: 1877,
  dimensionalWeight: 1,
  quantity: 1000,
  vatRate: 20,
};

const figyfunEducationalToyDefaults: ProductCaptionDefaults = {
  attributes: [
    { attributeId: 1192, attributeValueId: 10617344 },
    { attributeId: 1156, attributeValueId: 1225110 },
    { attributeId: 767, attributeValueId: 290274 },
    { attributeId: 1155, attributeValueId: 1225104 },
    { attributeId: 279, attributeValueId: 1256866 },
    { attributeId: 66, attributeValueId: 1218253 },
  ],
  categoryId: 1011,
  dimensionalWeight: 1,
  quantity: 1000,
  vatRate: 20,
};

const defaultsByCategoryId = new Map<number, ProductCaptionDefaults>([
  [figyfunAnimalFigureDefaults.categoryId, figyfunAnimalFigureDefaults],
  [figyfunHomeDecorDefaults.categoryId, figyfunHomeDecorDefaults],
  [figyfunEducationalToyDefaults.categoryId, figyfunEducationalToyDefaults],
]);

const categoryAliases = new Map<string, ProductCaptionDefaults>([
  ["biblo", figyfunHomeDecorDefaults],
  ["cocuk", figyfunEducationalToyDefaults],
  ["cocuk egitici", figyfunEducationalToyDefaults],
  ["cocuk egitici oyuncak", figyfunEducationalToyDefaults],
  ["cocuk oyuncak", figyfunEducationalToyDefaults],
  ["dekoratif obje", figyfunHomeDecorDefaults],
  ["dekoratif obje ve biblo", figyfunHomeDecorDefaults],
  ["egitici", figyfunEducationalToyDefaults],
  ["egitici oyuncak", figyfunEducationalToyDefaults],
  ["ev", figyfunHomeDecorDefaults],
  ["ev dekoratif obje", figyfunHomeDecorDefaults],
  ["ev dekoratif obje ve biblo", figyfunHomeDecorDefaults],
  ["hayvan figur oyuncak", figyfunAnimalFigureDefaults],
  ["oyuncak", figyfunAnimalFigureDefaults],
]);

function getAliasDefaults(alias: string) {
  const exactMatch = categoryAliases.get(alias);

  if (exactMatch) {
    return exactMatch;
  }

  if (/\b(cocuk|egitici)\b/.test(alias)) {
    return figyfunEducationalToyDefaults;
  }

  if (/\b(ev|biblo|dekoratif)\b/.test(alias)) {
    return figyfunHomeDecorDefaults;
  }

  if (/\b(hayvan|figur)\b/.test(alias)) {
    return figyfunAnimalFigureDefaults;
  }

  return undefined;
}

type CaptionKey =
  | "attributes"
  | "barcode"
  | "categoryId"
  | "description"
  | "dimensionalWeight"
  | "listPrice"
  | "productMainId"
  | "quantity"
  | "salePrice"
  | "stockCode"
  | "title"
  | "vatRate";

const keyMap: Record<string, CaptionKey> = {
  aciklama: "description",
  "ana urun kodu": "productMainId",
  attributes: "attributes",
  barkod: "barcode",
  barcode: "barcode",
  category: "categoryId",
  description: "description",
  desi: "dimensionalWeight",
  "dimensional weight": "dimensionalWeight",
  fiyat: "salePrice",
  isim: "title",
  kategor: "categoryId",
  kategori: "categoryId",
  kdv: "vatRate",
  "liste fiyat": "listPrice",
  "liste fiyati": "listPrice",
  "list price": "listPrice",
  listprice: "listPrice",
  "model kodu": "productMainId",
  productmainid: "productMainId",
  quantity: "quantity",
  "sale price": "salePrice",
  saleprice: "salePrice",
  "stock code": "stockCode",
  stockcode: "stockCode",
  stok: "quantity",
  "stok kodu": "stockCode",
  title: "title",
  urun: "title",
  "urun adi": "title",
  vat: "vatRate",
  "vat rate": "vatRate",
  ozellikler: "attributes",
};

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/Ä±/g, "i")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalized = value
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAttributes(value?: string) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is TrendyolAttributeInput => {
      if (!item || typeof item !== "object") {
        return false;
      }

      return typeof item.attributeId === "number";
    });
  } catch {
    return [];
  }
}

function cloneAttributes(attributes: TrendyolAttributeInput[]) {
  return attributes.map((attribute) => ({ ...attribute }));
}

function getCategoryDefaults(value?: string) {
  const categoryId = parseNumber(value);

  if (categoryId) {
    return {
      categoryId,
      defaults: defaultsByCategoryId.get(categoryId),
    };
  }

  const alias = normalizeKey(value ?? "").replace(/[.,;]+$/g, "");
  const defaults = getAliasDefaults(alias) ?? figyfunAnimalFigureDefaults;

  return {
    categoryId: defaults.categoryId,
    defaults,
  };
}

export function parseProductCaption(caption?: string): ParsedCaption {
  const fields = new Map<CaptionKey, string>();
  let currentKey: CaptionKey | undefined;

  for (const rawLine of caption?.split(/\r?\n/) ?? []) {
    const line = rawLine.trim();
    const match = line.match(/^([^:]+):\s*(.*)$/);
    const detectedKey = match ? keyMap[normalizeKey(match[1])] : undefined;

    if (match && detectedKey) {
      currentKey = detectedKey;
      fields.set(detectedKey, match[2].trim());
      continue;
    }

    if (currentKey === "description" && line) {
      const previous = fields.get(currentKey) ?? "";
      fields.set(currentKey, `${previous}\n${line}`.trim());
    }
  }

  const title = fields.get("title")?.trim();
  const description = fields.get("description")?.trim();
  const salePrice = parseNumber(fields.get("salePrice"));
  const listPrice = parseNumber(fields.get("listPrice"));
  const category = getCategoryDefaults(fields.get("categoryId"));
  const defaults = category.defaults ?? figyfunAnimalFigureDefaults;
  const categoryId = category.categoryId;
  const quantity = parseNumber(fields.get("quantity")) ?? defaults.quantity;
  const vatRate = parseNumber(fields.get("vatRate")) ?? defaults.vatRate;
  const dimensionalWeight =
    parseNumber(fields.get("dimensionalWeight")) ?? defaults.dimensionalWeight;
  const issues: string[] = [];

  if (!title) {
    issues.push("Ürün adı eksik.");
  }

  if (!description) {
    issues.push("Açıklama eksik.");
  }

  if (!salePrice || salePrice <= 0) {
    issues.push("Fiyat pozitif bir sayı olmalı.");
  }

  if (!categoryId || !Number.isInteger(categoryId)) {
    issues.push("Kategori Trendyol kategori ID değeri olmalı.");
  }

  if (listPrice !== undefined && salePrice !== undefined && listPrice < salePrice) {
    issues.push("Liste fiyatı satış fiyatından düşük olamaz.");
  }

  return {
    attributes: fields.has("attributes")
      ? parseAttributes(fields.get("attributes"))
      : category.defaults
        ? cloneAttributes(category.defaults.attributes)
        : [],
    barcode: fields.get("barcode")?.trim(),
    categoryId,
    description,
    dimensionalWeight,
    issues,
    listPrice,
    productMainId: fields.get("productMainId")?.trim(),
    quantity: Math.max(0, Math.trunc(quantity)),
    salePrice,
    stockCode: fields.get("stockCode")?.trim(),
    title,
    vatRate: Math.trunc(vatRate),
  };
}

export const telegramCaptionTemplate = `Fotoğraf açıklamasını şu biçimde gönder:

Ürün: Figyfun örnek hayvan figür oyuncak
Açıklama: Ürünün Trendyol açıklaması
Fiyat: 499.90

Hayvan Figür Oyuncak kategori, KDV 20, stok 1000 ve zorunlu kategori özellikleri otomatik eklenir.

Ev dekoratif obje ve biblo için ayrıca şunu ekleyebilirsin:
Kategori: ev`;
