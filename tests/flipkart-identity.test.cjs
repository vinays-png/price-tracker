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

test('FSN/link mismatch is surfaced without making a network request', async()=>{
 const {scrapeFlipkart}=require('../.test-build/lib/scrapers/flipkart.js');
 mock.method(shared,'fetchHtml',async()=>{throw new Error('must not fetch')});
 const result=await scrapeFlipkart({...row,fsn:'DIFFERENT'});
 assert.equal(result.ok,false);assert.equal(result.attempts,0);assert.match(result.notes,/does not match/);
 assert.equal(shared.fetchHtml.mock.callCount(),0);
});

test('never mistakes EMI, shipping or recommendation amounts for product price',()=>{
 const {parseFlipkartProductPage}=require('../.test-build/lib/scrapers/flipkart.js');
 const html='<title>Online Shopping</title><div class="v1zwn21n">Shipping ₹99</div><div class="_30jeq3">₹500</div><p>EMI ₹200</p>';
 assert.equal(parseFlipkartProductPage(html,row.flipkartUrl,'Shipping ₹99 EMI ₹200').price,null);
});

test('selects matching Product JSON-LD in graphs and ignores recommendation prices',()=>{
 const {parseFlipkartProductPage}=require('../.test-build/lib/scrapers/flipkart.js');
 const html='<script type="application/ld+json">'+JSON.stringify({'@graph':[
  {'@type':'Product',sku:'OTHER',name:'Other',offers:{price:99,priceCurrency:'INR'}},
  {'@type':['Product'],sku:'TRD123',name:'Requested',offers:{price:18499,priceCurrency:'INR'}}
 ]})+'</script>';
 const parsed=parseFlipkartProductPage(html,row.flipkartUrl);assert.equal(parsed.price,18499);assert.equal(parsed.title,'Requested');
 assert.equal(parseFlipkartProductPage(html,'https://www.flipkart.com/product/p/x?pid=NOT_PRESENT').price,null);
});

test('direct price fetch honors explicit FSN even when the original URL has no PID', async()=>{
 const {scrapeFlipkart}=require('../.test-build/lib/scrapers/flipkart.js');
 mock.method(shared,'fetchHtml',async()=>({status:200,url:'https://www.flipkart.com/other/p/item?pid=OTHER',html:'<script type="application/ld+json">{"@type":"Product","sku":"OTHER","offers":{"price":99}}</script>'}));
 const result=await scrapeFlipkart({...row,flipkartUrl:'https://www.flipkart.com/product/p/known'});
 assert.equal(result.price,null);assert.equal(result.ok,false);assert.match(result.notes,/no substitute/);
});

const priceRow=(price='₹18,499',mrp='49,999',href='')=>`<a class="_1o6mltlk4" ${href}><div><div class="css-g5y9jx">63%</div><div class="css-g5y9jx"><div class="v1zwn21o v1zwn21" style="text-decoration-line: line-through">${mrp}</div></div><div class="css-g5y9jx"><div class="v1zwn21n v1zwn20">${price}</div></div></div></a>`;
const pricePage=(content,pid='TRD123')=>`<meta property="og:url" content="https://www.flipkart.com/product/p/itme?pid=${pid}"><link rel="canonical" href="https://www.flipkart.com/product/p/itme"><div class="CTTtEa"><h1>Requested product</h1>${content}</div>`;

test('captures shopper selling price beside MRP, not conditional offer or structured-price discrepancy',()=>{
 const {parseFlipkartProductPage:parse}=require('../.test-build/lib/scrapers/flipkart.js');
 const html=pricePage(priceRow()+'<p>Buy at ₹17,574</p><script type="application/ld+json">{"@type":"Product","sku":"TRD123","offers":{"price":17574}}</script>');
 assert.equal(parse(html,row.flipkartUrl).price,18499);
 assert.equal(parse(pricePage(priceRow(),'OTHER'),row.flipkartUrl).price,null);
});

test('ignores Notify Me recommendations, linked cards, ambiguous rows and invalid MRP relationships',()=>{
 const {parseFlipkartProductPage:parse}=require('../.test-build/lib/scrapers/flipkart.js');
 assert.equal(parse(pricePage('<p>Notify Me</p>')+priceRow(),row.flipkartUrl).price,null);
 assert.equal(parse(pricePage(priceRow('₹18,499','49,999','href="/other/p/x?pid=OTHER"')),row.flipkartUrl).price,null);
 assert.equal(parse(pricePage(priceRow()+priceRow('₹999')),row.flipkartUrl).price,null);
 assert.equal(parse(pricePage(priceRow('₹18,499','999')),row.flipkartUrl).price,null);
 assert.equal(parse(pricePage(priceRow().replace('line-through','none')),row.flipkartUrl).price,null);
});
