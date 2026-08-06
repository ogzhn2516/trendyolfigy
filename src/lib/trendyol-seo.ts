import "server-only";

import { enqueueSeoAiUpdate, getSeoAiQueue, saveSeoAiQueue } from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { getAllOnSaleProducts } from "@/lib/trendyol-commerce-intelligence";
import { updateApprovedProductContent } from "@/lib/trendyol";

type ApiRecord = Record<string, unknown>;

export type SeoProduct = {
  attributes: string[];
  category: string;
  contentId: number;
  description: string;
  imageUrl: string | null;
  issues: string[];
  score: number;
  suggestedDescription: string;
  suggestedTitle: string;
  title: string;
};

type AiSeoContent = { description: string; provider: "Gemini" | "OpenRouter"; title: string };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): ApiRecord {
  return value && typeof value === "object" ? (value as ApiRecord) : {};
}

function plainHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeTitle(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateTitle(value: string) {
  if (value.length <= 100) return value;
  const shortened = value.slice(0, 100);
  return shortened.replace(/\s+\S*$/, "").trim();
}

function wordsOf(value: string) {
  return value.split(/\s+/).filter(Boolean);
}

function titleCase(value: string) {
  return wordsOf(value)
    .map((word) => {
      const lower = word.toLocaleLowerCase("tr-TR");
      return `${lower.charAt(0).toLocaleUpperCase("tr-TR")}${lower.slice(1)}`;
    })
    .join(" ");
}

function removeRepeatedWords(value: string) {
  const seen = new Set<string>();
  return wordsOf(value)
    .filter((word) => {
      const normalized = word.toLocaleLowerCase("tr-TR");
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .join(" ");
}

function categoryName(product: ApiRecord) {
  const category = record(product.category);
  return text(category.name) || text(product.categoryName);
}

function attributePairs(product: ApiRecord) {
  const attributes = Array.isArray(product.attributes) ? product.attributes : [];

  return attributes
    .map((item) => record(item))
    .map((item) => {
      const attribute = record(item.attribute);
      const attributeValue = record(item.attributeValue);
      const name = text(attribute.name) || text(item.attributeName);
      const value =
        text(attributeValue.name) ||
        text(item.customAttributeValue) ||
        text(item.attributeValue);
      return name && value ? { name, value } : null;
    })
    .filter((item): item is { name: string; value: string } => Boolean(item))
    .filter(
      (item, index, items) =>
        items.findIndex(
          (candidate) =>
            candidate.name.toLocaleLowerCase("tr-TR") === item.name.toLocaleLowerCase("tr-TR") &&
            candidate.value.toLocaleLowerCase("tr-TR") === item.value.toLocaleLowerCase("tr-TR"),
        ) === index,
    )
    .slice(0, 10);
}

function attributeLines(product: ApiRecord) {
  return attributePairs(product).map((item) => `${item.name}: ${item.value}`);
}

function firstImageUrl(product: ApiRecord) {
  const images = Array.isArray(product.images) ? product.images : [];
  return text(record(images[0]).url) || null;
}

const titleAttributePriority = [
  "materyal",
  "tema",
  "renk",
  "kullanim",
  "stil",
  "desen",
  "karakter",
];

function titleKeywords(product: ApiRecord) {
  return attributePairs(product)
    .filter((item) => !/(beden|boyut|ebat|ölçü|olcu|adet)/i.test(item.name))
    .filter((item) => !/^(yok|hayir|belirtilmemis|standart)$/i.test(item.value))
    .sort((a, b) => {
      const priority = (name: string) => {
        const normalized = name.toLocaleLowerCase("tr-TR");
        const index = titleAttributePriority.findIndex((key) => normalized.includes(key));
        return index === -1 ? 99 : index;
      };
      return priority(a.name) - priority(b.name);
    })
    .map((item) => item.value)
    .filter((value, index, values) =>
      values.findIndex((candidate) => candidate.toLocaleLowerCase("tr-TR") === value.toLocaleLowerCase("tr-TR")) === index,
    );
}

function suggestedTitle(product: ApiRecord, currentTitle: string) {
  let result = normalizeTitle(currentTitle);
  const category = categoryName(product);
  const brand = text(record(product.brand).name) || text(product.brandName);
  const barcode = text(product.barcode);
  const stockCode = text(product.stockCode);

  for (const forbidden of [brand, barcode, stockCode]) {
    if (!forbidden) continue;
    result = result.replace(new RegExp(`\\b${forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "giu"), " ");
  }
  result = removeRepeatedWords(normalizeTitle(result));

  const candidates = [category, ...titleKeywords(product)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalizedResult = result.toLocaleLowerCase("tr-TR");
    const normalizedCandidate = candidate.toLocaleLowerCase("tr-TR");
    if (normalizedResult.includes(normalizedCandidate)) continue;

    const next = removeRepeatedWords(`${result} ${normalizeTitle(candidate)}`);
    if (wordsOf(result).length < 13 && wordsOf(next).length <= 13 && next.length <= 100) result = next;
  }

  result = wordsOf(result).slice(0, 13).join(" ");
  return titleCase(truncateTitle(result));
}

function suggestedDescription(product: ApiRecord, title: string, current: string) {
  const currentPlain = plainHtml(current);
  const category = categoryName(product);
  const attributes = attributeLines(product);
  const intro = `${title}${category ? `, ${category} kategorisinde` : ""} kullanima sunulan bir urundur.`;
  const paragraphs = [intro];

  if (currentPlain && currentPlain.toLocaleLowerCase("tr-TR") !== title.toLocaleLowerCase("tr-TR")) {
    paragraphs.push(currentPlain.slice(0, 2500));
  }

  const html = paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  const list = attributes.length
    ? `<p><strong>Urun Ozellikleri</strong></p><ul>${attributes
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join("")}</ul>`
    : "";
  const closing = "<p>Urun olculeri, renk ve diger teknik detaylar icin urun ozelliklerini inceleyebilirsiniz.</p>";

  return `${html}${list}${closing}`.slice(0, 30000);
}

export function analyzeSeoProduct(product: ApiRecord): SeoProduct | null {
  const contentId = Number(product.contentId);
  const title = text(product.title);
  const description = text(product.description);

  if (!Number.isFinite(contentId) || contentId <= 0 || !title) return null;

  const plainDescription = plainHtml(description);
  const issues: string[] = [];
  let score = 100;
  const titleWordCount = wordsOf(normalizeTitle(title)).length;

  if (titleWordCount < 9) { score -= 20; issues.push("Baslik 9 kelimeden kisa"); }
  if (titleWordCount > 13) { score -= 15; issues.push("Baslik 13 kelimeden uzun"); }
  if (title.length > 100) { score -= 30; issues.push("Baslik 100 karakterden uzun"); }
  if (/[^\p{L}\p{N}\s]/u.test(title)) { score -= 10; issues.push("Baslikta gereksiz sembol veya noktalama var"); }
  if (wordsOf(normalizeTitle(title)).length !== new Set(wordsOf(normalizeTitle(title)).map((word) => word.toLocaleLowerCase("tr-TR"))).size) {
    score -= 10;
    issues.push("Baslikta tekrarlayan kelime var");
  }
  const category = categoryName(product);
  if (category && !title.toLocaleLowerCase("tr-TR").includes(category.toLocaleLowerCase("tr-TR"))) {
    score -= 15;
    issues.push("Baslikta kategori arama kelimesi eksik");
  }
  const keywords = titleKeywords(product);
  if (keywords.length && !keywords.some((keyword) => title.toLocaleLowerCase("tr-TR").includes(keyword.toLocaleLowerCase("tr-TR")))) {
    score -= 10;
    issues.push("Baslikta ayirt edici urun ozelligi eksik");
  }
  if (plainDescription.length < 120) { score -= 35; issues.push("Aciklama eksik veya cok kisa"); }
  else if (plainDescription.length < 250) { score -= 15; issues.push("Aciklama gelistirilebilir"); }
  if (!/<p|<ul|<li|<br/i.test(description)) { score -= 10; issues.push("Aciklama okunabilir HTML yapisinda degil"); }
  if (attributeLines(product).length < 2) { score -= 10; issues.push("Urun ozellikleri yetersiz"); }

  const cleanTitle = suggestedTitle(product, title);
  return {
    attributes: attributeLines(product),
    category: categoryName(product),
    contentId,
    description,
    imageUrl: firstImageUrl(product),
    issues,
    score: Math.max(0, score),
    suggestedDescription: suggestedDescription(product, cleanTitle, description),
    suggestedTitle: cleanTitle,
    title,
  };
}

function cleanAiDescription(value: string) {
  return value
    .replace(/<\/?(?:script|style|iframe|object|embed)[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30000);
}

function parseAiJson(value: string) {
  const cleaned = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<AiSeoContent>;
  return { description: text(parsed.description), title: text(parsed.title) };
}

function validateAiContent(generated: { description: string; title: string }, provider: AiSeoContent["provider"]): AiSeoContent {
  const safeTitle = titleCase(truncateTitle(wordsOf(removeRepeatedWords(normalizeTitle(generated.title))).slice(0, 13).join(" ")));
  const safeDescription = cleanAiDescription(generated.description);
  if (wordsOf(safeTitle).length < 9 || !safeDescription) throw new Error("AI gecersiz SEO icerigi uretti.");
  return { description: safeDescription, provider, title: safeTitle };
}

async function generateGeminiSeoContent(product: SeoProduct): Promise<AiSeoContent | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || !product.imageUrl) return null;
  const imageResponse = await fetch(product.imageUrl, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!imageResponse.ok) throw new Error("Urun gorseli AI icin alinamadi.");
  const imageBase64 = Buffer.from(await imageResponse.arrayBuffer()).toString("base64");
  const prompt = buildAiPrompt(product);
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inlineData: { data: imageBase64, mimeType: imageResponse.headers.get("content-type") || "image/jpeg" } },
        ] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      }),
      cache: "no-store",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      method: "POST",
      signal: AbortSignal.timeout(25_000),
    },
  );
  const body = await response.json().catch(() => null) as ApiRecord | null;
  if (!response.ok || !body) {
    const message = text(record(body?.error).message) || `Gemini ${response.status} hatasi`;
    throw new Error(response.status === 429 ? `AI_KOTA_DOLDU: ${message}` : message);
  }
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const parts = Array.isArray(record(record(candidates[0]).content).parts)
    ? record(record(candidates[0]).content).parts as ApiRecord[]
    : [];
  const content = text(record(parts[0]).text);
  if (!content) throw new Error("Gemini bos yanit verdi.");
  return validateAiContent(parseAiJson(content), "Gemini");
}

function buildAiPrompt(product: SeoProduct) {
  return [
    "Sen Trendyol urun icerigi uzmanisin. Urun gorselini ve dogrulanmis bilgileri incele.",
    "Yalnizca JSON dondur: {\"title\":\"...\",\"description\":\"...\"}.",
    "Baslik Turkce, dogal ve arama niyetine uygun 9-13 kelime, en fazla 100 karakter olsun.",
    "Her kelimenin ilk harfi buyuk olsun. Marka, barkod, stok, emoji, sembol, tekrar, abarti ve anlamsiz kisaltma kullanma.",
    "Beden, boyut, ebat, olcu ve adet bilgisini basliga yazma. Gorselde veya veride dogrulanmayan ozellik uydurma.",
    "Aciklama 2-4 kisa paragraf ve urun ozellikleri listesi iceren sade HTML olsun. SEO kelimelerini dogal kullan.",
    `Mevcut baslik: ${product.title}`,
    `Kategori: ${product.category || "Belirtilmemis"}`,
    `Dogrulanmis ozellikler: ${product.attributes.join("; ") || "Belirtilmemis"}`,
    `Mevcut aciklama: ${plainHtml(product.description).slice(0, 2500)}`,
  ].join("\n");
}

async function generateOpenRouterSeoContent(product: SeoProduct): Promise<AiSeoContent | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey || !product.imageUrl) return null;

  const prompt = buildAiPrompt(product);

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    body: JSON.stringify({
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: product.imageUrl } },
        ],
      }],
      model: "openrouter/free",
      temperature: 0.2,
    }),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://trendyolfigy.vercel.app",
      "X-Title": "Figyfun Trendyol SEO Bot",
    },
    method: "POST",
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => null) as ApiRecord | null;
  if (!response.ok || !body) throw new Error(`AI servisi ${response.status} ile reddedildi.`);
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const content = text(record(record(choices[0]).message).content);
  if (!content) throw new Error("AI servisi bos yanit verdi.");

  return validateAiContent(parseAiJson(content), "OpenRouter");
}

export async function scanLowSeoProducts() {
  const products = await getAllOnSaleProducts();
  return products
    .map(analyzeSeoProduct)
    .filter((item): item is SeoProduct => Boolean(item && item.score < 70))
    .sort((a, b) => a.score - b.score);
}

function batchIdOf(response: unknown) {
  if (!response || typeof response !== "object") return null;
  const value = Reflect.get(response, "batchRequestId");
  return typeof value === "string" ? value : null;
}

export async function applySeoUpdates(contentId?: number, chatId?: number | string) {
  let selected: SeoProduct[];

  if (contentId) {
    const products = await getAllOnSaleProducts();
    selected = products
      .map(analyzeSeoProduct)
      .filter(
        (product): product is SeoProduct =>
          Boolean(product && product.contentId === contentId),
      );
  } else {
    selected = await scanLowSeoProducts();
  }

  if (!selected.length) {
    return {
      aiCount: 0,
      aiFallbackReason: null,
      batchRequestId: null,
      count: 0,
      method: "not_found" as const,
      productContentId: contentId ?? null,
      productTitle: null,
      provider: null,
      queued: false,
    };
  }

  const items = [];
  let aiCount = 0;
  let aiFallbackReason: string | null = null;
  let provider: AiSeoContent["provider"] | null = null;
  for (const product of selected) {
    let aiContent: AiSeoContent | null = null;
    if (contentId) {
      try {
        aiContent = await generateGeminiSeoContent(product);
        if (!aiContent) aiContent = await generateOpenRouterSeoContent(product);
      } catch (error) {
        console.error("Primary AI SEO generation failed.", error);
        aiFallbackReason = error instanceof Error ? error.message : "AI servisi kullanilamadi.";
        try {
          aiContent = await generateOpenRouterSeoContent(product);
        } catch (fallbackError) {
          console.error("Fallback AI SEO generation failed.", fallbackError);
          aiFallbackReason = fallbackError instanceof Error ? fallbackError.message : aiFallbackReason;
        }
      }
    }
    if (!aiContent && contentId) {
      if (chatId) {
        await enqueueSeoAiUpdate({ chatId: String(chatId), contentId, createdAt: new Date().toISOString() });
      }
      return {
        aiCount: 0,
        aiFallbackReason,
        batchRequestId: null,
        count: 0,
        method: "queued" as const,
        productContentId: product.contentId,
        productTitle: product.title,
        provider: null,
        queued: true,
      };
    }
    if (aiContent) { aiCount += 1; provider = aiContent.provider; }
    items.push({
      contentId: product.contentId,
      description: aiContent?.description ?? product.suggestedDescription,
      title: aiContent?.title ?? product.suggestedTitle,
    });
  }
  const response = await updateApprovedProductContent(items);
  return {
    aiCount,
    aiFallbackReason,
    batchRequestId: batchIdOf(response),
    count: selected.length,
    method: aiCount > 0 ? "ai" as const : "standard" as const,
    productContentId: selected[0]?.contentId ?? null,
    productTitle: selected[0]?.title ?? null,
    provider,
    queued: false,
  };
}

export async function processSeoAiQueue() {
  const queue = await getSeoAiQueue();
  const remaining: typeof queue = [];
  let completed = 0;
  let processed = 0;
  for (const [index, item] of queue.slice(0, 5).entries()) {
    const result = await applySeoUpdates(item.contentId);
    if (result.method === "ai") {
      completed += 1;
      processed += 1;
      await sendTelegramMessage(
        item.chatId,
        `✅ Bekleyen SEO islemi ${result.provider} AI ile tamamlandi.\nUrun: ${result.productTitle ?? "Bilinmiyor"}\nContent ID: ${result.productContentId ?? item.contentId}\nBatch ID: ${result.batchRequestId ?? "bekleniyor"}`,
      );
    } else {
      remaining.push(...queue.slice(index));
      processed = queue.length;
      break;
    }
  }
  if (processed < queue.length) remaining.push(...queue.slice(processed));
  await saveSeoAiQueue(remaining);
  return { completed, remaining: remaining.length };
}

export async function sendSeoReport(chatId: number | string) {
  const lowProducts = await scanLowSeoProducts();

  if (!lowProducts.length) {
    await sendTelegramMessage(chatId, "SEO kontrolu tamamlandi. Dusuk puanli urun bulunmadi.");
    return { low: 0 };
  }

  await sendTelegramMessage(
    chatId,
    [
      `SEO kontrolu tamamlandi. Dusuk puanli urun: ${lowProducts.length}`,
      "Puan Trendyol'un resmi puani degil; baslik, aciklama ve urun ozelliklerinden hesaplanan kalite puanidir.",
      "Asagidaki butonla tum onerileri Trendyol onay surecine gonderebilirsiniz.",
    ].join("\n"),
  );

  for (const [index, product] of lowProducts.slice(0, 25).entries()) {
    await sendTelegramMessage(
      chatId,
      [
        `${index + 1}. ${product.title}`,
        `SEO puani: ${product.score}/100`,
        `Sorunlar: ${product.issues.join(", ")}`,
        `Yeni baslik: ${product.suggestedTitle}`,
      ].join("\n"),
      { inlineKeyboard: [[{ callbackData: `seo|${product.contentId}`, text: "AI ile SEO duzelt" }]] },
    );
  }

  if (lowProducts.length > 25) {
    await sendTelegramMessage(chatId, `Ilk 25 urun gosterildi. Tumunu duzelt butonu ${lowProducts.length} urunun tamamini kapsar.`);
  }
  return { low: lowProducts.length };
}
