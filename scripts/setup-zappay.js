const fs=require('fs');
const path=require('path');
const readline=require('readline');

const envPath=path.resolve(process.cwd(),'.env');

if(!fs.existsSync(envPath)){
  console.error('❌ .env file not found. Create it first.');
  process.exit(1);
}

function askHidden(question){
  return new Promise(resolve=>{
    const rl=readline.createInterface({input:process.stdin,output:process.stdout});
    const stdin=process.stdin;
    const stdout=process.stdout;
    let value='';
    stdout.write(question);
    stdin.setRawMode?.(true);
    stdin.resume();
    const onData=chunk=>{
      const key=chunk.toString();
      if(key==='\u0003'){
        stdin.setRawMode?.(false);
        stdin.off('data',onData);
        rl.close();
        console.log('\nCancelled.');
        process.exit(1);
      }
      if(key==='\r'||key==='\n'){
        stdin.setRawMode?.(false);
        stdin.off('data',onData);
        rl.close();
        stdout.write('\n');
        resolve(value.trim());
        return;
      }
      if(key==='\u007f'||key==='\b'){
        if(value.length){value=value.slice(0,-1);stdout.write('\b \b');}
        return;
      }
      if(key.length===1){value+=key;stdout.write('*');}
    };
    stdin.on('data',onData);
  });
}

function setEnv(content,key,value){
  const line=`${key}=${value}`;
  const re=new RegExp(`^${key}=.*$`,'m');
  if(re.test(content)) return content.replace(re,line);
  return content.trimEnd()+`\n${line}\n`;
}

(async()=>{
  console.log('☁️ Anime Cloud Pay — ZapPay Setup');
  console.log('This updates only ZAPPAY_API_KEY in your local .env file.\n');
  const key=await askHidden('Enter new ZapPay API key: ');
  if(!key){console.error('❌ API key cannot be empty.');process.exit(1);}
  let content=fs.readFileSync(envPath,'utf8');
  content=setEnv(content,'ZAPPAY_API_KEY',key);
  fs.writeFileSync(envPath,content,{mode:0o600});
  console.log('✅ ZapPay API key saved to .env');
  console.log('🔄 Restart the bot with: pm2 restart anime-cloud-pay');
})().catch(err=>{console.error('❌ Setup failed:',err.message);process.exit(1);});
