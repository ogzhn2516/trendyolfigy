import "server-only";

import type { ProductDraft } from "@/lib/db";
import { getTrendyolConfig } from "@/lib/env";

type TrendyolResponse = Record<string, unknown>;

function getHeaders() {
  const config = getTrendyolConfig();
  const authorization = Buffer.from(
    `${config.TRENDYOL_API_KEY}:${config.TRENDYOL_API_SECRET}`,
  ).toString("base64");
  const headers: HeadersInit = {
    Authorization: `Basic ${authorization}`,
    "Content-Type": "application/json",
    "User-Agent": "FigyfunTrendyolBot/1.0",
  };

  if (config.TRENDYOL_STORE_FRONT_CODE) {
    headers.storeFrontCode = config.TRENDYOL_STORE_FRONT_CODE;
  }

  return headers;
}

function getBaseUrl() {
  return getTrendyolConfig().TRENDYOL_BASE_URL ?? "https://apigw.trendyol.com";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDescription(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

export function buildTrendyolPayload(draft: ProductDraft) {
  const config = getTrendyolConfig();

  if (!draft.imageUrl) {
    throw new Error("Trendyol gönderimi için kalıcı HTTPS görsel URL'si gerekli.");
  }

  const item: Record<string, unknown> = {
    attributes: draft.attributes,
    barcode: draft.barcode,
    brandId: config.TRENDYOL_BRAND_ID,
    categoryId: draft.categoryId,
    description: formatDescription(draft.description),
    dimensionalWeight: draft.dimensionalWeight,
    images: [{ url: draft.imageUrl }],
    listPrice: draft.listPrice,
    productMainId: draft.productMainId,
    quantity: draft.quantity,
    salePrice: draft.salePrice,
    stockCode: draft.stockCode,
    title: draft.title,
    vatRate: draft.vatRate,
  };

  if (config.TRENDYOL_SHIPMENT_ADDRESS_ID) {
    item.shipmentAddressId = config.TRENDYOL_SHIPMENT_ADDRESS_ID;
  }

  if (config.TRENDYOL_RETURNING_ADDRESS_ID) {
    item.returningAddressId = config.TRENDYOL_RETURNING_ADDRESS_ID;
  }

  return { items: [item] };
}

async function readResponse(response: Response) {
  const rawText = await response.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText) as TrendyolResponse;
  } catch {
    return { rawText };
  }
}

export async function createTrendyolProduct(payload: ReturnType<typeof buildTrendyolPayload>) {
  const config = getTrendyolConfig();
  const response = await fetch(
    `${getBaseUrl()}/integration/product/sellers/${config.TRENDYOL_SUPPLIER_ID}/v2/products`,
    {
      body: JSON.stringify(payload),
      cache: "no-store",
      headers: getHeaders(),
      method: "POST",
    },
  );
  const body = await readResponse(response);

  if (!response.ok) {
    throw new TrendyolApiError(
      `Trendyol ürün isteği ${response.status} ile reddedildi.`,
      body,
    );
  }

  return body;
}

export async function getCategoryAttributes(categoryId: number) {
  const response = await fetch(
    `${getBaseUrl()}/integration/product/categories/${categoryId}/attributes`,
    {
      cache: "no-store",
      headers: getHeaders(),
    },
  );
  const body = await readResponse(response);

  if (!response.ok) {
    throw new TrendyolApiError(
      `Kategori özellik isteği ${response.status} ile reddedildi.`,
      body,
    );
  }

  return body;
}

export class TrendyolApiError extends Error {
  body: TrendyolResponse;

  constructor(message: string, body: TrendyolResponse) {
    super(message);
    this.body = body;
    this.name = "TrendyolApiError";
  }
}
