const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {build}=require('esbuild'),{JSDOM}=require('jsdom');
(async()=>{let cache=path.resolve(__dirname,'../test/.cache/original-declaration.cjs');await build({entryPoints:[path.resolve(__dirname,'../src/main/services/upLoad/originalDeclaration.js')],outfile:cache,bundle:true,platform:'node',format:'cjs'});let api=require(cache);
for(const scenario of ['confirm','unchecked','unreviewed','late-dialog']){
let dom=new JSDOM('<div id="__xhs_stmt_fixture"><span class="d-select-description">笔记含AI合成内容</span></div><label><input id="outer" type="checkbox" checked>声明原创</label>'+fs.readFileSync(path.join(__dirname,'fixtures/xhs-original-confirmation.html'),'utf8'));
global.document=dom.window.document;global.window=dom.window;dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});let modal=document.querySelector('.d-modal'),check=modal.querySelector('input'),button=modal.querySelector('button'),clicks=0;
check.closest('.d-checkbox').onclick=()=>{check.checked=scenario!=='unchecked';queueMicrotask(()=>{button.disabled=!check.checked})};button.onclick=()=>{assert(check.checked);clicks++;modal.remove()};
let page={evaluate:async(fn,...args)=>fn(...args),waitForTimeout:async()=>{await Promise.resolve()}},data={pt:'小红书',publishStepPacing:{enabled:false},data:{creativeStatement:'ai_generated'},originalDeclarationReview:{eligible:true,reason:'review',acceptedTermsSha256:scenario==='unreviewed'?undefined:crypto.createHash('sha256').update(modal.textContent.trim()).digest('hex')}};
assert(api.originalDeclarationDom('dialog',{platform:'xhs'}),'actual d-modal must be detected');
if(scenario==='late-dialog'){data.originalDeclarationResult={status:'selected',label:'声明原创',selected:true};await assert.rejects(()=>api.verifyDeclarationsBeforeSubmit(page,data),/协议/)}
else if(scenario==='confirm'){await api.applyOriginalDeclaration(page,data);assert.equal(clicks,1);assert.equal(data.originalDeclarationResult.confirmation.consentChecked,true);assert.equal(data.originalDeclarationResult.confirmation.buttonClicked,true);assert.equal(data.originalDeclarationResult.confirmation.closed,true);assert(data.creativeStatementVerification.verified)}
else{await assert.rejects(()=>api.applyOriginalDeclaration(page,data));assert.equal(clicks,0)}console.log('PASS XHS real confirmation',scenario);
}})().catch(e=>{console.error(e);process.exitCode=1});
