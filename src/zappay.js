const axios=require('axios');
const {zapPayApiKey,zapPayBaseUrl,publicBaseUrl}=require('./config');

const api=axios.create({
  baseURL:zapPayBaseUrl,
  timeout:15000,
  headers:{
    'Content-Type':'application/json',
    'X-ZapAPI-Key':zapPayApiKey
  }
});

async function createOrder(amount,title){
  const cleanAmount=Number(amount);
  if(!Number.isFinite(cleanAmount)||cleanAmount<1||cleanAmount>5000){
    throw new Error('Amount must be a number between ₹1 and ₹5,000');
  }
  try{
    const {data}=await api.post('/api/developer/create-order',{
      amount:cleanAmount,
      title:String(title||'Anime Cloud Pay Order').slice(0,100),
      redirect_url:`${publicBaseUrl}/callback`,
      useEmbedded:false
    });
    return data;
  }catch(e){
    const status=e.response?.status;
    const body=e.response?.data;
    const detail=body?.message||body?.error||body?.details;
    throw new Error(`ZapPay create-order failed${status?` (${status})`:''}${detail?`: ${detail}`:''}`);
  }
}

async function status(orderId){
  if(!orderId) throw new Error('Missing ZapPay order ID');
  try{
    const {data}=await api.get(`/api/developer/order-status/${encodeURIComponent(orderId)}`);
    return data;
  }catch(e){
    const code=e.response?.status;
    const body=e.response?.data;
    const detail=body?.message||body?.error;
    throw new Error(`ZapPay order-status failed${code?` (${code})`:''}${detail?`: ${detail}`:''}`);
  }
}

module.exports={createOrder,status};
