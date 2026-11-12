const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns/promises');
const https = require('node:https');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const safe = require('../.test-build/safe-request.js');
const { installRequestGuard } = require('../.test-build/browser-network.js');
afterEach(() => mock.restoreAll());

for (const url of [
  'http://www.amazon.in/dp/a', 'https://amazon.in.evil.test/', 'https://evilflipkart.com/',
  'https://flipkart.com.evil.test/', 'https://127.0.0.1/', 'https://[::1]/',
  'https://169.254.169.254/', 'https://user:pass@amazon.in/', 'https://amazon.in:8443/',
  'file:///etc/passwd', 'data:text/html,test', 'https://www.amazon.in./', 'https://2130706433/'
]) test(`reject URL ${url}`, () => assert.throws(() => safe.validateScrapeUrl(url)));

test('allow known product hosts and bounded CDN domains', () => {
  for (const host of ['amazon.in', 'www.amazon.in', 'flipkart.com', 'www.flipkart.com'])
    assert.equal(safe.validateScrapeUrl(`https://${host}/p?a=1`).hostname, host);
  assert.ok(safe.validateScrapeUrl('https://m.media-amazon.com/a.js', true));
  assert.throws(() => safe.validateScrapeUrl('https://m.media-amazon.com/a.js'));
  assert.throws(() => safe.validateScrapeUrl('https://media-amazon.com.evil.test/', true));
  assert.equal(safe.isFlipkartUrl('https://notflipkart.com/?pid=x&lid=y'), false);
});

test('deny private, reserved, mapped and transition addresses', () => {
  for (const ip of ['0.0.0.0', '10.1.2.3', '100.64.1.1', '127.0.0.1', '169.254.169.254',
    '172.16.1.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::', '64:ff9b::7f00:1'])
    assert.equal(safe.isPublicAddress(ip), false, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(safe.isPublicAddress(ip), true, ip);
});

test('reject mixed public/private DNS responses', async () => {
  mock.method(dns, 'lookup', async () => [{address:'8.8.8.8', family:4}, {address:'127.0.0.1', family:4}]);
  await assert.rejects(safe.resolvePublicAddress('www.amazon.in'), /non-public/);
});

function network(responses) {
  const calls = [];
  mock.method(dns, 'lookup', async () => [{address:'8.8.8.8', family:4}]);
  mock.method(https, 'request', (url, options, callback) => {
    calls.push(url.href);
    assert.equal(options.agent, false);
    assert.equal(options.family, 4);
    options.lookup(url.hostname, {}, (error, address, family) => {
      assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4);
    });
    const req = new EventEmitter();
    let closed = false;
    req.destroy = (error) => { if (!closed) { req.emit('error', error); req.emit('close'); closed = true; } };
    req.end = () => queueMicrotask(() => {
      const fixture = responses.shift();
      const response = new PassThrough();
      response.statusCode = fixture.status || 200; response.headers = fixture.headers || {};
      callback(response); response.end(fixture.body || 'ok'); closed = true; req.emit('close');
    });
    return req;
  });
  return calls;
}

test('pins DNS and follows validated relative redirects', async () => {
  const calls = network([{status:302, headers:{location:'/dp/good'}}, {body:'product'}]);
  const response = await safe.safeFetchHtml('https://www.amazon.in/start', {}, 100);
  assert.equal(response.html, 'product');
  assert.deepEqual(calls, ['https://www.amazon.in/start', 'https://www.amazon.in/dp/good']);
});

test('blocks redirect before contacting an internal destination', async () => {
  const calls = network([{status:302, headers:{location:'https://127.0.0.1/secret'}}]);
  await assert.rejects(safe.safeFetchHtml('https://www.amazon.in/start', {}, 100), /Unsupported/);
  assert.equal(calls.length, 1);
});

test('limits redirect loops', async () => {
  const calls = network(Array.from({length:6}, () => ({status:302, headers:{location:'/loop'}})));
  await assert.rejects(safe.safeFetchHtml('https://www.amazon.in/', {}, 100), /Too many/);
  assert.equal(calls.length, 6);
});

test('decodes compressed content with a decompressed size limit', async () => {
  network([{headers:{'content-encoding':'gzip'}, body:require('node:zlib').gzipSync('product')}]);
  assert.equal((await safe.safeRequest('https://amazon.in/')).body.toString(), 'product');
});

async function browserRequest(url, navigation) {
  let handler;
  await installRequestGuard({
    setBypassServiceWorker: async (value) => assert.equal(value, true),
    setRequestInterception: async (value) => assert.equal(value, true),
    on: (event, fn) => { assert.equal(event, 'request'); handler = fn; }
  });
  return new Promise((resolve) => handler({
    url: () => url, isNavigationRequest: () => navigation, method: () => 'GET',
    headers: () => ({}), postData: () => undefined,
    isInterceptResolutionHandled: () => false,
    respond: async (response) => resolve({response}), abort: async () => resolve({blocked:true})
  }));
}

test('browser rejects private navigation, redirects and subresources without network', async () => {
  mock.method(safe, 'safeRequest', async () => { throw new Error('must not fetch'); });
  for (const url of ['https://127.0.0.1/', 'https://evil.test/', 'file:///etc/passwd']) {
    assert.deepEqual(await browserRequest(url, true), {blocked:true});
    assert.deepEqual(await browserRequest(url, false), {blocked:true});
  }
  assert.equal(safe.safeRequest.mock.callCount(), 0);
});

test('browser fulfills allowed assets through the pinned transport, never continues raw', async () => {
  mock.method(safe, 'safeRequest', async () => ({status:200, headers:{'content-type':'text/javascript'}, body:Buffer.from('ok')}));
  const result = await browserRequest('https://m.media-amazon.com/app.js', false);
  assert.equal(result.response.status, 200);
  assert.equal(result.response.body.toString(), 'ok');
  assert.deepEqual(await browserRequest('https://m.media-amazon.com/app.js', true), {blocked:true});
});

test('prefers public IPv4 if IPv6 is listed first', async () => {
  mock.method(dns, 'lookup', async () => [{address:'2606:4700:4700::1111', family:6}, {address:'8.8.8.8', family:4}]);
  assert.deepEqual(await safe.resolvePublicAddress('www.amazon.in'), {address:'8.8.8.8', family:4});
});

test('rejects oversized decompressed responses', async () => {
  network([{headers:{'content-encoding':'gzip'}, body:require('node:zlib').gzipSync(Buffer.alloc(9 * 1024 * 1024))}]);
  await assert.rejects(safe.safeRequest('https://amazon.in/'), /too large/);
});
