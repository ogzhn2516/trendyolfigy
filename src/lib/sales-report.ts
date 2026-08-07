import "server-only";

import { getShipmentPackages } from "@/lib/trendyol";

type ApiRecord = Record<string, unknown>;

const excludedStatuses = new Set(["cancelled", "returned", "unsupplied", "un supplied"]);

function record(value: unknown): ApiRecord {
  return value && typeof value === "object" ? value as ApiRecord : {};
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function money(value: number) {
  return `${value.toLocaleString("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} TL`;
}

function istanbulTodayRange() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Istanbul",
    year: "numeric",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return {
    end: Date.parse(`${date}T23:59:59.999+03:00`),
    label: new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(new Date()),
    start: Date.parse(`${date}T00:00:00.000+03:00`),
  };
}

function contentOf(value: unknown) {
  const content = record(value).content;
  return Array.isArray(content) ? content.map(record) : [];
}

function historiesOf(order: ApiRecord) {
  return Array.isArray(order.packageHistories) ? order.packageHistories.map(record) : [];
}

function shippingOf(order: ApiRecord) {
  const agreed = numberValue(order.agreedDeliveryDate);
  const shipped = historiesOf(order)
    .filter((history) => textValue(history.status).toLowerCase() === "shipped")
    .map((history) => numberValue(history.createdDate))
    .filter(Boolean)
    .sort((a, b) => a - b)[0] ?? 0;
  const delayed = agreed > 0 && (shipped > 0 ? shipped > agreed : Date.now() > agreed);
  return { delayed, fee: delayed ? 80 : 50 };
}

async function todayOrders() {
  const range = istanbulTodayRange();
  const orders: ApiRecord[] = [];
  for (let page = 0; page < 20; page += 1) {
    const response = await getShipmentPackages({
      endDate: range.end,
      orderByDirection: "ASC",
      orderByField: "CreatedDate",
      page,
      size: 200,
      startDate: range.start,
    });
    const content = contentOf(response);
    orders.push(...content);
    const totalPages = numberValue(record(response).totalPages);
    if (content.length < 200 || (totalPages > 0 && page + 1 >= totalPages)) break;
  }
  return { orders, range };
}

export async function buildTodaySalesReport() {
  const { orders, range } = await todayOrders();
  const activeOrders = orders.filter((order) => !excludedStatuses.has(textValue(order.status || order.shipmentPackageStatus).toLowerCase()));
  const productRows: string[] = [];
  let revenue = 0;
  let commission = 0;
  let shipping = 0;
  let quantity = 0;
  let missingCommission = 0;
  let includedPackages = 0;

  for (const order of activeOrders) {
    const shippingInfo = shippingOf(order);
    const lines = Array.isArray(order.lines) ? order.lines.map(record) : [];
    let packageShippingReported = false;
    for (const line of lines) {
      const lineStatus = textValue(line.orderLineItemStatusName || line.status).toLowerCase();
      if (excludedStatuses.has(lineStatus)) continue;
      const lineShipping = packageShippingReported ? 0 : shippingInfo.fee;
      if (!packageShippingReported) {
        shipping += shippingInfo.fee;
        includedPackages += 1;
      }
      packageShippingReported = true;
      const count = Math.max(1, numberValue(line.quantity));
      const unitPrice = numberValue(line.lineUnitPrice) || numberValue(line.price) || numberValue(line.amount) || numberValue(line.lineGrossAmount);
      const lineRevenue = unitPrice * count;
      const commissionRate = numberValue(line.commission ?? line.commissionRate);
      const lineCommission = lineRevenue * commissionRate / 100;
      revenue += lineRevenue;
      commission += lineCommission;
      quantity += count;
      if (!commissionRate) missingCommission += 1;
      const name = textValue(line.productName || line.title || line.name) || textValue(line.barcode) || "Ürün";
      productRows.push([
        `${productRows.length + 1}. ${name}`,
        `   Adet: ${count} | Ciro: ${money(lineRevenue)}`,
        `   Komisyon: ${commissionRate ? `%${commissionRate.toLocaleString("tr-TR")} = ${money(lineCommission)}` : "Bilgi gelmedi"}`,
        `   Kargo: ${lineShipping ? `${money(lineShipping)} (${shippingInfo.delayed ? "gecikmeli" : "zamanında"})` : "Aynı pakete dahil"}`,
      ].join("\n"));
    }
  }

  if (!productRows.length) return [`📊 Bugünkü satış raporu — ${range.label}\n\nBugün raporlanacak aktif satış bulunamadı.`];

  const net = revenue - commission - shipping;
  const summary = [
    `📊 Bugünkü satış raporu — ${range.label}`,
    "",
    `Sipariş: ${includedPackages} | Ürün adedi: ${quantity}`,
    `Toplam ciro: ${money(revenue)}`,
    `Toplam komisyon: -${money(commission)}`,
    `Toplam kargo: -${money(shipping)}`,
    `Komisyon ve kargo sonrası: ${money(net)}`,
    missingCommission ? `⚠️ ${missingCommission} ürün satırında komisyon oranı gelmedi; bu satırlar komisyon toplamına eklenmedi.` : "",
    "\nÜrün detayları:",
  ].filter(Boolean).join("\n");

  const messages: string[] = [];
  let current = summary;
  for (const row of productRows) {
    if (`${current}\n\n${row}`.length > 3900) {
      messages.push(current);
      current = `📦 Ürün detayları (devam)\n\n${row}`;
    } else current += `\n\n${row}`;
  }
  messages.push(current);
  return messages;
}
