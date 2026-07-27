import { NextResponse } from "next/server";

import { getBuyboxAlertChatIds, sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const expected = process.env.BUYBOX_TEST_SECRET?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return Boolean(expected && received === expected);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chatIds = getBuyboxAlertChatIds();

  if (chatIds.length === 0) {
    return NextResponse.json(
      { error: "No BuyBox alert chat ID is configured." },
      { status: 503 },
    );
  }

  await Promise.all(
    chatIds.map((chatId) =>
      sendTelegramMessage(
        chatId,
        [
          "BuyBox test bildirimi",
          "Bu bir test mesajidir.",
          "BuyBox bildirim ve Telegram baglantisi hazir.",
        ].join("\n"),
      ),
    ),
  );

  return NextResponse.json({ ok: true, recipients: chatIds.length });
}
