import "server-only";

type ConfigItem = {
  configured: boolean;
  key: string;
  label: string;
  note: string;
  required: boolean;
};

function hasValue(key: string) {
  return Boolean(process.env[key]?.trim());
}

export function getRuntimeConfigStatus() {
  const items: ConfigItem[] = [
    {
      configured: hasValue("ADMIN_USERNAME"),
      key: "ADMIN_USERNAME",
      label: "Admin kullanıcı adı",
      note: "Admin panel girişi.",
      required: true,
    },
    {
      configured: hasValue("ADMIN_PASSWORD"),
      key: "ADMIN_PASSWORD",
      label: "Admin şifre",
      note: "Kaynak koda yazılmaz; Vercel env olarak eklenir.",
      required: true,
    },
    {
      configured: (process.env.ADMIN_SESSION_SECRET?.trim().length ?? 0) >= 32,
      key: "ADMIN_SESSION_SECRET",
      label: "Admin oturum secret",
      note: "En az 32 karakter.",
      required: true,
    },
    {
      configured: hasValue("TELEGRAM_BOT_TOKEN"),
      key: "TELEGRAM_BOT_TOKEN",
      label: "Telegram Bot Token",
      note: "Telegram webhook cevapları ve görsel indirme.",
      required: true,
    },
    {
      configured: hasValue("TELEGRAM_ALLOWED_USER_IDS"),
      key: "TELEGRAM_ALLOWED_USER_IDS",
      label: "Telegram izinli kullanıcı ID",
      note: "Virgülle ayrılmış Telegram user ID listesi.",
      required: true,
    },
    {
      configured: hasValue("BLOB_READ_WRITE_TOKEN"),
      key: "BLOB_READ_WRITE_TOKEN",
      label: "Vercel Blob token",
      note: "Trendyol için kalıcı ürün görsel URL'si üretir.",
      required: true,
    },
    {
      configured: hasValue("DATABASE_URL"),
      key: "DATABASE_URL",
      label: "Postgres bağlantısı",
      note: "Opsiyonel. Yoksa doğrudan gönderim modu çalışır; admin kuyruğu saklanmaz.",
      required: false,
    },
    {
      configured:
        hasValue("TRENDYOL_SELLER_ID") || hasValue("TRENDYOL_SUPPLIER_ID"),
      key: "TRENDYOL_SELLER_ID",
      label: "Satıcı ID (Cari ID)",
      note: "Seller Panel ekranındaki Satıcı ID. Eski TRENDYOL_SUPPLIER_ID de desteklenir.",
      required: true,
    },
    {
      configured: hasValue("TRENDYOL_API_KEY"),
      key: "TRENDYOL_API_KEY",
      label: "Trendyol API Key",
      note: "Product Create V2 Basic Auth kullanıcı adı.",
      required: true,
    },
    {
      configured: hasValue("TRENDYOL_API_SECRET"),
      key: "TRENDYOL_API_SECRET",
      label: "Trendyol API Secret",
      note: "Product Create V2 Basic Auth şifresi.",
      required: true,
    },
    {
      configured: hasValue("TRENDYOL_BRAND_ID"),
      key: "TRENDYOL_BRAND_ID",
      label: "Trendyol Brand ID",
      note: "Ürün payload'ındaki zorunlu brandId.",
      required: true,
    },
    {
      configured: hasValue("TRENDYOL_INTEGRATION_REFERENCE_CODE"),
      key: "TRENDYOL_INTEGRATION_REFERENCE_CODE",
      label: "Entegrasyon Referans Kodu",
      note: "İsteğe bağlı kayıt alanı. Trendyol destek taleplerinde kullanılır.",
      required: false,
    },
    {
      configured: hasValue("TRENDYOL_TOKEN"),
      key: "TRENDYOL_TOKEN",
      label: "Seller Panel Token",
      note: "İsteğe bağlı kayıt alanı. Product Create V2 auth header'ında kullanılmaz.",
      required: false,
    },
    {
      configured: hasValue("CRON_SECRET") || hasValue("TRENDYOL_AUTO_ACCEPT_SECRET"),
      key: "CRON_SECRET",
      label: "Otomatik kabul cron secret",
      note: "Opsiyonel. Vercel cron endpoint'ini dış tetiklemelere karşı korur.",
      required: false,
    },
  ];

  return {
    items,
    missingRequired: items.filter((item) => item.required && !item.configured),
    mode: hasValue("DATABASE_URL") ? "queue" : "direct",
  };
}
