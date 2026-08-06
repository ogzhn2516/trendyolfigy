import { parseProductCaption, telegramCaptionTemplate } from "@/lib/caption";
import type { ProductDraft } from "@/lib/db";
import {
  clearPendingTelegramPriceUpdate,
  findDraftByTelegramUpdateId,
  getPendingTelegramPriceUpdate,
  insertDraft,
} from "@/lib/db";
import { hasDatabaseUrl } from "@/lib/env";
import {
  submitDirectProductToTrendyol,
  submitDraftToTrendyol,
} from "@/lib/products";
import {
  answerTelegramCallbackQuery,
  getAllowedTelegramUserIds,
  sendTelegramMessage,
  storeTelegramPhoto,
  type TelegramUpdate,
} from "@/lib/telegram";
import {
  sendManualBuyboxReport,
  updateSingleProductPrice,
} from "@/lib/trendyol-commerce-intelligence";
import { applySeoUpdates, sendSeoReport } from "@/lib/trendyol-seo";

export const maxDuration = 60;
export const runtime = "nodejs";

function matchesWebhookSecret(request: Request) {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

  if (!configuredSecret) {
    return true;
  }

  return (
    request.headers.get("x-telegram-bot-api-secret-token") === configuredSecret
  );
}

function telegramId(value: number | string | undefined) {
  return value === undefined ? "" : String(value);
}

function generatedCode(prefix: string, updateId: string) {
  return `${prefix}-${updateId}`.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 40);
}

function parseTelegramPrice(value: string) {
  const compact = value.trim().replace(/\s+/g, "");
  const normalized = compact.includes(",")
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact.replace(/\.(?=.*\.)/g, "");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

async function handlePriceUpdateMessage(
  chatId: number | string,
  text: string | undefined,
) {
  if (!text) {
    return false;
  }

  const trimmed = text.trim();
  const commandMatch = trimmed.match(/^\/?(?:fiyat|price)\s+(\S+)\s+([0-9][0-9.,]*)$/i);
  let barcode = commandMatch?.[1];
  let salePrice = commandMatch ? parseTelegramPrice(commandMatch[2]) : null;
  let pending = null;

  if (!commandMatch && hasDatabaseUrl()) {
    salePrice = parseTelegramPrice(trimmed);

    if (salePrice !== null) {
      pending = await getPendingTelegramPriceUpdate(chatId);
      barcode = pending?.barcode;
    }
  }

  if (!barcode || salePrice === null) {
    return false;
  }

  try {
    const result = await updateSingleProductPrice({
      barcode,
      listPrice: pending?.listPrice,
      quantity: pending?.quantity,
      salePrice,
    });

    if (hasDatabaseUrl()) {
      await clearPendingTelegramPriceUpdate(chatId);
    }

    await sendTelegramMessage(
      chatId,
      [
        "Fiyat guncellemesi Trendyol kuyruğuna gonderildi.",
        `Urun: ${result.title}`,
        `Barkod: ${result.barcode}`,
        `Yeni satis fiyati: ${result.salePrice.toLocaleString("tr-TR", {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        })} TL`,
        `Batch ID: ${result.batchRequestId ?? "bekleniyor"}`,
      ].join("\n"),
    );
  } catch (error) {
    await sendTelegramMessage(
      chatId,
      `Fiyat guncellenemedi: ${
        error instanceof Error ? error.message : "Bilinmeyen hata"
      }`,
    );
  }

  return true;
}

async function handleBuyboxPriceButton(update: TelegramUpdate) {
  const callback = update.callback_query;

  if (!callback?.data?.startsWith("bb|") || !callback.message) {
    return false;
  }

  const chatId = callback.message.chat.id;
  const userId = telegramId(callback.from.id);

  if (!getAllowedTelegramUserIds().has(userId)) {
    await answerTelegramCallbackQuery(callback.id, "Bu islem icin yetkiniz yok.");
    return true;
  }

  const [, barcode, rawPrice] = callback.data.split("|");
  const salePrice = Number(rawPrice);

  if (!barcode || !Number.isFinite(salePrice) || salePrice <= 0) {
    await answerTelegramCallbackQuery(callback.id, "Gecersiz fiyat dugmesi.");
    return true;
  }

  await answerTelegramCallbackQuery(callback.id, "Fiyat Trendyol'a gonderiliyor...");

  try {
    const result = await updateSingleProductPrice({ barcode, salePrice });
    await sendTelegramMessage(
      chatId,
      [
        "Fiyat guncellemesi Trendyol'a gonderildi.",
        `Urun: ${result.title}`,
        `Barkod: ${result.barcode}`,
        `Yeni fiyat: ${result.salePrice.toLocaleString("tr-TR", {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        })} TL`,
        `Batch ID: ${result.batchRequestId ?? "bekleniyor"}`,
      ].join("\n"),
    );
  } catch (error) {
    await sendTelegramMessage(
      chatId,
      `Fiyat guncellenemedi: ${
        error instanceof Error ? error.message : "Bilinmeyen hata"
      }`,
    );
  }

  return true;
}

async function handleSeoButton(update: TelegramUpdate) {
  const callback = update.callback_query;

  if (!callback?.data || !callback.message || (callback.data !== "seoall" && !callback.data.startsWith("seo|"))) {
    return false;
  }

  const chatId = callback.message.chat.id;
  if (!getAllowedTelegramUserIds().has(telegramId(callback.from.id))) {
    await answerTelegramCallbackQuery(callback.id, "Bu islem icin yetkiniz yok.");
    return true;
  }

  const contentId = callback.data === "seoall" ? undefined : Number(callback.data.split("|")[1]);
  if (contentId !== undefined && (!Number.isFinite(contentId) || contentId <= 0)) {
    await answerTelegramCallbackQuery(callback.id, "Gecersiz urun.");
    return true;
  }

  await answerTelegramCallbackQuery(callback.id, "SEO guncellemesi hazirlaniyor...");
  try {
    if (!contentId) {
      await sendTelegramMessage(chatId, "AI SEO islemleri urun gorselleri tek tek analiz edilerek yapilir. Yeni `seo` listesindeki urun butonlarini kullanin.");
      return true;
    }
    const result = await applySeoUpdates(contentId, chatId);
    if (result.method === "queued") {
      await sendTelegramMessage(
        chatId,
        [
          "⏳ AI SEO islemi bekleme kuyruguna alindi.",
          `Urun: ${result.productTitle ?? "Bilinmiyor"}`,
          `Content ID: ${result.productContentId ?? "Bilinmiyor"}`,
          "Gemini ve yedek AI limiti su an kullanilamiyor.",
          "Kota yenilendiginde sistem otomatik tekrar deneyip sonucu bildirecek.",
        ].join("\n"),
      );
    } else if (!result.count) {
      await sendTelegramMessage(
        chatId,
        "Urun SEO icin uygun degil. Urun satis disinda olabilir veya BuyBox rekabeti bulundugu icin SEO degisikliginden haric tutulmustur.",
      );
    } else if (result.method === "ai") {
      await sendTelegramMessage(
        chatId,
        [
          "✅ SEO guncellemesi tamamlandi.",
          `Urun: ${result.productTitle ?? "Bilinmiyor"}`,
          `Content ID: ${result.productContentId ?? "Bilinmiyor"}`,
          `Yontem: ${result.provider ?? "AI"} gorsel analizi`,
          `Guncellenen urun: ${result.count}`,
          `Batch ID: ${result.batchRequestId ?? "bekleniyor"}`,
        ].join("\n"),
      );
    } else {
      await sendTelegramMessage(
        chatId,
        [
          "✅ SEO guncellemesi tamamlandi.",
          `Urun: ${result.productTitle ?? "Bilinmiyor"}`,
          `Content ID: ${result.productContentId ?? "Bilinmiyor"}`,
          "Yontem: Normal SEO sistemi (AI kullanilmadi)",
          contentId && result.aiFallbackReason
            ? "AI yanit vermedigi veya kullanilamadigi icin guvenli yedek sistem uygulandi."
            : "Toplu islemler guvenli normal SEO sistemiyle uygulanir.",
          `Guncellenen urun: ${result.count}`,
          `Batch ID: ${result.batchRequestId ?? "bekleniyor"}`,
        ].join("\n"),
      );
    }
  } catch (error) {
    await sendTelegramMessage(chatId, `SEO guncellemesi gonderilemedi: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
  }
  return true;
}

function getDirectDraft(
  updateId: string,
  chatId: string,
  userId: string,
  fileId: string,
  imageUrl: string | null,
  parsedCaption: ReturnType<typeof parseProductCaption>,
): ProductDraft {
  const now = new Date();

  return {
    attributes: parsedCaption.attributes,
    barcode: parsedCaption.barcode ?? generatedCode("FIGY", updateId),
    batchRequestId: null,
    categoryId: parsedCaption.categoryId!,
    createdAt: now,
    description: parsedCaption.description!,
    dimensionalWeight: parsedCaption.dimensionalWeight,
    id: updateId,
    imageUrl,
    lastError: null,
    listPrice: parsedCaption.listPrice ?? parsedCaption.salePrice!,
    productMainId: parsedCaption.productMainId ?? generatedCode("MAIN", updateId),
    quantity: parsedCaption.quantity,
    salePrice: parsedCaption.salePrice!,
    status: "draft",
    stockCode: parsedCaption.stockCode ?? generatedCode("STK", updateId),
    submittedAt: null,
    telegramChatId: chatId,
    telegramFileId: fileId,
    telegramUpdateId: updateId,
    telegramUserId: userId,
    title: parsedCaption.title!,
    trendyolPayload: null,
    trendyolResponse: null,
    updatedAt: now,
    vatRate: parsedCaption.vatRate,
  };
}

async function sendDirectDraft(
  chatId: number | string,
  warning: string | null,
  draft: ProductDraft,
) {
  const directResult = await submitDirectProductToTrendyol(draft);

  await sendTelegramMessage(
    chatId,
    directResult.ok
      ? `Ürün Trendyol kuyruğuna doğrudan gönderildi. Batch ID: ${directResult.batchRequestId ?? "bekleniyor"}`
      : `Doğrudan Trendyol gönderimi tamamlanmadı. ${warning ?? ""} ${directResult.error}`.trim(),
  );

  return directResult;
}

export async function POST(request: Request) {
  if (!matchesWebhookSecret(request)) {
    return Response.json({ error: "Invalid Telegram secret." }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;

  if (await handleBuyboxPriceButton(update)) {
    return Response.json({ ok: true });
  }

  if (await handleSeoButton(update)) {
    return Response.json({ ok: true });
  }

  const message = update.message;

  if (!message) {
    return Response.json({ ok: true });
  }

  const chatId = message.chat.id;
  const userId = telegramId(message.from?.id);

  if (!userId || !getAllowedTelegramUserIds().has(userId)) {
    await sendTelegramMessage(
      chatId,
      "Bu bot için yetkili Telegram kullanıcı ID'si gerekli.",
    );
    return Response.json({ ok: true });
  }

  if (!message.photo?.length) {
    const command = message.text?.trim().toLocaleLowerCase("tr-TR");

    if (
      command === "buybox" ||
      command === "buybox kontrol" ||
      command === "/buybox" ||
      command === "/buybox_kontrol"
    ) {
      await sendTelegramMessage(chatId, "Tum satis urunleri icin BuyBox kontrolu baslatildi...");

      try {
        await sendManualBuyboxReport(chatId);
      } catch (error) {
        await sendTelegramMessage(
          chatId,
          `BuyBox kontrolu tamamlanamadi: ${
            error instanceof Error ? error.message : "Bilinmeyen hata"
          }`,
        );
      }

      return Response.json({ ok: true });
    }

    if (command === "seo" || command === "/seo" || command === "seo kontrol") {
      await sendTelegramMessage(chatId, "Tum satis urunleri icin SEO kontrolu baslatildi...");
      try {
        await sendSeoReport(chatId);
      } catch (error) {
        await sendTelegramMessage(chatId, `SEO kontrolu tamamlanamadi: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
      }
      return Response.json({ ok: true });
    }

    if (await handlePriceUpdateMessage(chatId, message.text)) {
      return Response.json({ ok: true });
    }

    await sendTelegramMessage(chatId, telegramCaptionTemplate);
    return Response.json({ ok: true });
  }

  const updateId = String(update.update_id);
  let databaseEnabled = hasDatabaseUrl();
  let existing = null;

  if (databaseEnabled) {
    try {
      existing = await findDraftByTelegramUpdateId(updateId);
    } catch (error) {
      console.error("Product draft database is unavailable, using direct mode.", error);
      databaseEnabled = false;
    }
  }

  if (existing) {
    return Response.json({ draftId: existing.id, ok: true });
  }

  const parsedCaption = parseProductCaption(message.caption);

  if (parsedCaption.issues.length > 0) {
    await sendTelegramMessage(
      chatId,
      `Taslak alınamadı:\n- ${parsedCaption.issues.join("\n- ")}\n\n${telegramCaptionTemplate}`,
    );
    return Response.json({ ok: true });
  }

  const photo = message.photo.at(-1);

  if (!photo) {
    return Response.json({ ok: true });
  }

  const storedImage = await storeTelegramPhoto(
    photo.file_id,
    updateId,
  );

  if (!databaseEnabled) {
    const directDraft = getDirectDraft(
      updateId,
      telegramId(chatId),
      userId,
      photo.file_id,
      storedImage.imageUrl,
      parsedCaption,
    );
    const directResult = await sendDirectDraft(
      chatId,
      storedImage.warning,
      directDraft,
    );

    return Response.json({
      batchRequestId: directResult.batchRequestId,
      mode: "direct",
      ok: true,
    });
  }

  let draft: ProductDraft;

  try {
    draft = await insertDraft({
      attributes: parsedCaption.attributes,
      barcode: parsedCaption.barcode,
      categoryId: parsedCaption.categoryId!,
      description: parsedCaption.description!,
      dimensionalWeight: parsedCaption.dimensionalWeight,
      imageUrl: storedImage.imageUrl,
      lastError: storedImage.warning,
      listPrice: parsedCaption.listPrice ?? parsedCaption.salePrice!,
      productMainId: parsedCaption.productMainId,
      quantity: parsedCaption.quantity,
      salePrice: parsedCaption.salePrice!,
      status: storedImage.imageUrl ? "draft" : "needs_review",
      stockCode: parsedCaption.stockCode,
      telegramChatId: telegramId(chatId),
      telegramFileId: photo.file_id,
      telegramUpdateId: updateId,
      telegramUserId: userId,
      title: parsedCaption.title!,
      vatRate: parsedCaption.vatRate,
    });
  } catch (error) {
    console.error("Product draft could not be saved, using direct mode.", error);
    const directDraft = getDirectDraft(
      updateId,
      telegramId(chatId),
      userId,
      photo.file_id,
      storedImage.imageUrl,
      parsedCaption,
    );
    const directResult = await sendDirectDraft(
      chatId,
      storedImage.warning,
      directDraft,
    );

    return Response.json({
      batchRequestId: directResult.batchRequestId,
      mode: "direct-fallback",
      ok: true,
    });
  }
  const result = storedImage.imageUrl
    ? await submitDraftToTrendyol(draft.id)
    : draft;

  if (result?.status === "submitted") {
    await sendTelegramMessage(
      chatId,
      `Ürün Trendyol kuyruğuna gönderildi. Batch ID: ${result.batchRequestId ?? "bekleniyor"}`,
    );
  } else {
    await sendTelegramMessage(
      chatId,
      `Ürün admin kuyruğuna alındı. ${result?.lastError ?? "Trendyol gönderimi kontrol bekliyor."}`,
    );
  }

  return Response.json({ draftId: draft.id, ok: true });
}
