import "server-only";

import postgres from "postgres";

import type { TrendyolAttributeInput } from "@/lib/caption";
import { getDatabaseUrl } from "@/lib/env";

export type ProductStatus =
  | "draft"
  | "needs_review"
  | "failed"
  | "cancelled"
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
  imageUrls: string[];
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

export type CommerceSettings = {
  defaultCommissionRate: number;
  fixedCost: number;
  maxPrice: number;
  minPrice: number;
  productCost: number;
  repricerEnabled: boolean;
  repricerIntervalMinutes: number;
  shippingCost: number;
  stockWarningDays: number;
  targetMarginRate: number;
  undercutAmount: number;
};

export type CommerceActionNotice = {
  checked?: number;
  message?: string;
  notice: string;
  submitted?: number;
  updatedAt: Date | null;
};

export type BuyboxSnapshot = {
  barcode: string;
  buyboxOrder: number | null;
  buyboxPrice: number | null;
  listPrice: number;
  salePrice: number;
  stockCode: string;
  title: string;
  updatedAt: string;
};

export type PendingTelegramPriceUpdate = {
  barcode: string;
  buyboxOrder: number | null;
  buyboxPrice: number | null;
  chatId: string;
  listPrice: number;
  quantity: number;
  salePrice: number;
  stockCode: string;
  title: string;
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
  image_urls: string[] | null;
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
  imageUrls?: string[];
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
  imageUrls?: string[];
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
const buyboxSnapshotsKey = "buybox_snapshots";
const commerceActionNoticeKey = "commerce_action_notice";
const commerceSettingKey = "commerce_settings";
const pendingPriceUpdatePrefix = "pending_price_update:";
const seoAiQueueKey = "seo_ai_queue";

export type SeoAiQueueItem = {
  chatId: string;
  contentId: number;
  createdAt: string;
};

export const defaultCommerceSettings: CommerceSettings = {
  defaultCommissionRate: 18,
  fixedCost: 0,
  maxPrice: 999999,
  minPrice: 1,
  productCost: 0,
  repricerEnabled: false,
  repricerIntervalMinutes: 30,
  shippingCost: 0,
  stockWarningDays: 5,
  targetMarginRate: 12,
  undercutAmount: 0.5,
};

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
          image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
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
      await sql`ALTER TABLE product_drafts ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb`;
      await sql`
        CREATE TABLE IF NOT EXISTS telegram_product_albums (
          media_group_id TEXT PRIMARY KEY,
          telegram_user_id TEXT NOT NULL,
          telegram_chat_id TEXT NOT NULL,
          price NUMERIC(12, 2),
          notes TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'collecting',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS telegram_product_album_photos (
          media_group_id TEXT NOT NULL REFERENCES telegram_product_albums(media_group_id) ON DELETE CASCADE,
          telegram_update_id TEXT NOT NULL UNIQUE,
          telegram_file_id TEXT NOT NULL,
          image_url TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    imageUrls: row.image_urls?.length ? row.image_urls : row.image_url ? [row.image_url] : [],
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

function numberSetting(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCommerceSettings(row?: AppSettingRow): CommerceSettings {
  const value =
    row?.value && typeof row.value === "object"
      ? (row.value as Partial<Record<keyof CommerceSettings, unknown>>)
      : {};

  return {
    defaultCommissionRate: numberSetting(
      value.defaultCommissionRate,
      defaultCommerceSettings.defaultCommissionRate,
    ),
    fixedCost: numberSetting(value.fixedCost, defaultCommerceSettings.fixedCost),
    maxPrice: numberSetting(value.maxPrice, defaultCommerceSettings.maxPrice),
    minPrice: numberSetting(value.minPrice, defaultCommerceSettings.minPrice),
    productCost: numberSetting(value.productCost, defaultCommerceSettings.productCost),
    repricerEnabled: value.repricerEnabled === true,
    repricerIntervalMinutes: numberSetting(
      value.repricerIntervalMinutes,
      defaultCommerceSettings.repricerIntervalMinutes,
    ),
    shippingCost: numberSetting(value.shippingCost, defaultCommerceSettings.shippingCost),
    stockWarningDays: numberSetting(
      value.stockWarningDays,
      defaultCommerceSettings.stockWarningDays,
    ),
    targetMarginRate: numberSetting(
      value.targetMarginRate,
      defaultCommerceSettings.targetMarginRate,
    ),
    undercutAmount: numberSetting(
      value.undercutAmount,
      defaultCommerceSettings.undercutAmount,
    ),
  };
}

function normalizeCommerceActionNotice(row?: AppSettingRow): CommerceActionNotice | null {
  if (!row?.value || typeof row.value !== "object") {
    return null;
  }

  const value = row.value as Partial<CommerceActionNotice>;
  const updatedAt = new Date(row.updated_at);

  if (!value.notice || Date.now() - updatedAt.getTime() > 10 * 60 * 1000) {
    return null;
  }

  return {
    checked: numberSetting(value.checked, 0),
    message: typeof value.message === "string" ? value.message : undefined,
    notice: String(value.notice),
    submitted: numberSetting(value.submitted, 0),
    updatedAt,
  };
}

function normalizeBuyboxSnapshots(row?: AppSettingRow) {
  if (!row?.value || typeof row.value !== "object") {
    return new Map<string, BuyboxSnapshot>();
  }

  const entries = Object.entries(row.value as Record<string, unknown>);
  const snapshots = new Map<string, BuyboxSnapshot>();

  for (const [barcode, rawValue] of entries) {
    if (!rawValue || typeof rawValue !== "object") {
      continue;
    }

    const value = rawValue as Partial<BuyboxSnapshot>;

    snapshots.set(barcode, {
      barcode,
      buyboxOrder:
        value.buyboxOrder === null
          ? null
          : numberSetting(value.buyboxOrder, 0) || null,
      buyboxPrice:
        value.buyboxPrice === null
          ? null
          : numberSetting(value.buyboxPrice, 0) || null,
      listPrice: numberSetting(value.listPrice, 0),
      salePrice: numberSetting(value.salePrice, 0),
      stockCode: typeof value.stockCode === "string" ? value.stockCode : "",
      title: typeof value.title === "string" ? value.title : "",
      updatedAt:
        typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    });
  }

  return snapshots;
}

function normalizePendingPriceUpdate(
  row?: AppSettingRow,
): PendingTelegramPriceUpdate | null {
  if (!row?.value || typeof row.value !== "object") {
    return null;
  }

  const value = row.value as Partial<PendingTelegramPriceUpdate>;

  if (!value.barcode || !value.chatId) {
    return null;
  }

  return {
    barcode: String(value.barcode),
    buyboxOrder:
      value.buyboxOrder === null
        ? null
        : numberSetting(value.buyboxOrder, 0) || null,
    buyboxPrice:
      value.buyboxPrice === null
        ? null
        : numberSetting(value.buyboxPrice, 0) || null,
    chatId: String(value.chatId),
    listPrice: numberSetting(value.listPrice, 0),
    quantity: Math.trunc(numberSetting(value.quantity, 0)),
    salePrice: numberSetting(value.salePrice, 0),
    stockCode: typeof value.stockCode === "string" ? value.stockCode : "",
    title: typeof value.title === "string" ? value.title : "",
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

export async function getCommerceSettings() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<AppSettingRow[]>`
    SELECT * FROM app_settings
    WHERE key = ${commerceSettingKey}
    LIMIT 1
  `;

  return normalizeCommerceSettings(rows[0]);
}

export async function getCommerceActionNotice() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<AppSettingRow[]>`
    SELECT * FROM app_settings
    WHERE key = ${commerceActionNoticeKey}
    LIMIT 1
  `;

  return normalizeCommerceActionNotice(rows[0]);
}

export async function getBuyboxSnapshots() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<AppSettingRow[]>`
    SELECT * FROM app_settings
    WHERE key = ${buyboxSnapshotsKey}
    LIMIT 1
  `;

  return normalizeBuyboxSnapshots(rows[0]);
}

export async function saveBuyboxSnapshots(
  snapshots: Map<string, BuyboxSnapshot>,
) {
  await ensureSchema();
  const sql = getSql();
  const value = Object.fromEntries(snapshots.entries());

  await sql`
    INSERT INTO app_settings (key, value)
    VALUES (${buyboxSnapshotsKey}, ${sql.json(toJsonValue(value))})
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

export async function getPendingTelegramPriceUpdate(chatId: number | string) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<AppSettingRow[]>`
    SELECT * FROM app_settings
    WHERE key = ${pendingPriceUpdatePrefix + String(chatId)}
    LIMIT 1
  `;

  return normalizePendingPriceUpdate(rows[0]);
}

export async function savePendingTelegramPriceUpdate(
  pending: PendingTelegramPriceUpdate,
) {
  await ensureSchema();
  const sql = getSql();

  await sql`
    INSERT INTO app_settings (key, value)
    VALUES (
      ${pendingPriceUpdatePrefix + pending.chatId},
      ${sql.json(toJsonValue(pending))}
    )
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

export async function clearPendingTelegramPriceUpdate(chatId: number | string) {
  await ensureSchema();
  const sql = getSql();

  await sql`
    DELETE FROM app_settings
    WHERE key = ${pendingPriceUpdatePrefix + String(chatId)}
  `;
}

export async function getSeoAiQueue(): Promise<SeoAiQueueItem[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<AppSettingRow[]>`
    SELECT * FROM app_settings WHERE key = ${seoAiQueueKey} LIMIT 1
  `;
  const value = rows[0]?.value;
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      chatId: String(item.chatId ?? ""),
      contentId: Number(item.contentId),
      createdAt: String(item.createdAt ?? new Date().toISOString()),
    }))
    .filter((item) => item.chatId && Number.isFinite(item.contentId) && item.contentId > 0);
}

export async function saveSeoAiQueue(items: SeoAiQueueItem[]) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO app_settings (key, value)
    VALUES (${seoAiQueueKey}, ${sql.json(toJsonValue(items))})
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

export async function enqueueSeoAiUpdate(item: SeoAiQueueItem) {
  const queue = await getSeoAiQueue();
  const exists = queue.some(
    (current) => current.chatId === item.chatId && current.contentId === item.contentId,
  );
  if (!exists) queue.push(item);
  await saveSeoAiQueue(queue);
}

export async function saveCommerceActionNotice(
  notice: Omit<CommerceActionNotice, "updatedAt">,
) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<AppSettingRow[]>`
    INSERT INTO app_settings (key, value)
    VALUES (${commerceActionNoticeKey}, ${sql.json(toJsonValue(notice))})
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW()
    RETURNING *
  `;

  return normalizeCommerceActionNotice(rows[0]);
}

export async function saveCommerceSettings(settings: CommerceSettings) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<AppSettingRow[]>`
    INSERT INTO app_settings (key, value)
    VALUES (${commerceSettingKey}, ${sql.json(toJsonValue(settings))})
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW()
    RETURNING *
  `;

  return normalizeCommerceSettings(rows[0]);
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

export async function addTelegramAlbumPhoto(input: {
  chatId: string;
  fileId: string;
  imageUrl: string;
  mediaGroupId: string;
  notes: string;
  price: number | null;
  updateId: string;
  userId: string;
}) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO telegram_product_albums (
      media_group_id, telegram_user_id, telegram_chat_id, price, notes
    ) VALUES (
      ${input.mediaGroupId}, ${input.userId}, ${input.chatId}, ${input.price}, ${input.notes}
    )
    ON CONFLICT (media_group_id) DO UPDATE SET
      price = COALESCE(EXCLUDED.price, telegram_product_albums.price),
      notes = CASE WHEN EXCLUDED.notes <> '' THEN EXCLUDED.notes ELSE telegram_product_albums.notes END
  `;
  const inserted = await sql`
    INSERT INTO telegram_product_album_photos (
      media_group_id, telegram_update_id, telegram_file_id, image_url
    ) VALUES (
      ${input.mediaGroupId}, ${input.updateId}, ${input.fileId}, ${input.imageUrl}
    )
    ON CONFLICT (telegram_update_id) DO NOTHING
    RETURNING telegram_update_id
  `;
  if (inserted.length) {
    await sql`
      UPDATE telegram_product_albums
      SET updated_at = NOW()
      WHERE media_group_id = ${input.mediaGroupId} AND status = 'collecting'
    `;
  }
}

export async function claimTelegramAlbum(mediaGroupId: string) {
  await ensureSchema();
  const sql = getSql();
  const albums = await sql<Array<{
    media_group_id: string;
    notes: string;
    price: number | string | null;
    telegram_chat_id: string;
    telegram_user_id: string;
  }>>`
    UPDATE telegram_product_albums
    SET status = 'processing'
    WHERE media_group_id = ${mediaGroupId}
      AND status = 'collecting'
      AND updated_at < NOW() - INTERVAL '1.5 seconds'
    RETURNING *
  `;
  if (!albums[0]) return null;
  const photos = await sql<Array<{ image_url: string; telegram_file_id: string; telegram_update_id: string }>>`
    SELECT image_url, telegram_file_id, telegram_update_id
    FROM telegram_product_album_photos
    WHERE media_group_id = ${mediaGroupId}
    ORDER BY created_at ASC
  `;
  return {
    chatId: albums[0].telegram_chat_id,
    fileIds: photos.map((photo) => photo.telegram_file_id),
    imageUrls: photos.map((photo) => photo.image_url),
    notes: albums[0].notes,
    price: albums[0].price === null ? null : Number(albums[0].price),
    updateId: photos[0]?.telegram_update_id ?? mediaGroupId,
    userId: albums[0].telegram_user_id,
  };
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
      image_urls,
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
      ${sql.json(input.imageUrls?.length ? input.imageUrls : input.imageUrl ? [input.imageUrl] : [])},
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
      image_urls = ${sql.json(input.imageUrls?.length ? input.imageUrls : input.imageUrl ? [input.imageUrl] : [])},
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

export async function markDraftCancelled(id: string) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql<ProductRow[]>`
    UPDATE product_drafts
    SET status = 'cancelled', last_error = 'Telegram kullanicisi taslagi iptal etti.', updated_at = NOW()
    WHERE id = ${id} AND status <> 'submitted'
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
