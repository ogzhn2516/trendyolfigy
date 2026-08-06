import { NextResponse } from "next/server";

import { getBuyboxAlertChatIds } from "@/lib/telegram";
import { sendManualBuyboxReport } from "@/lib/trendyol-commerce-intelligence";
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
    const reports = await Promise.all(
      chatIds.map((chatId) => sendManualBuyboxReport(chatId)),
    );
    const report = reports[0];
    const healthy = reports.every((item) => item.errors.length === 0);

    return NextResponse.json({
      buyboxLost: report?.lost ?? 0,
      errors: reports.flatMap((item) => item.errors),
      ok: healthy,
      recipients: chatIds.length,
      trackedProducts: report?.tracked ?? 0,
    }, { status: healthy ? 200 : 503 });
  } catch (error) {
    console.error("BuyBox end-to-end test failed.", error);
    return NextResponse.json(
      { error: getTrendyolErrorSummary(error), ok: false },
      { status: 500 },
    );
  }
}
