import { redirect } from "next/navigation";

import {
  logoutAction,
  submitDraftAction,
  updateDraftAction,
} from "@/app/admin/actions";
import { CategoryAttributesPanel } from "@/components/category-attributes-panel";
import { isAdminAuthenticated } from "@/lib/auth";
import { getRuntimeConfigStatus } from "@/lib/config-status";
import type { ProductDraft } from "@/lib/db";
import { listDrafts } from "@/lib/db";
import { hasDatabaseUrl } from "@/lib/env";

import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

function statusText(status: ProductDraft["status"]) {
  switch (status) {
    case "submitted":
      return "Gönderildi";
    case "failed":
      return "Hata";
    case "needs_review":
      return "Kontrol gerekli";
    default:
      return "Taslak";
  }
}

function statusClass(status: ProductDraft["status"]) {
  switch (status) {
    case "submitted":
      return `${styles.status} ${styles.statusSubmitted}`;
    case "failed":
      return `${styles.status} ${styles.statusFailed}`;
    case "needs_review":
      return `${styles.status} ${styles.statusReview}`;
    default:
      return `${styles.status} ${styles.statusDraft}`;
  }
}

export default async function AdminPage() {
  if (!(await isAdminAuthenticated())) {
    redirect("/login");
  }

  const configStatus = getRuntimeConfigStatus();
  const queueEnabled = hasDatabaseUrl();
  let drafts: ProductDraft[] = [];
  let databaseError = "";

  if (queueEnabled) {
    try {
      drafts = await listDrafts();
    } catch (error) {
      databaseError =
        error instanceof Error ? error.message : "Veritabanı okunamadı.";
    }
  }

  const submittedCount = drafts.filter((draft) => draft.status === "submitted").length;
  const reviewCount = drafts.filter((draft) => draft.status !== "submitted").length;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Figyfun Telegram Bot</p>
          <h1>Trendyol ürün yönetimi</h1>
        </div>
        <form action={logoutAction}>
          <button type="submit">Çıkış</button>
        </form>
      </header>

      <section className={styles.metrics}>
        <div>
          <span>Son 100 kayıt</span>
          <strong>{drafts.length}</strong>
        </div>
        <div>
          <span>Kontrol kuyruğu</span>
          <strong>{reviewCount}</strong>
        </div>
        <div>
          <span>Trendyol kuyruğuna giden</span>
          <strong>{submittedCount}</strong>
        </div>
      </section>

      <section className={styles.configPanel}>
        <div className={styles.configLead}>
          <div>
            <p>Çalışma modu</p>
            <h2>
              {configStatus.mode === "queue"
                ? "Kalıcı admin kuyruğu"
                : "Hobby doğrudan gönderim"}
            </h2>
          </div>
          <strong
            className={
              configStatus.missingRequired.length === 0
                ? styles.configOk
                : styles.configMissing
            }
          >
            {configStatus.missingRequired.length === 0
              ? "Zorunlu env hazır"
              : `${configStatus.missingRequired.length} zorunlu env eksik`}
          </strong>
        </div>
        <p className={styles.configNote}>
          Trendyol ürün API auth için Seller Panel ekranındaki Satıcı ID, API Key ve API
          Secret kullanılır. Entegrasyon Referans Kodu destek içindir; Token bu
          Product Create V2 isteğine eklenmez.
        </p>
        <div className={styles.configGrid}>
          {configStatus.items.map((item) => (
            <div className={styles.configItem} key={item.key}>
              <span
                className={
                  item.configured ? styles.configOk : styles.configMissing
                }
              >
                {item.configured ? "Hazır" : item.required ? "Eksik" : "Opsiyonel"}
              </span>
              <strong>{item.label}</strong>
              <code>{item.key}</code>
              <p>{item.note}</p>
            </div>
          ))}
        </div>
      </section>

      {!queueEnabled ? (
        <section className={styles.modeBanner}>
          <strong>DATABASE_URL yok: admin kuyruğu saklanmıyor.</strong>
          <p>
            Telegram webhook görseli Vercel Blob içine koyup Trendyol servisine doğrudan
            gönderir. Trendyol hata döndürürse cevap Telegram mesajında görünür.
            Kalıcı düzeltme kuyruğu için ücretsiz bir Marketplace Postgres
            bağlantısı ekleyip DATABASE_URL env değerini bağla.
          </p>
        </section>
      ) : null}

      {databaseError ? (
        <section className={styles.banner}>
          <strong>Veritabanı hazır değil.</strong>
          <p>{databaseError}</p>
        </section>
      ) : null}

      <section className={styles.queue}>
        {drafts.map((draft) => (
          <article className={styles.draft} key={draft.id}>
            <div className={styles.preview}>
              {draft.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={draft.title} src={draft.imageUrl} />
              ) : (
                <div className={styles.emptyImage}>Görsel bekleniyor</div>
              )}
              <div className={styles.previewMeta}>
                <span className={statusClass(draft.status)}>
                  {statusText(draft.status)}
                </span>
                <p>Telegram kullanıcı: {draft.telegramUserId}</p>
                <p>{draft.createdAt.toLocaleString("tr-TR")}</p>
                {draft.batchRequestId ? (
                  <p>Batch: {draft.batchRequestId}</p>
                ) : null}
              </div>
            </div>

            <div className={styles.editor}>
              <form action={updateDraftAction.bind(null, draft.id)}>
                <div className={styles.fieldGrid}>
                  <label className={styles.wide}>
                    Ürün adı
                    <input defaultValue={draft.title} name="title" required />
                  </label>
                  <label>
                    Satış fiyatı
                    <input
                      defaultValue={draft.salePrice}
                      min="0.01"
                      name="salePrice"
                      required
                      step="0.01"
                      type="number"
                    />
                  </label>
                  <label>
                    Liste fiyatı
                    <input
                      defaultValue={draft.listPrice}
                      min="0.01"
                      name="listPrice"
                      required
                      step="0.01"
                      type="number"
                    />
                  </label>
                  <label>
                    Kategori ID
                    <input
                      defaultValue={draft.categoryId}
                      min="1"
                      name="categoryId"
                      required
                      type="number"
                    />
                  </label>
                  <label>
                    Stok
                    <input
                      defaultValue={draft.quantity}
                      min="0"
                      name="quantity"
                      required
                      type="number"
                    />
                  </label>
                  <label>
                    KDV
                    <input
                      defaultValue={draft.vatRate}
                      min="0"
                      name="vatRate"
                      required
                      type="number"
                    />
                  </label>
                  <label>
                    Desi
                    <input
                      defaultValue={draft.dimensionalWeight}
                      min="0.01"
                      name="dimensionalWeight"
                      required
                      step="0.01"
                      type="number"
                    />
                  </label>
                  <label>
                    Barkod
                    <input defaultValue={draft.barcode} name="barcode" required />
                  </label>
                  <label>
                    Stok kodu
                    <input defaultValue={draft.stockCode} name="stockCode" required />
                  </label>
                  <label>
                    Ana ürün kodu
                    <input
                      defaultValue={draft.productMainId}
                      name="productMainId"
                      required
                    />
                  </label>
                  <label className={styles.wide}>
                    Görsel URL
                    <input defaultValue={draft.imageUrl ?? ""} name="imageUrl" />
                  </label>
                  <label className={styles.wide}>
                    Açıklama
                    <textarea
                      defaultValue={draft.description}
                      name="description"
                      required
                      rows={5}
                    />
                  </label>
                  <label className={styles.wide}>
                    Trendyol attributes JSON
                    <textarea
                      defaultValue={JSON.stringify(draft.attributes, null, 2)}
                      name="attributes"
                      rows={7}
                    />
                  </label>
                </div>

                {draft.lastError ? (
                  <p className={styles.lastError}>{draft.lastError}</p>
                ) : null}

                <div className={styles.actions}>
                  <button type="submit">Kaydet</button>
                  <button
                    formAction={submitDraftAction.bind(null, draft.id)}
                    type="submit"
                  >
                    Trendyol’a gönder
                  </button>
                </div>
              </form>

              <CategoryAttributesPanel initialCategoryId={draft.categoryId} />
            </div>
          </article>
        ))}

        {queueEnabled && !databaseError && drafts.length === 0 ? (
          <section className={styles.emptyQueue}>
            Telegram’dan ilk fotoğraflı ürün mesajı geldiğinde taslak burada
            görünecek.
          </section>
        ) : null}
      </section>
    </main>
  );
}
