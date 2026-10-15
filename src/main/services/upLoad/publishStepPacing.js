import fs from "fs";
import path from "path";

// 只调整同一投稿页面内的步骤停顿，不更改平台间隔、重试和审核判定。
export const DEFAULT_STEP_PACING = Object.freeze({enabled:true,stepMinMs:2000,stepMaxMs:4000,beforeSubmitMinMs:5000,beforeSubmitMaxMs:8000});
export function normalizeStepPacing(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid publish step pacing configuration");
  const config={...DEFAULT_STEP_PACING,...value};
  if(typeof config.enabled!=="boolean")throw new Error("Invalid pacing enabled value");
  for(const key of ["stepMinMs","stepMaxMs","beforeSubmitMinMs","beforeSubmitMaxMs"]){
    if(!Number.isFinite(config[key])||config[key]<0||config[key]>60000)throw new Error("Invalid pacing "+key);
  }
  if(config.stepMinMs>config.stepMaxMs||config.beforeSubmitMinMs>config.beforeSubmitMaxMs)throw new Error("Invalid pacing range");
  return config;
}
export function loadStepPacing(userDataDirectory){
  try{return normalizeStepPacing(JSON.parse(fs.readFileSync(path.join(userDataDirectory,"publish-step-pacing.json"),"utf8").replace(/^\uFEFF/,"")))}
  catch(error){if(error.code==="ENOENT")return normalizeStepPacing();throw error;}
}
export function stepDelayMs(value,step,random=Math.random){
  const config=normalizeStepPacing(value);if(!config.enabled)return 0;
  const min=step==="beforeSubmit"?config.beforeSubmitMinMs:config.stepMinMs;
  const max=step==="beforeSubmit"?config.beforeSubmitMaxMs:config.stepMaxMs;
  return Math.round(min+(max-min)*random());
}
export async function pausePublishStep(page,data,step){
  if(data&&data.assertPublishTaskActive)data.assertPublishTaskActive();
  const delayMs=stepDelayMs(data&&data.publishStepPacing,step);if(delayMs===0)return 0;
  console.log("[publish-step]",JSON.stringify({platform:data&&data.pt,step,delayMs}));
  await page.waitForTimeout(delayMs);
  if(data&&data.assertPublishTaskActive)data.assertPublishTaskActive();
  return delayMs;
}
