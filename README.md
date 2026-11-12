# Vercel SKU Price Checker

Next.js app for Vercel that uploads a CSV, reads `SKU`, `ASIN`, and `FSN`, then fetches Amazon and Flipkart prices.

## Features

- CSV upload from the browser
- header normalization for common SKU, ASIN, FSN, title, and URL columns
- Amazon direct product-page lookup by ASIN when present
- Flipkart direct product-page lookup by URL when present
- Amazon retry loop with block detection and backoff
- CSV export of results after a run

## Expected CSV columns

The app will use the first matching column it finds.

- `SKU`
- `SKU Id`
- `ASIN`
- `Amazon ASIN`
- `FSN`
- `Product Name`
- `Title`
- `Search Query`
- `Amazon URL`
- `Flipkart URL`

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

1. Import the repository as a new Vercel project.
2. Set optional environment variables from `.env.example`.
3. Deploy.

## Important note about Amazon

Amazon can return captcha or bot-protection pages. This app retries automatically when a likely block is detected, but no scraper can guarantee permanent bypass. The retry count is intentionally bounded so Vercel functions do not run forever.

## Scraper network safety

Product URLs must use HTTPS on `amazon.in`, `www.amazon.in`, `flipkart.com`, or
`www.flipkart.com`. Credentials, non-default ports, IP literals, unrelated hosts,
and redirects outside this list are rejected. Short links and other regional
Amazon domains are intentionally unsupported; use the full India product URL.
Each connection validates all DNS answers and pins a public address for TLS.
HTML redirects are checked individually and limited to five hops.

Browser navigation uses the same policy. Browser asset requests are limited to
these marketplace hosts and the Amazon/Flipkart CDN domains listed in
`lib/marketplace-url.ts`. Requests are fulfilled through the checked Node
transport, with service-worker bypass and a fail-closed proxy for other browser
network paths. Browser contexts are isolated between runs. New legitimate CDN
hosts must be explicitly reviewed before adding them. Responses are capped at
8 MiB after decompression; DNS lookups and network requests have time limits.

Run `npm run test:security` for deterministic URL/DNS/redirect/transport checks.
Run `npm run test:browser-security` on a Linux host supporting the bundled
Chromium for real browser navigation, cookie, isolation and network-blocking
checks. Neither suite contacts live retail sites or production deployments.

The CSV importer and JSON API normalize pasted Markdown escapes (for example
`https\://www\.flipkart.com/...`), add HTTPS to scheme-less URLs, and retain
product IDs. Missing FSNs can be read from the supplied Flipkart `pid` parameter.
Blank, `#N/A`, `-`, or incomplete Amazon `/dp/` values are skipped unless a valid
10-character ASIN is supplied. Missing product IDs are never guessed.
