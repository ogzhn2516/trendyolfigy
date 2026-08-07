import "server-only";

import type { ProductDraft } from "@/lib/db";
import { listSubmittedDrafts, markDraftApproved, markDraftReview } from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { getBatchRequestResult } from "@/lib/trendyol";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function turkishReason(reason: string) {
  return reason
    .replace(/origin/gi, "Menşei")
    .replace(/attribute/gi, "kategori özelliği")
    .replace(/required/gi, "zorunlu")
    .replace(/missing/gi, "eksik")
    .replace(/image/gi, "görsel")
    .replace(/category/gi, "kategori")
    .replace(/barcode/gi, "barkod")
    .replace(/title/gi, "ürün adı")
    .replace(/description/gi, "ürün açıklaması");
}

export async function checkProductDraft(draft: ProductDraft, notify = true) {
  if (!draft.batchRequestId) return { message: "Batch ID bulunamadı.", status: "unknown" as const };
  const response = await getBatchRequestResult(draft.batchRequestId);
  const body = record(response);
  const items = Array.isArray(body.items) ? body.items.map(record) : [];
  const failed = items.filter((item) => String(item.status).toUpperCase() === "FAILED");
  const completed = String(body.status).toUpperCase() === "COMPLETED" || items.some((item) => ["SUCCESS", "FAILED"].includes(String(item.status).toUpperCase()));
  if (!completed) {
    const message = `⏳ İşleniyor\nÜrün: ${draft.title}\nBatch ID: ${draft.batchRequestId}`;
    if (notify) await sendTelegramMessage(draft.telegramChatId, message, { inlineKeyboard: [[{ callbackData: `pt|${draft.id}`, text: "🔄 Durumu Kontrol Et" }]] });
    return { message, status: "processing" as const };
  }
  if (!failed.length && Number(body.failedItemCount || 0) === 0) {
    await markDraftApproved(draft.id, response);
    const message = `✅ Trendyol ürünü onayladı\nÜrün: ${draft.title}\nBarkod: ${draft.barcode}`;
    if (notify) await sendTelegramMessage(draft.telegramChatId, message);
    return { message, status: "approved" as const };
  }
  const reasons = failed.flatMap((item) => Array.isArray(item.failureReasons) ? item.failureReasons.map(String) : []).map(turkishReason);
  const reason = reasons.join("\n- ") || "Trendyol ürün bilgilerini reddetti.";
  await markDraftReview(draft.id, reason);
  const message = `❌ Trendyol ürünü reddetti\nÜrün: ${draft.title}\nNeden:\n- ${reason}\n\nSistem zorunlu özellikleri yeniden kontrol ederek tekrar onaya hazırladı.`;
  if (notify) await sendTelegramMessage(draft.telegramChatId, message, { inlineKeyboard: [[{ callbackData: `pa|${draft.id}`, text: "🛠 Düzeltip Tekrar Gönder" }]] });
  return { message, status: "rejected" as const };
}

export async function checkPendingProducts(chatId?: number | string) {
  const drafts = (await listSubmittedDrafts()).filter((draft) => chatId === undefined || draft.telegramChatId === String(chatId));
  const results = [];
  for (const draft of drafts) results.push(await checkProductDraft(draft, true));
  return { checked: drafts.length, results };
}
