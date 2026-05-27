import "server-only";

import {
  getAutoAcceptSettings,
  saveAutoAcceptRunResult,
  type AutoAcceptRunResult,
} from "@/lib/db";
import { hasDatabaseUrl } from "@/lib/env";
import {
  getOtherFinancials,
  getReturnClaims,
  getSettlements,
  getShipmentPackages,
  getTrendyolErrorSummary,
  updateShipmentPackageStatus,
} from "@/lib/trendyol";

type ApiRecord = Record<string, unknown>;

type DashboardError = {
  area: string;
  message: string;
};

const dayMs = 24 * 60 * 60 * 1000;
function dateRange(days: number) {
  const end = Date.now();

  return {
    end,
    start: end - days * dayMs,
  };
}

function contentOf(response: unknown) {
  if (!response || typeof response !== "object") {
    return [];
  }

  const content = Reflect.get(response, "content");

  return Array.isArray(content) ? (content as ApiRecord[]) : [];
}

function totalElementsOf(response: unknown, fallback: number) {
  if (!response || typeof response !== "object") {
    return fallback;
  }

  const total = Reflect.get(response, "totalElements");

  return typeof total === "number" ? total : fallback;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function linesOf(order: ApiRecord) {
  const lines = order.lines;

  return Array.isArray(lines) ? (lines as ApiRecord[]) : [];
}

function packageIdOf(order: ApiRecord) {
  const packageId =
    order.shipmentPackageId ?? order.shipmentPackageID ?? order.packageId ?? order.id;

  return typeof packageId === "number" || typeof packageId === "string"
    ? packageId
    : null;
}

function packageTotal(order: ApiRecord) {
  const total =
    numberValue(order.totalPrice) ||
    numberValue(order.grossAmount) ||
    numberValue(order.totalDiscountedPrice);

  if (total > 0) {
    return total;
  }

  return linesOf(order).reduce((sum, line) => {
    const quantity = Math.max(1, numberValue(line.quantity));
    const price =
      numberValue(line.price) ||
      numberValue(line.lineItemPrice) ||
      numberValue(line.lineGrossAmount);

    return sum + price * quantity;
  }, 0);
}

function itemCount(order: ApiRecord) {
  return linesOf(order).reduce(
    (sum, line) => sum + Math.max(1, numberValue(line.quantity)),
    0,
  );
}

function statusOf(order: ApiRecord) {
  const status = textValue(order.status);

  return status || "Bilinmiyor";
}

function claimStatusCounts(claims: ApiRecord[]) {
  const counts: Record<string, number> = {};

  for (const claim of claims) {
    const items = Array.isArray(claim.items) ? (claim.items as ApiRecord[]) : [];

    if (items.length === 0) {
      const status = textValue(claim.claimItemStatus) || "Bilinmiyor";
      counts[status] = (counts[status] ?? 0) + 1;
      continue;
    }

    for (const item of items) {
      const claimItems = Array.isArray(item.claimItems)
        ? (item.claimItems as ApiRecord[])
        : [];

      if (claimItems.length === 0) {
        counts.Bilinmiyor = (counts.Bilinmiyor ?? 0) + 1;
        continue;
      }

      for (const claimItem of claimItems) {
        const statusObject =
          claimItem.claimItemStatus && typeof claimItem.claimItemStatus === "object"
            ? (claimItem.claimItemStatus as ApiRecord)
            : {};
        const status = textValue(statusObject.name) || "Bilinmiyor";
        counts[status] = (counts[status] ?? 0) + 1;
      }
    }
  }

  return counts;
}

function settlementAmount(records: ApiRecord[], matcher: (type: string) => boolean) {
  return records.reduce((sum, record) => {
    const type = textValue(record.transactionType);

    if (!matcher(type)) {
      return sum;
    }

    return (
      sum +
      numberValue(record.sellerRevenue) +
      numberValue(record.amount) +
      numberValue(record.debt)
    );
  }, 0);
}

function lineUpdatesOf(order: ApiRecord) {
  return linesOf(order)
    .map((line) => {
      const lineId = numberValue(line.lineId ?? line.id);
      const quantity = Math.max(1, Math.trunc(numberValue(line.quantity)));

      return lineId > 0 ? { lineId, quantity } : null;
    })
    .filter((line): line is { lineId: number; quantity: number } => Boolean(line));
}

function recommendationText(input: {
  autoAcceptEnabled: boolean;
  autoAcceptReady: boolean;
  createdCount: number;
  errors: DashboardError[];
  returnRate: number;
  waitingClaims: number;
}) {
  const recommendations: string[] = [];

  if (!input.autoAcceptReady) {
    recommendations.push(
      "Otomatik kabul ayarını saklamak için DATABASE_URL gerekli. Postgres bağlanınca tik kalıcı olur.",
    );
  }

  if (input.createdCount > 0 && !input.autoAcceptEnabled) {
    recommendations.push(
      "Kabul bekleyen sipariş var. Otomatik kabul açılırsa Created paketler Picking statüsüne çekilir.",
    );
  }

  if (input.createdCount > 0 && input.autoAcceptEnabled) {
    recommendations.push(
      "Otomatik kabul açık. Son çalışma sonucunda hata varsa kargo satırı veya yetki bilgisini kontrol et.",
    );
  }

  if (input.waitingClaims > 0) {
    recommendations.push(
      "Aksiyon bekleyen iade var. WaitingInAction iadelerde kabul veya red kararını geciktirme.",
    );
  }

  if (input.returnRate >= 10) {
    recommendations.push(
      "İade oranı yüksek görünüyor. En çok iade gelen ürün adlarını ve müşteri notlarını kontrol et.",
    );
  }

  if (input.errors.length > 0) {
    recommendations.push(
      "Bazı Trendyol servisleri veri döndürmedi. API yetkileri, tarih aralığı ve rate limitleri kontrol edilmeli.",
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Operasyon normal görünüyor. Yeni sipariş ve iade aksiyonlarını aynı panelden takip edebilirsin.",
    );
  }

  return recommendations;
}

function defaultAutoAcceptSettings() {
  const envEnabled = ["1", "true", "yes", "on"].includes(
    (process.env.TRENDYOL_AUTO_ACCEPT_ENABLED ?? "").trim().toLowerCase(),
  );

  return {
    enabled: envEnabled,
    lastResult: null,
    updatedAt: null,
  };
}

async function readAutoAcceptSettings() {
  if (!hasDatabaseUrl()) {
    return defaultAutoAcceptSettings();
  }

  return getAutoAcceptSettings();
}

async function storeAutoAcceptResult(result: AutoAcceptRunResult) {
  if (hasDatabaseUrl()) {
    await saveAutoAcceptRunResult(result);
  }

  return result;
}

export async function getOperationsDashboardData() {
  const orderRange = dateRange(14);
  const financeRange = dateRange(14);
  const returnsRange = dateRange(30);
  const errors: DashboardError[] = [];
  const autoAcceptSettings = await readAutoAcceptSettings();

  const [ordersResult, claimsResult, settlementsResult, paymentsResult] =
    await Promise.allSettled([
      getShipmentPackages({
        endDate: orderRange.end,
        orderByDirection: "DESC",
        orderByField: "PackageLastModifiedDate",
        page: 0,
        size: 200,
        startDate: orderRange.start,
      }),
      getReturnClaims({
        endDate: returnsRange.end,
        page: 0,
        size: 100,
        startDate: returnsRange.start,
      }),
      getSettlements({
        endDate: financeRange.end,
        page: 0,
        size: 500,
        startDate: financeRange.start,
        transactionTypes:
          "Sale,Return,CommissionNegative,CommissionPositive,Discount,Coupon",
      }),
      getOtherFinancials({
        endDate: financeRange.end,
        page: 0,
        size: 500,
        startDate: financeRange.start,
        transactionType: "PaymentOrder",
      }),
    ]);

  if (ordersResult.status === "rejected") {
    errors.push({
      area: "Siparişler",
      message: getTrendyolErrorSummary(ordersResult.reason),
    });
  }

  if (claimsResult.status === "rejected") {
    errors.push({
      area: "İadeler",
      message: getTrendyolErrorSummary(claimsResult.reason),
    });
  }

  if (settlementsResult.status === "rejected") {
    errors.push({
      area: "Cari hesap",
      message: getTrendyolErrorSummary(settlementsResult.reason),
    });
  }

  if (paymentsResult.status === "rejected") {
    errors.push({
      area: "Ödemeler",
      message: getTrendyolErrorSummary(paymentsResult.reason),
    });
  }

  const orders =
    ordersResult.status === "fulfilled" ? contentOf(ordersResult.value) : [];
  const claims =
    claimsResult.status === "fulfilled" ? contentOf(claimsResult.value) : [];
  const settlements =
    settlementsResult.status === "fulfilled"
      ? contentOf(settlementsResult.value)
      : [];
  const payments =
    paymentsResult.status === "fulfilled" ? contentOf(paymentsResult.value) : [];
  const statusCounts = orders.reduce<Record<string, number>>((counts, order) => {
    const status = statusOf(order);
    counts[status] = (counts[status] ?? 0) + 1;

    return counts;
  }, {});
  const grossRevenue = orders.reduce((sum, order) => sum + packageTotal(order), 0);
  const totalItems = orders.reduce((sum, order) => sum + itemCount(order), 0);
  const createdCount = statusCounts.Created ?? 0;
  const deliveredCount = statusCounts.Delivered ?? 0;
  const cancelledCount =
    (statusCounts.Cancelled ?? 0) + (statusCounts.UnSupplied ?? 0);
  const claimCounts = claimStatusCounts(claims);
  const waitingClaims = claimCounts.WaitingInAction ?? 0;
  const returnCount = Object.values(claimCounts).reduce((sum, count) => sum + count, 0);
  const netSettlement =
    settlementAmount(settlements, (type) => !/Commission|Return/.test(type)) -
    Math.abs(settlementAmount(settlements, (type) => /Commission|Return/.test(type)));
  const paymentTotal = payments.reduce(
    (sum, payment) =>
      sum +
      numberValue(payment.amount) +
      numberValue(payment.paymentAmount) +
      numberValue(payment.totalAmount),
    0,
  );
  const returnRate = orders.length > 0 ? (returnCount / orders.length) * 100 : 0;
  const cancellationRate =
    orders.length > 0 ? (cancelledCount / orders.length) * 100 : 0;

  return {
    autoAccept: autoAcceptSettings,
    autoAcceptReady: hasDatabaseUrl(),
    errors,
    finance: {
      netSettlement,
      paymentCount: payments.length,
      paymentTotal,
      recordCount: settlements.length,
    },
    orders: {
      averagePackageValue: orders.length > 0 ? grossRevenue / orders.length : 0,
      createdCount,
      deliveredCount,
      grossRevenue,
      latest: orders.slice(0, 10),
      statusCounts,
      totalElements:
        ordersResult.status === "fulfilled"
          ? totalElementsOf(ordersResult.value, orders.length)
          : orders.length,
      totalItems,
    },
    performance: {
      cancellationRate,
      returnRate,
      shippedCount: statusCounts.Shipped ?? 0,
    },
    period: {
      end: new Date(orderRange.end),
      financeEnd: new Date(financeRange.end),
      financeStart: new Date(financeRange.start),
      returnsEnd: new Date(returnsRange.end),
      returnsStart: new Date(returnsRange.start),
      start: new Date(orderRange.start),
    },
    recommendations: recommendationText({
      autoAcceptEnabled: autoAcceptSettings.enabled,
      autoAcceptReady: hasDatabaseUrl(),
      createdCount,
      errors,
      returnRate,
      waitingClaims,
    }),
    returns: {
      latest: claims.slice(0, 8),
      statusCounts: claimCounts,
      totalElements:
        claimsResult.status === "fulfilled"
          ? totalElementsOf(claimsResult.value, claims.length)
          : claims.length,
      waitingClaims,
    },
  };
}

export async function runAutoAcceptOrders(options: { force?: boolean } = {}) {
  const settings = await readAutoAcceptSettings();
  const ranAt = new Date().toISOString();

  if (!settings.enabled && !options.force) {
    const result: AutoAcceptRunResult = {
      accepted: 0,
      checked: 0,
      errors: [],
      failed: 0,
      message: "Otomatik kabul kapalı.",
      ranAt,
      skipped: true,
    };

    return storeAutoAcceptResult(result);
  }

  try {
    const range = dateRange(14);
    const response = await getShipmentPackages({
      endDate: range.end,
      orderByDirection: "ASC",
      orderByField: "PackageLastModifiedDate",
      page: 0,
      size: 50,
      startDate: range.start,
      status: "Created",
    });
    const orders = contentOf(response);
    let accepted = 0;
    const errors: string[] = [];

    for (const order of orders) {
      const packageId = packageIdOf(order);
      const lines = lineUpdatesOf(order);

      if (!packageId || lines.length === 0) {
        errors.push(
          `${textValue(order.orderNumber) || "Sipariş"} için paket satırı bulunamadı.`,
        );
        continue;
      }

      try {
        await updateShipmentPackageStatus(packageId, lines, "Picking");
        accepted += 1;
      } catch (error) {
        errors.push(getTrendyolErrorSummary(error));
      }
    }

    const result: AutoAcceptRunResult = {
      accepted,
      checked: orders.length,
      errors: errors.slice(0, 8),
      failed: errors.length,
      message:
        orders.length === 0
          ? "Created statüsünde kabul bekleyen sipariş yok."
          : `${accepted} paket Picking statüsüne alındı.`,
      ranAt,
      skipped: false,
    };

    return storeAutoAcceptResult(result);
  } catch (error) {
    const result: AutoAcceptRunResult = {
      accepted: 0,
      checked: 0,
      errors: [getTrendyolErrorSummary(error)],
      failed: 1,
      message: "Otomatik kabul çalışmadı.",
      ranAt,
      skipped: false,
    };

    return storeAutoAcceptResult(result);
  }
}

export function dashboardOrderRows(orders: ApiRecord[]) {
  return orders.map((order) => ({
    customer: `${textValue(order.customerFirstName)} ${textValue(order.customerLastName)}`.trim(),
    date: new Date(numberValue(order.orderDate) || numberValue(order.createdDate)),
    id: packageIdOf(order),
    itemCount: itemCount(order),
    orderNumber: textValue(order.orderNumber),
    status: statusOf(order),
    total: packageTotal(order),
  }));
}

export function dashboardReturnRows(claims: ApiRecord[]) {
  return claims.map((claim) => ({
    claimId: textValue(claim.claimId) || textValue(claim.id),
    customer: `${textValue(claim.customerFirstName)} ${textValue(claim.customerLastName)}`.trim(),
    date: new Date(numberValue(claim.claimDate)),
    orderNumber: textValue(claim.orderNumber),
    status: Object.keys(claimStatusCounts([claim]))[0] ?? "Bilinmiyor",
  }));
}
