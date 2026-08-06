import "server-only";

import {
  defaultCommerceSettings,
  getBuyboxSnapshots,
  getCommerceSettings,
  saveBuyboxSnapshots,
  type CommerceSettings,
} from "@/lib/db";
import { hasDatabaseUrl } from "@/lib/env";
import { getBuyboxAlertChatIds, sendTelegramMessage } from "@/lib/telegram";
import {
  getApprovedProducts,
  getProductBuyboxInformation,
  getShipmentPackages,
  getTrendyolErrorSummary,
  updatePriceAndInventory,
} from "@/lib/trendyol";

type ApiRecord = Record<string, unknown>;

export type CommerceProductInsight = {
  barcode: string;
  buyboxOrder: number | null;
  buyboxPrice: number | null;
  category: string;
  commissionRate: number;
  currentProfit: number;
  daysUntilStockout: number | null;
  hasMultipleSeller: boolean;
  imageUrl: string | null;
  listPrice: number;
  maxPrice: number;
  minPrice: number;
  onSale: boolean;
  profitMargin: number;
  qualityIssues: string[];
  qualityScore: number;
  quantity: number;
  recommendedPrice: number | null;
  salePrice: number;
  salesLast14Days: number;
  secondBuyboxPrice: number | null;
  stockCode: string;
  stockRisk: "critical" | "ok" | "warning";
  title: string;
};

export type PriceUpdateRunResult = {
  alertsSent?: number;
  batchRequestId: string | null;
  checked: number;
  mode: "bulk" | "repricer";
  skipped: number;
  submitted: number;
};

const dayMs = 24 * 60 * 60 * 1000;

function contentOf(response: unknown) {
  if (!response || typeof response !== "object") {
    return [];
  }

  const content = Reflect.get(response, "content");

  return Array.isArray(content) ? (content as ApiRecord[]) : [];
}

function totalPagesOf(response: unknown) {
  if (!response || typeof response !== "object") {
    return 1;
  }

  return Math.max(1, Math.trunc(numberValue(Reflect.get(response, "totalPages"))));
}

export async function getAllOnSaleProducts() {
  const firstPage = await getApprovedProducts({ page: 0, size: 100, status: "onSale" });
  const products = [...contentOf(firstPage)];
  const totalPages = Math.min(totalPagesOf(firstPage), 100);

  for (let page = 1; page < totalPages; page += 1) {
    const response = await getApprovedProducts({ page, size: 100, status: "onSale" });
    products.push(...contentOf(response));
  }

  return products;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? (value as ApiRecord[]) : [];
}

function variantsOf(product: ApiRecord) {
  return arrayValue(product.variants);
}

function firstImageUrl(product: ApiRecord) {
  const image = arrayValue(product.images)[0];
  const url = image ? textValue(image.url) : "";

  return url || null;
}

function categoryName(product: ApiRecord) {
  const category =
    product.category && typeof product.category === "object"
      ? (product.category as ApiRecord)
      : {};

  return textValue(category.name) || "Kategori yok";
}

function buyboxInfoOf(response: unknown) {
  if (!response || typeof response !== "object") {
    return new Map<string, ApiRecord>();
  }

  const items = Reflect.get(response, "buyboxInfo");
  const map = new Map<string, ApiRecord>();

  if (!Array.isArray(items)) {
    return map;
  }

  for (const item of items as ApiRecord[]) {
    const barcode = textValue(item.barcode);

    if (barcode) {
      map.set(barcode, item);
    }
  }

  return map;
}

async function getBuyboxMap(barcodes: string[], errors: { area: string; message: string }[]) {
  const buyboxMap = new Map<string, ApiRecord>();

  for (let index = 0; index < barcodes.length; index += 10) {
    const batch = barcodes.slice(index, index + 10);

    if (batch.length === 0) {
      continue;
    }

    try {
      for (const [barcode, info] of buyboxInfoOf(await getProductBuyboxInformation(batch))) {
        buyboxMap.set(barcode, info);
      }
    } catch (error) {
      errors.push({
        area: "BuyBox",
        message: getTrendyolErrorSummary(error),
      });
    }
  }

  return buyboxMap;
}

export async function getBuyboxCompetitionByBarcode(barcodes: string[]) {
  const errors: { area: string; message: string }[] = [];
  const buyboxMap = await getBuyboxMap(
    [...new Set(barcodes.map((barcode) => barcode.trim()).filter(Boolean))],
    errors,
  );

  if (errors.length > 0) {
    throw new Error(`BuyBox uygunluk kontrolu tamamlanamadi: ${errors[0].message}`);
  }

  return new Map(
    [...buyboxMap.entries()].map(([barcode, info]) => [
      barcode,
      info.hasMultipleSeller === true,
    ]),
  );
}

function orderLinesByBarcode(orders: ApiRecord[]) {
  const sales = new Map<string, number>();

  for (const order of orders) {
    for (const line of arrayValue(order.lines)) {
      const barcode = textValue(line.barcode);
      const quantity = Math.max(1, Math.trunc(numberValue(line.quantity)));

      if (barcode) {
        sales.set(barcode, (sales.get(barcode) ?? 0) + quantity);
      }
    }
  }

  return sales;
}

function qualityIssues(product: ApiRecord, variant: ApiRecord) {
  const issues: string[] = [];
  const title = textValue(product.title);
  const description = textValue(product.description);
  const images = arrayValue(product.images);
  const attributes = [...arrayValue(product.attributes), ...arrayValue(variant.attributes)];

  if (title.length < 30 || title.length > 100) {
    issues.push("Başlık 30-100 karakter aralığında değil.");
  }

  if (description.replace(/<[^>]+>/g, "").length < 120) {
    issues.push("Açıklama kısa; SEO ve dönüşüm için genişlet.");
  }

  if (images.length < 2) {
    issues.push("Görsel sayısı düşük; en az 2-3 net görsel ekle.");
  }

  if (attributes.length < 4) {
    issues.push("Özellik alanları zayıf; filtrelerde görünürlük düşebilir.");
  }

  if (!textValue(variant.stockCode)) {
    issues.push("Stok kodu eksik.");
  }

  return issues;
}

function qualityScore(product: ApiRecord, variant: ApiRecord) {
  const issues = qualityIssues(product, variant);

  return Math.max(0, 100 - issues.length * 18);
}

function profitFor(price: number, settings: CommerceSettings, commissionRate: number) {
  const commission = price * (commissionRate / 100);

  return price - commission - settings.productCost - settings.shippingCost - settings.fixedCost;
}

function minProfitPrice(settings: CommerceSettings, commissionRate: number) {
  const variableRate =
    commissionRate / 100 + Math.max(0, settings.targetMarginRate) / 100;
  const denominator = Math.max(0.05, 1 - variableRate);
  const floor =
    (settings.productCost + settings.shippingCost + settings.fixedCost) / denominator;

  return Math.max(settings.minPrice, floor || settings.minPrice);
}

function recommendedPrice(input: {
  buyboxOrder: number | null;
  buyboxPrice: number | null;
  currentPrice: number;
  maxPrice: number;
  minPrice: number;
  settings: CommerceSettings;
}) {
  if (!input.buyboxPrice || input.buyboxPrice <= 0) {
    return null;
  }

  if (input.buyboxOrder === 1 && input.currentPrice <= input.buyboxPrice) {
    return null;
  }

  const target = input.buyboxPrice - input.settings.undercutAmount;
  const bounded = Math.min(input.maxPrice, Math.max(input.minPrice, target));

  if (bounded <= 0 || Math.abs(bounded - input.currentPrice) < 0.01) {
    return null;
  }

  return Math.round(bounded * 100) / 100;
}

function stockRisk(quantity: number, daysUntilStockout: number | null, warningDays: number) {
  if (quantity <= 0 || daysUntilStockout === 0) {
    return "critical";
  }

  if (daysUntilStockout !== null && daysUntilStockout <= warningDays) {
    return "warning";
  }

  return "ok";
}

function formatTry(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "bilinmiyor";
  }

  return `${value.toLocaleString("tr-TR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} TL`;
}

function buyboxListItem(product: CommerceProductInsight, index: number) {
  const targetPrice = product.recommendedPrice ?? product.buyboxPrice ?? product.salePrice;
  const commandPrice = targetPrice.toLocaleString("tr-TR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });

  return [
    `${index}. ${product.title || product.barcode}`,
    `Barkod: ${product.barcode}`,
    `Sira: #${product.buyboxOrder ?? "?"} | BuyBox: ${formatTry(product.buyboxPrice)} | Sizin fiyat: ${formatTry(product.salePrice)}`,
    `Guncelle: /fiyat ${product.barcode} ${commandPrice}`,
  ].join("\n");
}

function chunkTelegramText(heading: string, sections: string[]) {
  const chunks: string[] = [];
  let current = heading;

  for (const section of sections) {
    const candidate = `${current}\n\n${section}`;

    if (candidate.length > 3800 && current !== heading) {
      chunks.push(current);
      current = `${heading} (devam)\n\n${section}`;
    } else {
      current = candidate;
    }
  }

  chunks.push(current);
  return chunks;
}

async function sendBuyboxList(
  chatId: number | string,
  products: CommerceProductInsight[],
  heading: string,
) {
  const lost = products.filter(
    (product) => product.buyboxOrder !== null && product.buyboxOrder > 1,
  );
  const title = `${heading}\nTaranan urun: ${products.length}\nBuyBox kaybi: ${lost.length}`;
  const sections = lost.map((product, index) => buyboxListItem(product, index + 1));

  for (const chunk of chunkTelegramText(title, sections)) {
    await sendTelegramMessage(chatId, chunk);
  }

  for (let index = 0; index < lost.length; index += 20) {
    const batch = lost.slice(index, index + 20);
    const inlineKeyboard = batch.map((product, batchIndex) => {
      const targetPrice = Math.round(
        (product.recommendedPrice ?? product.buyboxPrice ?? product.salePrice) * 100,
      ) / 100;
      const productNumber = index + batchIndex + 1;

      return [{
        callbackData: `bb|${product.barcode}|${targetPrice}`,
        text: `${productNumber} · ${targetPrice.toLocaleString("tr-TR", {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        })} TL yap`,
      }];
    });

    await sendTelegramMessage(
      chatId,
      index === 0
        ? "Hizli fiyat guncelleme: Urunu ve fiyati kontrol edip dugmeye basin."
        : "Hizli fiyat guncelleme (devam):",
      { inlineKeyboard },
    );
  }

  return lost.length;
}

export async function sendManualBuyboxReport(chatId: number | string) {
  const dashboard = await getCommerceDashboardData();
  const lost = await sendBuyboxList(
    chatId,
    dashboard.products,
    "Anlik BuyBox kontrol sonucu",
  );

  return {
    errors: dashboard.errors,
    lost,
    tracked: dashboard.products.length,
  };
}

async function readCommerceSettings() {
  if (!hasDatabaseUrl()) {
    return defaultCommerceSettings;
  }

  return getCommerceSettings();
}

async function getRecentOrders() {
  const end = Date.now();
  const start = end - 14 * dayMs;

  const response = await getShipmentPackages({
    endDate: end,
    orderByDirection: "DESC",
    orderByField: "PackageLastModifiedDate",
    page: 0,
    size: 200,
    startDate: start,
  });

  return contentOf(response);
}

export async function getCommerceDashboardData() {
  const settings = await readCommerceSettings();
  const errors: { area: string; message: string }[] = [];
  const [productsResult, ordersResult] = await Promise.allSettled([
    getAllOnSaleProducts(),
    getRecentOrders(),
  ]);

  if (productsResult.status === "rejected") {
    errors.push({
      area: "Ürünler",
      message: getTrendyolErrorSummary(productsResult.reason),
    });
  }

  if (ordersResult.status === "rejected") {
    errors.push({
      area: "Satış tahmini",
      message: getTrendyolErrorSummary(ordersResult.reason),
    });
  }

  const products = productsResult.status === "fulfilled" ? productsResult.value : [];
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];
  const salesByBarcode = orderLinesByBarcode(orders);
  const flattened = products.flatMap((product) =>
    variantsOf(product).map((variant) => ({ product, variant })),
  );
  const barcodes = flattened
    .map(({ variant }) => textValue(variant.barcode))
    .filter(Boolean);
  const buyboxMap = await getBuyboxMap(barcodes, errors);

  const productInsights: CommerceProductInsight[] = flattened.map(({ product, variant }) => {
      const barcode = textValue(variant.barcode);
      const price =
        variant.price && typeof variant.price === "object"
          ? (variant.price as ApiRecord)
          : {};
      const stock =
        variant.stock && typeof variant.stock === "object"
          ? (variant.stock as ApiRecord)
          : {};
      const buybox = buyboxMap.get(barcode) ?? {};
      const salePrice = numberValue(price.salePrice);
      const listPrice = numberValue(price.listPrice) || salePrice;
      const quantity = Math.trunc(numberValue(stock.quantity));
      const commissionRate =
        numberValue(variant.commission) || settings.defaultCommissionRate;
      const minPrice = minProfitPrice(settings, commissionRate);
      const maxPrice = Math.max(settings.maxPrice, minPrice);
      const buyboxOrder = numberValue(buybox.buyboxOrder) || null;
      const buyboxPrice = numberValue(buybox.buyboxPrice) || null;
      const secondBuyboxPrice = numberValue(buybox.secondBuyboxPrice) || null;
      const salesLast14Days = salesByBarcode.get(barcode) ?? 0;
      const dailySales = salesLast14Days / 14;
      const daysUntilStockout =
        dailySales > 0 ? Math.max(0, Math.floor(quantity / dailySales)) : null;
      const issues = qualityIssues(product, variant);

      return {
        barcode,
        buyboxOrder,
        buyboxPrice,
        category: categoryName(product),
        commissionRate,
        currentProfit: profitFor(salePrice, settings, commissionRate),
        daysUntilStockout,
        hasMultipleSeller: buybox.hasMultipleSeller === true,
        imageUrl: firstImageUrl(product),
        listPrice,
        maxPrice,
        minPrice,
        onSale: variant.onSale === true,
        profitMargin: salePrice > 0 ? (profitFor(salePrice, settings, commissionRate) / salePrice) * 100 : 0,
        qualityIssues: issues.slice(0, 3),
        qualityScore: qualityScore(product, variant),
        quantity,
        recommendedPrice: recommendedPrice({
          buyboxOrder,
          buyboxPrice,
          currentPrice: salePrice,
          maxPrice,
          minPrice,
          settings,
        }),
        salePrice,
        salesLast14Days,
        secondBuyboxPrice,
        stockCode: textValue(variant.stockCode),
        stockRisk: stockRisk(quantity, daysUntilStockout, settings.stockWarningDays),
        title: textValue(product.title),
      };
  });

  const buyboxLost = productInsights.filter(
    (product) => product.buyboxOrder !== null && product.buyboxOrder > 1,
  ).length;
  const repricerReady = productInsights.filter(
    (product) => product.recommendedPrice !== null,
  ).length;
  const stockWarnings = productInsights.filter(
    (product) => product.stockRisk !== "ok",
  ).length;
  const totalProfit = productInsights.reduce(
    (sum, product) => sum + product.currentProfit * Math.max(1, product.salesLast14Days),
    0,
  );
  const averageQuality =
    productInsights.length > 0
      ? productInsights.reduce((sum, product) => sum + product.qualityScore, 0) /
        productInsights.length
      : 0;

  return {
    averageQuality,
    buyboxLost,
    databaseBacked: hasDatabaseUrl(),
    errors,
    products: productInsights,
    repricerReady,
    settings,
    stockWarnings,
    totalProfit,
    trackedProducts: productInsights.length,
  };
}

export async function runRepricerUpdate(options: { force?: boolean } = {}) {
  const dashboard = await getCommerceDashboardData();
  const alertsSent = await sendBuyboxLossAlerts(dashboard.products);

  if (!dashboard.settings.repricerEnabled && !options.force) {
    return {
      alertsSent,
      batchRequestId: null,
      checked: dashboard.products.length,
      mode: "repricer" as const,
      skipped: dashboard.products.length,
      submitted: 0,
    };
  }

  const items = dashboard.products
    .filter((product) => product.recommendedPrice !== null)
    .map((product) => ({
      barcode: product.barcode,
      listPrice: Math.max(product.listPrice, product.recommendedPrice ?? product.salePrice),
      quantity: product.quantity,
      salePrice: product.recommendedPrice ?? product.salePrice,
    }));

  if (items.length === 0) {
    return {
      alertsSent,
      batchRequestId: null,
      checked: dashboard.products.length,
      mode: "repricer" as const,
      skipped: dashboard.products.length,
      submitted: 0,
    };
  }

  const response = await updatePriceAndInventory(items);

  return {
    alertsSent,
    batchRequestId:
      response.batchRequestId && typeof response.batchRequestId === "string"
        ? response.batchRequestId
        : null,
    checked: dashboard.products.length,
    mode: "repricer" as const,
    skipped: dashboard.products.length - items.length,
    submitted: items.length,
  };
}

export async function sendBuyboxLossAlerts(products: CommerceProductInsight[]) {
  if (!hasDatabaseUrl()) {
    return 0;
  }

  const snapshots = await getBuyboxSnapshots();
  const chatIds = getBuyboxAlertChatIds();
  let alertsSent = 0;
  const now = new Date().toISOString();
  const newlyLost: CommerceProductInsight[] = [];
  const previousByBarcode = new Map<string, ReturnType<typeof snapshots.get>>();

  for (const product of products) {
    if (!product.barcode) {
      continue;
    }

    const previous = snapshots.get(product.barcode);
    previousByBarcode.set(product.barcode, previous);
    const lostBuybox =
      product.buyboxOrder !== null &&
      product.buyboxOrder > 1 &&
      (!previous?.buyboxOrder || previous.buyboxOrder <= 1);

    snapshots.set(product.barcode, {
      barcode: product.barcode,
      buyboxOrder: product.buyboxOrder,
      buyboxPrice: product.buyboxPrice,
      listPrice: product.listPrice,
      salePrice: product.salePrice,
      stockCode: product.stockCode,
      title: product.title,
      updatedAt: now,
    });

    if (!lostBuybox) {
      continue;
    }

    newlyLost.push(product);
  }

  if (newlyLost.length > 0) {
    let delivered = false;

    for (const chatId of chatIds) {
      try {
        await sendBuyboxList(chatId, newlyLost, "BuyBox kaybi alarmi");
        alertsSent += newlyLost.length;
        delivered = true;
      } catch (error) {
        console.error(`BuyBox alert list could not be delivered to chat ${chatId}.`, error);
      }
    }

    if (!delivered) {
      for (const product of newlyLost) {
        const previous = previousByBarcode.get(product.barcode);

        if (previous) {
          snapshots.set(product.barcode, previous);
        } else {
          snapshots.delete(product.barcode);
        }
      }
    }
  }

  await saveBuyboxSnapshots(snapshots);

  return alertsSent;
}

export async function updateSingleProductPrice(input: {
  barcode: string;
  listPrice?: number;
  quantity?: number;
  salePrice: number;
}) {
  const dashboard = await getCommerceDashboardData();
  const product = dashboard.products.find(
    (item) => item.barcode.toLocaleLowerCase("tr-TR") === input.barcode.toLocaleLowerCase("tr-TR"),
  );
  const salePrice = Math.round(input.salePrice * 100) / 100;

  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    throw new Error("Gecerli bir satis fiyati girin.");
  }

  const listPrice = Math.max(product?.listPrice ?? input.listPrice ?? salePrice, salePrice);
  const quantity = product?.quantity ?? input.quantity ?? 0;
  const response = await updatePriceAndInventory([
    {
      barcode: input.barcode,
      listPrice,
      quantity,
      salePrice,
    },
  ]);

  return {
    batchRequestId:
      response.batchRequestId && typeof response.batchRequestId === "string"
        ? response.batchRequestId
        : null,
    barcode: input.barcode,
    listPrice,
    quantity,
    salePrice,
    title: product?.title ?? input.barcode,
  };
}

export async function runBulkPriceChange(percent: number) {
  const dashboard = await getCommerceDashboardData();
  const multiplier = 1 + percent / 100;
  const items = dashboard.products
    .map((product) => {
      const nextPrice = Math.round(product.salePrice * multiplier * 100) / 100;
      const boundedPrice = Math.min(
        product.maxPrice,
        Math.max(product.minPrice, nextPrice),
      );

      return {
        barcode: product.barcode,
        listPrice: Math.max(product.listPrice, boundedPrice),
        quantity: product.quantity,
        salePrice: boundedPrice,
      };
    })
    .filter((item) => item.barcode && item.salePrice > 0);

  if (items.length === 0) {
    return {
      batchRequestId: null,
      checked: dashboard.products.length,
      mode: "bulk" as const,
      skipped: dashboard.products.length,
      submitted: 0,
    };
  }

  const response = await updatePriceAndInventory(items);

  return {
    batchRequestId:
      response.batchRequestId && typeof response.batchRequestId === "string"
        ? response.batchRequestId
        : null,
    checked: dashboard.products.length,
    mode: "bulk" as const,
    skipped: dashboard.products.length - items.length,
    submitted: items.length,
  };
}
