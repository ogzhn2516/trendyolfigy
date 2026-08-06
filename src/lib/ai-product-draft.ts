import "server-only";

import type { TrendyolAttributeInput } from "@/lib/caption";
import { getCategoryAttributes, getCategoryTree } from "@/lib/trendyol";

type ApiRecord = Record<string, unknown>;
type CategoryCandidate = { id: number; name: string; path: string };

function record(value: unknown): ApiRecord {
  return value && typeof value === "object" ? value as ApiRecord : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseJson(value: string) {
  return JSON.parse(value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()) as ApiRecord;
}

async function gemini(parts: ApiRecord[]) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY gerekli.");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.15 } }),
    cache: "no-store",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as ApiRecord | null;
  if (!response.ok || !body) throw new Error(response.status === 429 ? "Gemini ucretsiz limiti doldu; daha sonra tekrar deneyin." : text(record(body?.error).message) || `Gemini ${response.status} hatasi.`);
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const outputParts = record(record(candidates[0]).content).parts;
  const first = Array.isArray(outputParts) ? record(outputParts[0]) : {};
  const output = text(first.text);
  if (!output) throw new Error("Gemini bos yanit verdi.");
  return parseJson(output);
}

function flattenCategories(value: unknown, parents: string[] = []): CategoryCandidate[] {
  const nodes = Array.isArray(value) ? value : Array.isArray(record(value).categories) ? record(value).categories as unknown[] : [value];
  return nodes.flatMap((raw) => {
    const node = record(raw);
    const id = Number(node.id);
    const name = text(node.name);
    const children = Array.isArray(node.subCategories) ? node.subCategories : [];
    const path = [...parents, name].filter(Boolean);
    if (children.length) return flattenCategories(children, path);
    return Number.isFinite(id) && name ? [{ id, name, path: path.join(" > ") }] : [];
  });
}

function categoryAttributes(value: unknown) {
  const body = record(value);
  const items = Array.isArray(body.categoryAttributes)
    ? body.categoryAttributes
    : Array.isArray(body.content) ? body.content : [];
  return items.map(record);
}

export async function analyzeNewProductImage(imageUrl: string) {
  const imageResponse = await fetch(imageUrl, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!imageResponse.ok) throw new Error("Urun gorseli analiz icin alinamadi.");
  const imageData = Buffer.from(await imageResponse.arrayBuffer()).toString("base64");
  const imagePart = { inlineData: { data: imageData, mimeType: imageResponse.headers.get("content-type") || "image/jpeg" } };
  const vision = await gemini([
    { text: "Gorseldeki urunu analiz et. Turkce JSON dondur: title (Trendyol Akademi kurallarina uygun 9-13 kelime, en fazla 100 karakter), description (HTML etiketi olmadan 2-4 kisa paragraf ve dogal SEO), searchTerms (Trendyol kategori aramasi icin 3 kisa genel kategori terimi), vatRate (0,1,10 veya 20), dimensionalWeight (pozitif sayi). Marka, barkod, stok, emoji, abarti veya gorselde olmayan ozellik yazma." },
    imagePart,
  ]);
  const searchTerms = Array.isArray(vision.searchTerms) ? vision.searchTerms.map(text).filter(Boolean).slice(0, 3) : [];
  const title = text(vision.title).replace(/\s+/g, " ");
  const description = text(vision.description);
  const wordCount = title.split(" ").filter(Boolean).length;
  if (!title || title.length > 100 || wordCount < 9 || wordCount > 13 || description.length < 120 || !searchTerms.length) {
    throw new Error("AI baslik veya aciklamayi kalite kurallarina uygun olusturamadi; fotografi daha net cekip tekrar deneyin.");
  }

  const categoryResponses = await Promise.all(searchTerms.map((term) => getCategoryTree(term)));
  const candidates = categoryResponses.flatMap((response) => flattenCategories(response));
  const unique = [...new Map(candidates.map((item) => [item.id, item])).values()].slice(0, 150);
  if (!unique.length) throw new Error("Uygun Trendyol alt kategorisi bulunamadi.");
  const choice = await gemini([
    { text: `Urun: ${text(vision.title)}\nGorsel analizine gore asagidaki Trendyol yaprak kategorilerinden tam birini sec. Yalnizca JSON dondur: {\"categoryId\":123}. Adaylar:\n${unique.map((item) => `${item.id}: ${item.path}`).join("\n")}` },
  ]);
  const categoryId = Number(choice.categoryId);
  const category = unique.find((item) => item.id === categoryId);
  if (!category) throw new Error("AI gecerli Trendyol kategorisi secemedi.");

  const attributesResponse = await getCategoryAttributes(category.id);
  const required = categoryAttributes(attributesResponse).filter((item) => item.required === true);
  let attributes: TrendyolAttributeInput[] = [];
  if (required.length) {
    const compact = required.map((item) => ({
      attributeId: Number(record(item.attribute).id || item.attributeId),
      name: text(record(item.attribute).name) || text(item.attributeName),
      allowCustom: item.allowCustom === true,
      values: (Array.isArray(item.attributeValues) ? item.attributeValues : []).slice(0, 100).map((raw) => ({ id: Number(record(raw).id || record(raw).attributeValueId), name: text(record(raw).name) || text(record(raw).attributeValue) })),
    }));
    const selected = await gemini([
      { text: `Urun gorseli ve basliga gore zorunlu Trendyol ozelliklerini sec. Yalnizca JSON dondur: {\"attributes\":[{\"attributeId\":1,\"attributeValueId\":2}]} Her zorunlu attribute icin verilen degerlerden birini sec; uydurma ID kullanma. Urun: ${text(vision.title)}\n${JSON.stringify(compact)}` },
    ]);
    const selections = Array.isArray(selected.attributes) ? selected.attributes.map(record) : [];
    attributes = selections.map((item) => ({ attributeId: Number(item.attributeId), attributeValueId: Number(item.attributeValueId) })).filter((item) => Number.isFinite(item.attributeId) && Number.isFinite(item.attributeValueId));
    const selectedIds = new Set(attributes.map((item) => item.attributeId));
    const missing = compact.filter((item) => !selectedIds.has(item.attributeId)).map((item) => item.name).filter(Boolean);
    if (missing.length) throw new Error(`Fotograftan belirlenemeyen zorunlu bilgiler: ${missing.join(", ")}. Bu bilgileri fotograf aciklamasina ekleyip yeniden gonderin.`);
  }

  return {
    attributes,
    categoryId: category.id,
    categoryName: category.path,
    description: description.slice(0, 30000),
    dimensionalWeight: Math.max(1, Number(vision.dimensionalWeight) || 1),
    title,
    vatRate: [0, 1, 10, 20].includes(Number(vision.vatRate)) ? Number(vision.vatRate) : 20,
  };
}
