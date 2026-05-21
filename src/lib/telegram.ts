import "server-only";

import { put } from "@vercel/blob";

import { getOptionalBlobToken, getTelegramConfig } from "@/lib/env";

export type TelegramMessage = {
  caption?: string;
  chat: { id: number | string };
  from?: { id: number | string };
  photo?: Array<{ file_id: string; file_unique_id: string }>;
  text?: string;
};

export type TelegramUpdate = {
  message?: TelegramMessage;
  update_id: number;
};

type TelegramFileResponse = {
  ok: boolean;
  result?: {
    file_path?: string;
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

export async function sendTelegramMessage(chatId: number | string, text: string) {
  await fetch(getTelegramApiUrl("sendMessage"), {
    body: JSON.stringify({
      chat_id: chatId,
      disable_web_page_preview: true,
      text,
    }),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
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
