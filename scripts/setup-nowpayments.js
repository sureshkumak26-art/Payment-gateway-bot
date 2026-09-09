const fs=require('fs');
const path=require('path');
const readline=require('readline');

const envPath=path.resolve(process.cwd(),'.env');

if(!fs.existsSync(envPath)){
  console.error('❌ .env file not found. Create it first.');
  process.exit(1);
}

function ask(question,hidden=false){
  return new Promise(resolve=>{
    const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:true});
    if(hidden){
      const original=rl._writeToOutput;
      rl._writeToOutput=()=>{};
      rl.question(question,value=>{rl._writeToOutput=original;rl.close();console.log();resolve(value.trim());});
    }else{
      rl.question(question,value=>{rl.close();resolve(value.trim());});
    }
  });
}

function setEnv(content,key,value){
  const line=`${key}=${value}`;
  const re=new RegExp(`^${key}=.*$`,'m');
  if(re.test(content)) return content.replace(re,line);
  return content.trimEnd()+`\n${line}\n`;
}

(async()=>{
  console.log('☁️ Anime Cloud Pay — NOWPayments Setup');
  console.log('This updates only NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET in .env.\n');
  const apiKey=await ask('Enter NOWPayments API key: ',true);
  if(!apiKey){console.error('❌ API key cannot be empty.');process.exit(1);}
  const ipnSecret=await ask('Enter NOWPayments IPN secret: ',true);
  if(!ipnSecret){console.error('❌ IPN secret cannot be empty.');process.exit(1);}
  let content=fs.readFileSync(envPath,'utf8');
  content=setEnv(content,'NOWPAYMENTS_API_KEY',apiKey);
  content=setEnv(content,'NOWPAYMENTS_IPN_SECRET',ipnSecret);
  content=setEnv(content,'NOWPAYMENTS_API_BASE_URL','https://api.nowpayments.io');
  fs.writeFileSync(envPath,content,{mode:0o600});
  try{fs.chmodSync(envPath,0o600);}catch{}
  console.log('✅ NOWPayments API key saved.');
  console.log('✅ NOWPayments IPN secret saved.');
  console.log('🔄 Restart with: pm2 restart anime-cloud-pay');
})().catch(err=>{console.error('❌ Setup failed:',err.message);process.exit(1);});
