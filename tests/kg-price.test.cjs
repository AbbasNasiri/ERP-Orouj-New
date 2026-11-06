const test=require('node:test');const assert=require('node:assert');
test('مقوا بر مبنای کیلوگرم',async()=>{
 const {bandWeightKg,bandValueFromKg}=await import('../src/kgprice.js');
 const {parseInventoryText}=await import('../src/inventorysmart.js');
 const item={size:'100×70',gramaj:'250',sheetsPerBand:'125',unitMode:'band_sheet',priceBasis:'kg'};
 assert.strictEqual(bandWeightKg(item),21.875);
 assert.strictEqual(bandValueFromKg(item,'5500000'),120312500);
 assert.strictEqual(bandValueFromKg({...item,size:'۱۰۰×۷۰',gramaj:'۲۵۰'},'۵,۵۰۰,۰۰۰'),120312500);
 const r=parseInventoryText('مقوا گلاسه براق 250 گرم 100×70 ده بند 125 برگی فی هر کیلو 5500000 ریال');
 const d=(r.items||r.drafts||r)[0].draft;
 assert.strictEqual(d.priceBasis,'kg');assert.strictEqual(d.pricePerKg,'5500000');assert.strictEqual(d.unitValue,'120312500');
});
test('دریافت کالا فی کیلو را همگام نگه می‌دارد', async()=>{
 const {applyReceipt}=await import('../src/suppliers.js');
 const inv=[{id:'a',unitMode:'band_sheet',priceBasis:'kg',size:'100×70',gramaj:'250',sheetsPerBand:'125',bandCount:'10',unitValue:'120312500',pricePerKg:'5500000'}];
 const out=applyReceipt(inv,{id:'r',date:'1405/01/01',lines:[{inventoryItemId:'a',qty:'10',unitPrice:'131250000'}]},'t');
 assert.strictEqual(out[0].pricePerKg,'5750000');
});

