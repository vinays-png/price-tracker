const {test,afterEach,mock}=require('node:test');
const assert=require('node:assert/strict');
const shared=require('../.test-build/lib/scrapers/shared.js');
const {resolveFlipkartIdentity}=require('../.test-build/lib/scrapers/flipkart-resolver.js');
afterEach(()=>mock.restoreAll());
const row={sku:'TestProduct',asin:'',fsn:'TRD123',title:'',searchQuery:'',amazonUrl:'',flipkartUrl:'https://www.flipkart.com/product/p/itme?pid=TRD123'};

test('never substitutes an unrelated product when the exact PID is missing', async()=>{
 mock.method(shared,'fetchHtml',async(url)=>({status:200,url,html:'<a href="/other/p/abc?pid=OTHER&lid=LSTOTHER123">Other</a>'}));
 assert.equal(await resolveFlipkartIdentity(row),null);
});

test('selects only exact PID rather than a prefix match', async()=>{
 mock.method(shared,'fetchHtml',async(url)=>({status:200,url,html:'<a href="/wrong/p/abc?pid=TRD1234&lid=LSTTRD1234X">Wrong</a><a href="/correct/p/abc?pid=TRD123&lid=LSTTRD123X">Correct</a>'}));
 const result=await resolveFlipkartIdentity(row);
 assert.equal(result.pid,'TRD123');assert.equal(result.lid,'LSTTRD123X');
 assert.ok(result.productUrl.includes('/correct/'));
});

test('rejects a listing ID belonging to another product', async()=>{
 mock.method(shared,'fetchHtml',async(url)=>({status:200,url,html:'<a href="/wrong/p/abc?pid=TRD123&lid=LSTOTHER123">Wrong</a>'}));
 assert.equal(await resolveFlipkartIdentity(row),null);
});

test('FSN-only scrape does not fall through to an unrelated first search result', async()=>{
 const {scrapeFlipkart}=require('../.test-build/lib/scrapers/flipkart.js');
 mock.method(shared,'fetchHtml',async(url)=>({status:200,url,html:'<a href="/other/p/abc?pid=OTHER&lid=LSTOTHER123">Other</a><h1>Other product</h1><div class="Nx9bqj">₹123</div>'}));
 const result=await scrapeFlipkart({...row,flipkartUrl:''});
 assert.equal(result.price,null);assert.equal(result.ok,false);assert.match(result.notes,/no substitute/);
});

test('direct-link resolution rejects redirects to a different PID', async()=>{
 mock.method(shared,'fetchHtml',async(url)=>({status:200,url:'https://www.flipkart.com/other/p/abc?pid=OTHER',html:'<span>"lid":"LSTTRD123X"</span>'}));
 assert.equal(await resolveFlipkartIdentity({...row,flipkartUrl:'https://www.flipkart.com/product/p/known'}),null);
 assert.equal(await resolveFlipkartIdentity(row),null);
});
