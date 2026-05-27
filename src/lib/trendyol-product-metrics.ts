import "server-only";

import {
  getApprovedProducts,
  getTrendyolErrorSummary,
  getUnapprovedProducts,
} from "@/lib/trendyol";

function totalElementsOf(response: unknown) {
  if (!response || typeof response !== "object") {
    return 0;
  }

  const total = Reflect.get(response, "totalElements");

  return typeof total === "number" ? total : 0;
}

export type TrendyolProductMetrics = {
  approvedProducts: number;
  error: string | null;
  queuedProducts: number;
  totalProducts: number;
  updatedAt: string;
};

export async function getTrendyolProductMetrics(): Promise<TrendyolProductMetrics> {
  const updatedAt = new Date().toISOString();
  const [approvedResult, unapprovedResult] = await Promise.allSettled([
    getApprovedProducts({ page: 0, size: 1 }),
    getUnapprovedProducts({ page: 0, size: 1 }),
  ]);
  const approvedProducts =
    approvedResult.status === "fulfilled" ? totalElementsOf(approvedResult.value) : 0;
  const queuedProducts =
    unapprovedResult.status === "fulfilled"
      ? totalElementsOf(unapprovedResult.value)
      : 0;
  const errors = [
    approvedResult.status === "rejected"
      ? getTrendyolErrorSummary(approvedResult.reason)
      : "",
    unapprovedResult.status === "rejected"
      ? getTrendyolErrorSummary(unapprovedResult.reason)
      : "",
  ].filter(Boolean);

  return {
    approvedProducts,
    error: errors.length > 0 ? errors.join(" ") : null,
    queuedProducts,
    totalProducts: approvedProducts + queuedProducts,
    updatedAt,
  };
}
