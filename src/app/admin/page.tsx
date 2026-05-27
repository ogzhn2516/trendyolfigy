import { redirect } from "next/navigation";

import {
  logoutAction,
  runAutoAcceptAction,
  submitDraftAction,
  updateAutoAcceptAction,
  updateDraftAction,
} from "@/app/admin/actions";
import { CategoryAttributesPanel } from "@/components/category-attributes-panel";
import { isAdminAuthenticated } from "@/lib/auth";
import { getRuntimeConfigStatus } from "@/lib/config-status";
import type { ProductDraft } from "@/lib/db";
import { listDrafts } from "@/lib/db";
import { hasDatabaseUrl } from "@/lib/env";
import {
  dashboardOrderRows,
  dashboardReturnRows,
  getOperationsDashboardData,
} from "@/lib/trendyol-dashboard";

import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

const visibleOrderStatuses = [
  "Created",
  "Picking",
  "Invoiced",
  "Shipped",
  "Delivered",
  "Cancelled",
  "Returned",
];

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

function formatMoney(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    currency: "TRY",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatPercent(value: number) {
  return `${value.toLocaleString("tr-TR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  })}%`;
}

function formatNumber(value: number) {
  return value.toLocaleString("tr-TR");
}

function formatDateTime(value: Date | null | undefined) {
  if (!value || Number.isNaN(value.getTime())) {
    return "Yok";
  }

  return value.toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default async function AdminPage() {
  if (!(await isAdminAuthenticated())) {
    redirect("/login");
  }

  const configStatus = getRuntimeConfigStatus();
  const queueEnabled = hasDatabaseUrl();
  let drafts: ProductDraft[] = [];
  let databaseError = "";
  let dashboard:
    | Awaited<ReturnType<typeof getOperationsDashboardData>>
    | null = null;
  let dashboardError = "";

  if (queueEnabled) {
    try {
      drafts = await listDrafts();
    } catch (error) {
      databaseError =
        error instanceof Error ? error.message : "Veritabanı okunamadı.";
    }
  }

  try {
    dashboard = await getOperationsDashboardData();
  } catch (error) {
    dashboardError =
      error instanceof Error ? error.message : "Operasyon paneli okunamadı.";
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
          Trendyol ürün API auth için Seller Panel ekranındaki Satıcı ID, API Key
          ve API Secret kullanılır. Entegrasyon Referans Kodu destek içindir;
          Token bu Product Create V2 isteğine eklenmez.
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
            Telegram webhook görseli Vercel Blob içine koyup Trendyol servisine
            doğrudan gönderir. Kalıcı operasyon paneli, otomatik kabul ayarı ve
            düzeltme kuyruğu için Postgres bağlantısı gerekir.
          </p>
        </section>
      ) : null}

      {databaseError ? (
        <section className={styles.banner}>
          <strong>Veritabanı hazır değil.</strong>
          <p>{databaseError}</p>
        </section>
      ) : null}

      {dashboard ? (
        <section className={styles.operations}>
          <div className={styles.operationsLead}>
            <div>
              <p>Canlı operasyon paneli</p>
              <h2>Sipariş, iade, ödeme ve performans</h2>
              <span>
                Siparişler son 14 gün, iadeler son 30 gün, finans son 14 gün.
              </span>
            </div>
            <form action={updateAutoAcceptAction} className={styles.autoAccept}>
              <label>
                <input
                  defaultChecked={dashboard.autoAccept.enabled}
                  disabled={!dashboard.autoAcceptReady}
                  name="autoAcceptOrders"
                  type="checkbox"
                />
                <span>
                  <strong>Otomatik sipariş kabul</strong>
                  Created siparişleri Picking statüsüne alır.
                </span>
              </label>
              <div className={styles.autoAcceptActions}>
                <button disabled={!dashboard.autoAcceptReady} type="submit">
                  Kaydet
                </button>
                <button
                  disabled={!dashboard.autoAcceptReady}
                  formAction={runAutoAcceptAction}
                  type="submit"
                >
                  Şimdi kabul et
                </button>
              </div>
              {!dashboard.autoAcceptReady ? (
                <p>Otomatik kabul tikini saklamak için DATABASE_URL gerekir.</p>
              ) : dashboard.autoAccept.lastResult ? (
                <p>
                  Son çalışma:{" "}
                  {formatDateTime(new Date(dashboard.autoAccept.lastResult.ranAt))}.
                  {` ${dashboard.autoAccept.lastResult.message}`}
                </p>
              ) : (
                <p>Henüz çalışmadı. Vercel cron 5 dakikada bir kontrol eder.</p>
              )}
            </form>
          </div>

          <div className={styles.opsMetrics}>
            <div>
              <span>Toplam sipariş</span>
              <strong>{formatNumber(dashboard.orders.totalElements)}</strong>
              <p>{formatNumber(dashboard.orders.totalItems)} ürün satırı</p>
            </div>
            <div>
              <span>Kabul bekleyen</span>
              <strong>{formatNumber(dashboard.orders.createdCount)}</strong>
              <p>Created statüsü</p>
            </div>
            <div>
              <span>Brüt sipariş hacmi</span>
              <strong>{formatMoney(dashboard.orders.grossRevenue)}</strong>
              <p>Ortalama {formatMoney(dashboard.orders.averagePackageValue)}</p>
            </div>
            <div>
              <span>İade oranı</span>
              <strong>{formatPercent(dashboard.performance.returnRate)}</strong>
              <p>{formatNumber(dashboard.returns.totalElements)} iade kaydı</p>
            </div>
            <div>
              <span>Tahmini cari net</span>
              <strong>{formatMoney(dashboard.finance.netSettlement)}</strong>
              <p>{formatNumber(dashboard.finance.recordCount)} finans kaydı</p>
            </div>
            <div>
              <span>Ödeme emirleri</span>
              <strong>{formatMoney(dashboard.finance.paymentTotal)}</strong>
              <p>{formatNumber(dashboard.finance.paymentCount)} kayıt</p>
            </div>
          </div>

          {dashboard.errors.length > 0 ? (
            <div className={styles.opsErrors}>
              {dashboard.errors.map((error) => (
                <p key={error.area}>
                  <strong>{error.area}:</strong> {error.message}
                </p>
              ))}
            </div>
          ) : null}

          <div className={styles.opsGrid}>
            <section className={styles.opsSection}>
              <div className={styles.sectionTitle}>
                <h3>Sipariş akışı</h3>
                <span>Statü dağılımı</span>
              </div>
              <div className={styles.statusGrid}>
                {visibleOrderStatuses.map((status) => (
                  <div key={status}>
                    <span>{status}</span>
                    <strong>{dashboard.orders.statusCounts[status] ?? 0}</strong>
                  </div>
                ))}
              </div>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Sipariş</th>
                      <th>Müşteri</th>
                      <th>Statü</th>
                      <th>Tutar</th>
                      <th>Tarih</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardOrderRows(dashboard.orders.latest).length > 0 ? (
                      dashboardOrderRows(dashboard.orders.latest).map((order) => (
                        <tr key={`${order.id}-${order.orderNumber}`}>
                          <td>{order.orderNumber || order.id}</td>
                          <td>{order.customer || "Müşteri"}</td>
                          <td>{order.status}</td>
                          <td>{formatMoney(order.total)}</td>
                          <td>{formatDateTime(order.date)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5}>Sipariş kaydı yok.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={styles.opsSection}>
              <div className={styles.sectionTitle}>
                <h3>İade ve aksiyonlar</h3>
                <span>
                  {formatNumber(dashboard.returns.waitingClaims)} aksiyon bekliyor
                </span>
              </div>
              <div className={styles.statusGrid}>
                {Object.entries(dashboard.returns.statusCounts).length > 0 ? (
                  Object.entries(dashboard.returns.statusCounts).map(
                    ([status, count]) => (
                      <div key={status}>
                        <span>{status}</span>
                        <strong>{count}</strong>
                      </div>
                    ),
                  )
                ) : (
                  <div>
                    <span>İade</span>
                    <strong>0</strong>
                  </div>
                )}
              </div>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>İade</th>
                      <th>Sipariş</th>
                      <th>Statü</th>
                      <th>Tarih</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardReturnRows(dashboard.returns.latest).length > 0 ? (
                      dashboardReturnRows(dashboard.returns.latest).map((claim) => (
                        <tr key={claim.claimId || claim.orderNumber}>
                          <td>{claim.claimId || "İade"}</td>
                          <td>{claim.orderNumber}</td>
                          <td>{claim.status}</td>
                          <td>{formatDateTime(claim.date)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4}>İade kaydı yok.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className={styles.insightGrid}>
            <section className={styles.opsSection}>
              <div className={styles.sectionTitle}>
                <h3>Performans</h3>
                <span>Operasyon sağlığı</span>
              </div>
              <dl className={styles.performanceList}>
                <div>
                  <dt>Teslim edilen</dt>
                  <dd>{formatNumber(dashboard.orders.deliveredCount)}</dd>
                </div>
                <div>
                  <dt>Kargoda</dt>
                  <dd>{formatNumber(dashboard.performance.shippedCount)}</dd>
                </div>
                <div>
                  <dt>İptal oranı</dt>
                  <dd>{formatPercent(dashboard.performance.cancellationRate)}</dd>
                </div>
                <div>
                  <dt>Ortalama paket</dt>
                  <dd>{formatMoney(dashboard.orders.averagePackageValue)}</dd>
                </div>
              </dl>
            </section>

            <section className={styles.opsSection}>
              <div className={styles.sectionTitle}>
                <h3>Tavsiyeler</h3>
                <span>Otomatik kontrol</span>
              </div>
              <ul className={styles.recommendations}>
                {dashboard.recommendations.map((recommendation) => (
                  <li key={recommendation}>{recommendation}</li>
                ))}
              </ul>
            </section>
          </div>
        </section>
      ) : (
        <section className={styles.banner}>
          <strong>Operasyon paneli hazır değil.</strong>
          <p>{dashboardError || "Trendyol verileri şu an okunamadı."}</p>
        </section>
      )}

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
                {draft.batchRequestId ? <p>Batch: {draft.batchRequestId}</p> : null}
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
