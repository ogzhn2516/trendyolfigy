import "server-only";

import type { TrendyolAttributeInput } from "@/lib/caption";
import { getCategoryAttributes, getCategoryAttributeValues, getCategoryTree } from "@/lib/trendyol";

type ApiRecord = Record<string, unknown>;
type CategoryCandidate = { id: number; name: string; path: string };
let fullCategoryTreePromise: Promise<CategoryCandidate[]> | null = null;
const manufacturingProfile = "PLA plastik, 3D yazici ile 3D baski, yerli uretim, mensei Turkiye, tek parca";

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
  const configuredFallbacks = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash-lite,gemini-3.5-flash,gemini-3.1-flash-lite").split(",").map((item) => item.trim()).filter(Boolean);
  const models = [...new Set([process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash", ...configuredFallbacks])];
  let quotaOnly = true;
  let lastMessage = "Gemini gecici olarak kullanilamiyor.";

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json" } }),
          cache: "no-store",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isTimeoutError(error)) throw new Error(`${stage} zaman asimina ugradi. Albumu tekrar gondererek yeniden deneyin.`);
        throw error;
      }
      const body = await response.json().catch(() => null) as ApiRecord | null;
      if (response.ok && body) {
        const candidates = Array.isArray(body.candidates) ? body.candidates : [];
        const outputParts = record(record(candidates[0]).content).parts;
        const first = Array.isArray(outputParts) ? record(outputParts[0]) : {};
        const output = text(first.text);
        if (!output) throw new Error("Gemini bos yanit verdi.");
        return parseJson(output);
      }
      const message = text(record(body?.error).message) || `Gemini ${response.status} hatasi.`;
      lastMessage = message;
      quotaOnly = quotaOnly && response.status === 429;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable && response.status !== 404) throw new Error(message);
      if (attempt === 0 && retryable) {
        await new Promise((resolve) => setTimeout(resolve, 500 + Math.floor(Math.random() * 350)));
      }
    }
  }
  if (quotaOnly) throw new Error("Tum Gemini ucretsiz model limitleri doldu; limit yenilendiginde albumu tekrar gonderin.");
  throw new Error(`Gemini modelleri gecici olarak yogun: ${lastMessage}`);
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

function normalizedValue(value: string) {
  return value.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim();
}

function categorySimilarity(category: CategoryCandidate, requested: string) {
  const query = normalizedValue(requested);
  const name = normalizedValue(category.name);
  const path = normalizedValue(category.path);
  if (name === query) return 100;
  if (path === query) return 110;
  const queryWords = query.split(/\s+/).filter(Boolean);
  const nameWords = name.split(/\s+/).filter(Boolean);
  const matched = queryWords.filter((queryWord) => nameWords.some((nameWord) => {
    if (nameWord === queryWord || (Math.min(nameWord.length, queryWord.length) >= 4 && (nameWord.startsWith(queryWord) || queryWord.startsWith(nameWord)))) return true;
    let commonPrefix = 0;
    while (commonPrefix < Math.min(nameWord.length, queryWord.length) && nameWord[commonPrefix] === queryWord[commonPrefix]) commonPrefix += 1;
    return commonPrefix >= 4 && commonPrefix / Math.min(nameWord.length, queryWord.length) >= 0.7;
  })).length;
  const coverage = queryWords.length ? matched / queryWords.length : 0;
  const precision = nameWords.length ? matched / nameWords.length : 0;
  return coverage * 70 + precision * 25 + (path.includes(query) ? 5 : 0);
}

async function allTrendyolCategories() {
  if (!fullCategoryTreePromise) {
    fullCategoryTreePromise = getCategoryTree().then(flattenCategories).catch((error) => {
      fullCategoryTreePromise = null;
      throw error;
    });
  }
  return fullCategoryTreePromise;
}

async function resolvePreferredCategory(categoryInput: string) {
  const searched = flattenCategories(await getCategoryTree(categoryInput));
  const categories = [...new Map([...(searched || []), ...await allTrendyolCategories()].map((item) => [item.id, item])).values()];
  const requested = normalizedValue(categoryInput);
  const requestedId = Number(categoryInput.trim());
  const byId = Number.isFinite(requestedId) ? categories.find((item) => item.id === requestedId) : null;
  if (byId) return byId;
  const exact = categories.filter((item) => normalizedValue(item.name) === requested || normalizedValue(item.path) === requested);
  if (exact.length) return exact.sort((a, b) => a.path.length - b.path.length)[0];
  const ranked = categories.map((item) => ({ item, score: categorySimilarity(item, categoryInput) })).sort((a, b) => b.score - a.score || a.item.path.length - b.item.path.length);
  if (ranked[0]?.score >= 60) return ranked[0].item;
  const suggestions = ranked.slice(0, 5).map(({ item }) => item.path);
  throw new Error(`Kategori bulunamadi: ${categoryInput}.${suggestions.length ? ` En yakin kategoriler: ${suggestions.join(" | ")}` : ""}`);
}

function bestAttributeValue(values: Array<{ id: number; name: string }>, hint: string) {
  const wanted = normalizedValue(hint);
  if (!wanted) return null;
  const wantedWords = wanted.split(/\s+/).filter(Boolean);
  const ranked = values.map((value) => {
    const candidate = normalizedValue(value.name);
    const overlap = wantedWords.filter((word) => candidate.includes(word)).length;
    const score = candidate === wanted ? 20 : candidate.includes(wanted) || wanted.includes(candidate) ? 10 : overlap;
    return { score, value };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].value : null;
}

function propertyHint(attributeName: string, properties: ApiRecord, fallback: string) {
  const name = normalizedValue(attributeName);
  if (name.includes("parca")) return text(properties.pieceCount) || "1";
  if (name.includes("web color")) {
    const color = text(properties.webColor) || text(properties.color);
    return /\bve\b|,|\//i.test(color) ? `${color} Cok Renkli` : color || "Cok Renkli";
  }
  if (name.includes("renk")) return text(properties.color) || "Cok Renkli";
  if (name.includes("mensei")) return text(properties.origin) || "Turkiye";
  if (name.includes("hammadde")) return "PLA Plastik";
  if (name.includes("uretim yeri") || name.includes("uretim ulkesi")) return "Turkiye Yerli";
  if (name.includes("uretim") || name.includes("teknik")) return "3D Baski 3D Yazici Yerli Uretim";
  if (name === "beden" || name.includes("beden ")) return text(properties.size) || "Tek Ebat Standart";
  if (name.includes("kumas tipi")) return text(properties.fabricType) || text(properties.material) || "Diger Dokuma";
  if (name.includes("cinsiyet")) return text(properties.gender) || "Unisex";
  if (name.includes("kalip")) return text(properties.fit) || "Standart Regular";
  if (name.includes("yas grubu")) return text(properties.ageGroup) || "Yetiskin";
  if (name === "boy") return text(properties.height) || "Standart";
  if (name.includes("boyut") || name.includes("ebat") || name.includes("olcu")) return text(properties.size) || "Standart Tek Ebat";
  if (name.includes("materyal") || name.includes("malzeme")) {
    const material = text(properties.material);
    return /pla|petg|abs/i.test(material) ? `${material} Plastik` : material ? `${material} PLA Plastik` : "PLA Plastik";
  }
  return fallback;
}

function standardAttributeValue(values: Array<{ id: number; name: string }>, primaryHint: string) {
  const standards = [
    primaryHint,
    manufacturingProfile,
    "PLA Plastik",
    "3D Baski 3D Yazici",
    "Turkiye Yerli Uretim",
    "1 Tek Parca",
    "Cok Renkli",
    "Standart",
    "Tek Ebat",
    "Unisex",
    "Yetiskin",
    "Diger",
    "Yok",
  ];
  for (const standard of standards) {
    const matched = bestAttributeValue(values, standard);
    if (matched) return matched;
  }
  return values[0] ?? null;
}

function categoryAttributes(value: unknown) {
  const body = record(value);
  const items = Array.isArray(body.categoryAttributes)
    ? body.categoryAttributes
    : Array.isArray(body.content) ? body.content : [];
  return items.map(record);
}

function attributeValues(value: unknown) {
  const content = record(value).content;
  return (Array.isArray(content) ? content : []).map((raw) => ({
    id: Number(record(raw).attributeValueId),
    name: text(record(raw).attributeValue),
  })).filter((item) => Number.isFinite(item.id) && item.name);
}

export async function analyzeNewProductImage(imageInput: string | string[], userNotes = "", preferredCategory = "", sourceProductName = "") {
  // Albümün yalnızca ana (ilk) görseli AI'a gönderilir. Diğer görseller
  // taslakta korunur ve onaydan sonra Trendyol'a yüklenir.
  const imageUrls = (Array.isArray(imageInput) ? imageInput : [imageInput]).slice(0, 1);
  let imageParts: ApiRecord[] = [];
  if (!sourceProductName.trim()) {
    let imageResponses: Response[];
    try {
      imageResponses = await Promise.all(imageUrls.map((imageUrl) => fetch(imageUrl, { cache: "no-store", signal: AbortSignal.timeout(8_000) })));
    } catch (error) {
      if (isTimeoutError(error)) throw new Error("Urun gorselleri zamaninda indirilemedi; albumu tekrar gonderin.");
      throw error;
    }
    if (!imageResponses.length || imageResponses.some((response) => !response.ok)) throw new Error("Urun gorselleri analiz icin alinamadi.");
    imageParts = await Promise.all(imageResponses.map(async (response) => ({
      inlineData: {
        data: Buffer.from(await response.arrayBuffer()).toString("base64"),
        mimeType: response.headers.get("content-type") || "image/jpeg",
      },
    })));
  }
  const vision = await gemini([
    { text: `${sourceProductName.trim() ? `Saticinin verdigi urun adini tek dogru kaynak kabul et: "${sourceProductName.slice(0, 300)}". Urun turunu degistirme ve gorselden urun kimligi tahmin etme.` : "Gorseldeki urunu analiz et."} Tum urunler icin dogru uretim profili: ${manufacturingProfile}. Turkce JSON dondur: title (mevcut urun adini koruyarak Trendyol SEO uyumlu 9-13 kelime, en fazla 100 karakter), description (kaynak urun adi ve uretim profiline dayanan, HTML etiketi olmadan 2-4 kisa paragraf ve dogal SEO), searchTerms (3 kisa kategori terimi), vatRate (0,1,10 veya 20), dimensionalWeight (pozitif sayi), properties ({"pieceCount":"1","color":"...","webColor":"...","size":"...","material":"PLA Plastik","fabricType":"...","gender":"Unisex","fit":"Standart","ageGroup":"Yetiskin","height":"Standart","origin":"Turkiye"}). Marka, barkod, stok, emoji veya abarti yazma. Satici notlari: ${userNotes.slice(0, 1000) || "yok"}` },
    ...imageParts,
  ], 32_000, "Coklu gorsel analizi");
  const searchTerms = Array.isArray(vision.searchTerms) ? vision.searchTerms.map(text).filter(Boolean).slice(0, 3) : [];
  const title = text(vision.title).replace(/\s+/g, " ");
  const description = text(vision.description);
  const wordCount = title.split(" ").filter(Boolean).length;
  if (!title || title.length > 100 || wordCount < 9 || wordCount > 13 || description.length < 120 || !searchTerms.length) {
    throw new Error("AI baslik veya aciklamayi kalite kurallarina uygun olusturamadi; fotografi daha net cekip tekrar deneyin.");
  }

  let category: CategoryCandidate | undefined;
  if (preferredCategory.trim()) {
    category = await resolvePreferredCategory(preferredCategory);
  } else {
    const categoryResponses = await Promise.all(searchTerms.map((term) => getCategoryTree(term)));
    let candidates = categoryResponses.flatMap((response) => flattenCategories(response));
    if (!candidates.length) candidates = await allTrendyolCategories();
    const deduplicated = [...new Map(candidates.map((item) => [item.id, item])).values()];
    const unique = rankCategories(deduplicated, `${title} ${searchTerms.join(" ")}`).slice(0, 150);
    if (!unique.length) throw new Error("Uygun Trendyol alt kategorisi bulunamadi.");
    const choice = await gemini([
      { text: `Urun: ${title}\nGorsel analizine gore asagidaki Trendyol yaprak kategorilerinden tam birini sec. Yalnizca JSON dondur: {\"categoryId\":123}. Adaylar:\n${unique.map((item) => `${item.id}: ${item.path}`).join("\n")}` },
    ], 8_000, "Kategori secimi");
    category = unique.find((item) => item.id === Number(choice.categoryId));
  }
  if (!category) throw new Error("Gecerli Trendyol alt kategorisi secilemedi.");

  const attributesResponse = await getCategoryAttributes(category.id);
  const required = categoryAttributes(attributesResponse).filter((item) => item.required === true && !normalizedValue(text(record(item.attribute).name)).includes("mensei"));
  let attributes: TrendyolAttributeInput[] = [];
  if (required.length) {
    const compact = await Promise.all(required.map(async (item) => {
      const attributeId = Number(record(item.attribute).id || item.attributeId);
      const allowCustom = item.allowCustom === true;
      return {
        attributeId,
        name: text(record(item.attribute).name) || text(item.attributeName),
        allowCustom,
        values: allowCustom ? [] : attributeValues(await getCategoryAttributeValues(category.id, attributeId)),
      };
    }));
    attributes = [];
    for (const pieceAttribute of compact.filter((item) => normalizedValue(item.name).includes("parca sayisi"))) {
      attributes = attributes.filter((item) => item.attributeId !== pieceAttribute.attributeId);
      const singlePiece = bestAttributeValue(pieceAttribute.values, "1 Tek Parca");
      if (singlePiece) attributes.push({ attributeId: pieceAttribute.attributeId, attributeValueId: singlePiece.id });
    }
    const properties = record(vision.properties);
    const alreadySelected = new Set(attributes.map((item) => item.attributeId));
    for (const item of compact.filter((entry) => !alreadySelected.has(entry.attributeId))) {
      const hint = propertyHint(item.name, properties, `${userNotes} ${title} ${description}`);
      const matched = standardAttributeValue(item.values, hint);
      if (matched) {
        attributes.push({ attributeId: item.attributeId, attributeValueId: matched.id });
      } else if (item.allowCustom) {
        attributes.push({ attributeId: item.attributeId, customAttributeValue: (hint.trim() || manufacturingProfile).slice(0, 100) });
      }
    }
    const selectedIds = new Set(attributes.map((item) => item.attributeId));
    const missing = compact.filter((item) => !selectedIds.has(item.attributeId)).map((item) => item.name).filter(Boolean);
    if (missing.length) throw new Error(`Trendyol deger listesi bos olan zorunlu alanlar: ${missing.join(", ")}. Kategori ayarlarinin kontrol edilmesi gerekiyor.`);
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
