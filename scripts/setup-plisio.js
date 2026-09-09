const fs=require('fs');
const path=require('path');
const axios=require('axios');
const dotenv=require('dotenv');

const envPath=path.resolve(process.cwd(),'.env');
if(!fs.existsSync(envPath)){
  console.error('❌ .env file not found. Create it first.');
  process.exit(1);
}

dotenv.config({path:envPath});
const baseUrl=(process.env.PLISIO_API_BASE_URL||'https://api.plisio.net/api/v1').replace(/\/$/,'');

function askHidden(question){
  return new Promise((resolve,reject)=>{
    const stdin=process.stdin;
    const stdout=process.stdout;
    if(!stdin.isTTY){reject(new Error('Interactive terminal input is required.'));return;}
    let value='';
    let done=false;
    const cleanup=()=>{if(done)return;done=true;stdin.setRawMode?.(false);stdin.pause();stdin.off('data',onData);};
    const onData=chunk=>{
      for(const char of chunk.toString('utf8')){
        if(char==='\u0003'){cleanup();stdout.write('\n');reject(new Error('Cancelled.'));return;}
        if(char==='\r'||char==='\n'){cleanup();stdout.write('\n');resolve(value.trim());return;}
        if(char==='\u007f'||char==='\b'){if(value.length){value=value.slice(0,-1);stdout.write('\b \b');}continue;}
        if(char.charCodeAt(0)<32)continue;
        value+=char;stdout.write('*');
      }
    };
    stdout.write(question);
    stdin.setRawMode(true);stdin.resume();stdin.on('data',onData);
  });
}

function setEnv(content,key,value){
  const line=`${key}=${value}`;
  const re=new RegExp(`^${key}=.*$`,'m');
  if(re.test(content))return content.replace(re,line);
  return content.trimEnd()+`\n${line}\n`;
}

async function validateKey(key){
  try{
    const {data}=await axios.get(`${baseUrl}/currencies/BTC`,{params:{api_key:key},timeout:10000});
    if(data?.status==='success')return {ok:true,message:'Plisio accepted the secret key.'};
    return {ok:false,message:data?.data?.message||'Plisio rejected the secret key.'};
  }catch(e){
    const code=e.response?.status;
    const message=e.response?.data?.data?.message||e.response?.data?.message||e.message;
    return {ok:false,message:`Plisio validation failed${code?` (HTTP ${code})`:''}: ${message}`};
  }
}

(async()=>{
  console.log('☁️ Anime Cloud Pay — Plisio Setup');
  console.log('This changes only PLISIO_SECRET_KEY and PLISIO_API_BASE_URL in .env.');
  console.log('The secret key is hidden while you type and is never printed.\n');
  let key;
  try{key=await askHidden('Enter Plisio Secret Key: ');}catch(e){console.error(`❌ ${e.message}`);process.exit(1);}
  if(!key){console.error('❌ Secret key cannot be empty.');process.exit(1);}
  console.log('🔎 Validating Plisio secret key...');
  const result=await validateKey(key);
  if(!result.ok){console.error(`❌ ${result.message}`);console.error('Nothing was changed in .env.');process.exit(1);}
  let content=fs.readFileSync(envPath,'utf8');
  content=setEnv(content,'PLISIO_SECRET_KEY',key);
  content=setEnv(content,'PLISIO_API_BASE_URL','https://api.plisio.net/api/v1');
  fs.writeFileSync(envPath,content,{mode:0o600});
  try{fs.chmodSync(envPath,0o600);}catch{}
  console.log('✅ Plisio secret key saved to .env');
  console.log('📌 Callback URL:');
  console.log('   https://YOUR-PAYMENT-DOMAIN/api/plisio/webhook?json=true');
  console.log('🔄 Restart Anime Cloud Pay: pm2 restart anime-cloud-pay');
})().catch(e=>{console.error('❌ Setup failed:',e.message);process.exit(1);});
