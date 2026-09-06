const express=require('express');
const crypto=require('crypto');
const {Client,GatewayIntentBits,SlashCommandBuilder,REST,Routes,PermissionFlagsBits}=require('discord.js');
const connect=require('./db');
const {PaymentLink,Transaction}=require('./models');
const {createOrder,status}=require('./zappay');
const cfg=require('./config');

const startedAt=Date.now();

async function finalizePayment(x,s){
  const providerStatus=String(s?.data?.status||'').toLowerCase();
  const providerAmount=Number(s?.data?.amount);
  if(s?.success!==true||providerStatus!=='success') return false;
  if(!Number.isFinite(providerAmount)||providerAmount!==Number(x.amount)) throw new Error('Payment amount mismatch');
  if(x.status!=='PAID'){
    x.status='PAID';
    x.paidAt=new Date();
    x.providerResponse=s;
    await x.save();
    await Transaction.updateOne({orderId:x.orderId},{$set:{status:'PAID',providerStatus:'success',paidAt:x.paidAt,providerResponse:s}});
  }
  return true;
}

function uptime(){
  const seconds=Math.floor((Date.now()-startedAt)/1000);
  const d=Math.floor(seconds/86400),h=Math.floor(seconds%86400/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

async function checkZapPay(){
  try{
    if(!cfg.zapPayApiKey) return false;
    const response=await require('./zappay').status('__healthcheck__');
    return !!response;
  }catch(e){
    return e?.response?.status===404 || String(e?.message||'').includes('(404)');
  }
}

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
    r.send(`<!doctype html><meta name="viewport" content="width=device-width"><title>${cfg.brandName}</title><body style="font-family:system-ui;background:#090b12;color:white;display:grid;place-items:center;min-height:100vh"><main style="padding:30px;background:#111522;border-radius:20px;width:min(90%,420px)"><h1>${cfg.brandName}</h1><h2>₹${x.amount.toFixed(2)}</h2><p>${x.description}</p><p>Status: <b>${x.status}</b></p>${x.status==='PENDING'?`<a href="${x.paymentUrl}" target="_blank" style="display:block;padding:14px;background:#6d5dfc;color:white;text-align:center;border-radius:12px;text-decoration:none">Pay with UPI</a>`:''}<p>Order: ${x.orderId}</p></main></body>`);
  });
  app.get('/api/payment/status/:id',async(q,r)=>{
    try{
      const x=await PaymentLink.findOne({linkId:q.params.id});
      if(!x)return r.status(404).json({error:'not_found'});
      const s=await status(x.orderId);
      await finalizePayment(x,s);
      r.json({orderId:x.orderId,status:x.status});
    }catch(e){r.status(502).json({error:e.message||'provider_unavailable'});}
  });
  app.post('/api/zappay/webhook',async(q,r)=>{
    if(cfg.webhookSecret&&q.get('x-webhook-secret')!==cfg.webhookSecret)return r.status(401).json({error:'unauthorized'});
    const id=q.body?.order_id||q.body?.orderId||q.body?.data?.order_id||q.body?.data?.orderId;
    if(!id)return r.status(400).json({error:'missing_order_id'});
    try{
      const x=await PaymentLink.findOne({orderId:id});
      if(x){const s=await status(id);await finalizePayment(x,s);}
      r.json({ok:true});
    }catch(e){r.status(202).json({ok:false});}
  });
  app.listen(cfg.port,()=>console.log(`Web/API :${cfg.port}`));

  const bot=new Client({intents:[GatewayIntentBits.Guilds]});
  const commands=[
    new SlashCommandBuilder().setName('create-link').setDescription('Create a ZapPay payment link').addNumberOption(o=>o.setName('amount').setDescription('INR 1-5000').setRequired(true)).addStringOption(o=>o.setName('description').setDescription('Description').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('transaction').setDescription('Check transaction').addStringOption(o=>o.setName('order_id').setDescription('ZapPay order ID').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('stats').setDescription('Payment statistics').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('status').setDescription('Check Anime Cloud Pay system status').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('help').setDescription('Show Anime Cloud Pay commands').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ];

  bot.once('ready',async()=>{
    const rest=new REST({version:'10'}).setToken(cfg.discordToken);
    await rest.put(cfg.discordGuildId?Routes.applicationGuildCommands(cfg.discordClientId,cfg.discordGuildId):Routes.applicationCommands(cfg.discordClientId),{body:commands.map(x=>x.toJSON())});
    console.log(`Logged in as ${bot.user.tag}`);
  });

  bot.on('interactionCreate',async i=>{
    if(!i.isChatInputCommand())return;
    if(!i.memberPermissions?.has(PermissionFlagsBits.Administrator)){
      return i.reply({content:'❌ **Administrator permission required.**',ephemeral:true});
    }
    await i.deferReply({ephemeral:false});
    try{
      if(i.commandName==='help'){
        return i.editReply('☁️ **Anime Cloud Pay — Help**\n\n🔐 **Payment Commands**\n`/create-link` — Create a UPI payment link\n`/transaction` — Check a transaction\n`/stats` — View payment statistics\n\n🛠️ **System Commands**\n`/status` — Check bot, API, database and ZapPay status\n`/help` — Show this help menu\n\n🔒 All commands are **Administrator-only**.');
      }
      if(i.commandName==='status'){
        let dbStatus='🟢 Operational';
        try{await PaymentLink.findOne().select('_id').lean().limit(1);}catch(e){dbStatus='🔴 Offline';}
        let apiStatus='🟢 Operational';
        try{await require('axios').get(`http://127.0.0.1:${cfg.port}/health`,{timeout:3000});}catch(e){apiStatus='🔴 Offline';}
        let zapStatus='🟡 Checking';
        try{await checkZapPay();zapStatus='🟢 Configured';}catch(e){zapStatus='🔴 Unavailable';}
        return i.editReply(`☁️ **Anime Cloud Pay — System Status**\n\n🤖 Discord Bot — 🟢 Operational\n🌐 Web/API — ${apiStatus}\n🗄️ MongoDB — ${dbStatus}\n💳 ZapPay — ${zapStatus}\n\n**Uptime:** ${uptime()}\n**Overall:** 🟢 System Online\n**Last Check:** <t:${Math.floor(Date.now()/1000)}:R>`);
      }
      if(i.commandName==='create-link'){
        const amount=Number(i.options.getNumber('amount'));
        if(!Number.isFinite(amount)||amount<1||amount>5000)throw Error('Amount must be ₹1–₹5,000');
        const linkId='AC-'+crypto.randomBytes(6).toString('hex').toUpperCase();
        const d=i.options.getString('description');
        const p=await createOrder(amount,d);
        const providerOrderId=p?.data?.order_id;
        const url=p?.data?.payment_url;
        const providerAmount=Number(p?.data?.amount);
        if(!providerOrderId)throw Error('ZapPay did not return an order ID');
        if(!url)throw Error('ZapPay did not return a payment URL');
        if(!Number.isFinite(providerAmount)||providerAmount!==amount)throw Error('ZapPay returned an unexpected amount');
        await PaymentLink.create({linkId,orderId:providerOrderId,amount,description:d,paymentUrl:url,discordUserId:i.user.id,discordUsername:i.user.username,expiresAt:new Date(Date.now()+86400000),providerResponse:p});
        await Transaction.create({orderId:providerOrderId,linkId,amount,description:d,discordUserId:i.user.id,discordUsername:i.user.username});
        await i.editReply(`🔗 **Payment Link Created**\nAmount: ₹${amount.toFixed(2)}\nOrder: \`${providerOrderId}\`\n\n💳 **Pay Now:** ${url}`);
      }else if(i.commandName==='transaction'){
        const id=i.options.getString('order_id');
        const x=await PaymentLink.findOne({orderId:id});
        if(!x)return i.editReply('❌ Not found');
        const s=await status(id);
        await finalizePayment(x,s);
        await i.editReply(`Order: \`${id}\`\nAmount: ₹${x.amount}\nStatus: **${x.status}**`);
      }else{
        const rows=await Transaction.find({status:'PAID'});
        const total=rows.reduce((a,x)=>a+Number(x.amount||0),0);
        await i.editReply(`📊 Paid: **${rows.length}**\nRevenue: **₹${total.toFixed(2)}**`);
      }
    }catch(e){await i.editReply(`❌ ${e.message}`);}
  });
  await bot.login(cfg.discordToken);
}

main().catch(e=>{console.error(e);process.exit(1)});
