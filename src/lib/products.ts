import "server-only";

import {
  getDraftById,
  markDraftReview,
  markDraftSubmitted,
} from "@/lib/db";
import {
  buildTrendyolPayload,
  createTrendyolProduct,
  getTrendyolErrorSummary,
} from "@/lib/trendyol";

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
  const validationError = validateDraftForSubmission(draft);

  if (validationError) {
    return {
      batchRequestId: null,
      error: validationError,
      ok: false,
    };
  }

  try {
    const payload = buildTrendyolPayload(draft);
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
