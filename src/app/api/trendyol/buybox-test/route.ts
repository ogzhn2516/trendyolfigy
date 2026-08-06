import { NextResponse } from "next/server";

import { getBuyboxAlertChatIds, sendTelegramMessage } from "@/lib/telegram";
import { getCommerceDashboardData } from "@/lib/trendyol-commerce-intelligence";
import { getTrendyolErrorSummary } from "@/lib/trendyol";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  try {
    const dashboard = await getCommerceDashboardData();
    const healthy = dashboard.databaseBacked && dashboard.errors.length === 0;
    const message = [
      healthy ? "BuyBox sistem testi basarili" : "BuyBox sistem testi eksik bulundu",
      `Izlenen urun: ${dashboard.trackedProducts}`,
      `BuyBox kaybi: ${dashboard.buyboxLost}`,
      `Trendyol okuma hatasi: ${dashboard.errors.length}`,
      `Veritabani: ${dashboard.databaseBacked ? "hazir" : "eksik"}`,
    ].join("\n");

    await Promise.all(chatIds.map((chatId) => sendTelegramMessage(chatId, message)));

    return NextResponse.json({
      buyboxLost: dashboard.buyboxLost,
      databaseBacked: dashboard.databaseBacked,
      errors: dashboard.errors,
      ok: healthy,
      recipients: chatIds.length,
      trackedProducts: dashboard.trackedProducts,
    }, { status: healthy ? 200 : 503 });
  } catch (error) {
    console.error("BuyBox end-to-end test failed.", error);
    return NextResponse.json(
      { error: getTrendyolErrorSummary(error), ok: false },
      { status: 500 },
    );
  }
}
