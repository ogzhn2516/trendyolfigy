import { parseProductCaption, telegramCaptionTemplate } from "@/lib/caption";
import type { ProductDraft } from "@/lib/db";
import {
  clearPendingTelegramPriceUpdate,
  addTelegramAlbumPhoto,
  claimTelegramAlbum,
  findDraftByTelegramUpdateId,
  getDraftById,
  getPendingTelegramPriceUpdate,
  getTelegramSelectedCategory,
  insertDraft,
  markDraftCancelled,
  saveTelegramSelectedCategory,
} from "@/lib/db";
import { analyzeNewProductImage, getTrendyolLeafCategoryById, searchTrendyolLeafCategories } from "@/lib/ai-product-draft";
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
import { applySeoUpdates, processSeoAiQueue, queueAllLowSeoProducts, sendSeoReport } from "@/lib/trendyol-seo";
import { checkPendingProducts, checkProductDraft } from "@/lib/product-tracker";
import { buildTodaySalesReport } from "@/lib/sales-report";

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
      await sendTelegramMessage(chatId, "Düşük puanlı ürünlerin tamamı AI SEO kuyruğuna hazırlanıyor...");
      const queued = await queueAllLowSeoProducts(chatId);
      if (!queued.low) {
        await sendTelegramMessage(chatId, "Güncellenecek düşük puanlı ürün bulunamadı.");
        return true;
      }
      await sendTelegramMessage(chatId, [
        `🤖 Toplu AI SEO işlemi başlatıldı.`,
        `Düşük puanlı ürün: ${queued.low}`,
        `Yeni kuyruğa eklenen: ${queued.added}`,
        "İlk ürün şimdi işlenecek; kalanlar ücretsiz AI kotası doğrultusunda otomatik devam edecek.",
        "Her tamamlanan ürün ayrıca bildirilecek.",
      ].join("\n"));
      const processed = await processSeoAiQueue(1);
      await sendTelegramMessage(chatId, `Toplu SEO durumu: ${processed.completed} ürün tamamlandı, ${processed.remaining} ürün sırada.`);
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

async function handleProductApprovalButton(update: TelegramUpdate) {
  const callback = update.callback_query;
  if (!callback?.data || !callback.message || (!callback.data.startsWith("pa|") && !callback.data.startsWith("px|"))) return false;
  const chatId = callback.message.chat.id;
  if (!getAllowedTelegramUserIds().has(telegramId(callback.from.id))) {
    await answerTelegramCallbackQuery(callback.id, "Bu islem icin yetkiniz yok.");
    return true;
  }
  const [action, draftId] = callback.data.split("|");
  const draft = draftId ? await getDraftById(draftId) : null;
  if (!draft || draft.telegramChatId !== telegramId(chatId)) {
    await answerTelegramCallbackQuery(callback.id, "Taslak bulunamadi veya size ait degil.");
    return true;
  }
  if (draft.status === "submitted" || draft.status === "approved") {
    await answerTelegramCallbackQuery(callback.id, "Bu urun daha once Trendyol'a gonderildi.");
    return true;
  }
  if (draft.status === "cancelled") {
    await answerTelegramCallbackQuery(callback.id, "Bu urun taslagi iptal edildi.");
    return true;
  }
  if (action === "px") {
    await markDraftCancelled(draft.id);
    await answerTelegramCallbackQuery(callback.id, "Taslak iptal edildi.");
    await sendTelegramMessage(chatId, `❌ Urun taslagi iptal edildi.\nUrun: ${draft.title}`);
    return true;
  }
  await answerTelegramCallbackQuery(callback.id, "Urun Trendyol'a gonderiliyor...");
  try {
    const result = await submitDraftToTrendyol(draft.id);
    if (result?.status === "submitted") {
      await sendTelegramMessage(chatId, `⏳ Urun Trendyol'da isleniyor.\nUrun: ${draft.title}\nBatch ID: ${result.batchRequestId ?? "bekleniyor"}`, {
        inlineKeyboard: [[{ callbackData: `pt|${draft.id}`, text: "🔄 Durumu Kontrol Et" }]],
      });
      await new Promise((resolve) => setTimeout(resolve, 3500));
      try {
        const submittedDraft = await getDraftById(draft.id);
        if (submittedDraft?.status === "submitted") {
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const outcome = await checkProductDraft(submittedDraft, false);
            if (outcome.status !== "processing") {
              await checkProductDraft(submittedDraft, true);
              break;
            }
            if (attempt === 4) await checkProductDraft(submittedDraft, true);
            else await new Promise((resolve) => setTimeout(resolve, 4000));
          }
        }
      } catch {
        // Kuyruk sonucu gecikirse kullanici butonla veya /urun_durum ile tekrar kontrol eder.
      }
    } else {
      await sendTelegramMessage(chatId, `Urun gonderilemedi: ${result?.lastError ?? "Trendyol kontrolu gerekli."}`);
    }
  } catch (error) {
    await sendTelegramMessage(chatId, `Urun gonderilemedi: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
  }
  return true;
}

async function handleProductCategoryButton(update: TelegramUpdate) {
  const callback = update.callback_query;
  if (!callback?.data?.startsWith("pc|") || !callback.message) return false;
  const chatId = callback.message.chat.id;
  if (!getAllowedTelegramUserIds().has(telegramId(callback.from.id))) {
    await answerTelegramCallbackQuery(callback.id, "Bu islem icin yetkiniz yok.");
    return true;
  }
  const categoryId = Number(callback.data.split("|")[1]);
  const category = Number.isFinite(categoryId) ? await getTrendyolLeafCategoryById(categoryId) : null;
  if (!category) {
    await answerTelegramCallbackQuery(callback.id, "Kategori bulunamadi; yeniden arayin.");
    return true;
  }
  await saveTelegramSelectedCategory(chatId, { categoryId: category.id, name: category.name, path: category.path });
  await answerTelegramCallbackQuery(callback.id, "Aktif kategori secildi.");
  await sendTelegramMessage(chatId, `✅ Aktif kategori ayarlandi\n${category.path}\nKategori ID: ${category.id}\n\nBundan sonraki urunlerde sadece Urun ve Fiyat yazmaniz yeterli.`);
  return true;
}

async function handleProductTrackingButton(update: TelegramUpdate) {
  const callback = update.callback_query;
  if (!callback?.data?.startsWith("pt|") || !callback.message) return false;
  const chatId = callback.message.chat.id;
  if (!getAllowedTelegramUserIds().has(telegramId(callback.from.id))) {
    await answerTelegramCallbackQuery(callback.id, "Bu islem icin yetkiniz yok.");
    return true;
  }
  const draft = await getDraftById(callback.data.split("|")[1] || "");
  if (!draft || draft.telegramChatId !== telegramId(chatId)) {
    await answerTelegramCallbackQuery(callback.id, "Urun takibi bulunamadi.");
    return true;
  }
  if (draft.status === "approved") {
    await answerTelegramCallbackQuery(callback.id, "Bu urun Trendyol tarafindan onaylandi.");
    await sendTelegramMessage(chatId, `✅ Trendyol urunu onayladi\nUrun: ${draft.title}\nBarkod: ${draft.barcode}`);
    return true;
  }
  if (draft.status === "needs_review") {
    await answerTelegramCallbackQuery(callback.id, "Urun reddedildi; duzeltip yeniden gonderebilirsiniz.");
    await sendTelegramMessage(chatId, `❌ Trendyol urunu reddetti\nUrun: ${draft.title}\nNeden: ${draft.lastError ?? "Urun bilgileri yeniden kontrol edilmeli."}`, {
      inlineKeyboard: [[{ callbackData: `pa|${draft.id}`, text: "🛠 Duzeltip Tekrar Gonder" }]],
    });
    return true;
  }
  await answerTelegramCallbackQuery(callback.id, "Trendyol durumu kontrol ediliyor...");
  try { await checkProductDraft(draft, true); }
  catch (error) { await sendTelegramMessage(chatId, `Urun durumu alinamadi: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`); }
  return true;
}

function categorySearchQuery(value?: string) {
  const command = value?.trim().replace(/@[a-zA-Z0-9_]+(?=\s|$)/, "") || "";
  const explicit = command.match(/^\/?kategori\s+(.+)$/i);
  if (explicit?.[1]) return explicit[1].trim();
  const shortcut = command.match(/^\/([\p{L}\p{N}_-]{2,})$/u)?.[1];
  if (!shortcut || ["start", "help", "buybox", "buybox_kontrol", "seo"].includes(shortcut.toLocaleLowerCase("tr-TR"))) return null;
  return shortcut.replace(/_/g, " ");
}

async function sendCategorySearch(chatId: number | string, query: string) {
  const categories = await searchTrendyolLeafCategories(query, 10);
  if (!categories.length) {
    await sendTelegramMessage(chatId, `"${query}" icin Trendyol alt kategorisi bulunamadi.`);
    return;
  }
  await sendTelegramMessage(chatId, [
    `🔎 "${query}" icin Trendyol alt kategorileri:`,
    ...categories.map((category, index) => `${index + 1}. ${category.path}\nID: ${category.id}`),
    "\nDogru kategoriyi butondan secin.",
  ].join("\n\n"), {
    inlineKeyboard: categories.map((category, index) => [{ callbackData: `pc|${category.id}`, text: `${index + 1}. ${category.name}` }]),
  });
}

function imageCaptionPrice(caption?: string) {
  if (!caption?.trim()) return null;
  const lines = caption.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const priceLine = lines.find((line) => /^(?:fiyat\s*:\s*)?[0-9][0-9.,]*\s*(?:tl)?$/i.test(line));
  const priceMatch = priceLine?.match(/^(?:fiyat\s*:\s*)?([0-9][0-9.,]*)/i);
  const price = priceMatch ? parseTelegramPrice(priceMatch[1]) : null;
  if (price === null) return null;
  const categoryLine = lines.find((line) => /^kategori\s*:/i.test(line));
  const category = categoryLine?.replace(/^kategori\s*:\s*/i, "").trim() || "";
  const productLine = lines.find((line) => /^(?:urun|ürün)\s*:/i.test(line));
  const productName = productLine?.replace(/^(?:urun|ürün)\s*:\s*/i, "").trim() || "";
  const notes = lines.filter((line) => line !== categoryLine && line !== priceLine && line !== productLine).join("\n");
  return { category, notes, price, productName };
}

async function createAiDraftAndNotify(input: {
  chatId: number | string;
  fileIds: string[];
  imageUrls: string[];
  notes: string;
  category: string;
  productName: string;
  price: number;
  updateId: string;
  userId: string;
}) {
  if (!input.category.trim()) {
    throw new Error("Kategori gerekli. Aciklamaya yeni satirda `Kategori: alt kategori adi` yazin.");
  }
  if (!input.productName.trim()) {
    throw new Error("Urun adi gerekli. Aciklamaya yeni satirda `Urun: urunun mevcut adi` yazin.");
  }
  const ai = await analyzeNewProductImage(input.imageUrls, input.notes, input.category, input.productName);
  const draft = await insertDraft({
    attributes: ai.attributes,
    categoryId: ai.categoryId,
    description: ai.description,
    dimensionalWeight: ai.dimensionalWeight,
    imageUrl: input.imageUrls[0],
    imageUrls: input.imageUrls,
    lastError: `AI kategori: ${ai.categoryName}`,
    listPrice: input.price,
    quantity: 1000,
    salePrice: input.price,
    status: "needs_review",
    telegramChatId: telegramId(input.chatId),
    telegramFileId: input.fileIds[0] ?? null,
    telegramUpdateId: input.updateId,
    telegramUserId: input.userId,
    title: ai.title,
    vatRate: ai.vatRate,
  });
  const cleanDescription = ai.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  await sendTelegramMessage(input.chatId, [
    "🤖 AI urun taslagi hazir",
    `Urun: ${draft.title}`,
    `Kategori: ${ai.categoryName} (${ai.categoryId})`,
    `Gorsel: ${input.imageUrls.length}`,
    `Fiyat: ${input.price.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL`,
    `KDV: %${ai.vatRate}`,
    `Zorunlu ozellik: ${ai.attributes.length}`,
    `Aciklama: ${cleanDescription.slice(0, 900)}`,
    "\nBilgileri kontrol edip onaylayin. Onay verilmeden Trendyol'a yuklenmez.",
  ].join("\n"), { inlineKeyboard: [[
    { callbackData: `pa|${draft.id}`, text: "✅ Onayla ve Yukle" },
    { callbackData: `px|${draft.id}`, text: "❌ Iptal" },
  ]] });
  return draft;
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
    imageUrls: imageUrl ? [imageUrl] : [],
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

  if (await handleProductCategoryButton(update)) {
    return Response.json({ ok: true });
  }

  if (await handleProductTrackingButton(update)) {
    return Response.json({ ok: true });
  }

  if (await handleProductApprovalButton(update)) {
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
    const categoryQuery = categorySearchQuery(message.text);

    if (["/rapor bugün", "rapor bugün", "/rapor bugun", "rapor bugun"].includes(command || "")) {
      await sendTelegramMessage(chatId, "Bugünkü Trendyol satışları ve kesintileri hesaplanıyor...");
      try {
        const reportMessages = await buildTodaySalesReport();
        for (const reportMessage of reportMessages) await sendTelegramMessage(chatId, reportMessage);
      } catch (error) {
        await sendTelegramMessage(chatId, `Satış raporu hazırlanamadı: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
      }
      return Response.json({ ok: true });
    }

    if (command === "/kategori" || command === "kategori") {
      const selected = hasDatabaseUrl() ? await getTelegramSelectedCategory(chatId) : null;
      await sendTelegramMessage(chatId, selected
        ? `Aktif kategori:\n${selected.path}\nKategori ID: ${selected.categoryId}\n\nDegistirmek icin /ev, /figur veya /kategori arama yazin.`
        : "Aktif kategori secilmedi. /ev, /figur veya /kategori fotograf cercevesi yazarak arayin.");
      return Response.json({ ok: true });
    }

    if (["/urun_durum", "urun durum", "ürün durum", "/urun_durumu"].includes(command || "")) {
      await sendTelegramMessage(chatId, "Gönderilen ürünlerin Trendyol durumu kontrol ediliyor...");
      try {
        const result = await checkPendingProducts(chatId);
        if (!result.checked) await sendTelegramMessage(chatId, "Takip bekleyen ürün bulunamadı.");
      } catch (error) {
        await sendTelegramMessage(chatId, `Ürün takibi tamamlanamadı: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
      }
      return Response.json({ ok: true });
    }

    if (categoryQuery) {
      try {
        await sendCategorySearch(chatId, categoryQuery);
      } catch (error) {
        await sendTelegramMessage(chatId, `Kategori aramasi tamamlanamadi: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
      }
      return Response.json({ ok: true });
    }

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

  const photo = message.photo.at(-1);
  if (!photo) return Response.json({ ok: true });
  const simpleProduct = imageCaptionPrice(message.caption);
  const activeCategory = databaseEnabled ? await getTelegramSelectedCategory(chatId) : null;
  const effectiveCategory = simpleProduct?.category || (activeCategory ? String(activeCategory.categoryId) : "");

  if (message.media_group_id) {
    if (!databaseEnabled) {
      await sendTelegramMessage(chatId, "Coklu fotograf akisi icin veritabani baglantisi gerekli.");
      return Response.json({ ok: true });
    }
    try {
      const storedImage = await storeTelegramPhoto(photo.file_id, updateId);
      if (!storedImage.imageUrl) throw new Error(storedImage.warning || "Kalici urun gorseli olusturulamadi.");
      await addTelegramAlbumPhoto({
        chatId: telegramId(chatId),
        category: effectiveCategory,
        productName: simpleProduct?.productName ?? "",
        fileId: photo.file_id,
        imageUrl: storedImage.imageUrl,
        mediaGroupId: message.media_group_id,
        notes: simpleProduct?.notes ?? "",
        price: simpleProduct?.price ?? null,
        updateId,
        userId,
      });
      // Telegram bir albumdeki her fotografi ayri webhook olarak gonderir.
      // Son fotograf Blob ve veritabanina yazilana kadar albumu acik tut.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const album = await claimTelegramAlbum(message.media_group_id);
      if (!album) return Response.json({ mode: "album-collecting", ok: true });
      if (album.price === null) {
        await sendTelegramMessage(chatId, "Album alindi fakat fiyat bulunamadi. Fotograflari yeniden album olarak gonderip ilk fotograf aciklamasina `Fiyat: 349.90` yazin.");
        return Response.json({ mode: "album-missing-price", ok: true });
      }
      await sendTelegramMessage(chatId, `🤖 Yazdiginiz urun adi SEO icin optimize ediliyor. Albumdeki ${album.imageUrls.length} gorselin tamami Trendyol taslaginda korunuyor...`);
      const draft = await createAiDraftAndNotify({
        chatId,
        fileIds: album.fileIds,
        imageUrls: album.imageUrls,
        notes: album.notes,
        category: album.category,
        productName: album.productName,
        price: album.price,
        updateId: album.updateId,
        userId: album.userId,
      });
      return Response.json({ draftId: draft.id, mode: "ai-album-approval", ok: true });
    } catch (error) {
      await sendTelegramMessage(chatId, `AI urun albumu hazirlanamadi: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
      return Response.json({ ok: true });
    }
  }

  if (simpleProduct !== null) {
    if (!databaseEnabled) {
      await sendTelegramMessage(chatId, "AI urun onay akisi icin veritabani baglantisi gerekli.");
      return Response.json({ ok: true });
    }
    await sendTelegramMessage(chatId, "🤖 Yazdiginiz urun adi SEO icin optimize ediliyor; aciklama hazirlaniyor...");
    try {
      const storedImage = await storeTelegramPhoto(photo.file_id, updateId);
      if (!storedImage.imageUrl) throw new Error(storedImage.warning || "Kalici urun gorseli olusturulamadi.");
      const draft = await createAiDraftAndNotify({
        chatId,
        fileIds: [photo.file_id],
        imageUrls: [storedImage.imageUrl],
        notes: simpleProduct.notes,
        category: effectiveCategory,
        productName: simpleProduct.productName,
        price: simpleProduct.price,
        updateId,
        userId,
      });
      return Response.json({ draftId: draft.id, mode: "ai-approval", ok: true });
    } catch (error) {
      await sendTelegramMessage(chatId, `AI urun taslagi hazirlanamadi: ${error instanceof Error ? error.message : "Bilinmeyen hata"}`);
      return Response.json({ ok: true });
    }
  }

  const parsedCaption = parseProductCaption(message.caption);

  if (parsedCaption.issues.length > 0) {
    await sendTelegramMessage(
      chatId,
      `Taslak alınamadı:\n- ${parsedCaption.issues.join("\n- ")}\n\n${telegramCaptionTemplate}`,
    );
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
