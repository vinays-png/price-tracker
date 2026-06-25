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
