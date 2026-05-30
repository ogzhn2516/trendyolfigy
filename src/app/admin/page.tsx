import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  logoutAction,
  runBulkPriceChangeAction,
  runAutoAcceptAction,
  runRepricerAction,
  submitDraftAction,
  updateAutoAcceptAction,
  updateCommerceSettingsAction,
  updateDraftAction,
} from "@/app/admin/actions";
import { CategoryAttributesPanel } from "@/components/category-attributes-panel";
import { LiveProductMetrics } from "@/components/live-product-metrics";
import { isAdminAuthenticated } from "@/lib/auth";
import { getRuntimeConfigStatus } from "@/lib/config-status";
import type { ProductDraft } from "@/lib/db";
import { listDrafts } from "@/lib/db";
import { hasDatabaseUrl } from "@/lib/env";
import { getCommerceDashboardData } from "@/lib/trendyol-commerce-intelligence";
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

type AdminPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function searchParamValue(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];

  return Array.isArray(value) ? value[0] : value;
}

function commerceNoticeOf(params: Record<string, string | string[] | undefined>) {
  const notice = searchParamValue(params, "notice");
  const submitted = Number(searchParamValue(params, "submitted") ?? 0);
  const checked = Number(searchParamValue(params, "checked") ?? 0);
  const message = searchParamValue(params, "message");

  switch (notice) {
    case "settings_saved":
      return {
        message: "Kâr, komisyon, stok ve repricer ayarları veritabanına yazıldı.",
        tone: "success",
        title: "Ayarlar kaydedildi",
      };
    case "settings_invalid":
      return {
        message: "Sayı alanlarını kontrol et. Virgüllü değerler desteklenir.",
        tone: "error",
        title: "Ayarlar kaydedilemedi",
      };
    case "settings_range_error":
      return {
        message: "Maksimum fiyat minimum fiyattan düşük olamaz.",
        tone: "error",
        title: "Fiyat aralığı hatalı",
      };
    case "database_missing":
      return {
        message: "Bu ayarı saklamak için DATABASE_URL gerekir.",
        tone: "error",
        title: "Veritabanı bağlı değil",
      };
    case "repricer_submitted":
      return {
        message: `${submitted.toLocaleString("tr-TR")} ürün için Trendyol fiyat güncelleme kuyruğuna gönderildi.`,
        tone: "success",
        title: "Repricer çalıştı",
      };
    case "repricer_empty":
      return {
        message: `${checked.toLocaleString("tr-TR")} ürün kontrol edildi. Şu anda fiyat önerisi olmadığı için Trendyol'a güncelleme gönderilmedi.`,
        tone: "warning",
        title: "Fiyat değişikliği yok",
      };
    case "repricer_error":
      return {
        message: message || "Repricer çalıştırılamadı.",
        tone: "error",
        title: "Repricer hatası",
      };
    default:
      return null;
  }
}

function commerceNoticeCookieParams(value: string | undefined) {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).map(([key, entry]) => [key, String(entry)]),
    );
  } catch {
    return {};
  }
}

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

function formatDecimal(value: number) {
  return value.toLocaleString("tr-TR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
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

function formatDays(value: number | null) {
  if (value === null) {
    return "Satış verisi yok";
  }

  if (value <= 0) {
    return "Bugün biter";
  }

  return `${formatNumber(value)} gün`;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  if (!(await isAdminAuthenticated())) {
    redirect("/login");
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const cookieStore = await cookies();
  const cookieNoticeParams = commerceNoticeCookieParams(
    cookieStore.get("figyfun_commerce_notice")?.value,
  );
  const commerceNotice = commerceNoticeOf({
    ...cookieNoticeParams,
    ...resolvedSearchParams,
  });
  const configStatus = getRuntimeConfigStatus();
  const queueEnabled = hasDatabaseUrl();
  let drafts: ProductDraft[] = [];
  let databaseError = "";
  let dashboard:
    | Awaited<ReturnType<typeof getOperationsDashboardData>>
    | null = null;
  let dashboardError = "";
  let commerce:
    | Awaited<ReturnType<typeof getCommerceDashboardData>>
    | null = null;
  let commerceError = "";

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

  try {
    commerce = await getCommerceDashboardData();
  } catch (error) {
    commerceError =
      error instanceof Error ? error.message : "Ticaret zekası paneli okunamadı.";
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Figyfun Commerce Center</p>
          <h1>Trendyol operasyon dashboardu</h1>
          <span>Ürün, sipariş, BuyBox, stok ve kâr yönetimi tek panelde.</span>
        </div>
        <form action={logoutAction}>
          <button type="submit">Çıkış</button>
        </form>
      </header>

      <nav className={styles.dashboardNav} aria-label="Admin bölümleri">
        <a href="#dashboard">Dashboard</a>
        <a href="#commerce">Ticaret zekası</a>
        <a href="#operations">Operasyon</a>
        <a href="#system">Sistem</a>
        <a href="#drafts">Taslaklar</a>
      </nav>

      <section className={styles.commandCenter} id="dashboard">
        <div className={styles.sectionHeader}>
          <div>
            <p>Genel bakış</p>
            <h2>Canlı mağaza durumu</h2>
          </div>
          <span>Ürün sayaçları 30 saniyede bir yenilenir</span>
        </div>

        <LiveProductMetrics />

        <div className={styles.dashboardStrip}>
          <div>
            <span>BuyBox alarmı</span>
            <strong>{formatNumber(commerce?.buyboxLost ?? 0)}</strong>
            <p>Kaybedilen pozisyon</p>
          </div>
          <div>
            <span>Fiyat aksiyonu</span>
            <strong>{formatNumber(commerce?.repricerReady ?? 0)}</strong>
            <p>Repricer önerisi</p>
          </div>
          <div>
            <span>Stok uyarısı</span>
            <strong>{formatNumber(commerce?.stockWarnings ?? 0)}</strong>
            <p>Yakında bitebilir</p>
          </div>
          <div>
            <span>Sipariş aksiyonu</span>
            <strong>{formatNumber(dashboard?.orders.createdCount ?? 0)}</strong>
            <p>Kabul bekleyen</p>
          </div>
        </div>
      </section>

      {commerce ? (
        <section className={styles.commercePanel} id="commerce">
          <div className={styles.sectionHeader}>
            <div>
              <p>Ticaret zekası</p>
              <h2>BuyBox, repricer, kâr, stok ve listing kalite</h2>
            </div>
            <span>Resmi API verileriyle fiyat ve stok karar ekranı</span>
          </div>
          {commerceNotice ? (
            <div
              className={`${styles.actionNotice} ${
                commerceNotice.tone === "success"
                  ? styles.actionNoticeSuccess
                  : commerceNotice.tone === "warning"
                    ? styles.actionNoticeWarning
                    : styles.actionNoticeError
              }`}
            >
              <strong>{commerceNotice.title}</strong>
              <p>{commerceNotice.message}</p>
            </div>
          ) : null}
          <div className={styles.commerceLead}>
            <div>
              <p>Akıllı kontrol</p>
              <h3>Ürünlerini kâr tabanını koruyarak yönet</h3>
              <span>
                İlk 100 onaylı satıştaki ürün izlenir; BuyBox resmi endpoint
                limiti nedeniyle ilk 10 barkod canlı sorgulanır.
              </span>
            </div>
            <form action={runRepricerAction} className={styles.repricerCard}>
              <strong>Otomatik fiyatlandırma</strong>
              <p>
                Rakip BuyBox fiyatının {formatDecimal(commerce.settings.undercutAmount)} TL altını hedefler,
                min kâr tabanının altına inmez.
              </p>
              <button type="submit">Repricer uygula</button>
            </form>
          </div>

          <div className={styles.opsMetrics}>
            <div>
              <span>İzlenen ürün</span>
              <strong>{formatNumber(commerce.trackedProducts)}</strong>
              <p>Onaylı ve satışta</p>
            </div>
            <div>
              <span>BuyBox kaybı</span>
              <strong>{formatNumber(commerce.buyboxLost)}</strong>
              <p>İlk 10 barkod canlı</p>
            </div>
            <div>
              <span>Repricer hazır</span>
              <strong>{formatNumber(commerce.repricerReady)}</strong>
              <p>Fiyat önerisi var</p>
            </div>
            <div>
              <span>Stok riski</span>
              <strong>{formatNumber(commerce.stockWarnings)}</strong>
              <p>Yakında bitebilir</p>
            </div>
            <div>
              <span>14g tahmini kâr</span>
              <strong>{formatMoney(commerce.totalProfit)}</strong>
              <p>Maliyet ayarına göre</p>
            </div>
            <div>
              <span>Kalite skoru</span>
              <strong>{formatDecimal(commerce.averageQuality)}</strong>
              <p>Başlık, açıklama, görsel</p>
            </div>
          </div>

          {commerce.errors.length > 0 ? (
            <div className={styles.opsErrors}>
              {commerce.errors.map((error) => (
                <p key={error.area}>
                  <strong>{error.area}:</strong> {error.message}
                </p>
              ))}
            </div>
          ) : null}

          <div className={styles.commerceGrid}>
            <section className={styles.opsSection}>
              <div className={styles.sectionTitle}>
                <h3>Kâr ve komisyon ayarı</h3>
                <span>
                  {commerce.databaseBacked ? "Kalıcı ayar" : "DATABASE_URL yok"}
                </span>
              </div>
              <form
                action={updateCommerceSettingsAction}
                className={styles.settingsForm}
              >
                <label>
                  Komisyon %
                  <input
                    defaultValue={commerce.settings.defaultCommissionRate}
                    min="0"
                    max="60"
                    name="defaultCommissionRate"
                    step="0.1"
                    type="number"
                  />
                </label>
                <label>
                  Hedef kâr %
                  <input
                    defaultValue={commerce.settings.targetMarginRate}
                    min="0"
                    max="80"
                    name="targetMarginRate"
                    step="0.1"
                    type="number"
                  />
                </label>
                <label>
                  Ürün maliyeti
                  <input
                    defaultValue={commerce.settings.productCost}
                    min="0"
                    name="productCost"
                    step="0.01"
                    type="number"
                  />
                </label>
                <label>
                  Kargo maliyeti
                  <input
                    defaultValue={commerce.settings.shippingCost}
                    min="0"
                    name="shippingCost"
                    step="0.01"
                    type="number"
                  />
                </label>
                <label>
                  Sabit gider
                  <input
                    defaultValue={commerce.settings.fixedCost}
                    min="0"
                    name="fixedCost"
                    step="0.01"
                    type="number"
                  />
                </label>
                <label>
                  Min fiyat
                  <input
                    defaultValue={commerce.settings.minPrice}
                    min="0.01"
                    name="minPrice"
                    step="0.01"
                    type="number"
                  />
                </label>
                <label>
                  Max fiyat
                  <input
                    defaultValue={commerce.settings.maxPrice}
                    min="0.01"
                    name="maxPrice"
                    step="0.01"
                    type="number"
                  />
                </label>
                <label>
                  Rakibin altına
                  <input
                    defaultValue={commerce.settings.undercutAmount}
                    min="0.01"
                    name="undercutAmount"
                    step="0.01"
                    type="number"
                  />
                </label>
                <label>
                  Repricer dakika
                  <input
                    defaultValue={commerce.settings.repricerIntervalMinutes}
                    min="15"
                    max="120"
                    name="repricerIntervalMinutes"
                    step="15"
                    type="number"
                  />
                </label>
                <label className={styles.checkLine}>
                  <input
                    defaultChecked={commerce.settings.repricerEnabled}
                    name="repricerEnabled"
                    type="checkbox"
                  />
                  Otomatik repricer açık
                </label>
                <label>
                  Stok uyarı günü
                  <input
                    defaultValue={commerce.settings.stockWarningDays}
                    min="1"
                    max="90"
                    name="stockWarningDays"
                    type="number"
                  />
                </label>
                <button disabled={!commerce.databaseBacked} type="submit">
                  Ayarları kaydet
                </button>
                {!commerce.databaseBacked ? (
                  <p>Bu ayarları saklamak için DATABASE_URL gerekir.</p>
                ) : null}
              </form>
            </section>

            <section className={styles.opsSection}>
              <div className={styles.sectionTitle}>
                <h3>Toplu fiyat değişikliği</h3>
                <span>Min/Max ve kâr tabanı korunur</span>
              </div>
              <form action={runBulkPriceChangeAction} className={styles.bulkForm}>
                <label>
                  Yüzde değişim
                  <input
                    defaultValue={0}
                    max="300"
                    min="-80"
                    name="percent"
                    step="0.1"
                    type="number"
                  />
                </label>
                <button type="submit">Toplu fiyat uygula</button>
                <p>
                  Örnek: -10 yazarsan fiyatları %10 düşürür, 15 yazarsan %15
                  artırır. Trendyol işlem sonucunu batch kuyruğuna alır.
                </p>
              </form>

              <div className={styles.ruleList}>
                <div>
                  <span>BuyBox kuralı</span>
                  <strong>Rakipten {formatDecimal(commerce.settings.undercutAmount)} TL düşük</strong>
                </div>
                <div>
                  <span>Kâr koruması</span>
                  <strong>{formatPercent(commerce.settings.targetMarginRate)} hedef marj</strong>
                </div>
                <div>
                  <span>Güncelleme planı</span>
                  <strong>
                    {commerce.settings.repricerEnabled ? "Açık" : "Kapalı"} ·{" "}
                    {formatNumber(commerce.settings.repricerIntervalMinutes)} dk
                  </strong>
                </div>
              </div>
            </section>
          </div>

          <section className={styles.opsSection}>
            <div className={styles.sectionTitle}>
              <h3>Ürün karar ekranı</h3>
              <span>BuyBox, stok, kâr ve SEO</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.commerceTable}>
                <thead>
                  <tr>
                    <th>Ürün</th>
                    <th>BuyBox</th>
                    <th>Fiyat</th>
                    <th>Öneri</th>
                    <th>Kâr</th>
                    <th>Stok</th>
                    <th>Kalite</th>
                  </tr>
                </thead>
                <tbody>
                  {commerce.products.length > 0 ? (
                    commerce.products.map((product) => (
                      <tr key={`${product.barcode}-${product.stockCode}`}>
                        <td>
                          <strong>{product.title || product.barcode}</strong>
                          <span>{product.category}</span>
                          <code>{product.barcode}</code>
                        </td>
                        <td>
                          {product.buyboxOrder ? (
                            <>
                              <strong>#{product.buyboxOrder}</strong>
                              <span>
                                BuyBox {formatMoney(product.buyboxPrice ?? 0)}
                              </span>
                              {product.secondBuyboxPrice ? (
                                <span>2. fiyat {formatMoney(product.secondBuyboxPrice)}</span>
                              ) : null}
                            </>
                          ) : (
                            <span>Canlı veri yok</span>
                          )}
                        </td>
                        <td>
                          <strong>{formatMoney(product.salePrice)}</strong>
                          <span>Liste {formatMoney(product.listPrice)}</span>
                          <span>Komisyon {formatPercent(product.commissionRate)}</span>
                        </td>
                        <td>
                          {product.recommendedPrice ? (
                            <>
                              <strong>{formatMoney(product.recommendedPrice)}</strong>
                              <span>Min {formatMoney(product.minPrice)}</span>
                            </>
                          ) : (
                            <span>Fiyat korunur</span>
                          )}
                        </td>
                        <td>
                          <strong>{formatMoney(product.currentProfit)}</strong>
                          <span>Marj {formatPercent(product.profitMargin)}</span>
                        </td>
                        <td>
                          <strong>{formatNumber(product.quantity)}</strong>
                          <span>{formatDays(product.daysUntilStockout)}</span>
                          <span>{product.salesLast14Days} satış / 14g</span>
                        </td>
                        <td>
                          <strong>{formatDecimal(product.qualityScore)}</strong>
                          {product.qualityIssues.length > 0 ? (
                            <span>{product.qualityIssues[0]}</span>
                          ) : (
                            <span>İyi görünüyor</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7}>Satışta onaylı ürün bulunamadı.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      ) : (
        <section className={styles.banner}>
          <strong>Ticaret zekası paneli hazır değil.</strong>
          <p>{commerceError || "Trendyol ürün ve BuyBox verileri okunamadı."}</p>
        </section>
      )}

      <section className={styles.configPanel} id="system">
        <div className={styles.sectionHeader}>
          <div>
            <p>Sistem</p>
            <h2>Bağlantı ve ortam durumu</h2>
          </div>
          <span>Eksik env varsa burada görünür</span>
        </div>
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
        <details
          className={styles.configDetails}
          open={configStatus.missingRequired.length > 0}
        >
          <summary>Env ve entegrasyon detaylarını göster</summary>
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
        </details>
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
        <section className={styles.operations} id="operations">
          <div className={styles.sectionHeader}>
            <div>
              <p>Operasyon</p>
              <h2>Sipariş, iade, ödeme ve performans</h2>
            </div>
            <span>Günlük iş akışını ayrı kartlarda takip et</span>
          </div>
          <div className={styles.operationsLead}>
            <div>
              <p>Canlı operasyon</p>
              <h3>Sipariş kabul ve takip akışı</h3>
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
                  formAction={runAutoAcceptAction}
                  type="submit"
                >
                  Şimdi kabul et
                </button>
              </div>
              {!dashboard.autoAcceptReady ? (
                <p>
                  Kalıcı tik için DATABASE_URL gerekir. Şimdi kabul et düğmesi
                  yine çalışır.
                </p>
              ) : dashboard.autoAccept.lastResult ? (
                <p>
                  Son çalışma:{" "}
                  {formatDateTime(new Date(dashboard.autoAccept.lastResult.ranAt))}.
                  {` ${dashboard.autoAccept.lastResult.message}`}
                </p>
              ) : (
                <p>Henüz çalışmadı. Vercel Hobby cron günde bir kez kontrol eder.</p>
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

      <section className={styles.queue} id="drafts">
        <div className={styles.sectionHeader}>
          <div>
            <p>Ürün taslakları</p>
            <h2>Telegramdan gelen ürün kuyruğu</h2>
          </div>
          <span>{formatNumber(drafts.length)} taslak</span>
        </div>
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
