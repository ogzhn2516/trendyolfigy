import { NextResponse } from "next/server";

import { runRepricerUpdate } from "@/lib/trendyol-commerce-intelligence";

export const dynamic = "force-dynamic";

function getExpectedSecret() {
  return (
    process.env.TRENDYOL_REPRICER_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.TRENDYOL_AUTO_ACCEPT_SECRET?.trim()
  );
}

function isAuthorized(request: Request, expected: string) {
  const url = new URL(request.url);
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const querySecret = url.searchParams.get("secret");

  return bearer === expected || querySecret === expected;
}

export async function GET(request: Request) {
  const expected = getExpectedSecret();

  if (!expected) {
    return NextResponse.json(
      { error: "TRENDYOL_REPRICER_SECRET or CRON_SECRET is required." },
      { status: 503 },
    );
  }

  if (!isAuthorized(request, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runRepricerUpdate();

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  return GET(request);
}
