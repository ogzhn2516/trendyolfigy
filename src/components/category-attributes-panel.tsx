"use client";

import { useState } from "react";

import styles from "@/app/admin/admin.module.css";

type CategoryAttributesPanelProps = {
  initialCategoryId: number;
};

export function CategoryAttributesPanel({
  initialCategoryId,
}: CategoryAttributesPanelProps) {
  const [categoryId, setCategoryId] = useState(String(initialCategoryId));
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadAttributes() {
    setError("");
    setLoading(true);

    try {
      const response = await fetch(
        `/api/trendyol/category-attributes?categoryId=${encodeURIComponent(categoryId)}`,
      );
      const json = (await response.json()) as unknown;

      if (!response.ok) {
        throw new Error(
          typeof json === "object" &&
            json &&
            "error" in json &&
            typeof json.error === "string"
            ? json.error
            : "Kategori özellikleri alınamadı.",
        );
      }

      setData(json);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Kategori özellikleri alınamadı.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className={styles.inspector}>
      <summary>Kategori özelliklerini sorgula</summary>
      <div className={styles.inspectorTools}>
        <input
          aria-label="Kategori ID"
          inputMode="numeric"
          onChange={(event) => setCategoryId(event.target.value)}
          value={categoryId}
        />
        <button onClick={loadAttributes} type="button">
          {loading ? "Alınıyor" : "Getir"}
        </button>
      </div>
      {error ? <p className={styles.inlineError}>{error}</p> : null}
      {data ? <pre>{JSON.stringify(data, null, 2)}</pre> : null}
    </details>
  );
}
