const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCsvToRows } = require('../.test-build/lib/csv.js');
const { normalizeSourceRow } = require('../.test-build/lib/source-row.js');
const { normalizeMarketplaceUrl, normalizeAsin, validateScrapeUrl } = require('../.test-build/lib/marketplace-url.js');
const row = (changes = {}) => ({sku:'SKU-1',asin:'',fsn:'',title:'',searchQuery:'',amazonUrl:'',flipkartUrl:'',...changes});

test('normalizes pasted escaped URLs and scheme-less Amazon URLs without changing product IDs', () => {
  const value = normalizeSourceRow(row({amazonUrl:'amazon.in/dp/B0DXKXZNNS',
    flipkartUrl:String.raw`https\://www\.flipkart.com/product/p/itme?pid=TRDHDDWQHKKWBVTS`}));
  assert.equal(value.amazonUrl, 'https://amazon.in/dp/B0DXKXZNNS');
  assert.equal(value.flipkartUrl, 'https://www.flipkart.com/product/p/itme?pid=TRDHDDWQHKKWBVTS');
  assert.equal(value.fsn, 'TRDHDDWQHKKWBVTS');
  assert.equal(normalizeSourceRow({...value, fsn:'EXPLICIT'}).fsn, 'EXPLICIT');
});

test('CSV and submitted JSON rows use identical normalization', () => {
  const csv = String.raw`SKU,ASIN,Amazon Link,Flipkart Link
SKU-1,B0DXKXZNNS,amazon.in/dp/B0DXKXZNNS,https\://www\.flipkart.com/product/p/itme?pid=TRDHDDWQHKKWBVTS`;
  const expected = normalizeSourceRow(row({asin:'B0DXKXZNNS', amazonUrl:'amazon.in/dp/B0DXKXZNNS',
    flipkartUrl:String.raw`https\://www\.flipkart.com/product/p/itme?pid=TRDHDDWQHKKWBVTS`}));
  assert.deepEqual(parseCsvToRows(csv), [expected]);
});

test('missing identifiers remain missing and never become invented Amazon URLs', () => {
  for (const asin of ['', '-', '#N/A', 'undefined', '123']) assert.equal(normalizeAsin(asin), '');
  for (const amazonUrl of ['', '#N/A', 'amazon.in/dp/', 'amazon.in/dp/-', 'amazon.in/dp/#N/A']) {
    const value = normalizeSourceRow(row({asin:'#N/A',amazonUrl}));
    assert.equal(value.amazonUrl, '', amazonUrl); assert.equal(value.asin, '');
  }
});

test('normalization cannot weaken destination validation', () => {
  for (const url of ['https://amazon.in.evil.test/dp/B0DXKXZNNS', 'https://127.0.0.1/',
    'https://amazon.in@evil.test/', 'https://evil.test@amazon.in/', 'https://amazon.in:8443/',
    'https://notflipkart.com/?pid=123', 'file:///etc/passwd', 'https://amazon.in\\@evil.test/']) {
    assert.equal(normalizeMarketplaceUrl(url,'amazon'), '', url);
    assert.equal(normalizeMarketplaceUrl(url,'flipkart'), '', url);
  }
  const url = normalizeMarketplaceUrl('[product](amazon.in/dp/B0DXKXZNNS)', 'amazon');
  assert.equal(validateScrapeUrl(url).hostname, 'amazon.in');
});
