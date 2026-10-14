"use strict";
const assert=require('assert'),path=require('path');
const {build}=require('esbuild'),{JSDOM}=require('jsdom');
(async()=>{
 const outfile=path.join(__dirname,'../test/.cache/xhs-statement.cjs');
 await build({entryPoints:[path.join(__dirname,'../src/main/services/upLoad/xhs.js')],outfile,bundle:true,platform:'node',format:'cjs',plugins:[{name:'offline-outcome',setup(b){b.onLoad({filter:/failureScreenshot\.js$/},()=>({contents:'export async function capturePublishFailureScreenshot(){return null;}'}))}}]});
 const {selectXhsCreativeStatement}=require(outfile);
 for(const mode of ['hidden','missing','wrong','mouse fallback','none','delayed update']) {
  const dom=new JSDOM(`<div class=d-select><span class=d-select-placeholder>添加内容类型声明</span></div><div class=d-options-wrapper style="display:none"><div class=d-options><div class=d-grid-item style="grid-area:2 / 1 / 3 / 2"><div class=d-option-handler></div></div><div class=d-grid-item style="grid-area:2 / 2 / 3 / 3"><span class=d-option-name>笔记含AI合成内容</span></div></div></div>`,{runScripts:'outside-only'});
  const doc=dom.window.document,select=doc.querySelector('.d-select'),options=doc.querySelector('.d-options-wrapper');
  if(mode==='missing')select.remove();
  Object.defineProperty(doc,'visibilityState',{value:'hidden'});
  dom.window.HTMLElement.prototype.scrollIntoView=function(){};
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return {left:20,top:this.className.includes('handler')?100:30,width:180,height:40}};
  select.addEventListener('mousedown',()=>{options.style.display='block'});
  const update=()=>{select.innerHTML='<span class=d-select-description>'+(mode==='wrong'?'虚构演绎，仅供娱乐':'笔记含AI合成内容')+'</span>'};
  let pending=false,waited=0;
  doc.querySelector('.d-option-handler').addEventListener('mousedown',()=>{if(mode==='delayed update')pending=true;else update()});
  let clicks=0;
  const page={evaluate:async s=>dom.window.eval(s),waitForTimeout:async ms=>{if(pending){waited+=ms;if(waited>=800)update();}},click:async()=>{throw Error('observer-dependent click must not run')},waitForFunction:async()=>{throw Error('RAF polling must not run')},mouse:{click:async(x,y)=>{clicks++;if(mode==='mouse fallback')throw Error('mouse failure');const el=y>90?doc.querySelector('.d-option-handler'):select;el.dispatchEvent(new dom.window.MouseEvent('mousedown',{bubbles:true}));}}};
  let failed=false;try{await selectXhsCreativeStatement(page,{data:{creativeStatement:mode==='none'?'none':'ai_generated'}})}catch(e){failed=true;}
  assert.equal(failed,['missing','wrong'].includes(mode),mode);
  if(!failed&&mode!=='none')assert.equal(select.textContent,'笔记含AI合成内容');
  if(mode==='none')assert.equal(clicks,0);
  dom.window.close();console.log('PASS DOM',mode);
 }
})().catch(e=>{console.error(e);process.exitCode=1});
