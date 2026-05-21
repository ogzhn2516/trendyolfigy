# Figyfun Trendyol Telegram Bot

Next.js tabanlı bu uygulama Telegram botundan gelen ürün fotoğrafını ve
fotoğraf açıklamasındaki ürün alanlarını Postgres üzerinde taslak olarak saklar,
Trendyol Product Create V2 API'sine otomatik gönderim dener ve admin panelinde
düzeltme / yeniden gönderim kuyruğu sunar.

## Akış

1. Telegram botuna ürün fotoğrafı gönderilir.
2. Fotoğraf açıklaması ürün adı, açıklama, fiyat ve Trendyol kategori ID'sini
   içerir.
3. Webhook izinli Telegram kullanıcı ID'sini doğrular.
4. Görsel Vercel Blob'a yüklenir, ürün taslağı Postgres'e yazılır.
5. Trendyol gönderimi başarılıysa `batchRequestId` saklanır. Eksik kategori
   özelliği veya API hatası varsa taslak admin panelinde kontrol bekler.

## Kurulum

```bash
npm install
npm run dev
```

Giriş ekranı `/login`, admin kuyruğu `/admin`, Telegram webhook'u
`/api/telegram/webhook` yolundadır.

## Env

`.env.local` yerelde kullanılabilir. Vercel ortam değişkenlerine aynı anahtarlar
eklenmelidir.

```env
ADMIN_USERNAME=ozy
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_WEBHOOK_SECRET=
TRENDYOL_SUPPLIER_ID=
TRENDYOL_API_KEY=
TRENDYOL_API_SECRET=
TRENDYOL_BRAND_ID=
TRENDYOL_SHIPMENT_TEMPLATE_ID=
TRENDYOL_SHIPMENT_ADDRESS_ID=
TRENDYOL_RETURNING_ADDRESS_ID=
TRENDYOL_STORE_FRONT_CODE=
TRENDYOL_BASE_URL=https://apigw.trendyol.com
BLOB_READ_WRITE_TOKEN=
DATABASE_URL=
```

`ADMIN_SESSION_SECRET` en az 32 karakter olmalıdır.

`TELEGRAM_ALLOWED_USER_IDS` virgülle ayrılmış Telegram user ID listesi bekler.
Boş bırakılırsa webhook ürün kabul etmez.

Trendyol Product Create V2 payload'ı `shipmentAddressId` ve
`returningAddressId` alanlarını destekler. İstenen
`TRENDYOL_SHIPMENT_TEMPLATE_ID` env anahtarı örnek env içinde tutuldu, fakat V2
ürün oluşturma isteğine gönderilmez.

## Telegram Mesajı

Fotoğraf açıklaması örneği:

```text
Ürün: Figyfun örnek ürün
Açıklama: Trendyol ürün açıklaması
Fiyat: 499.90
Liste Fiyatı: 549.90
Kategori: 123456
Stok: 5
KDV: 20
Desi: 1
Özellikler: [{"attributeId": 1, "attributeValueId": 2}]
```

Bot barkod, stok kodu ve ana ürün kodu gönderilmezse Telegram update ID'sinden
tekil değerler üretir. Bunlar fotoğraf açıklamasında şu alanlarla ezilebilir:

```text
Barkod: FIGY-123
Stok Kodu: STK-123
Ana Ürün Kodu: MAIN-123
```

Kategoriye göre zorunlu `attributes` değerleri değişir. Admin panelindeki
"Kategori özelliklerini sorgula" aracı Trendyol yanıtını gösterir; gerekli JSON
taslağa kaydedilip tekrar gönderilebilir.

## Telegram Webhook

Deploy sonrası bot webhook'unu örneğin şu istekle ayarla:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-vercel-domain.example/api/telegram/webhook",
    "secret_token": "TELEGRAM_WEBHOOK_SECRET"
  }'
```

## Veritabanı

Uygulama ilk DB erişiminde `product_drafts` tablosunu oluşturur. Manuel kurulum
için aynı şema [database/schema.sql](database/schema.sql) dosyasındadır.

Yeni Vercel projelerinde `DATABASE_URL` veren bir Marketplace Postgres
entegrasyonu kullanılabilir.

## Üretim Notları

- Trendyol gönderimi kuyruğa alır; `batchRequestId` ürünün onaylandığı anlamına
  gelmez.
- Trendyol görsel URL'sinin kalıcı ve HTTPS olmasını bekler. Bu nedenle Telegram
  dosyası doğrudan yayın adresi olarak kullanılmaz; `BLOB_READ_WRITE_TOKEN`
  ayarlanmalıdır.
- Görselleri Trendyol görsel kurallarına uygun ölçü ve kaliteyle gönder.
