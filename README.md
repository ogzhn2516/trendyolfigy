# Figyfun Trendyol Telegram Bot

This Next.js app takes product photos and product fields from Telegram and
sends them to Trendyol Product Create V2.

It has two deployment modes:

1. Direct mode for Vercel Hobby: leave `DATABASE_URL` empty. Telegram uploads
   the image to Vercel Blob and sends the product directly to Trendyol.
2. Queue mode: set `DATABASE_URL`. Product drafts, Trendyol errors, and
   `batchRequestId` values are stored in Postgres and can be managed in the
   admin panel.

## Routes

- `/login`: admin login
- `/admin`: config status and the Postgres product queue
- `/api/telegram/webhook`: Telegram bot webhook

## Env

Use `.env.local` locally and add the same keys in Vercel Environment Variables.

```env
ADMIN_USERNAME=ozy
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_WEBHOOK_SECRET=
TRENDYOL_SELLER_ID=
TRENDYOL_API_KEY=
TRENDYOL_API_SECRET=
TRENDYOL_INTEGRATION_REFERENCE_CODE=
TRENDYOL_TOKEN=
TRENDYOL_BRAND_ID=
TRENDYOL_SHIPMENT_TEMPLATE_ID=
TRENDYOL_SHIPMENT_ADDRESS_ID=
TRENDYOL_RETURNING_ADDRESS_ID=
TRENDYOL_STORE_FRONT_CODE=
TRENDYOL_BASE_URL=https://apigw.trendyol.com
BLOB_READ_WRITE_TOKEN=
DATABASE_URL=
CRON_SECRET=
```

`ADMIN_SESSION_SECRET` must be at least 32 characters.

`TELEGRAM_ALLOWED_USER_IDS` is a comma-separated Telegram user ID list.

## Trendyol Seller Panel Mapping

| Seller Panel field | Env | Product Create V2 use |
| --- | --- | --- |
| Satici ID (Cari ID) | `TRENDYOL_SELLER_ID` | URL `sellerId` |
| API Key | `TRENDYOL_API_KEY` | Basic Auth username |
| API Secret | `TRENDYOL_API_SECRET` | Basic Auth password |
| Entegrasyon Referans Kodu | `TRENDYOL_INTEGRATION_REFERENCE_CODE` | Optional record for support requests |
| Token | `TRENDYOL_TOKEN` | Optional record, not used by Product Create V2 Basic Auth |

`TRENDYOL_SUPPLIER_ID` is still accepted as a backward-compatible alias for
`TRENDYOL_SELLER_ID`.

Product Create V2 requires `brandId`, so set `TRENDYOL_BRAND_ID` too. Category
IDs and category attributes come from Trendyol category services. The admin panel
can inspect category attributes for a draft.

`TRENDYOL_SHIPMENT_TEMPLATE_ID` stays in the env template because it was part of
the original requirements. Product Create V2 uses the optional
`shipmentAddressId` and `returningAddressId` payload fields instead.

## Telegram Caption

Send a product photo with a caption like this:

```text
Urun: Figyfun ornek urun
Aciklama: Trendyol urun aciklamasi
Fiyat: 499.90
```

The Telegram caption defaults to Figyfun animal figure products:
`Hayvan Figur Oyuncak` category `4498`, quantity `1000`, VAT `20`,
dimensional weight `1`, and the required Trendyol category attributes for
origin `TR`, no battery operation, unspecified age, and no batteries included.
Optional caption lines such as `Liste Fiyati`, `Kategori`, `Stok`, `KDV`,
`Desi`, and `Ozellikler` still override those defaults.

For home decorative objects and figurines, add the category shortcut:

```text
Kategori: ev
```

That shortcut sends products to Trendyol category `1877` (`Dekoratif Obje ve
Biblo`) with quantity `1000`, VAT `20`, dimensional weight `1`, and required
defaults for multicolor, one piece, modern style, poliresin material, and
origin `TR`.

For children's educational toys, add the category shortcut:

```text
Kategori: çocuk
```

That shortcut sends products to Trendyol category `1011` (`Eğitici Oyuncak`)
with quantity `1000`, VAT `20`, dimensional weight `1`, and required defaults
for origin `TR`, no battery operation, no batteries included, Turkish language,
unspecified age, and one-piece package content.

Optional generated-code overrides:

```text
Barkod: FIGY-123
Stok Kodu: STK-123
Ana Urun Kodu: MAIN-123
```

Category-specific `attributes` are required by Trendyol. If attributes are
missing or rejected:

- Direct mode returns the Trendyol error to Telegram.
- Queue mode stores the draft and shows it in `/admin` for correction.

## Vercel Hobby Setup

1. Connect the GitHub repo to Vercel.
2. Add the required admin, Telegram, Trendyol, and Blob env keys.
3. Create and connect a public Vercel Blob store. Its token is
   `BLOB_READ_WRITE_TOKEN`.
4. Leave `DATABASE_URL` empty if you want direct mode.
5. Add a Marketplace Postgres provider later if you want queue mode.
6. Redeploy after changing env keys.

Vercel Blob is needed because Trendyol needs a stable HTTPS product image URL.
The Telegram file URL is not used as the public product image URL.

## Postgres Queue

When `DATABASE_URL` exists, the app creates `product_drafts` on first access.
The manual SQL is also available in [database/schema.sql](database/schema.sql).

## Admin Operations Panel

The `/admin` page also shows Trendyol order, return, payment, and performance
signals when `DATABASE_URL` and Trendyol API credentials are configured.

- Orders are read from the last 14 days because Trendyol limits the standard
  order query window.
- Returns are read from the latest claim records.
- Finance uses current account `settlements` and `otherfinancials` services.
- The auto-accept checkbox stores its setting in Postgres and the Vercel cron
  route checks once per day on Hobby. When enabled, Created packages are moved
  to Picking status. Use the admin panel's manual accept button for immediate
  processing, or upgrade to Pro / use an external cron service for frequent
  checks.
- Without `DATABASE_URL`, the manual accept button still works. Set
  `TRENDYOL_AUTO_ACCEPT_ENABLED=true` in Vercel if you want the daily cron to run
  auto-accept without storing the checkbox state in Postgres.

Set `CRON_SECRET` in Vercel to protect the cron endpoint. Vercel Cron sends it
as a bearer token automatically when configured.

## Telegram Webhook

After deployment, register the production URL with Telegram:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-vercel-domain.example/api/telegram/webhook",
    "secret_token": "TELEGRAM_WEBHOOK_SECRET"
  }'
```

## Notes

- Trendyol returns a `batchRequestId` after a successful Product Create request.
  Approval and live product status must still be checked in Trendyol workflows.
- Product image dimensions, content, category attributes, stock, price, and
  barcode rules still need to satisfy Trendyol validation.
