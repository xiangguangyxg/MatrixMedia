const assert=require('assert'),fs=require('fs'),path=require('path');
const {build}=require('esbuild'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),cache=path.join(root,'test/.cache');fs.mkdirSync(cache,{recursive:true});
async function main(){
 await build({entryPoints:[path.join(root,'src/main/services/upLoad/originalDeclaration.js')],outfile:path.join(cache,'original-declaration.cjs'),bundle:true,platform:'node',format:'cjs'});
 const api=require(path.join(cache,'original-declaration.cjs'));
 let failed=0;
 for(const pt of ['dy','sph','ks','xhs','blbl'])for(const scenario of ['eligible','ineligible','default-checked-ineligible','missing','heading-only','disabled','wrong-state','ai-lost','exclusive-only']){
  const ai={dy:'<div class="selectText-test">内容由AI生成</div>',sph:'<div class="post-with-mark-tag"><div class="select-display">内容由AI生成</div></div>',ks:'<span class="ant-select-selection-item" title="内容为AI生成">内容为AI生成</span>',xhs:'<div id="__xhs_stmt_fixture"><span class="d-select-description">笔记含AI合成内容</span></div>',blbl:'<div class="statement-content"><input value="内容由人工智能生成"></div>'}[pt];
  const checkbox=scenario==='missing'?'':scenario==='heading-only'?'<h3>原创声明</h3><div>添加内容类型声明</div>':scenario==='exclusive-only'?'<label><input type="checkbox">独家首发</label>':`<label id="claim"><input id="original" type="checkbox" ${scenario==='default-checked-ineligible'?'checked':''} ${scenario==='disabled'?'disabled':''}>声明原创</label>`;
  const dom=new JSDOM('<body>'+ai+checkbox+'<button id="publish">发布</button></body>');
  global.document=dom.window.document;global.window=dom.window;
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {width:100,height:30,x:0,y:0}};
  const input=document.querySelector('#original');
  if(scenario==='wrong-state')input.addEventListener('click',e=>e.preventDefault());
  if(scenario==='ai-lost')input.addEventListener('click',()=>{document.querySelector('.selectText-test,.select-display,.ant-select-selection-item,.d-select-description,.statement-content input').remove()});
  let submits=0;document.querySelector('#publish').onclick=()=>submits++;
  const data={pt:{dy:'抖音',sph:'视频号',ks:'快手',xhs:'小红书',blbl:'哔哩哔哩'}[pt],publishStepPacing:{enabled:false},data:{creativeStatement:'ai_generated'},originalDeclarationReview:{eligible:!scenario.includes('ineligible'),reason:'fixture review',platform:pt,fileSha256:'a'.repeat(64),evidence:['fixture']}};
  try{
   let error;try{await api.applyOriginalDeclaration({evaluate:async(fn,...args)=>fn(...args),waitForTimeout:async()=>{}},data)}catch(e){error=e}
   if(['disabled','wrong-state','ai-lost'].includes(scenario)){assert(error,'must fail before submitting');assert.equal(data.originalDeclarationResult.status,'failed');}
   else{assert.ifError(error);assert(data.originalDeclarationResult);if(['missing','heading-only','exclusive-only'].includes(scenario))assert.equal(data.originalDeclarationResult.status,'not_offered');else{assert.equal(input.checked,!scenario.includes('ineligible'));assert.equal(data.originalDeclarationResult.status,scenario.includes('ineligible')?'not_claimed':'selected');}}
   if(!error){await api.verifyDeclarationsBeforeSubmit({evaluate:async(fn,...args)=>fn(...args)},data);if(pt==='dy'&&scenario==='eligible'){input.checked=false;await assert.rejects(()=>api.verifyDeclarationsBeforeSubmit({evaluate:async(fn,...args)=>fn(...args)},data),/原创/);input.checked=true;}}
   assert.equal(submits,0);console.log('PASS',pt,scenario);
  }catch(e){failed++;console.error('FAIL',pt,scenario,e.message)}
 }
 {
  const dom=new JSDOM('<div id="__xhs_stmt_fixture"><span class="d-select-description">笔记含AI合成内容</span></div><video></video><div class="custom-switch-card"><div class="custom-switch-text-content"><span class="has-tips">原创声明</span></div><div class="custom-switch-switch"><div class="d-switch"><input type="checkbox" checked></div></div></div>');
  global.document=dom.window.document;global.window=dom.window;dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});Object.defineProperty(document.querySelector('video'),'duration',{value:5});
  const data={pt:'小红书',data:{creativeStatement:'ai_generated'},originalDeclarationResult:{status:'selected',label:'原创声明',selected:true}};
  await assert.rejects(()=>api.verifyDeclarationsBeforeSubmit({evaluate:async(fn,...args)=>fn(...args)},data),/10秒/);console.log('PASS XHS final duration restriction recheck');
 }
 // 小红书实际 DOM：原创是 custom-switch-card 内的原生 checkbox，与 AI 下拉独立。
 for(const scenario of ['long-eligible','short-disabled','long-ineligible','disabled-unknown']){
  const disabled=scenario==='short-disabled'||scenario==='disabled-unknown';
  const dom=new JSDOM(`<div id="__xhs_stmt_fixture"><span class="d-select-description">笔记含AI合成内容</span></div><video></video><div class="custom-switch-card"><div class="custom-switch-text-content"><span class="has-tips">原创声明</span></div><div class="custom-switch-switch"><div class="d-switch ${disabled?'disabled':''}"><span class="d-switch-simulator"><input type="checkbox" ${disabled?'disabled':''} ${scenario==='long-ineligible'?'checked':''}></span></div></div></div>`);
  global.document=dom.window.document;global.window=dom.window;dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
  Object.defineProperty(document.querySelector('video'),'duration',{value:scenario==='short-disabled'?5.125:43});
  const input=document.querySelector('input');document.querySelector('.d-switch').onclick=()=>{if(!disabled)input.checked=!input.checked};
  const data={pt:'小红书',publishStepPacing:{enabled:false},data:{creativeStatement:'ai_generated'},originalDeclarationReview:{eligible:scenario!=='long-ineligible',reason:'review'}};
  let error;try{await api.applyOriginalDeclaration({evaluate:async(fn,...args)=>fn(...args),waitForTimeout:async()=>{}},data)}catch(e){error=e}
  if(scenario==='disabled-unknown')assert(error,'unknown disabled cause must stop');
  else{assert.ifError(error);assert.equal(data.originalDeclarationResult.status,scenario==='long-eligible'?'selected':'not_claimed');assert.equal(input.checked,scenario==='long-eligible');assert.equal(data.creativeStatementVerification.verified,true);if(scenario==='short-disabled'){assert.equal(data.originalDeclarationResult.eligible,false);assert.equal(data.originalDeclarationResult.runtimeRestriction,'xhs_duration_below_10_seconds')}}
  console.log('PASS XHS actual originality switch',scenario);
 }
 {
  const dom=new JSDOM('<div class="selectText-test">内容由AI生成</div><label><input type="checkbox" checked>声明原创</label><div role="dialog">原创声明：必须同意独家首发协议</div>');
  global.document=dom.window.document;global.window=dom.window;dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
  const data={pt:'抖音',data:{creativeStatement:'ai_generated'},originalDeclarationResult:{status:'selected',label:'声明原创',selected:true}};
  await assert.rejects(()=>api.verifyDeclarationsBeforeSubmit({evaluate:async(fn,...args)=>fn(...args)},data),/协议/);
  assert.equal(data.originalDeclarationResult.status,'failed');console.log('PASS late original agreement stops final submission');
 }
 for(const aria of ['', 'aria-checked="mixed"']){
  const dom=new JSDOM(`<div class="selectText-test">内容由AI生成</div><div role="checkbox" aria-label="声明原创" data-state="checked" ${aria}></div>`);
  global.document=dom.window.document;global.window=dom.window;dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
  const data={pt:'抖音',publishStepPacing:{enabled:false},data:{creativeStatement:'ai_generated'},originalDeclarationReview:{eligible:false,reason:'unverified'}};
  await assert.rejects(()=>api.applyOriginalDeclaration({evaluate:async(fn,...args)=>fn(...args),waitForTimeout:async()=>{}},data),/状态/);
  assert.equal(data.originalDeclarationResult.status,'failed');console.log('PASS ambiguous checkbox state stops submission',aria);
 }
 // B站授权菜单关闭后仍保留 DOM；不能把菜单动画导致的零尺寸当成没有原创入口。
 {
  const dom=new JSDOM('<div class="statement-content"><input value="含AI生成内容"><div class="bcc-select-list-wrap" style="display:none"><div class="auth-content"><span>内容为自制：未经作者允许，禁止转载</span></div></div></div>');
  global.document=dom.window.document;global.window=dom.window;
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return this.className==='auth-content'?{width:0,height:0}:{width:100,height:30}};
  const auth=document.querySelector('.auth-content');auth.onclick=()=>{auth.innerHTML='<span class="option-text option-text-selected">内容为自制：未经作者允许，禁止转载</span><svg class="option-icon icon-sprite icon-sprite-duihao"></svg>'};
  const data={pt:'哔哩哔哩',publishStepPacing:{enabled:false},data:{creativeStatement:'ai_generated'},originalDeclarationReview:{eligible:true,reason:'review'}};
  await api.applyOriginalDeclaration({evaluate:async(fn,...args)=>fn(...args),waitForTimeout:async()=>{}},data);
  assert.equal(data.originalDeclarationResult.status,'selected');assert.equal(data.creativeStatementVerification.verified,true);console.log('PASS Bilibili authorization state retained in closed menu');
 }
 // 协议必须先审查；独家/首发承诺以及 AI 限制不能因勾选原创而静默接受。
 for(const scenario of ['unreviewed','reviewed','exclusive','ai-excluded']){
  const text=scenario==='exclusive'?'必须独家首发':scenario==='ai-excluded'?'人工智能生成内容不支持声明原创':'确认内容由本人独立创作';
  const dom=new JSDOM(`<div class="selectText-test">内容由AI生成</div><label><input id="claim" type="checkbox">声明原创</label><div role="dialog" hidden><h3>原创声明</h3><p>${text}</p><label><input type="checkbox">已阅读原创协议</label><button>声明原创</button></div>`);
  global.document=dom.window.document;global.window=dom.window;dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30});
  const dialog=document.querySelector('[role="dialog"]');document.querySelector('#claim').onclick=()=>{dialog.hidden=false};let confirmations=0;dialog.querySelector('button').onclick=()=>{confirmations++;dialog.hidden=true};
  const terms=dialog.textContent.trim(),accepted=require('crypto').createHash('sha256').update(terms).digest('hex');
  const data={pt:'抖音',publishStepPacing:{enabled:false},data:{creativeStatement:'ai_generated'},originalDeclarationReview:{eligible:true,reason:'review',acceptedTermsSha256:scenario==='unreviewed'?undefined:accepted}};
  let error;try{await api.applyOriginalDeclaration({evaluate:async(fn,...args)=>fn(...args),waitForTimeout:async()=>{}},data)}catch(e){error=e}
  if(scenario==='reviewed'){assert.ifError(error);assert.equal(confirmations,1);assert.equal(data.originalDeclarationResult.status,'selected')}
  else{assert(error);assert.equal(confirmations,0)}
  console.log('PASS original terms',scenario);
 }
 const file=path.join(cache,'original-hash-fixture.txt');fs.writeFileSync(file,'original fixture');
 const hash=require('crypto').createHash('sha256').update('original fixture').digest('hex');
 const data={pt:'抖音',filePath:file,publishOptions:{originalDeclaration:{eligible:true,reason:'review',evidence:['fixture'],fileSha256:hash,platform:'dy'}}};
 assert.equal((await api.prepareOriginalDeclaration(data)).eligible,true);
 await assert.rejects(()=>api.prepareOriginalDeclaration({pt:'哔哩哔哩',data:{creativeStatement:'self_made_no_repost'}}),/原创资格/);
 await assert.rejects(()=>api.prepareOriginalDeclaration({...data,pt:'快手'}),/平台/);
 await assert.rejects(()=>api.prepareOriginalDeclaration({...data,publishOptions:{originalDeclaration:{...data.publishOptions.originalDeclaration,fileSha256:'b'.repeat(64)}}}),/SHA256/);
 if(failed)throw Error(failed+' original declaration tests failed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
