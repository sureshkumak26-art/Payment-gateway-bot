const axios=require('axios');
const crypto=require('crypto');
const {nowPaymentsApiKey,nowPaymentsBaseUrl,publicBaseUrl,nowPaymentsIpnSecret}=require('./config');

const key=String(nowPaymentsApiKey||'').trim();
const baseUrl=String(nowPaymentsBaseUrl||'https://api.nowpayments.io').replace(/\/$/,'');
const api=axios.create({
  baseURL:baseUrl,
  timeout:15000,
  headers:{'Content-Type':'application/json','x-api-key':key}
});

function requireKey(){
  if(!key) throw new Error('NOWPayments API key is not configured. Add NOWPAYMENTS_API_KEY to .env.');
}

async function createInvoice({amount,description,orderId,payCurrency='usdttrc20'}){
  requireKey();
  const priceAmount=Number(amount);
  if(!Number.isFinite(priceAmount)||priceAmount<1||priceAmount>5000) throw new Error('Amount must be a number between ₹1 and ₹5,000');
  const currency=String(payCurrency||'usdttrc20').trim().toLowerCase();
  if(!/^[a-z0-9]{2,20}$/.test(currency)) throw new Error('Invalid crypto currency code');
  try{
    const {data}=await api.post('/v1/invoice',{
      price_amount:priceAmount,
      price_currency:'inr',
      order_id:String(orderId),
      order_description:String(description||'Anime Cloud Pay Crypto Order').slice(0,255),
      ipn_callback_url:`${publicBaseUrl}/api/nowpayments/webhook`,
      success_url:`${publicBaseUrl}/callback`,
      cancel_url:`${publicBaseUrl}/callback`
    });
    if(!data?.invoice_url) throw new Error('NOWPayments did not return an invoice URL');
    return {...data,selected_pay_currency:currency};
  }catch(e){
    const code=e.response?.status;
    const body=e.response?.data;
    const detail=body?.message||body?.error||body?.errors;
    throw new Error(`NOWPayments create-invoice failed${code?` (${code})`:''}${detail?`: ${typeof detail==='string'?detail:JSON.stringify(detail)}`:''}`);
  }
}

async function createPayment({amount,description,orderId,payCurrency='usdttrc20'}){
  requireKey();
  const priceAmount=Number(amount);
  if(!Number.isFinite(priceAmount)||priceAmount<1||priceAmount>5000) throw new Error('Amount must be a number between ₹1 and ₹5,000');
  const currency=String(payCurrency||'usdttrc20').trim().toLowerCase();
  try{
    const {data}=await api.post('/v1/payment',{
      price_amount:priceAmount,
      price_currency:'inr',
      pay_currency:currency,
      ipn_callback_url:`${publicBaseUrl}/api/nowpayments/webhook`,
      order_id:String(orderId),
      order_description:String(description||'Anime Cloud Pay Crypto Order').slice(0,255)
    });
    return data;
  }catch(e){
    const code=e.response?.status;
    const body=e.response?.data;
    const detail=body?.message||body?.error||body?.errors;
    throw new Error(`NOWPayments create-payment failed${code?` (${code})`:''}${detail?`: ${typeof detail==='string'?detail:JSON.stringify(detail)}`:''}`);
  }
}

async function status(paymentId){
  requireKey();
  if(!paymentId) throw new Error('Missing NOWPayments payment ID');
  try{
    const {data}=await api.get(`/v1/payment/${encodeURIComponent(paymentId)}`);
    return data;
  }catch(e){
    const code=e.response?.status;
    const body=e.response?.data;
    const detail=body?.message||body?.error;
    throw new Error(`NOWPayments payment-status failed${code?` (${code})`:''}${detail?`: ${detail}`:''}`);
  }
}

function sortObject(value){
  if(Array.isArray(value)) return value.map(sortObject);
  if(value&&typeof value==='object') return Object.keys(value).sort().reduce((out,k)=>{out[k]=sortObject(value[k]);return out;},{});
  return value;
}

function verifyWebhook(payload,signature){
  if(!nowPaymentsIpnSecret||!signature) return false;
  const expected=crypto.createHmac('sha512',String(nowPaymentsIpnSecret).trim()).update(JSON.stringify(sortObject(payload))).digest('hex');
  const a=Buffer.from(expected,'utf8');
  const b=Buffer.from(String(signature),'utf8');
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

module.exports={createInvoice,createPayment,status,verifyWebhook};
