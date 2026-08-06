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

function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || /timeout|aborted/i.test(error.message));
}

async function gemini(parts: ApiRecord[], timeoutMs = 10_000, stage = "AI islemi") {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY gerekli.");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.15 } }),
      cache: "no-store",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) throw new Error(`${stage} zaman asimina ugradi. Gemini yogun olabilir; albumu tekrar gondererek yeniden deneyin.`);
    throw error;
  }
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
  const wrapper = record(value);
  const nodes = Array.isArray(value)
    ? value
    : Array.isArray(wrapper.categories)
      ? wrapper.categories as unknown[]
      : wrapper.category
        ? [wrapper.category]
        : [value];
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

function normalizedWords(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9çğıöşü]+/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function rankCategories(candidates: CategoryCandidate[], query: string) {
  const queryWords = new Set(normalizedWords(query));
  return candidates
    .map((candidate) => {
      const pathWords = normalizedWords(candidate.path);
      const matches = pathWords.filter((word) => queryWords.has(word)).length;
      const exactBonus = [...queryWords].some((word) => candidate.name.toLocaleLowerCase("tr-TR").includes(word)) ? 3 : 0;
      return { candidate, score: matches * 2 + exactBonus };
    })
    .sort((a, b) => b.score - a.score || a.candidate.path.length - b.candidate.path.length)
    .map((item) => item.candidate);
}

function categoryAttributes(value: unknown) {
  const body = record(value);
  const items = Array.isArray(body.categoryAttributes)
    ? body.categoryAttributes
    : Array.isArray(body.content) ? body.content : [];
  return items.map(record);
}

export async function analyzeNewProductImage(imageInput: string | string[], userNotes = "") {
  // Albümün yalnızca ana (ilk) görseli AI'a gönderilir. Diğer görseller
  // taslakta korunur ve onaydan sonra Trendyol'a yüklenir.
  const imageUrls = (Array.isArray(imageInput) ? imageInput : [imageInput]).slice(0, 1);
  let imageResponses: Response[];
  try {
    imageResponses = await Promise.all(imageUrls.map((imageUrl) => fetch(imageUrl, { cache: "no-store", signal: AbortSignal.timeout(8_000) })));
  } catch (error) {
    if (isTimeoutError(error)) throw new Error("Urun gorselleri zamaninda indirilemedi; albumu tekrar gonderin.");
    throw error;
  }
  if (!imageResponses.length || imageResponses.some((response) => !response.ok)) throw new Error("Urun gorselleri analiz icin alinamadi.");
  const imageParts = await Promise.all(imageResponses.map(async (response) => ({
    inlineData: {
      data: Buffer.from(await response.arrayBuffer()).toString("base64"),
      mimeType: response.headers.get("content-type") || "image/jpeg",
    },
  })));
  const vision = await gemini([
    { text: `Gorseldeki urunu analiz et. Turkce JSON dondur: title (Trendyol Akademi kurallarina uygun 9-13 kelime, en fazla 100 karakter), description (HTML etiketi olmadan 2-4 kisa paragraf ve dogal SEO), searchTerms (Trendyol kategori aramasi icin 3 kisa genel kategori terimi), vatRate (0,1,10 veya 20), dimensionalWeight (pozitif sayi). Marka, barkod, stok, emoji, abarti veya gorselde olmayan ozellik yazma. Saticinin ek notlari varsa dogru urun ozellikleri olarak kullan: ${userNotes.slice(0, 1000) || "yok"}` },
    ...imageParts,
  ], 32_000, "Coklu gorsel analizi");
  const searchTerms = Array.isArray(vision.searchTerms) ? vision.searchTerms.map(text).filter(Boolean).slice(0, 3) : [];
  const title = text(vision.title).replace(/\s+/g, " ");
  const description = text(vision.description);
  const wordCount = title.split(" ").filter(Boolean).length;
  if (!title || title.length > 100 || wordCount < 9 || wordCount > 13 || description.length < 120 || !searchTerms.length) {
    throw new Error("AI baslik veya aciklamayi kalite kurallarina uygun olusturamadi; fotografi daha net cekip tekrar deneyin.");
  }

  const categoryResponses = await Promise.all(searchTerms.map((term) => getCategoryTree(term)));
  let candidates = categoryResponses.flatMap((response) => flattenCategories(response));
  if (!candidates.length) {
    candidates = flattenCategories(await getCategoryTree());
  }
  const deduplicated = [...new Map(candidates.map((item) => [item.id, item])).values()];
  const unique = rankCategories(deduplicated, `${title} ${searchTerms.join(" ")}`).slice(0, 150);
  if (!unique.length) throw new Error("Uygun Trendyol alt kategorisi bulunamadi.");
  const choice = await gemini([
    { text: `Urun: ${text(vision.title)}\nGorsel analizine gore asagidaki Trendyol yaprak kategorilerinden tam birini sec. Yalnizca JSON dondur: {\"categoryId\":123}. Adaylar:\n${unique.map((item) => `${item.id}: ${item.path}`).join("\n")}` },
  ], 8_000, "Kategori secimi");
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
    ], 8_000, "Kategori ozellik secimi");
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
