const axios=require('axios');
const {zapPayApiKey,zapPayBaseUrl,publicBaseUrl}=require('./config');
const api=axios.create({baseURL:zapPayBaseUrl,timeout:15000,headers:{'Content-Type':'application/json','X-API-Key':zapPayApiKey,'Authorization':`Bearer ${zapPayApiKey}`}});
async function createOrder(orderId,amount,description){const {data}=await api.post('/api/developer/create-order',{orderId,amount:Number(amount),description,callbackUrl:`${publicBaseUrl}/callback`,webhookUrl:`${publicBaseUrl}/api/zappay/webhook`});return data;}
async function status(orderId){const {data}=await api.get(`/api/developer/order-status/${encodeURIComponent(orderId)}`);return data;}
module.exports={createOrder,status};