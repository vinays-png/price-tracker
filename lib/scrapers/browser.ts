import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import type { Browser, Page } from "puppeteer-core";

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
    await preparePage(page);

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

export async function fetchAmazonDeliveryHtml(url: string, pincode: string) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await preparePage(page);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    const forced = await trySetAmazonPincode(page, pincode);

    try {
      await page.waitForFunction(
        () => {
          const bodyText = document.body?.innerText || "";
          return (
            bodyText.includes("FREE delivery") ||
            bodyText.includes("Fastest delivery") ||
            bodyText.includes("Deliver to") ||
            bodyText.includes("delivery")
          );
        },
        { timeout: 12000 }
      );
    } catch {
      // The currently rendered DOM is still useful even if the wait condition times out.
    }

    const [html, text] = await Promise.all([
      page.content(),
      page.evaluate(() => document.body?.innerText || "")
    ]);

    return {
      html,
      text,
      forced
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

async function preparePage(page: Page) {
  await page.setViewport(VIEWPORT);
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({
    "accept-language": "en-IN,en;q=0.9"
  });
}

async function trySetAmazonPincode(page: Page, pincode: string) {
  try {
    const triggerSelectors = [
      "#glow-ingress-block",
      "#nav-global-location-popover-link",
      "#contextualIngressPtLabel_deliveryShortLine",
      "#glow-ingress-line2"
    ];

    for (const selector of triggerSelectors) {
      const trigger = await page.$(selector);
      if (!trigger) continue;
      await trigger.click();
      break;
    }

    await page.waitForSelector("#GLUXZipUpdateInput", { timeout: 8000 });
    const input = await page.$("#GLUXZipUpdateInput");
    if (!input) return false;

    await input.click();
    await input.evaluate((element) => {
      const field = element as HTMLInputElement;
      field.value = "";
    });
    await input.type(pincode, { delay: 30 });

    const applyButton =
      (await page.$('input[aria-labelledby="GLUXZipUpdate-announce"]')) ||
      (await page.$("#GLUXZipUpdate .a-button-input")) ||
      (await page.$("#GLUXZipUpdate-announce"));

    if (!applyButton) return false;
    await applyButton.click();

    try {
      await page.waitForSelector("#GLUXConfirmClose .a-button-input", { timeout: 4000 });
      const confirmButton = await page.$("#GLUXConfirmClose .a-button-input");
      if (confirmButton) {
        await confirmButton.click();
      }
    } catch {
      // Some Amazon flows update without showing a confirmation step.
    }

    try {
      await page.waitForFunction(
        (pin) => {
          const text = document.body?.innerText || "";
          return text.includes(pin);
        },
        { timeout: 8000 },
        pincode
      );
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
