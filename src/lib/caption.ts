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
  "aciklama": "description",
  "ana urun kodu": "productMainId",
  "attributes": "attributes",
  "barkod": "barcode",
  "barcode": "barcode",
  "category": "categoryId",
  "description": "description",
  "desi": "dimensionalWeight",
  "dimensional weight": "dimensionalWeight",
  "fiyat": "salePrice",
  "isim": "title",
  "kategori": "categoryId",
  "kdv": "vatRate",
  "liste fiyat": "listPrice",
  "liste fiyati": "listPrice",
  "list price": "listPrice",
  "listprice": "listPrice",
  "model kodu": "productMainId",
  "productmainid": "productMainId",
  "quantity": "quantity",
  "sale price": "salePrice",
  "saleprice": "salePrice",
  "stock code": "stockCode",
  "stockcode": "stockCode",
  "stok": "quantity",
  "stok kodu": "stockCode",
  "title": "title",
  "urun": "title",
  "urun adi": "title",
  "vat": "vatRate",
  "vat rate": "vatRate",
  "ozellikler": "attributes",
};

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
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
  const categoryId = parseNumber(fields.get("categoryId"));
  const quantity = parseNumber(fields.get("quantity")) ?? 1;
  const vatRate = parseNumber(fields.get("vatRate")) ?? 20;
  const dimensionalWeight = parseNumber(fields.get("dimensionalWeight")) ?? 1;
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
    attributes: parseAttributes(fields.get("attributes")),
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

Ürün: Figyfun örnek ürün
Açıklama: Ürünün Trendyol açıklaması
Fiyat: 499.90
Liste Fiyatı: 549.90
Kategori: 123456
Stok: 5
KDV: 20
Desi: 1
Özellikler: [{"attributeId": 1, "attributeValueId": 2}]`;
