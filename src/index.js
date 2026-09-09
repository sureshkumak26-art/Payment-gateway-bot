const express=require('express');
const crypto=require('crypto');
const {Client,GatewayIntentBits,SlashCommandBuilder,REST,Routes,PermissionFlagsBits}=require('discord.js');
const connect=require('./db');
const {PaymentLink,Transaction}=require('./models');
const {createOrder,status:zapStatus}=require('./zappay');
const {createInvoice,status:plisioStatus,verifyWebhook:verifyPlisioWebhook}=require('./plisio');
const cfg=require('./config');

const startedAt=Date.now();

async function finalizeZapPayment(x,s){
  const providerStatus=String(s?.data?.status||'').toLowerCase();
  const providerAmount=Number(s?.data?.amount);
  if(s?.success!==true||providerStatus!=='success') return false;
  if(!Number.isFinite(providerAmount)||providerAmount!==Number(x.amount)) throw new Error('Payment amount mismatch');
  if(x.status!=='PAID'){
    x.status='PAID';x.paidAt=new Date();x.providerStatus='success';x.providerResponse=s;
    await x.save();
    await Transaction.updateOne({orderId:x.orderId},{$set:{status:'PAID',providerStatus:'success',paidAt:x.paidAt,providerResponse:s}});
  }
  return true;
}

async function finalizePlisioPayment(x,payment){
  const data=payment?.data||payment;
  const providerStatus=String(data?.status||'').toLowerCase();
  const sourceAmount=Number(data?.params?.source_amount??data?.source_amount);
  if(providerStatus==='completed'){
    if(Number.isFinite(sourceAmount)&&sourceAmount!==Number(x.amount)) throw new Error('Plisio payment amount mismatch');
    x.status='PAID';x.paidAt=x.paidAt||new Date();x.providerStatus='completed';
    x.providerPaymentId=String(data?.id||x.providerPaymentId||'');x.providerResponse=payment;
    await x.save();
    await Transaction.updateOne({orderId:x.orderId},{$set:{status:'PAID',providerStatus:'completed',providerPaymentId:x.providerPaymentId,paidAt:x.paidAt,providerResponse:payment}});
    return true;
  }
  if(['expired','cancelled','error'].includes(providerStatus)){
    x.status='FAILED';x.providerStatus=providerStatus;x.providerPaymentId=String(data?.id||x.providerPaymentId||'');x.providerResponse=payment;
    await x.save();
    await Transaction.updateOne({orderId:x.orderId},{$set:{status:'FAILED',providerStatus:providerStatus,providerPaymentId:x.providerPaymentId,providerResponse:payment}});
    return false;
  }
  x.providerStatus=providerStatus||x.providerStatus;x.providerPaymentId=String(data?.id||x.providerPaymentId||'');x.providerResponse=payment||x.providerResponse;
  await x.save();
  await Transaction.updateOne({orderId:x.orderId},{$set:{providerStatus:x.providerStatus,providerPaymentId:x.providerPaymentId,providerResponse:x.providerResponse}});
  return false;
}

function uptime(){
  const seconds=Math.floor((Date.now()-startedAt)/1000);
  const d=Math.floor(seconds/86400),h=Math.floor(seconds%86400/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

function esc(v){return String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

async function main(){
  await connect();
  const app=express();
  app.use(express.json());
  app.use(express.static('public'));
  app.get('/health',async(_,r)=>r.json({ok:true,service:cfg.brandName,uptime:process.uptime()}));
  app.get('/callback',(_,r)=>r.redirect('/'));

  app.get('/pay/:id',async(q,r)=>{
    const x=await PaymentLink.findOne({linkId:q.params.id}).lean();
    if(!x)return r.status(404).send('Payment link not found');
    const cryptoPayment=x.paymentMethod==='CRYPTO';
    const provider=x.provider==='plisio'?'Plisio':'ZapPay';
    const button=cryptoPayment?'Pay with Crypto':'Pay with UPI';
    r.send(`<!doctype html><meta name="viewport" content="width=device-width"><title>${esc(cfg.brandName)}</title><body style="font-family:system-ui;background:#090b12;color:white;display:grid;place-items:center;min-height:100vh;margin:0"><main style="padding:30px;background:#111522;border-radius:20px;width:min(90%,420px)"><h1>${esc(cfg.brandName)}</h1><p style="opacity:.7">${provider} checkout</p><h2>₹${Number(x.amount).toFixed(2)}</h2><p>${esc(x.description)}</p><p>Status: <b id="status">${esc(x.status)}</b></p>${x.status==='PENDING'?`<a href="${esc(x.paymentUrl)}" target="_blank" rel="noopener" style="display:block;padding:14px;background:#6d5dfc;color:white;text-align:center;border-radius:12px;text-decoration:none">${button}</a>`:''}<p>Order: ${esc(x.orderId)}</p></main><script>setInterval(async()=>{try{const r=await fetch('/api/payment/status/${encodeURIComponent(x.linkId)}');const d=await r.json();if(d.status){document.getElementById('status').textContent=d.status;if(d.status==='PAID')location.reload();}}catch{}},5000);</script></body>`);
  });

  app.get('/api/payment/status/:id',async(q,r)=>{
    try{
      const x=await PaymentLink.findOne({linkId:q.params.id});
      if(!x)return r.status(404).json({error:'not_found'});
      if(x.paymentMethod==='CRYPTO'){
        if(x.providerPaymentId){const s=await plisioStatus(x.providerPaymentId);await finalizePlisioPayment(x,s);}
      }else{
        const s=await zapStatus(x.orderId);await finalizeZapPayment(x,s);
      }
      r.json({orderId:x.orderId,status:x.status,paymentMethod:x.paymentMethod,provider:x.provider,providerStatus:x.providerStatus||null});
    }catch(e){r.status(502).json({error:e.message||'provider_unavailable'});}
  });

  app.post('/api/zappay/webhook',async(q,r)=>{
    if(cfg.webhookSecret&&q.get('x-webhook-secret')!==cfg.webhookSecret)return r.status(401).json({error:'unauthorized'});
    const id=q.body?.order_id||q.body?.orderId||q.body?.data?.order_id||q.body?.data?.orderId;
    if(!id)return r.status(400).json({error:'missing_order_id'});
    try{
      const x=await PaymentLink.findOne({orderId:String(id),paymentMethod:'UPI'});
      if(x){const s=await zapStatus(String(id));await finalizeZapPayment(x,s);}
      r.json({ok:true});
    }catch(e){r.status(202).json({ok:false});}
  });

  app.post('/api/plisio/webhook',async(q,r)=>{
    if(!cfg.plisioSecretKey)return r.status(503).json({error:'Plisio secret key not configured'});
    if(!verifyPlisioWebhook(q.body))return r.status(401).json({error:'invalid_signature'});
    const linkId=String(q.body?.order_number||'').trim();
    const txnId=String(q.body?.txn_id||'').trim();
    if(!linkId)return r.status(400).json({error:'missing_order_number'});
    try{
      const x=await PaymentLink.findOne({linkId,paymentMethod:'CRYPTO',provider:'plisio'});
      if(!x)return r.status(404).json({error:'payment_link_not_found'});
      const sourceAmount=Number(q.body?.source_amount);
      if(Number.isFinite(sourceAmount)&&sourceAmount!==Number(x.amount))return r.status(400).json({error:'amount_mismatch'});
      if(txnId)x.providerPaymentId=txnId;
      if(String(q.body?.status||'').toLowerCase()==='completed'&&txnId){
        const verified=await plisioStatus(txnId);
        await finalizePlisioPayment(x,verified);
      }else{
        await finalizePlisioPayment(x,q.body);
      }
      r.json({ok:true});
    }catch(e){console.error('Plisio webhook:',e.message);r.status(202).json({ok:false});}
  });

  app.listen(cfg.port,()=>console.log(`Web/API :${cfg.port}`));

  const bot=new Client({intents:[GatewayIntentBits.Guilds]});
  const commands=[
    new SlashCommandBuilder().setName('create-link').setDescription('Create a ZapPay UPI payment link').addNumberOption(o=>o.setName('amount').setDescription('INR 1-5000').setRequired(true)).addStringOption(o=>o.setName('description').setDescription('Description').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('create-crypto-link').setDescription('Create a Plisio crypto payment link').addNumberOption(o=>o.setName('amount').setDescription('INR 1-5000').setRequired(true)).addStringOption(o=>o.setName('description').setDescription('Description').setRequired(true)).addStringOption(o=>o.setName('currency').setDescription('Optional crypto code, e.g. BTC or ETH').setRequired(false).setMaxLength(20)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('transaction').setDescription('Check transaction').addStringOption(o=>o.setName('order_id').setDescription('Payment order ID or link ID').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('stats').setDescription('Payment statistics').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('status').setDescription('Check Anime Cloud Pay system status').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('help').setDescription('Show Anime Cloud Pay commands').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ];

  bot.once('ready',async()=>{
    const rest=new REST({version:'10'}).setToken(cfg.discordToken);
    await rest.put(Routes.applicationCommands(cfg.discordClientId),{body:commands.map(x=>x.toJSON())});
    console.log(`Logged in as ${bot.user.tag} | Multi-server mode enabled`);
  });

  bot.on('interactionCreate',async i=>{
    if(!i.isChatInputCommand())return;
    if(!i.memberPermissions?.has(PermissionFlagsBits.Administrator))return i.reply({content:'❌ **Administrator permission required.**',ephemeral:true});
    if(!i.guildId)return i.reply({content:'❌ This command can only be used inside a Discord server.',ephemeral:true});
    await i.deferReply({ephemeral:false});
    try{
      if(i.commandName==='help')return i.editReply('☁️ **Anime Cloud Pay — Help**\n\n💳 **Payment Commands**\n`/create-link` — Create a ZapPay UPI payment link\n`/create-crypto-link` — Create a Plisio crypto payment link\n`/transaction` — Check any transaction\n`/stats` — View payment statistics\n\n🛠️ **System Commands**\n`/status` — Check bot, API, database, ZapPay and Plisio status\n`/help` — Show this help menu\n\n🔒 All commands are **Administrator-only**.\n🌐 Bot supports **multiple Discord servers**.');

      if(i.commandName==='status'){
        let dbStatus='🟢 Operational';
        try{await PaymentLink.findOne({guildId:i.guildId}).select('_id').lean().limit(1);}catch{dbStatus='🔴 Offline';}
        let apiStatus='🟢 Operational';
        try{await require('axios').get(`http://127.0.0.1:${cfg.port}/health`,{timeout:3000});}catch{apiStatus='🔴 Offline';}
        const plisioStatusText=cfg.plisioSecretKey?'🟢 Configured':'⚪ Not configured';
        return i.editReply(`☁️ **Anime Cloud Pay — System Status**\n\n🤖 Discord Bot — 🟢 Operational\n🌐 Web/API — ${apiStatus}\n🗄️ MongoDB — ${dbStatus}\n💳 ZapPay — ${cfg.zapPayApiKey?'🟢 Configured':'🔴 Missing'}\n🪙 Plisio — ${plisioStatusText}\n\n🏠 **Server:** ${i.guild.name}\n**Uptime:** ${uptime()}\n**Overall:** 🟢 System Online\n**Last Check:** <t:${Math.floor(Date.now()/1000)}:R>`);
      }

      if(i.commandName==='create-link'){
        const amount=Number(i.options.getNumber('amount'));
        if(!Number.isFinite(amount)||amount<1||amount>5000)throw Error('Amount must be ₹1–₹5,000');
        const linkId='AC-'+crypto.randomBytes(6).toString('hex').toUpperCase();
        const d=i.options.getString('description');
        const p=await createOrder(amount,d);
        const providerOrderId=p?.data?.order_id,url=p?.data?.payment_url,providerAmount=Number(p?.data?.amount);
        if(!providerOrderId||!url)throw Error('ZapPay did not return a valid payment order');
        if(!Number.isFinite(providerAmount)||providerAmount!==amount)throw Error('ZapPay returned an unexpected amount');
        await PaymentLink.create({linkId,orderId:String(providerOrderId),amount,description:d,paymentUrl:url,paymentMethod:'UPI',provider:'zappay',discordUserId:i.user.id,discordUsername:i.user.username,guildId:i.guildId,guildName:i.guild.name,expiresAt:new Date(Date.now()+86400000),providerResponse:p});
        await Transaction.create({orderId:String(providerOrderId),linkId,amount,description:d,paymentMethod:'UPI',provider:'zappay',discordUserId:i.user.id,discordUsername:i.user.username,guildId:i.guildId,guildName:i.guild.name});
        return i.editReply(`🔗 **UPI Payment Link Created**\nServer: **${i.guild.name}**\nAmount: ₹${amount.toFixed(2)}\nOrder: \`${providerOrderId}\`\n\n💳 **Pay Now:** ${url}`);
      }

      if(i.commandName==='create-crypto-link'){
        if(!cfg.plisioSecretKey)throw Error('Plisio is not configured. Run `npm run setup:plisio`.');
        const amount=Number(i.options.getNumber('amount'));
        if(!Number.isFinite(amount)||amount<1||amount>5000)throw Error('Amount must be ₹1–₹5,000');
        const linkId='AC-CRYPTO-'+crypto.randomBytes(6).toString('hex').toUpperCase();
        const d=i.options.getString('description');
        const currency=i.options.getString('currency')||'';
        const p=await createInvoice({amount,description:d,orderNumber:linkId,currency});
        const txnId=p?.data?.txn_id,url=p?.data?.invoice_url;
        if(!txnId||!url)throw Error('Plisio did not return a valid invoice');
        const cryptoCurrency=p?.data?.currency||currency||undefined;
        const cryptoAmount=Number(p?.data?.amount);
        const localOrderId=`PL-${txnId}`;
        await PaymentLink.create({linkId,orderId:localOrderId,amount,description:d,paymentUrl:url,paymentMethod:'CRYPTO',provider:'plisio',providerPaymentId:String(txnId),cryptoCurrency,cryptoAmount:Number.isFinite(cryptoAmount)?cryptoAmount:undefined,discordUserId:i.user.id,discordUsername:i.user.username,guildId:i.guildId,guildName:i.guild.name,expiresAt:new Date(Date.now()+86400000),providerResponse:p});
        await Transaction.create({orderId:localOrderId,linkId,amount,description:d,paymentMethod:'CRYPTO',provider:'plisio',providerPaymentId:String(txnId),cryptoCurrency,cryptoAmount:Number.isFinite(cryptoAmount)?cryptoAmount:undefined,discordUserId:i.user.id,discordUsername:i.user.username,guildId:i.guildId,guildName:i.guild.name,providerResponse:p});
        return i.editReply(`🪙 **Plisio Crypto Payment Link Created**\nServer: **${i.guild.name}**\nAmount: ₹${amount.toFixed(2)}${cryptoCurrency?`\nCurrency: **${cryptoCurrency}**`:''}\nOrder: \`${localOrderId}\`\n\n🌐 **Pay with Crypto:** ${url}`);
      }

      if(i.commandName==='transaction'){
        const id=i.options.getString('order_id');
        const x=await PaymentLink.findOne({guildId:i.guildId,$or:[{orderId:id},{linkId:id}]});
        if(!x)return i.editReply('❌ Transaction not found in this server.');
        if(x.paymentMethod==='CRYPTO'&&x.providerPaymentId){const s=await plisioStatus(x.providerPaymentId);await finalizePlisioPayment(x,s);}
        if(x.paymentMethod==='UPI'){const s=await zapStatus(x.orderId);await finalizeZapPayment(x,s);}
        return i.editReply(`🏠 Server: **${i.guild.name}**\nProvider: **${x.provider}**\nOrder: \`${x.orderId}\`\nAmount: ₹${Number(x.amount).toFixed(2)}\nStatus: **${x.status}**${x.providerStatus?`\nProvider Status: **${x.providerStatus}**`:''}`);
      }

      if(i.commandName==='stats'){
        const rows=await Transaction.find({status:'PAID',guildId:i.guildId}).lean();
        const total=rows.reduce((a,x)=>a+Number(x.amount||0),0);
        const upi=rows.filter(x=>x.paymentMethod==='UPI').length;
        const cryptoRows=rows.filter(x=>x.paymentMethod==='CRYPTO').length;
        return i.editReply(`📊 **${i.guild.name} — Payment Statistics**\n\nPaid Transactions: **${rows.length}**\nUPI Payments: **${upi}**\nCrypto Payments: **${cryptoRows}**\nRevenue: **₹${total.toFixed(2)}**`);
      }
    }catch(e){return i.editReply(`❌ ${e.message}`);}
  });

  await bot.login(cfg.discordToken);
}

main().catch(e=>{console.error(e);process.exit(1);});
