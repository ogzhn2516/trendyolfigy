import "server-only";

import {
  defaultCommerceSettings,
  getCommerceSettings,
  type CommerceSettings,
} from "@/lib/db";
import { hasDatabaseUrl } from "@/lib/env";
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
    getApprovedProducts({ page: 0, size: 100, status: "onSale" }),
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

  const products =
    productsResult.status === "fulfilled" ? contentOf(productsResult.value) : [];
  const orders = ordersResult.status === "fulfilled" ? ordersResult.value : [];
  const salesByBarcode = orderLinesByBarcode(orders);
  const flattened = products.flatMap((product) =>
    variantsOf(product).map((variant) => ({ product, variant })),
  );
  const barcodes = flattened
    .map(({ variant }) => textValue(variant.barcode))
    .filter(Boolean)
    .slice(0, 10);
  let buyboxMap = new Map<string, ApiRecord>();

  if (barcodes.length > 0) {
    try {
      buyboxMap = buyboxInfoOf(await getProductBuyboxInformation(barcodes));
    } catch (error) {
      errors.push({
        area: "BuyBox",
        message: getTrendyolErrorSummary(error),
      });
    }
  }

  const productInsights: CommerceProductInsight[] = flattened
    .slice(0, 100)
    .map(({ product, variant }) => {
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

  if (!dashboard.settings.repricerEnabled && !options.force) {
    return {
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
      batchRequestId: null,
      checked: dashboard.products.length,
      mode: "repricer" as const,
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
    mode: "repricer" as const,
    skipped: dashboard.products.length - items.length,
    submitted: items.length,
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
