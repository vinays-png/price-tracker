const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const chromium = require('@sparticuz/chromium').default;
const puppeteer = require('puppeteer-core');
const safe = require('../.test-build/safe-request.js');
const { BROWSER_NETWORK_ARGS, installRequestGuard } = require('../.test-build/browser-network.js');

test('real Chromium: safe navigation, redirect rejection and blocked alternate network paths', {timeout:60000}, async () => {
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; res.end('internal'); });
  server.on('upgrade', (req, socket) => { hits++; socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let browser;
  try {
    chromium.setGraphicsMode = false;
    browser = await puppeteer.launch({
      executablePath: await chromium.executablePath(), headless:'shell',
      args: await puppeteer.defaultArgs({headless:'shell', args:[
        ...chromium.args.filter(arg => arg !== '--single-process'), ...BROWSER_NETWORK_ARGS
      ]})
    });
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await installRequestGuard(page);
    const requested = [];
    mock.method(safe, 'safeRequest', async (url) => {
      requested.push(url);
      if (url.endsWith('/redirect')) return {status:302, headers:{location:`http://127.0.0.1:${port}/redirect-target`}, body:Buffer.alloc(0)};
      return {status:200, headers:{'content-type':'text/html', 'set-cookie':['test_one=1; Path=/; Secure','test_two=2; Path=/; Secure']}, body:Buffer.from('<html><body>Safe fixture</body></html>')};
    });
    await page.goto('https://www.amazon.in/fixture');
    assert.equal(await page.$eval('body', element => element.textContent), 'Safe fixture');
    assert.deepEqual((await context.cookies()).map(c => c.name).sort(), ['test_one','test_two']);
    await page.evaluate((port) => {
      fetch(`http://127.0.0.1:${port}/fetch`).catch(() => {});
      new WebSocket(`ws://127.0.0.1:${port}/socket`);
      const iframe = document.createElement('iframe'); iframe.src=`http://127.0.0.1:${port}/frame`; document.body.appendChild(iframe);
      window.open(`http://127.0.0.1:${port}/popup`);
      const code = `fetch('http://127.0.0.1:${port}/worker').catch(()=>{}); new WebSocket('ws://127.0.0.1:${port}/worker-socket');`;
      new Worker(URL.createObjectURL(new Blob([code], {type:'text/javascript'})));
    }, port);
    await new Promise(resolve => setTimeout(resolve, 1200));
    await assert.rejects(page.goto('https://www.amazon.in/redirect'));
    assert.equal(hits, 0, 'local trap must receive no requests');
    assert.ok(requested.every(url => url.startsWith('https://www.amazon.in/')));
    await context.close();
    // Context lifecycle remains functional with single-process disabled.
    const second = await browser.createBrowserContext();
    await second.newPage(); await second.close();
  } finally {
    mock.restoreAll();
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
