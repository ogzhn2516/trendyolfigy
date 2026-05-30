"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { clearAdminSession, isAdminAuthenticated } from "@/lib/auth";
import type { TrendyolAttributeInput } from "@/lib/caption";
import { saveCommerceSettings, setAutoAcceptEnabled } from "@/lib/db";
import { updateDraft } from "@/lib/db";
import { hasDatabaseUrl } from "@/lib/env";
import { submitDraftToTrendyol } from "@/lib/products";
import {
  runBulkPriceChange,
  runRepricerUpdate,
} from "@/lib/trendyol-commerce-intelligence";
import { runAutoAcceptOrders } from "@/lib/trendyol-dashboard";

const attributeSchema = z.array(
  z.object({
    attributeId: z.number().int().positive(),
    attributeValueId: z.number().int().positive().optional(),
    attributeValueIds: z.array(z.number().int().positive()).optional(),
    customAttributeValue: z.string().min(1).optional(),
  }),
);

const updateSchema = z.object({
  barcode: z.string().trim().min(1),
  categoryId: z.coerce.number().int().positive(),
  description: z.string().trim().min(1),
  dimensionalWeight: z.coerce.number().positive(),
  imageUrl: z.string().trim().url().or(z.literal("")),
  listPrice: z.coerce.number().positive(),
  productMainId: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(0),
  salePrice: z.coerce.number().positive(),
  stockCode: z.string().trim().min(1),
  title: z.string().trim().min(1).max(100),
  vatRate: z.coerce.number().int().min(0).max(100),
});

const commerceSettingsSchema = z.object({
  defaultCommissionRate: z.coerce.number().min(0).max(60),
  fixedCost: z.coerce.number().min(0),
  maxPrice: z.coerce.number().positive(),
  minPrice: z.coerce.number().positive(),
  productCost: z.coerce.number().min(0),
  repricerEnabled: z.boolean(),
  repricerIntervalMinutes: z.coerce.number().int().min(15).max(120),
  shippingCost: z.coerce.number().min(0),
  stockWarningDays: z.coerce.number().int().min(1).max(90),
  targetMarginRate: z.coerce.number().min(0).max(80),
  undercutAmount: z.coerce.number().min(0.01).max(1000),
});

const bulkPriceSchema = z.object({
  percent: z.coerce.number().min(-80).max(300),
});

async function requireActionAuth() {
  if (!(await isAdminAuthenticated())) {
    redirect("/login");
  }
}

function parseAttributes(value: FormDataEntryValue | null): TrendyolAttributeInput[] {
  const rawValue = String(value ?? "[]").trim() || "[]";
  const json = JSON.parse(rawValue);

  return attributeSchema.parse(json);
}

export async function updateDraftAction(id: string, formData: FormData) {
  await requireActionAuth();

  const data = updateSchema.parse({
    barcode: formData.get("barcode"),
    categoryId: formData.get("categoryId"),
    description: formData.get("description"),
    dimensionalWeight: formData.get("dimensionalWeight"),
    imageUrl: formData.get("imageUrl"),
    listPrice: formData.get("listPrice"),
    productMainId: formData.get("productMainId"),
    quantity: formData.get("quantity"),
    salePrice: formData.get("salePrice"),
    stockCode: formData.get("stockCode"),
    title: formData.get("title"),
    vatRate: formData.get("vatRate"),
  });

  if (data.listPrice < data.salePrice) {
    throw new Error("Liste fiyatı satış fiyatından düşük olamaz.");
  }

  await updateDraft(id, {
    ...data,
    attributes: parseAttributes(formData.get("attributes")),
    imageUrl: data.imageUrl || null,
  });
  revalidatePath("/admin");
}

export async function submitDraftAction(id: string) {
  await requireActionAuth();
  await submitDraftToTrendyol(id);
  revalidatePath("/admin");
}

export async function updateAutoAcceptAction(formData: FormData) {
  await requireActionAuth();

  const enabled = formData.get("autoAcceptOrders") === "on";
  await setAutoAcceptEnabled(enabled);

  if (enabled) {
    await runAutoAcceptOrders();
  }

  revalidatePath("/admin");
}

export async function runAutoAcceptAction() {
  await requireActionAuth();
  await runAutoAcceptOrders({ force: true });
  revalidatePath("/admin");
}

export async function updateCommerceSettingsAction(formData: FormData) {
  await requireActionAuth();

  if (!hasDatabaseUrl()) {
    revalidatePath("/admin");
    return;
  }

  const settings = commerceSettingsSchema.parse({
    defaultCommissionRate: formData.get("defaultCommissionRate"),
    fixedCost: formData.get("fixedCost"),
    maxPrice: formData.get("maxPrice"),
    minPrice: formData.get("minPrice"),
    productCost: formData.get("productCost"),
    repricerEnabled: formData.get("repricerEnabled") === "on",
    repricerIntervalMinutes: formData.get("repricerIntervalMinutes"),
    shippingCost: formData.get("shippingCost"),
    stockWarningDays: formData.get("stockWarningDays"),
    targetMarginRate: formData.get("targetMarginRate"),
    undercutAmount: formData.get("undercutAmount"),
  });

  if (settings.maxPrice < settings.minPrice) {
    throw new Error("Maksimum fiyat minimum fiyattan düşük olamaz.");
  }

  await saveCommerceSettings(settings);
  revalidatePath("/admin");
}

export async function runRepricerAction() {
  await requireActionAuth();
  await runRepricerUpdate({ force: true });
  revalidatePath("/admin");
}

export async function runBulkPriceChangeAction(formData: FormData) {
  await requireActionAuth();
  const data = bulkPriceSchema.parse({
    percent: formData.get("percent"),
  });

  await runBulkPriceChange(data.percent);
  revalidatePath("/admin");
}

export async function logoutAction() {
  await clearAdminSession();
  redirect("/login");
}
