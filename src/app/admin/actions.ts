"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { clearAdminSession, isAdminAuthenticated } from "@/lib/auth";
import type { TrendyolAttributeInput } from "@/lib/caption";
import { updateDraft } from "@/lib/db";
import { submitDraftToTrendyol } from "@/lib/products";

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

export async function logoutAction() {
  await clearAdminSession();
  redirect("/login");
}
