import { runAutoAcceptOrders } from "@/lib/trendyol-dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: Request) {
  const secret =
    process.env.CRON_SECRET?.trim() ||
    process.env.TRENDYOL_AUTO_ACCEPT_SECRET?.trim();

  if (!secret) {
    return true;
  }

  const url = new URL(request.url);

  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    url.searchParams.get("secret") === secret
  );
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runAutoAcceptOrders();

  return Response.json({ ok: true, result });
}

export async function POST(request: Request) {
  return GET(request);
}
