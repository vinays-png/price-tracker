import type { Page } from "puppeteer-core";
import { safeRequest, validateScrapeUrl } from "./safe-request";

export const BROWSER_NETWORK_ARGS = [
  "--proxy-server=http://127.0.0.1:9",
  "--proxy-bypass-list=<-loopback>",
  "--disable-quic",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"
];

export async function installRequestGuard(page: Page) {
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    void (async () => {
      try {
        // Navigation is marketplace-only; scripts/styles may use known retail CDNs.
        validateScrapeUrl(request.url(), !request.isNavigationRequest());
        const response = await safeRequest(request.url(), {
          assets: !request.isNavigationRequest(),
          method: request.method(),
          headers: request.headers(),
          body: request.postData()
        });
        const headers: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined && !["transfer-encoding", "content-length", "connection"].includes(name)) {
            headers[name] = value;
          }
        }
        // Chromium follows redirects through interception, so every hop is checked.
        await request.respond({ status: response.status, headers, body: response.body });
      } catch {
        if (!request.isInterceptResolutionHandled()) await request.abort("blockedbyclient").catch(() => {});
      }
    })();
  });
}
