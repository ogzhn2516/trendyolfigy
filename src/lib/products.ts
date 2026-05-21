import "server-only";

import {
  getDraftById,
  markDraftFailure,
  markDraftReview,
  markDraftSubmitted,
} from "@/lib/db";
import {
  buildTrendyolPayload,
  createTrendyolProduct,
  TrendyolApiError,
} from "@/lib/trendyol";

function getBatchRequestId(response: unknown) {
  if (!response || typeof response !== "object") {
    return null;
  }

  const batchRequestId = Reflect.get(response, "batchRequestId");

  return typeof batchRequestId === "string" ? batchRequestId : null;
}

function validateDraftForSubmission(draft: NonNullable<Awaited<ReturnType<typeof getDraftById>>>) {
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

export async function submitDraftToTrendyol(id: string) {
  const draft = await getDraftById(id);

  if (!draft) {
    throw new Error("Taslak bulunamadı.");
  }

  const validationError = validateDraftForSubmission(draft);

  if (validationError) {
    return markDraftReview(id, validationError);
  }

  const payload = buildTrendyolPayload(draft);

  try {
    const response = await createTrendyolProduct(payload);

    return markDraftSubmitted(id, getBatchRequestId(response), payload, response);
  } catch (error) {
    if (error instanceof TrendyolApiError) {
      return markDraftFailure(id, error.message, payload, error.body);
    }

    return markDraftFailure(
      id,
      error instanceof Error ? error.message : "Trendyol gönderimi başarısız oldu.",
      payload,
    );
  }
}
