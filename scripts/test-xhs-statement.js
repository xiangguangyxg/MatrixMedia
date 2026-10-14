"use strict";
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname,'../src/main/services/upLoad/xhs.js'),'utf8');
const begin = source.includes('async function clickXhsStatementControl') ? source.indexOf('async function clickXhsStatementControl') : source.indexOf('async function selectXhsCreativeStatement');
const end = source.indexOf('async function closeCheckedXhsPkCoverSwitch');
async function scenario(mode) {
  let opened=false,selected='',slowClicks=0,coordinateClicks=0,submitted=0;
  const rect={left:20,top:30,width:180,height:40};
  const handler={id:'',getBoundingClientRect:()=>rect,setAttribute(k,v){this[k]=v},dispatchEvent(){if(mode!=='wrong')selected='笔记含AI合成内容';return true;}};
  const row={getAttribute:()=> 'grid-area: 2 / 1 / 3 / 2',querySelector:()=>handler};
  row.parentElement={querySelectorAll:()=>[row]};
  const option={textContent:'笔记含AI合成内容',getBoundingClientRect:()=>rect,closest:()=>row};
  const select={id:'',textContent:'添加内容类型声明',getBoundingClientRect:()=>rect,setAttribute(k,v){this[k]=v},scrollIntoView(){},dispatchEvent(){opened=true;return true;},querySelector(s){return s==='.d-select-description'?{textContent:selected}:{textContent:selected||'添加内容类型声明'};}};
  const placeholder={textContent:'添加内容类型声明',closest:()=>select};
  const document={querySelectorAll(s){if(s==='.d-select-placeholder')return mode==='missing'?[]:[placeholder];if(s.includes('.d-option-name'))return opened?[option]:[];return [];},getElementById(id){return id===select.id?select:id===handler.id?handler:null;}};
  class MouseEvent{constructor(type){this.type=type}}
  const context=vm.createContext({document,window:{innerWidth:1300,innerHeight:800,getComputedStyle:()=>({display:'block',visibility:'visible'})},MouseEvent,console:{log(){},warn(){}},Date,Error,JSON,XHS_SUPPORTED_STATEMENT_LABELS:new Set(['笔记含AI合成内容']),isCreativeStatementNone:v=>!v||v==='none',resolveXhsCreativeStatementLabel:()=> '笔记含AI合成内容',WAIT_SELECTOR_APPEAR_MS:300000,pollPageUntil:async(page,expression)=>{for(let i=0;i<3;i++)if(await page.evaluate(expression))return;throw Error('bounded polling timeout');}});
  vm.runInContext(source.slice(begin,end).replace(/export async/g,'async')+'\nthis.run=selectXhsCreativeStatement;',context);
  const page={evaluate:async(expression)=>vm.runInContext(expression,context),click:async()=>{slowClicks++;throw Error('Runtime.callFunctionOn timed out')},waitForFunction:async(expression)=>{if(!vm.runInContext(expression,context))throw Error('timeout')},waitForTimeout:async()=>{},mouse:{click:async()=>{coordinateClicks++;if(!opened)opened=true;else if(mode!=='wrong')selected='笔记含AI合成内容';}}};
  let failure;
  try{await context.run(page,{data:{creativeStatement:'ai_generated'}});submitted++;}catch(e){failure=e;}
  if(mode==='hidden') {assert.equal(slowClicks,0,'hidden declaration selection must not call observer-dependent page.click');assert.equal(coordinateClicks,2);assert.equal(selected,'笔记含AI合成内容');assert.equal(submitted,1);}
  else {assert(failure,'missing or incorrect declaration must block submission');assert.equal(submitted,0);}
  console.log('PASS',mode);
}
(async()=>{await scenario('hidden');await scenario('missing');await scenario('wrong')})().catch(e=>{console.error(e);process.exitCode=1});
