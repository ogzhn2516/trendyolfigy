import { parseProductCaption, telegramCaptionTemplate } from "@/lib/caption";
import type { ProductDraft } from "@/lib/db";
import { findDraftByTelegramUpdateId, insertDraft } from "@/lib/db";
import { hasDatabaseUrl } from "@/lib/env";
import {
  submitDirectProductToTrendyol,
  submitDraftToTrendyol,
} from "@/lib/products";
import {
  getAllowedTelegramUserIds,
  sendTelegramMessage,
  storeTelegramPhoto,
  type TelegramUpdate,
} from "@/lib/telegram";

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
