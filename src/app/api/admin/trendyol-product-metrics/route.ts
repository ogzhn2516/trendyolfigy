import { isAdminAuthenticated } from "@/lib/auth";
import { getTrendyolProductMetrics } from "@/lib/trendyol-product-metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return Response.json(await getTrendyolProductMetrics());
}
