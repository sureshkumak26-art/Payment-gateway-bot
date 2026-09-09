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

const baseUrl=(process.env.ZAPPAY_API_BASE_URL||'https://zappay-beta.vercel.app').replace(/\/$/,'');

function askHidden(question){
  return new Promise((resolve,reject)=>{
    const stdin=process.stdin;
    const stdout=process.stdout;

    if(!stdin.isTTY){
      reject(new Error('Interactive terminal input is required. Run: npm run setup'));
      return;
    }

    let value='';
    let finished=false;

    const cleanup=()=>{
      if(finished) return;
      finished=true;
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.off('data',onData);
    };

    const onData=chunk=>{
      const input=chunk.toString('utf8');

      if(input.includes('\u0003')){
        cleanup();
        stdout.write('\n');
        reject(new Error('Cancelled.'));
        return;
      }

      for(const char of input){
        if(char==='\r'||char==='\n'){
          cleanup();
          stdout.write('\n');
          resolve(value.trim());
          return;
        }

        if(char==='\u007f'||char==='\b'){
          if(value.length){
            value=value.slice(0,-1);
            stdout.write('\b \b');
          }
          continue;
        }

        if(char==='\u001b') continue;
        if(char.charCodeAt(0)<32) continue;

        value+=char;
        stdout.write('*');
      }
    };

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data',onData);
  });
}

function setEnv(content,key,value){
  const line=`${key}=${value}`;
  const re=new RegExp(`^${key}=.*$`,'m');
  if(re.test(content)) return content.replace(re,line);
  return content.trimEnd()+`\n${line}\n`;
}

async function validateKey(key){
  try{
    const response=await axios.get(`${baseUrl}/api/developer/order-status/__setup_check__`,{
      timeout:10000,
      headers:{'X-ZapAPI-Key':key}
    });

    return {ok:true,message:`ZapPay accepted the API key (HTTP ${response.status}).`};
  }catch(e){
    const code=e.response?.status;
    if(code===404){
      return {ok:true,message:'ZapPay accepted the API key (test order not found, which is expected).'};
    }
    if(code===401){
      return {ok:false,message:'ZapPay rejected this API key (401 Invalid ZapAPI key).'};
    }
    return {ok:false,message:`ZapPay validation failed${code?` (HTTP ${code})`:''}.`};
  }
}

(async()=>{
  console.log('☁️ Anime Cloud Pay — ZapPay Setup');
  console.log('This changes only ZAPPAY_API_KEY in your local .env file.');
  console.log('The API key is hidden while you type and is never printed.\n');

  let key;
  try{
    key=await askHidden('Enter new ZapPay API key: ');
  }catch(err){
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  key=String(key||'').trim();
  if(!key){
    console.error('❌ API key cannot be empty.');
    process.exit(1);
  }

  console.log('🔎 Validating ZapPay API key...');
  const result=await validateKey(key);

  if(!result.ok){
    console.error(`❌ ${result.message}`);
    console.error('Nothing was changed in .env.');
    process.exit(1);
  }

  let content=fs.readFileSync(envPath,'utf8');
  content=setEnv(content,'ZAPPAY_API_KEY',key);
  fs.writeFileSync(envPath,content,{mode:0o600});
  try{fs.chmodSync(envPath,0o600);}catch{}

  console.log(`✅ ${result.message}`);
  console.log('✅ ZapPay API key saved to .env');
  console.log('🔄 Restart Anime Cloud Pay to load the new key:');
  console.log('   pm2 restart anime-cloud-pay');
  console.log('   pm2 save');
})().catch(err=>{
  console.error('❌ Setup failed:',err.message);
  process.exit(1);
});
