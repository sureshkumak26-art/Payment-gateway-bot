const {Client,GatewayIntentBits,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder}=require('discord.js');
const crypto=require('crypto');
const cfg=require('./config');
const {createOrder}=require('./zappay');
const {createInvoice,getCurrencies}=require('./plisio');
const {PaymentLink,Transaction}=require('./models');

const buttons=amount=>new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`prefix_pay_upi:${amount}`).setLabel('UPI').setEmoji('🟢').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`prefix_pay_crypto:${amount}`).setLabel('Crypto').setEmoji('🪙').setStyle(ButtonStyle.Primary)
);

async function upi(user,amount,guild){
  const linkId='AC-'+crypto.randomBytes(6).toString('hex').toUpperCase();
  const p=await createOrder(amount,'Payment');
  const oid=p?.data?.order_id,url=p?.data?.payment_url;
  if(!oid||!url)throw new Error('ZapPay did not return a valid payment link');
  await PaymentLink.create({linkId,orderId:String(oid),amount,description:'Payment',paymentUrl:url,paymentMethod:'UPI',provider:'zappay',discordUserId:user.id,discordUsername:user.username,guildId:guild?.id,guildName:guild?.name,expiresAt:new Date(Date.now()+86400000),providerResponse:p});
  await Transaction.create({orderId:String(oid),linkId,amount,description:'Payment',paymentMethod:'UPI',provider:'zappay',discordUserId:user.id,discordUsername:user.username,guildId:guild?.id,guildName:guild?.name});
  return {oid,url};
}

async function cryptoPay(user,amount,currency,guild){
  if(!cfg.plisioSecretKey)throw new Error('Plisio is not configured. Run `npm run setup:plisio`.');
  const linkId='AC-CRYPTO-'+crypto.randomBytes(6).toString('hex').toUpperCase();
  const p=await createInvoice({amount,description:'Payment',orderNumber:linkId,currency});
  const txn=p?.data?.txn_id,url=p?.data?.invoice_url;
  if(!txn||!url)throw new Error('Plisio did not return a valid invoice');
  const cc=p?.data?.currency||currency,ca=Number(p?.data?.amount),oid=`PL-${txn}`;
  const common={linkId,orderId:oid,amount,description:'Payment',paymentUrl:url,paymentMethod:'CRYPTO',provider:'plisio',providerPaymentId:String(txn),cryptoCurrency:cc,cryptoAmount:Number.isFinite(ca)?ca:undefined,discordUserId:user.id,discordUsername:user.username,guildId:guild?.id,guildName:guild?.name,expiresAt:new Date(Date.now()+86400000),providerResponse:p};
  await PaymentLink.create(common);
  await Transaction.create({...common});
  return {oid,url,cc};
}

function install(bot){
  if(bot.__prefixPayInstalled)return;
  bot.__prefixPayInstalled=true;
  bot.on('messageCreate',async m=>{
    try{
      if(m.author?.bot||!m.guild)return;
      const content=String(m.content||'').trim();
      const match=content.match(/^\.pay(?:\s+([0-9]+(?:\.[0-9]+)?))?\s*$/i);
      if(!match)return;
      if(!m.member?.permissions?.has('Administrator')){
        await m.reply('❌ **Administrator permission required.**').catch(()=>{});
        return;
      }
      if(!match[1]){
        await m.reply('💳 **Anime Cloud Pay**\n\nUsage: `.pay <amount>`\nExample: `.pay 100`').catch(()=>{});
        return;
      }
      const amount=Number(match[1]);
      if(!Number.isFinite(amount)||amount<1||amount>5000){
        await m.reply('❌ Amount must be between **₹1 and ₹5,000**.').catch(()=>{});
        return;
      }
      await m.reply({content:`💳 **Anime Cloud Pay**\n\nAmount: **₹${amount.toFixed(2)}**\nSelect payment method:`,components:[buttons(amount)]});
    }catch(e){
      console.error('.pay message handler:',e);
      await m.reply(`❌ ${e.message||'Payment setup failed.'}`).catch(()=>{});
    }
  });

  bot.on('interactionCreate',async i=>{
    try{
      if(i.isButton()&&i.customId.startsWith('prefix_pay_upi:')){
        const amount=Number(i.customId.split(':')[1]);
        await i.deferUpdate();
        const p=await upi(i.user,amount,i.guild);
        return i.editReply({content:`🔗 **UPI Payment Link Created**\n\nAmount: ₹${amount.toFixed(2)}\nOrder: \`${p.oid}\`\n\n💳 **Pay Now:** ${p.url}`,components:[]});
      }
      if(i.isButton()&&i.customId.startsWith('prefix_pay_crypto:')){
        const amount=Number(i.customId.split(':')[1]);
        await i.deferUpdate();
        const cs=await getCurrencies();
        if(!cs.length)return i.editReply({content:'❌ No active Plisio currencies available.',components:[]});
        const opts=cs.slice(0,25).map(c=>({label:`${String(c.name||c.currency||c.cid).slice(0,70)} (${String(c.cid||c.currency).slice(0,20)})`,value:String(c.cid||c.currency).slice(0,100),description:String(c.currency||c.cid||'Crypto').slice(0,100)}));
        return i.editReply({content:`🪙 **Select Cryptocurrency**\n\nAmount: **₹${amount.toFixed(2)}**`,components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`prefix_pay_currency:${amount}`).setPlaceholder('Select cryptocurrency').addOptions(opts))]});
      }
      if(i.isStringSelectMenu()&&i.customId.startsWith('prefix_pay_currency:')){
        const amount=Number(i.customId.split(':')[1]);
        const currency=String(i.values[0]).trim().toUpperCase();
        await i.deferUpdate();
        const p=await cryptoPay(i.user,amount,currency,i.guild);
        return i.editReply({content:`🪙 **Crypto Payment Link Created**\n\nAmount: ₹${amount.toFixed(2)}\nCurrency: **${p.cc}**\nOrder: \`${p.oid}\`\n\n🌐 **Pay with Crypto:** ${p.url}`,components:[]});
      }
    }catch(e){
      console.error('Prefix payment interaction:',e);
      if(i.deferred||i.replied)i.editReply({content:`❌ ${e.message||'Payment creation failed.'}`,components:[]}).catch(()=>{});
      else i.reply({content:`❌ ${e.message||'Payment creation failed.'}`,ephemeral:true}).catch(()=>{});
    }
  });
}

const originalLogin=Client.prototype.login;
Client.prototype.login=async function(token){
  this.options.intents.add(GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent);
  install(this);
  console.log('✅ .pay prefix command enabled');
  return originalLogin.call(this,token);
};

module.exports={install};
