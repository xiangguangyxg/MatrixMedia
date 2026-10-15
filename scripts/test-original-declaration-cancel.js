const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../src/main/services/puppeteerFile.js'),'utf8');
const start=source.indexOf('async function doUpload('),end=source.indexOf('/** @deprecated',start);
let release,cancelHandler,finished=0,scheduled=0;const replies=[];
const prepared=new Promise(r=>{release=r});
const context=vm.createContext({console,applyXhsConservativePublishOptions:v=>v,normalizePuppeteerVideoTaskData(){},isXhsPlatform:()=>false,getPublishAttemptLimit:()=>1,app:{getPath:()=>'/fixture'},loadStepPacing:()=>({}),prepareOriginalDeclaration:()=>prepared,setTimeout(){scheduled++},clearTimeout(){},skipCloseConfirmation(){}});
vm.runInContext(source.slice(start,end)+';this.doUpload=doUpload;',context);
(async()=>{
 const work=context.doUpload({partition:'persist:fixture',pt:'抖音',data:{}},{reply:(_c,p)=>replies.push(p)},()=>finished++,{setCancelHandler:handler=>{cancelHandler=handler}});
 assert.equal(typeof cancelHandler,'function','cancellation must be registered before async file hashing');
 cancelHandler('cancel while hashing');release({eligible:true});await work;
 assert.equal(finished,1);assert.equal(scheduled,0,'cancelled preparation must never schedule an upload window');assert.equal(replies.length,1);assert.equal(replies[0].interrupted,true);
 console.log('PASS cancellation during originality hash preparation prevents upload and duplicate completion');
})().catch(e=>{release({eligible:false});console.error(e);process.exitCode=1});
