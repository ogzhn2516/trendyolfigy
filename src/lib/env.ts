import "server-only";

import { z } from "zod";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

const optionalPositiveInteger = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().positive().optional(),
);

const adminSchema = z.object({
  ADMIN_PASSWORD: z.string().min(1, "ADMIN_PASSWORD is required."),
  ADMIN_SESSION_SECRET: z
    .string()
    .min(32, "ADMIN_SESSION_SECRET must be at least 32 characters."),
  ADMIN_USERNAME: z.string().min(1, "ADMIN_USERNAME is required."),
});

const telegramSchema = z.object({
  TELEGRAM_ALLOWED_USER_IDS: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: optionalText,
});

const trendyolSchema = z.object({
  TRENDYOL_API_KEY: z.string().min(1),
  TRENDYOL_API_SECRET: z.string().min(1),
  TRENDYOL_BASE_URL: optionalUrl,
  TRENDYOL_BRAND_ID: z.coerce.number().int().positive(),
  TRENDYOL_RETURNING_ADDRESS_ID: optionalPositiveInteger,
  TRENDYOL_SHIPMENT_ADDRESS_ID: optionalPositiveInteger,
  TRENDYOL_STORE_FRONT_CODE: optionalText,
  TRENDYOL_SUPPLIER_ID: z.string().min(1),
});

function parseEnv<T>(schema: z.ZodType<T>, name: string): T {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(" ");

    throw new Error(`${name} configuration error. ${details}`);
  }

  return parsed.data;
}

export function getAdminConfig() {
  return parseEnv(adminSchema, "Admin");
}

export function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("Database configuration error. DATABASE_URL is required.");
  }

  return databaseUrl;
}

export function getTelegramConfig() {
  return parseEnv(telegramSchema, "Telegram");
}

export function getTrendyolConfig() {
  return parseEnv(trendyolSchema, "Trendyol");
}

export function getOptionalBlobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim();
}
