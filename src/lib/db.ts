import "server-only";

import postgres from "postgres";

import type { TrendyolAttributeInput } from "@/lib/caption";
import { getDatabaseUrl } from "@/lib/env";

export type ProductStatus =
  | "draft"
  | "needs_review"
  | "failed"
  | "submitted";

export type ProductDraft = {
  attributes: TrendyolAttributeInput[];
  barcode: string;
  batchRequestId: string | null;
  categoryId: number;
  createdAt: Date;
  description: string;
  dimensionalWeight: number;
  id: string;
  imageUrl: string | null;
  lastError: string | null;
  listPrice: number;
  productMainId: string;
  quantity: number;
  salePrice: number;
  status: ProductStatus;
  stockCode: string;
  submittedAt: Date | null;
  telegramChatId: string;
  telegramFileId: string | null;
  telegramUpdateId: string;
  telegramUserId: string;
  title: string;
  trendyolPayload: unknown;
  trendyolResponse: unknown;
  updatedAt: Date;
  vatRate: number;
};

export type AutoAcceptRunResult = {
  accepted: number;
  checked: number;
  errors: string[];
  failed: number;
  message: string;
  ranAt: string;
  skipped: boolean;
};

export type AutoAcceptSettings = {
  enabled: boolean;
  lastResult: AutoAcceptRunResult | null;
  updatedAt: Date | null;
};

type ProductRow = {
  attributes: TrendyolAttributeInput[];
  barcode: string;
  batch_request_id: string | null;
  category_id: number | string;
  created_at: Date | string;
  description: string;
  dimensional_weight: number | string;
  id: string;
  image_url: string | null;
  last_error: string | null;
  list_price: number | string;
  product_main_id: string;
  quantity: number | string;
  sale_price: number | string;
  status: ProductStatus;
  stock_code: string;
  submitted_at: Date | string | null;
  telegram_chat_id: string;
  telegram_file_id: string | null;
  telegram_update_id: string;
  telegram_user_id: string;
  title: string;
  trendyol_payload: unknown;
  trendyol_response: unknown;
  updated_at: Date | string;
  vat_rate: number | string;
};

type AppSettingRow = {
  key: string;
  updated_at: Date | string;
  value: unknown;
};

type NewDraft = {
  attributes: TrendyolAttributeInput[];
  barcode?: string;
  categoryId: number;
  description: string;
  dimensionalWeight: number;
  imageUrl: string | null;
  lastError?: string | null;
  listPrice: number;
  productMainId?: string;
  quantity: number;
  salePrice: number;
  status: ProductStatus;
  stockCode?: string;
  telegramChatId: string;
  telegramFileId: string | null;
  telegramUpdateId: string;
  telegramUserId: string;
  title: string;
  vatRate: number;
};

type ProductUpdate = {
  attributes: TrendyolAttributeInput[];
  barcode: string;
  categoryId: number;
  description: string;
  dimensionalWeight: number;
  imageUrl: string | null;
  listPrice: number;
  productMainId: string;
  quantity: number;
  salePrice: number;
  stockCode: string;
  title: string;
  vatRate: number;
};

type GlobalSql = typeof globalThis & {
  figyfunSchemaPromise?: Promise<void>;
  figyfunSql?: postgres.Sql;
};

const globalSql = globalThis as GlobalSql;
const autoAcceptSettingKey = "auto_accept_orders";

function getSql() {
  if (!globalSql.figyfunSql) {
    globalSql.figyfunSql = postgres(getDatabaseUrl(), {
      connect_timeout: 15,
      idle_timeout: 20,
      max: 1,
      prepare: false,
    });
  }

  return globalSql.figyfunSql;
}

async function ensureSchema() {
  if (!globalSql.figyfunSchemaPromise) {
    const sql = getSql();

    globalSql.figyfunSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS product_drafts (
          id UUID PRIMARY KEY,
          telegram_update_id TEXT NOT NULL UNIQUE,
          telegram_user_id TEXT NOT NULL,
          telegram_chat_id TEXT NOT NULL,
          telegram_file_id TEXT,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          sale_price NUMERIC(12, 2) NOT NULL,
          list_price NUMERIC(12, 2) NOT NULL,
          category_id BIGINT NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 1,
          vat_rate INTEGER NOT NULL DEFAULT 20,
          dimensional_weight NUMERIC(10, 2) NOT NULL DEFAULT 1,
          attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
          image_url TEXT,
          barcode TEXT NOT NULL,
          stock_code TEXT NOT NULL,
          product_main_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          batch_request_id TEXT,
          last_error TEXT,
          trendyol_payload JSONB,
          trendyol_response JSONB,
          submitted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS product_drafts_created_at_idx
        ON product_drafts (created_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS product_drafts_status_idx
        ON product_drafts (status)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
    })();
  }

  return globalSql.figyfunSchemaPromise;
}

function mapProduct(row: ProductRow): ProductDraft {
  return {
    attributes: row.attributes ?? [],
    barcode: row.barcode,
    batchRequestId: row.batch_request_id,
    categoryId: Number(row.category_id),
    createdAt: new Date(row.created_at),
    description: row.description,
    dimensionalWeight: Number(row.dimensional_weight),
    id: row.id,
    imageUrl: row.image_url,
    lastError: row.last_error,
    listPrice: Number(row.list_price),
    productMainId: row.product_main_id,
    quantity: Number(row.quantity),
    salePrice: Number(row.sale_price),
    status: row.status,
    stockCode: row.stock_code,
    submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
    telegramChatId: row.telegram_chat_id,
    telegramFileId: row.telegram_file_id,
    telegramUpdateId: row.telegram_update_id,
    telegramUserId: row.telegram_user_id,
    title: row.title,
    trendyolPayload: row.trendyol_payload,
    trendyolResponse: row.trendyol_response,
    updatedAt: new Date(row.updated_at),
    vatRate: Number(row.vat_rate),
  };
}

function generatedCode(prefix: string, updateId: string) {
  return `${prefix}-${updateId}`.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 40);
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as postgres.JSONValue;
}

function normalizeAutoAcceptSettings(row?: AppSettingRow): AutoAcceptSettings {
  const value =
    row?.value && typeof row.value === "object"
      ? (row.value as Partial<{
          enabled: unknown;
          lastResult: unknown;
        }>)
      : {};
  const lastResult =
    value.lastResult && typeof value.lastResult === "object"
      ? (value.lastResult as AutoAcceptRunResult)
      : null;

  return {
    enabled: value.enabled === true,
    lastResult,
    updatedAt: row ? new Date(row.updated_at) : null,
  };
}

export async function getAutoAcceptSettings() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<AppSettingRow[]>`
    SELECT * FROM app_settings
    WHERE key = ${autoAcceptSettingKey}
    LIMIT 1
  `;

  return normalizeAutoAcceptSettings(rows[0]);
}

export async function setAutoAcceptEnabled(enabled: boolean) {
  await ensureSchema();
  const sql = getSql();
  const current = await getAutoAcceptSettings();
  const value = {
    enabled,
    lastResult: current.lastResult,
  };
  const rows = await sql<AppSettingRow[]>`
    INSERT INTO app_settings (key, value)
    VALUES (${autoAcceptSettingKey}, ${sql.json(toJsonValue(value))})
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW()
    RETURNING *
  `;

  return normalizeAutoAcceptSettings(rows[0]);
}

export async function saveAutoAcceptRunResult(result: AutoAcceptRunResult) {
  await ensureSchema();
  const sql = getSql();
  const current = await getAutoAcceptSettings();
  const value = {
    enabled: current.enabled,
    lastResult: result,
  };
  const rows = await sql<AppSettingRow[]>`
    INSERT INTO app_settings (key, value)
    VALUES (${autoAcceptSettingKey}, ${sql.json(toJsonValue(value))})
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW()
    RETURNING *
  `;

  return normalizeAutoAcceptSettings(rows[0]);
}

export async function findDraftByTelegramUpdateId(updateId: string) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ProductRow[]>`
    SELECT * FROM product_drafts
    WHERE telegram_update_id = ${updateId}
    LIMIT 1
  `;

  return rows[0] ? mapProduct(rows[0]) : null;
}

export async function insertDraft(input: NewDraft) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ProductRow[]>`
    INSERT INTO product_drafts (
      id,
      telegram_update_id,
      telegram_user_id,
      telegram_chat_id,
      telegram_file_id,
      title,
      description,
      sale_price,
      list_price,
      category_id,
      quantity,
      vat_rate,
      dimensional_weight,
      attributes,
      image_url,
      barcode,
      stock_code,
      product_main_id,
      status,
      last_error
    )
    VALUES (
      ${crypto.randomUUID()},
      ${input.telegramUpdateId},
      ${input.telegramUserId},
      ${input.telegramChatId},
      ${input.telegramFileId},
      ${input.title},
      ${input.description},
      ${input.salePrice},
      ${input.listPrice},
      ${input.categoryId},
      ${input.quantity},
      ${input.vatRate},
      ${input.dimensionalWeight},
      ${sql.json(input.attributes)},
      ${input.imageUrl},
      ${input.barcode || generatedCode("FIGY", input.telegramUpdateId)},
      ${input.stockCode || generatedCode("STK", input.telegramUpdateId)},
      ${input.productMainId || generatedCode("MAIN", input.telegramUpdateId)},
      ${input.status},
      ${input.lastError ?? null}
    )
    ON CONFLICT (telegram_update_id) DO NOTHING
    RETURNING *
  `;

  if (rows[0]) {
    return mapProduct(rows[0]);
  }

  const existing = await findDraftByTelegramUpdateId(input.telegramUpdateId);

  if (!existing) {
    throw new Error("Taslak oluşturulamadı.");
  }

  return existing;
}

export async function listDrafts() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ProductRow[]>`
    SELECT * FROM product_drafts
    ORDER BY created_at DESC
    LIMIT 100
  `;

  return rows.map(mapProduct);
}

export async function getDraftById(id: string) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ProductRow[]>`
    SELECT * FROM product_drafts
    WHERE id = ${id}
    LIMIT 1
  `;

  return rows[0] ? mapProduct(rows[0]) : null;
}

export async function updateDraft(id: string, input: ProductUpdate) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ProductRow[]>`
    UPDATE product_drafts
    SET
      attributes = ${sql.json(input.attributes)},
      barcode = ${input.barcode},
      category_id = ${input.categoryId},
      description = ${input.description},
      dimensional_weight = ${input.dimensionalWeight},
      image_url = ${input.imageUrl},
      list_price = ${input.listPrice},
      product_main_id = ${input.productMainId},
      quantity = ${input.quantity},
      sale_price = ${input.salePrice},
      stock_code = ${input.stockCode},
      title = ${input.title},
      vat_rate = ${input.vatRate},
      status = CASE WHEN status = 'submitted' THEN status ELSE 'draft' END,
      last_error = CASE WHEN status = 'submitted' THEN last_error ELSE NULL END,
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  return rows[0] ? mapProduct(rows[0]) : null;
}

export async function markDraftReview(id: string, message: string) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ProductRow[]>`
    UPDATE product_drafts
    SET status = 'needs_review', last_error = ${message}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  return rows[0] ? mapProduct(rows[0]) : null;
}

export async function markDraftFailure(
  id: string,
  message: string,
  payload?: unknown,
  response?: unknown,
) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ProductRow[]>`
    UPDATE product_drafts
    SET
      status = 'failed',
      last_error = ${message},
      trendyol_payload = ${payload ? sql.json(toJsonValue(payload)) : null},
      trendyol_response = ${response ? sql.json(toJsonValue(response)) : null},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  return rows[0] ? mapProduct(rows[0]) : null;
}

export async function markDraftSubmitted(
  id: string,
  batchRequestId: string | null,
  payload: unknown,
  response: unknown,
) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ProductRow[]>`
    UPDATE product_drafts
    SET
      batch_request_id = ${batchRequestId},
      last_error = NULL,
      status = 'submitted',
      submitted_at = NOW(),
      trendyol_payload = ${sql.json(toJsonValue(payload))},
      trendyol_response = ${sql.json(toJsonValue(response))},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  return rows[0] ? mapProduct(rows[0]) : null;
}
