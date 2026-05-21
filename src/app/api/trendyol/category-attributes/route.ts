import { isAdminAuthenticated } from "@/lib/auth";
import { getCategoryAttributes } from "@/lib/trendyol";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return Response.json({ error: "Yetkisiz istek." }, { status: 401 });
  }

  const categoryId = Number(new URL(request.url).searchParams.get("categoryId"));

  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return Response.json({ error: "Geçerli kategori ID gerekli." }, { status: 400 });
  }

  try {
    return Response.json(await getCategoryAttributes(categoryId));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Kategori özellikleri alınamadı.",
      },
      { status: 502 },
    );
  }
}
