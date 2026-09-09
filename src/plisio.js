const axios=require('axios');
const crypto=require('crypto');
const {plisioSecretKey,plisioBaseUrl,publicBaseUrl}=require('./config');

const key=String(plisioSecretKey||'').trim();
const baseUrl=String(plisioBaseUrl||'https://api.plisio.net/api/v1').replace(/\/$/,'');

function requireKey(){
  if(!key) throw new Error('Plisio secret key is not configured. Add PLISIO_SECRET_KEY to .env.');
}

async function apiGet(path,params={}){
  requireKey();
  try{
    const {data}=await axios.get(`${baseUrl}${path}`,{params:{...params,api_key:key},timeout:15000});
    if(data?.status!=='success'){
      const message=data?.data?.message||data?.message||'Plisio API returned an error';
      throw new Error(message);
    }
    return data;
  }catch(e){
    if(!e.response) throw e;
    const code=e.response?.status;
    const body=e.response?.data;
    const message=body?.data?.message||body?.message||e.message;
    throw new Error(`Plisio API request failed${code?` (${code})`:''}: ${message}`);
  }
}

async function getCurrencies(){
  const data=await apiGet('/currencies');
  const list=Array.isArray(data?.data)?data.data:[];
  return list.filter(x=>x&&x.hidden!==1&&x.hidden!=='1'&&x.maintenance!==true);
}

async function createInvoice({amount,description,orderNumber,currency}){
  requireKey();
  const sourceAmount=Number(amount);
  if(!Number.isFinite(sourceAmount)||sourceAmount<1||sourceAmount>5000) throw new Error('Amount must be a number between ₹1 and ₹5,000');
  const order=String(orderNumber||'').trim();
  if(!order) throw new Error('Missing Plisio order number');
  const params={
    source_currency:'INR',
    source_amount:sourceAmount,
    order_number:order,
    order_name:'Anime Cloud Pay',
    description:String(description||'Anime Cloud Pay Crypto Order').slice(0,255),
    callback_url:`${publicBaseUrl}/api/plisio/webhook?json=true`,
    success_callback_url:`${publicBaseUrl}/callback?json=true`,
    fail_callback_url:`${publicBaseUrl}/callback?json=true`,
    expire_min:1440
  };
  const cleanCurrency=String(currency||'').trim().toUpperCase();
  if(cleanCurrency){
    params.currency=cleanCurrency;
    params.allowed_psys_cids=cleanCurrency;
  }
  const data=await apiGet('/invoices/new',params);
  if(!data?.data?.invoice_url) throw new Error('Plisio did not return an invoice URL');
  return data;
}

async function status(txnId){
  const id=String(txnId||'').trim();
  if(!id) throw new Error('Missing Plisio transaction ID');
  return apiGet(`/operations/${encodeURIComponent(id)}`);
}

function verifyWebhook(payload){
  if(!payload||typeof payload!=='object'||!payload.verify_hash||!key) return false;
  const ordered={...payload};
  const received=String(ordered.verify_hash);
  delete ordered.verify_hash;
  const sorted={};
  for(const k of Object.keys(ordered).sort()) sorted[k]=ordered[k];
  if(Object.prototype.hasOwnProperty.call(sorted,'expire_utc')) sorted.expire_utc=String(sorted.expire_utc);
  if(Object.prototype.hasOwnProperty.call(sorted,'tx_urls')&&typeof sorted.tx_urls==='string') sorted.tx_urls=sorted.tx_urls.replace(/&amp;/g,'&');
  const serialized=JSON.stringify(sorted);
  const expected=crypto.createHmac('sha1',key).update(serialized).digest('hex');
  const a=Buffer.from(expected,'utf8');
  const b=Buffer.from(received,'utf8');
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

module.exports={createInvoice,status,verifyWebhook,getCurrencies};
