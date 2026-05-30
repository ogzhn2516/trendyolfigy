"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { clearAdminSession, isAdminAuthenticated } from "@/lib/auth";
import type { TrendyolAttributeInput } from "@/lib/caption";
import {
  saveCommerceActionNotice,
  saveCommerceSettings,
  setAutoAcceptEnabled,
} from "@/lib/db";
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
  defaultCommissionRate: z.number().min(0).max(60),
  fixedCost: z.number().min(0),
  maxPrice: z.number().positive(),
  minPrice: z.number().positive(),
  productCost: z.number().min(0),
  repricerEnabled: z.boolean(),
  repricerIntervalMinutes: z.number().int().min(15).max(120),
  shippingCost: z.number().min(0),
  stockWarningDays: z.number().int().min(1).max(90),
  targetMarginRate: z.number().min(0).max(80),
  undercutAmount: z.number().min(0.01).max(1000),
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

function parseFormNumber(value: FormDataEntryValue | null) {
  const rawValue = String(value ?? "").trim();
  const normalized = rawValue.includes(",")
    ? rawValue.replace(/\./g, "").replace(",", ".")
    : rawValue;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

async function commerceRedirect(
  params: Record<string, number | string>,
): Promise<never> {
  if (hasDatabaseUrl()) {
    await saveCommerceActionNotice({
      checked: typeof params.checked === "number" ? params.checked : undefined,
      message: typeof params.message === "string" ? params.message : undefined,
      notice: String(params.notice),
      submitted:
        typeof params.submitted === "number" ? params.submitted : undefined,
    });
  }

  const cookieStore = await cookies();
  cookieStore.set("figyfun_commerce_notice", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 120,
    path: "/",
    sameSite: "lax",
  });
  redirect("/admin#commerce");
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
    return await commerceRedirect({ notice: "database_missing" });
  }

  const parsed = commerceSettingsSchema.safeParse({
    defaultCommissionRate: parseFormNumber(formData.get("defaultCommissionRate")),
    fixedCost: parseFormNumber(formData.get("fixedCost")),
    maxPrice: parseFormNumber(formData.get("maxPrice")),
    minPrice: parseFormNumber(formData.get("minPrice")),
    productCost: parseFormNumber(formData.get("productCost")),
    repricerEnabled: formData.get("repricerEnabled") === "on",
    repricerIntervalMinutes: Math.trunc(
      parseFormNumber(formData.get("repricerIntervalMinutes")),
    ),
    shippingCost: parseFormNumber(formData.get("shippingCost")),
    stockWarningDays: Math.trunc(parseFormNumber(formData.get("stockWarningDays"))),
    targetMarginRate: parseFormNumber(formData.get("targetMarginRate")),
    undercutAmount: parseFormNumber(formData.get("undercutAmount")),
  });

  if (!parsed.success) {
    return await commerceRedirect({ notice: "settings_invalid" });
  }

  const settings = parsed.data;

  if (settings.maxPrice < settings.minPrice) {
    return await commerceRedirect({ notice: "settings_range_error" });
  }

  await saveCommerceSettings(settings);
  revalidatePath("/admin");
  return await commerceRedirect({ notice: "settings_saved" });
}

export async function runRepricerAction() {
  await requireActionAuth();

  let result: Awaited<ReturnType<typeof runRepricerUpdate>>;

  try {
    result = await runRepricerUpdate({ force: true });
  } catch (error) {
    return await commerceRedirect({
      message:
        error instanceof Error
          ? error.message.slice(0, 180)
          : "Repricer çalıştırılamadı.",
      notice: "repricer_error",
    });
  }

  revalidatePath("/admin");
  return await commerceRedirect({
    checked: result.checked,
    notice: result.submitted > 0 ? "repricer_submitted" : "repricer_empty",
    submitted: result.submitted,
  });
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
