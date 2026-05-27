"use client";

import { useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import type { TrendyolProductMetrics } from "@/lib/trendyol-product-metrics";

type MetricsState = TrendyolProductMetrics & {
  loading: boolean;
};

const emptyMetrics: MetricsState = {
  approvedProducts: 0,
  error: null,
  loading: true,
  queuedProducts: 0,
  totalProducts: 0,
  updatedAt: new Date(0).toISOString(),
};

function formatNumber(value: number) {
  return value.toLocaleString("tr-TR");
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Bekleniyor";
  }

  return date.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function LiveProductMetrics() {
  const [metrics, setMetrics] = useState<MetricsState>(emptyMetrics);

  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      try {
        const response = await fetch("/api/admin/trendyol-product-metrics", {
          cache: "no-store",
        });
        const json = (await response.json()) as Partial<TrendyolProductMetrics> & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(json.error || "Trendyol ürün sayaçları alınamadı.");
        }

        if (!cancelled) {
          setMetrics({
            approvedProducts: Number(json.approvedProducts ?? 0),
            error: json.error ?? null,
            loading: false,
            queuedProducts: Number(json.queuedProducts ?? 0),
            totalProducts: Number(json.totalProducts ?? 0),
            updatedAt: json.updatedAt ?? new Date().toISOString(),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setMetrics((current) => ({
            ...current,
            error:
              error instanceof Error
                ? error.message
                : "Trendyol ürün sayaçları alınamadı.",
            loading: false,
            updatedAt: new Date().toISOString(),
          }));
        }
      }
    }

    loadMetrics();
    const timer = window.setInterval(loadMetrics, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const updatedText = metrics.loading
    ? "Canlı sayaç yükleniyor"
    : `Son güncelleme ${formatUpdatedAt(metrics.updatedAt)}`;

  return (
    <section className={styles.metrics}>
      <div>
        <span>Trendyol ürünleri</span>
        <strong>{metrics.loading ? "..." : formatNumber(metrics.totalProducts)}</strong>
        <p>{updatedText}</p>
      </div>
      <div>
        <span>Kuyrukta / onay bekleyen</span>
        <strong>{metrics.loading ? "..." : formatNumber(metrics.queuedProducts)}</strong>
        <p>30 saniyede bir yenilenir</p>
      </div>
      <div>
        <span>Onaylanan ürün</span>
        <strong>{metrics.loading ? "..." : formatNumber(metrics.approvedProducts)}</strong>
        <p>{metrics.error ? "Sayaçta hata var" : "Trendyol onaylı ürün listesi"}</p>
      </div>
      {metrics.error ? (
        <p className={styles.metricError}>{metrics.error}</p>
      ) : null}
    </section>
  );
}
