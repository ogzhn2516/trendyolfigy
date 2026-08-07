import "server-only";

import {
  getDraftById,
  markDraftReview,
  markDraftSubmitted,
} from "@/lib/db";
import {
  buildTrendyolPayload,
  createTrendyolProduct,
  getCategoryAttributes,
  getCategoryAttributeValues,
  getTrendyolErrorSummary,
} from "@/lib/trendyol";

type ApiRecord = Record<string, unknown>;

function record(value: unknown): ApiRecord {
  return value && typeof value === "object" ? value as ApiRecord : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalized(value: string) {
  return value.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim();
}

function defaultHint(attributeName: string) {
  const name = normalized(attributeName);
  if (name.includes("mensei")) return "Turkiye TR";
  if (name.includes("parca")) return "1 Tek Parca";
  if (name.includes("hammadde") || name.includes("materyal") || name.includes("malzeme")) return "PLA Plastik";
  if (name.includes("uretim")) return "3D Baski 3D Yazici Yerli Uretim";
  if (name.includes("renk") || name.includes("web color")) return "Cok Renkli";
  if (name.includes("beden") || name.includes("boyut") || name.includes("ebat")) return "Tek Ebat Standart";
  if (name.includes("cinsiyet")) return "Unisex";
  if (name.includes("yas grubu")) return "Yetiskin";
  return "Standart Diger Yok";
}

function pickValue(values: Array<{ id: number; name: string }>, hint: string) {
  const hints = normalized(hint).split(/\s+/).filter(Boolean);
  const ranked = values.map((value) => {
    const candidate = normalized(value.name);
    const score = hints.filter((word) => candidate.includes(word) || word.includes(candidate)).length;
    return { score, value };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].value : values[0] ?? null;
}

async function completeRequiredAttributes(draft: NonNullable<Awaited<ReturnType<typeof getDraftById>>>) {
  const response = record(await getCategoryAttributes(draft.categoryId));
  const categoryAttributes = Array.isArray(response.categoryAttributes) ? response.categoryAttributes.map(record) : [];
  const required = categoryAttributes.filter((item) => item.required === true);
  let attributes = [...draft.attributes];
  const existingIds = new Set(attributes.map((item) => item.attributeId));

  for (const item of required) {
    const attribute = record(item.attribute);
    const attributeId = Number(attribute.id || item.attributeId);
    if (!Number.isFinite(attributeId)) continue;
    const attributeName = text(attribute.name) || text(item.attributeName);
    const normalizedName = normalized(attributeName);
    const forceStandard = attributeId === 1192 || normalizedName.includes("mensei") || normalizedName.includes("parca sayisi") || normalizedName.includes("hammadde") || normalizedName.includes("materyal") || normalizedName.includes("malzeme") || normalizedName.includes("uretim");
    if (existingIds.has(attributeId) && !forceStandard) continue;
    if (forceStandard) {
      attributes = attributes.filter((entry) => entry.attributeId !== attributeId);
      existingIds.delete(attributeId);
    }
    const hint = defaultHint(attributeName);
    if (item.allowCustom === true) {
      attributes.push({ attributeId, customAttributeValue: hint.slice(0, 100) });
      existingIds.add(attributeId);
      continue;
    }
    const valuesResponse = record(await getCategoryAttributeValues(draft.categoryId, attributeId));
    const values = (Array.isArray(valuesResponse.content) ? valuesResponse.content : []).map((raw) => ({
      id: Number(record(raw).attributeValueId),
      name: text(record(raw).attributeValue),
    })).filter((value) => Number.isFinite(value.id) && value.name);
    const selected = pickValue(values, hint);
    if (!selected) throw new Error(`Zorunlu kategori ozelligi icin deger bulunamadi: ${attributeName} (${attributeId}).`);
    attributes.push({ attributeId, attributeValueId: selected.id });
    existingIds.add(attributeId);
  }
  return { ...draft, attributes };
}

function getBatchRequestId(response: unknown) {
  if (!response || typeof response !== "object") {
    return null;
  }

  const batchRequestId = Reflect.get(response, "batchRequestId");

  return typeof batchRequestId === "string" ? batchRequestId : null;
}

function validateDraftForSubmission(
  draft: NonNullable<Awaited<ReturnType<typeof getDraftById>>>,
) {
  if (!draft.imageUrl) {
    return "Görsel Vercel Blob'a yüklenmedi. BLOB_READ_WRITE_TOKEN ayarlanmalı veya görsel URL'si admin panelinden girilmeli.";
  }

  if (!draft.title.trim() || !draft.description.trim()) {
    return "Ürün adı ve açıklama boş olamaz.";
  }

  if (!draft.barcode.trim() || !draft.stockCode.trim() || !draft.productMainId.trim()) {
    return "Barkod, stok kodu ve ana ürün kodu gerekli.";
  }

  if (draft.salePrice <= 0 || draft.listPrice < draft.salePrice) {
    return "Fiyatlar geçersiz. Liste fiyatı satış fiyatından düşük olamaz.";
  }

  return null;
}

export async function submitDirectProductToTrendyol(
  draft: NonNullable<Awaited<ReturnType<typeof getDraftById>>>,
) {
  const completedDraft = await completeRequiredAttributes(draft);
  const validationError = validateDraftForSubmission(completedDraft);

  if (validationError) {
    return {
      batchRequestId: null,
      error: validationError,
      ok: false,
    };
  }

  try {
    const payload = buildTrendyolPayload(completedDraft);
    const response = await createTrendyolProduct(payload);

    return {
      batchRequestId: getBatchRequestId(response),
      error: null,
      ok: true,
      payload,
      response,
    };
  } catch (error) {
    return {
      batchRequestId: null,
      error: getTrendyolErrorSummary(error),
      ok: false,
    };
  }
}

export async function submitDraftToTrendyol(id: string) {
  const draft = await getDraftById(id);

  if (!draft) {
    throw new Error("Taslak bulunamadı.");
  }

  if (draft.status === "cancelled") {
    throw new Error("Iptal edilen taslak Trendyol'a gonderilemez.");
  }

  const result = await submitDirectProductToTrendyol(draft);

  if (result.ok) {
    return markDraftSubmitted(
      id,
      result.batchRequestId,
      result.payload,
      result.response,
    );
  }

  return markDraftReview(
    id,
    result.error ?? "Trendyol gönderimi kontrol bekliyor.",
  );
}
