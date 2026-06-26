import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import type { Browser } from "puppeteer-core";

declare global {
  // Reuse the browser between warm invocations to keep Flipkart rendering fast.
  var __priceTrackerBrowserPromise: Promise<Browser> | undefined;
}

const VIEWPORT = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  hasTouch: false,
  isLandscape: true,
  isMobile: false
} as const;
const REMOTE_CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

export async function fetchRenderedHtml(url: string) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport(VIEWPORT);
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "accept-language": "en-IN,en;q=0.9"
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    try {
      await page.waitForFunction(
        () => {
          const bodyText = document.body?.innerText || "";
          return (
            bodyText.includes("Delivery by") ||
            bodyText.includes("Cash on Delivery") ||
            bodyText.includes("Shipping Policy") ||
            bodyText.includes("Please enable Javascript")
          );
        },
        { timeout: 12000 }
      );
    } catch {
      // If the page takes longer or renders a different surface, we still inspect the current DOM.
    }

    const [html, text] = await Promise.all([
      page.content(),
      page.evaluate(() => document.body?.innerText || "")
    ]);

    return {
      html,
      text
    };
  } finally {
    await page.close();
  }
}

async function getBrowser() {
  if (!globalThis.__priceTrackerBrowserPromise) {
    globalThis.__priceTrackerBrowserPromise = launchBrowser().catch((error) => {
      globalThis.__priceTrackerBrowserPromise = undefined;
      throw error;
    });
  }

  return globalThis.__priceTrackerBrowserPromise;
}

async function launchBrowser() {
  chromium.setGraphicsMode = false;
  const executablePath = await resolveChromiumExecutablePath();

  return puppeteer.launch({
    args: await puppeteer.defaultArgs({
      args: chromium.args,
      headless: "shell"
    }),
    defaultViewport: VIEWPORT,
    executablePath,
    headless: "shell"
  });
}

async function resolveChromiumExecutablePath() {
  try {
    return await chromium.executablePath();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes('The input directory "') || !message.includes("@sparticuz/chromium/bin")) {
      throw error;
    }

    return chromium.executablePath(REMOTE_CHROMIUM_PACK_URL);
  }
}
