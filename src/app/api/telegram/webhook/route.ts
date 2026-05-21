import { parseProductCaption, telegramCaptionTemplate } from "@/lib/caption";
import { findDraftByTelegramUpdateId, insertDraft } from "@/lib/db";
import { submitDraftToTrendyol } from "@/lib/products";
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

  const existing = await findDraftByTelegramUpdateId(String(update.update_id));

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
    String(update.update_id),
  );
  const draft = await insertDraft({
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
    telegramUpdateId: String(update.update_id),
    telegramUserId: userId,
    title: parsedCaption.title!,
    vatRate: parsedCaption.vatRate,
  });
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
