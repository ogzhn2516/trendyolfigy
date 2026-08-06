import "server-only";

import { put } from "@vercel/blob";

import { getOptionalBlobToken, getTelegramConfig } from "@/lib/env";

export type TelegramMessage = {
  caption?: string;
  chat: { id: number | string };
  from?: { id: number | string };
  photo?: Array<{ file_id: string; file_unique_id: string }>;
  reply_to_message?: TelegramMessage;
  text?: string;
};

export type TelegramUpdate = {
  callback_query?: {
    data?: string;
    from: { id: number | string };
    id: string;
    message?: TelegramMessage;
  };
  message?: TelegramMessage;
  update_id: number;
};

type TelegramFileResponse = {
  ok: boolean;
  result?: {
    file_path?: string;
  };
};

type TelegramSendMessageResponse = {
  description?: string;
  ok: boolean;
  result?: {
    message_id?: number;
  };
};

function getTelegramApiUrl(method: string) {
  return `https://api.telegram.org/bot${getTelegramConfig().TELEGRAM_BOT_TOKEN}/${method}`;
}

export function getAllowedTelegramUserIds() {
  return new Set(
    getTelegramConfig()
      .TELEGRAM_ALLOWED_USER_IDS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function getBuyboxAlertChatIds() {
  const configured = process.env.TELEGRAM_BUYBOX_ALERT_CHAT_IDS?.trim();
  const rawValue = configured || getTelegramConfig().TELEGRAM_ALLOWED_USER_IDS;

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options: {
    forceReply?: boolean;
    inlineKeyboard?: Array<Array<{ callbackData: string; text: string }>>;
  } = {},
) {
  const response = await fetch(getTelegramApiUrl("sendMessage"), {
    body: JSON.stringify({
      chat_id: chatId,
      disable_web_page_preview: true,
      ...(options.inlineKeyboard?.length
        ? {
            reply_markup: {
              inline_keyboard: options.inlineKeyboard.map((row) =>
                row.map((button) => ({
                  callback_data: button.callbackData,
                  text: button.text,
                })),
              ),
            },
          }
        : options.forceReply
        ? {
            reply_markup: {
              force_reply: true,
              input_field_placeholder: "Yeni satis fiyatini yazin",
              selective: true,
            },
          }
        : {}),
      text,
    }),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => ({
    ok: false,
  }))) as TelegramSendMessageResponse;

  if (!response.ok || !body.ok) {
    throw new Error(
      `Telegram mesaji gonderilemedi${body.description ? `: ${body.description}` : ` (${response.status})`}.`,
    );
  }

  return {
    messageId: body.result?.message_id ?? null,
  };
}

export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  text: string,
) {
  const response = await fetch(getTelegramApiUrl("answerCallbackQuery"), {
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      show_alert: false,
      text: text.slice(0, 200),
    }),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = (await response.json().catch(() => ({ ok: false }))) as {
    description?: string;
    ok: boolean;
  };

  if (!response.ok || !body.ok) {
    throw new Error(
      `Telegram buton cevabi gonderilemedi${body.description ? `: ${body.description}` : ""}.`,
    );
  }
}

async function getTelegramFileUrl(fileId: string) {
  const response = await fetch(getTelegramApiUrl("getFile"), {
    body: JSON.stringify({ file_id: fileId }),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = (await response.json()) as TelegramFileResponse;
  const filePath = body.result?.file_path;

  if (!response.ok || !body.ok || !filePath) {
    throw new Error("Telegram görsel dosya yolu alınamadı.");
  }

  return `https://api.telegram.org/file/bot${getTelegramConfig().TELEGRAM_BOT_TOKEN}/${filePath}`;
}

function getExtension(contentType: string | null) {
  if (contentType === "image/png") {
    return "png";
  }

  if (contentType === "image/webp") {
    return "webp";
  }

  return "jpg";
}

export async function storeTelegramPhoto(fileId: string, draftId: string) {
  const telegramFileUrl = await getTelegramFileUrl(fileId);
  const blobToken = getOptionalBlobToken();

  if (!blobToken) {
    return {
      imageUrl: null,
      warning:
        "BLOB_READ_WRITE_TOKEN tanımlı olmadığı için görsel kalıcı depoya yüklenmedi.",
    };
  }

  const imageResponse = await fetch(telegramFileUrl, { cache: "no-store" });

  if (!imageResponse.ok || !imageResponse.body) {
    throw new Error("Telegram görseli indirilemedi.");
  }

  const contentType = imageResponse.headers.get("content-type") ?? "image/jpeg";
  const blob = await put(
    `telegram-products/${draftId}.${getExtension(contentType)}`,
    imageResponse.body,
    {
      access: "public",
      addRandomSuffix: true,
      contentType,
      token: blobToken,
    },
  );

  return { imageUrl: blob.url, warning: null };
}
