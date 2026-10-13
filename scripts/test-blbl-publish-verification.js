"use strict";
const assert = require("assert");
const path = require("path");
const { build } = require("esbuild");
const { JSDOM } = require("jsdom");

async function main() {
  const outfile = path.join(__dirname, "../test/.cache/blbl-verification.cjs");
  await build({ entryPoints: [path.join(__dirname, "../src/main/services/upLoad/blbl.js")], outfile,
    bundle: true, platform: "node", format: "cjs", plugins: [{ name: "offline-outcome", setup(b) {
      b.onLoad({ filter: /failureScreenshot\.js$/ }, () => ({ contents: `
        export async function capturePublishFailureScreenshot(){return null;}` }));
    } }] });
  const module = require(outfile);
  const handler = module.default;
  let navigated = false;
  const navigation = await module.waitBlblSubmit({
    url: () => navigated ? 'https://member.bilibili.com/platform/upload-manager/article' : 'https://member.bilibili.com/platform/upload/video/frame/',
    evaluate: async () => { navigated = true; throw Error('Execution context was destroyed'); },
    waitForTimeout: async () => {},
  }, false);
  assert.equal(navigation.ok, true, 'navigation must not turn a submitted work into a failed record');
  console.log('PASS navigation during confirmation');
  for (const scenario of ["success", "missing declaration", "wrong declaration", "missing category", "upload error", "upload stalled", "submit unconfirmed", "draft unconfirmed"]) {
    const dom = new JSDOM(`<input type=file class=file><div class=bcc-upload></div>
      <div class=input-instance><input placeholder="请输入稿件标题"></div>
      <div class=statement-content><div class=bcc-select-input-wrap><input readonly></div>
      <div class=bcc-select-list-wrap style="display:none"><li class=bcc-option><span>含AI生成内容</span></li></div></div>
      <div class=video-human-type><div class=select-container><div class=select-controller></div><p class=select-item-cont>动画</p></div>
      <div class=human-type-list style="display:none"><div title=影视>影视</div></div></div>
      <div class=desc-container><div class=ql-editor contenteditable=true></div></div>
      <div class=tag-container><div class=input-instance><input></div></div>
      <div class=file-item-content-status><span class=success>上传完成</span></div>
      <div class=cover-main><img class=cover-img></div>
      <div class=submit-container><button class=submit-add>立即投稿</button><button class=submit-draft>存草稿</button></div>`, { url: "https://member.bilibili.com/platform/upload/video/frame/" });
    const doc = dom.window.document; doc.querySelector('.bcc-upload').append(doc.querySelector('.file'));
    global.document = doc; global.window = dom.window;
    dom.window.HTMLElement.prototype.getBoundingClientRect = function() {return {width:this.style.display==='none'?0:100,height:this.style.display==='none'?0:20};};
    let active, submitted = 0, clock = 0;
    doc.querySelector('.submit-add').onclick=()=>{submitted++;};
    doc.querySelector('.submit-draft').onclick=()=>{submitted++;};
    doc.querySelector('.bcc-select-input-wrap').onclick=()=>{doc.querySelector('.bcc-select-list-wrap').style.display='block';};
    doc.querySelector('.bcc-option').onclick=()=>{doc.querySelector('.statement-content input').value=scenario==='wrong declaration'?'内容无需标注':'含AI生成内容';};
    doc.querySelector('.select-controller').onclick=()=>{doc.querySelector('.human-type-list').style.display='block';};
    doc.querySelector('[title="影视"]').onclick=()=>{doc.querySelector('.select-item-cont').textContent='影视';};
    if(scenario==='missing declaration')doc.querySelector('.statement-content').remove();
    if(scenario==='missing category')doc.querySelector('[title="影视"]').remove();
    if(scenario==='upload error')doc.querySelector('.file-item-content-status').innerHTML='<span class="error">上传失败</span>';
    if(scenario==='upload stalled')doc.querySelector('.file-item-content-status').textContent='已经上传：0.0MB/1.2MB';
    const handle=el=>el&&({click:async()=>{active=el; /* 复现隐藏窗口的坐标点击没有展开菜单 */ if(!el.closest('.statement-content,.video-human-type'))el.click();},
      evaluate:async(fn,...args)=>fn(el,...args),uploadFile:async()=>{},focus:async()=>{active=el;},dispose:async()=>{}});
    const page={ url:()=>submitted && !scenario.includes('unconfirmed')?'https://member.bilibili.com/platform/upload-manager/article':'https://member.bilibili.com/platform/upload/video/frame/',
      $:async s=>handle(doc.querySelector(s)), evaluate:async(fn,...args)=>fn(...args),
      waitForSelector:async s=>{const el=doc.querySelector(s);if(!el||el.style.display==='none')throw Error('selector unavailable');return handle(el);},
      waitForTimeout:async ms=>{clock+=ms;},click:async s=>{doc.querySelector(s)?.click();},
      keyboard:{down:async()=>{},up:async()=>{},press:async k=>{if(k==='Backspace'&&active){if(active.tagName==='INPUT')active.value='';else active.textContent='';}},type:async t=>{if(active.tagName==='INPUT')active.value+=t;else active.textContent+=t;}}};
    const oldNow=Date.now; Date.now=()=>clock;
    const replies=[];
    try {await handler(page,{pt:'哔哩哔哩',filePath:'fixture.mp4',publishMode:scenario==='draft unconfirmed'?'draft':'publish',data:{title:'测试标题',description:'测试正文',tags:['技巧'],creativeStatement:'ai_generated'}},null,{reply:(_c,p)=>replies.push(p)});} finally {Date.now=oldNow;}
    const result=replies.at(-1); assert.ok(result,'must finish with a result');
    if(scenario==='success' && !result.status) console.error(result);
    if(scenario==='success'){assert.equal(submitted,1,'DOM clicks must expand and select both menus');assert.equal(result.status,true);assert.equal(doc.querySelector('.statement-content input').value,'含AI生成内容');assert.equal(doc.querySelector('.select-item-cont').textContent,'影视');}
    else if(scenario.includes('unconfirmed')){assert.equal(submitted,1);assert.equal(result.status,true);assert.equal(result.publishAbnormal,true,'must preserve abnormal classification in GUI/CLI');assert.equal(result.needsAttention,true);assert.equal(result.retryable,false);}
    else {assert.equal(submitted,0,'must not submit when a required step fails');assert.equal(result.status,false);assert.equal(result.retryable,false,'must not automatically upload again');}
    console.log('PASS',scenario);
    dom.window.close();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
