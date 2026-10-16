const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../src/tg_auth.js'),'utf8');
const ctx={path,SESSIONS_DIR:'/synthetic/tg_sessions'};vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('function sessionPath('),src.indexOf('const ENCRYPTION_SALT')),ctx);
for(const sid of ['../sentinel','/tmp/sentinel','session_../x','session_a/b','session_a\\b','session_%2e%2e','__proto__','constructor','',null,[],{},'session_'+ 'x'.repeat(201)])test(`reject invalid SID ${JSON.stringify(sid)}`,()=>{
 assert.throws(()=>ctx.sessionPath(sid));let next=false,status=0;const res={status(n){status=n;return this},json(){}};ctx.validateRequestSid({method:'POST',body:{sid}},res,()=>next=true);assert.equal(status,400);assert.equal(next,false);
});
test('accept legacy and UUID-style IDs inside the sessions directory',()=>{for(const sid of ['session_MTIzNDU2','session_12345678-abcd-4321-9876-123456789abc'])assert.equal(path.dirname(ctx.sessionPath(sid)),'/synthetic/tg_sessions');});
test('all registered auth routes validate SID before invoking handlers',()=>{for(const line of src.split('\n').filter(l=>/^router\.(get|post)\(/.test(l)))assert.match(line,/, validateRequestSid,/);});
test('real auth module refuses traversal without disk write or Telegram connection',async()=>{
 const os=require('node:os');const root=fs.mkdtempSync(path.join(os.tmpdir(),'tg-session-regression-'));let connections=0;const routes={};
 const router={get:(p,...h)=>routes['GET '+p]=h,post:(p,...h)=>routes['POST '+p]=h};
 const mocks={express:{Router:()=>router},telegram:{TelegramClient:class{constructor(){connections++}},Api:{}},'telegram/sessions':{StringSession:class{}},'telegram/Password':{computeCheck(){}}};
 const box={require:n=>mocks[n]||require(n),__dirname:path.join(root,'src'),process:{env:{}},console:{log(){},error(){}},setTimeout,clearTimeout,Buffer,module:{exports:{}}};
 try{
  vm.createContext(box);vm.runInContext(src,box);
  assert.throws(()=>vm.runInContext("saveSession('../sentinel')",box));assert.equal(fs.existsSync(path.join(root,'sentinel.json')),false);
  assert.equal(await box.module.exports.getClient('../sentinel'),null);
  for(const route of ['GET /check','POST /send-code']){
   let code;const res={status:n=>{code=n;return res},json(){}};const req={method:route.split(' ')[0],query:{sid:'../sentinel'},body:{sid:'../sentinel'}};
   routes[route][0](req,res,()=>{throw Error('invalid SID reached handler')});assert.equal(code,400);
  }
  vm.runInContext("activeClients.session_test={tgClient:{session:{save:()=> 'SYNTHETIC_NOT_A_CREDENTIAL'}}};saveSession('session_test');",box);
  assert.equal(fs.existsSync(path.join(root,'tg_sessions/session_test.json')),true);assert.equal(connections,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
