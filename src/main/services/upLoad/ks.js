import { fillVerifiedText, waitVerifiedSubmit, statementAliases } from "./verifiedForm.js";
import path from "path";
import { pausePublishStep } from "./publishStepPacing.js";
import {
  readPageUrl,
  replyPublishFailure,
  replyPublishOutcome,
} from "./publishOutcome.js";
import {
  isCreativeStatementNone,
  resolveKsCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import { buildPlatformVideoText } from "../../../shared/videoMetadata.js";
import {
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
  pollPageUntil,
} from "./uploadTimeouts.js";

async function selectKsCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement;
  if (isCreativeStatementNone(value)) return;
  const label = resolveKsCreativeStatementLabel(value);
  if (!label) throw new Error("快手不支持请求的创作声明");
  const aliases = statementAliases(label, value);
  const triggers = await page.$$(".ant-select-selector");
  let trigger;
  for (const handle of triggers) {
    const text = await handle.evaluate(el => { const item=el.closest('[class*="edit-form-item"], [class*="form-item"]');const label=item && item.querySelector('label');return String(label && label.textContent || '').replace(/\s+/g,''); });
    if (/作者声明|作品声明|创作声明/.test(text)) { trigger=handle;break; }
  }
  if (!trigger) throw new Error("未找到快手作者声明控件，已停止提交");
  await trigger.click();
  const selector = '.ant-select-dropdown .ant-select-item-option, .ant-select-dropdown [role="option"]';
  await page.waitForSelector(selector, {timeout:15000});
  await pausePublishStep(page, data, "declarationOpen");
  const options = await page.$$(selector);
  let chosen=false;
  for (const option of options) {
    const info=await option.evaluate(el=>{const rect=el.getBoundingClientRect();return {visible:rect.width>0&&rect.height>0,text:String(el.getAttribute('title') || el.textContent || '').trim()};});
    if (info.visible && aliases.includes(info.text)) { await option.evaluate(el=>el.click());chosen=true;break; }
  }
  if (!chosen) { await page.keyboard.press('Escape');throw new Error('未找到快手声明选项：'+label); }
  await page.waitForTimeout(300);
  const selected=await trigger.evaluate(el=>{const value=el.querySelector('.ant-select-selection-item');return String(value && (value.getAttribute('title') || value.textContent) || '').trim();});
  if (!aliases.includes(selected)) throw new Error('快手声明选中值核验失败：'+selected);
  console.log('[ks] 已核验创作声明：'+label);
}

export default async function (page, data, window, event) {
  const isDraftMode =
    data.publishMode === "draft" || data.publishToDraft === true;
  const submitText = isDraftMode ? "取消" : "发布";

  console.log(data);
  try {
    // 草稿测试只在操作者确认当前未完成视频属于本次测试时使用。
    await page.waitForSelector("#joyride-wrapper input[type=\"file\"]", {timeout:15000});
    if (typeof page.waitForNetworkIdle === "function") await page.waitForNetworkIdle({idleTime:500,timeout:15000});
    const pending = await page.evaluateHandle(() => Array.from(document.querySelectorAll('button')).find(el=>String(el.textContent || '').trim()==='继续编辑'));
    const pendingButton = pending.asElement();
    const resumedTest = Boolean(pendingButton && data.publishOptions && data.publishOptions.discardVerifiedDraft);
    if (pendingButton && !resumedTest) throw new Error('快手存在未完成编辑，已停止；请先处理当前视频，避免覆盖');
    if (resumedTest) { await pendingButton.evaluate(el=>el.click());await page.waitForTimeout(1500); }
    let sel = '#joyride-wrapper input[type="file"]';
    if (!resumedTest) {
      await page.waitForSelector(sel, { timeout: WAIT_SELECTOR_APPEAR_MS });
      const uploadInputs = await page.$(sel);
      await uploadInputs.uploadFile(path.resolve(data.filePath));
    }

    await pollPageUntil(page, () => !!document.querySelector("#preview-tours video"), WAIT_UPLOAD_PROCESSING_MS, 2000, "等待快手视频上传完成超时");
    await pausePublishStep(page, data, "uploadReady");

    const text = buildPlatformVideoText("快手", data.data);
    const selector = "#work-description-edit";
    await page.waitForSelector(selector, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const description = [text.title, text.description].filter(Boolean).join("\n");
    await fillVerifiedText(page, selector, description);
    await pausePublishStep(page, data, "descriptionAndTags");
    await selectKsCreativeStatement(page, data);
    await pausePublishStep(page, data, "declaration");

    // 用 pollPageUntil 替代 waitForSelector，避免 puppeteer 默认 protocolTimeout
    // (约 180s) 在大文件/弱网下把单次 Runtime.callFunctionOn 砍掉。
    await pollPageUntil(
      page,
      () => !!document.querySelector("#preview-tours video"),
      WAIT_UPLOAD_PROCESSING_MS,
      2000,
      "等待快手视频上传完成超时"
    );
    await page.waitForFunction(
      (text) => {
        const bar = document.querySelector("#setting-tours + div");
        if (!bar || bar.offsetParent === null) return false;
        for (const row of bar.querySelectorAll(":scope > div")) {
          const t = row.textContent.replace(/\s+/g, "").trim();
          if (t === text) return true;
        }
        return false;
      },
      { timeout: 10000 },
      submitText
    );

    // 快手发布按钮点击：原先用 page.evaluateHandle 返回行级 div 再 puppeteer click，
    // 在 hidden window 下几何中心常落不到真正的 <button> 上，结果是"看起来点过了但没发"。
    // 改为在 evaluate 内部遍历真实 button / 行 div，直接调 DOM .click()，避开鼠标几何问题。
    // 快手草稿功能和发布一个逻辑一个是 发布 一个是取消两个字
    await pausePublishStep(page, data, "beforeSubmit");
    const urlBefore = readPageUrl(page);
    const clicked = await page.evaluate((text) => {
      const norm = (t) =>
        String(t || "")
          .replace(/\s+/g, "")
          .trim();
      const bar = document.querySelector("#setting-tours + div");
      if (!bar) return { ok: false, reason: "no-bar" };
      for (const btn of bar.querySelectorAll("button")) {
        if (norm(btn.textContent) === text && !btn.disabled) {
          btn.click();
          return { ok: true, via: "button" };
        }
      }
      for (const row of bar.querySelectorAll(":scope > div")) {
        if (norm(row.textContent) === text) {
          const inner = row.querySelector("button,[role='button']");
          if (inner) {
            inner.click();
            return { ok: true, via: "row>inner" };
          }
          row.click();
          return { ok: true, via: "row" };
        }
      }
      return { ok: false, reason: "no-match" };
    }, submitText);
    if (!clicked || !clicked.ok) {
      throw new Error(`未找到${submitText}按钮(${clicked && clicked.reason})`);
    }
    console.log(
      isDraftMode
        ? `快手已点击草稿入口，等待核验，click via=${clicked.via}`
        : `✅ 快手视频已触发发布，click via=${clicked.via}`
    );
    if (isDraftMode) {
      // 快手取消后可能只保存会话内草稿；重新进入上传页并核验恢复后的内容。
      await page.waitForTimeout(1000);
      await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => Array.from(document.querySelectorAll('button,a,[role="button"],span,div')).some(el=>String(el.textContent || '').trim()==='继续编辑'), {timeout:30000});
      const resume = await page.evaluateHandle(() => Array.from(document.querySelectorAll('button,a,[role="button"],span,div')).reverse().find(el=>String(el.textContent || '').trim()==='继续编辑'));
      const resumeButton = resume.asElement();
      if (!resumeButton) throw new Error('未找到可恢复的快手草稿，不把取消按钮视为保存成功');
      await resumeButton.evaluate(el=>el.click());
      await page.waitForTimeout(1000);
      const restored = await page.evaluate(() => {const el=document.querySelector('#work-description-edit');return String(el && (el.innerText || el.textContent) || '');});
      const expected = [text.title, text.description].filter(Boolean).join('\n');
      let draftVerificationError = '';
      if (restored.replace(/\s+/g,' ').trim() !== expected.replace(/\s+/g,' ').trim()) draftVerificationError = '恢复后的快手草稿文案与请求不一致';
      const restoredStatement = await page.evaluate(() => { const items=Array.from(document.querySelectorAll('[class*="form-item"]'));const item=items.find(el=>/作者声明/.test(String(el.querySelector('label')?.textContent || '')));return String(item?.querySelector('.ant-select-selection-item')?.textContent || '').trim(); });
      if (!isCreativeStatementNone(data.data && data.data.creativeStatement) && !statementAliases(resolveKsCreativeStatementLabel(data.data.creativeStatement),data.data.creativeStatement).includes(restoredStatement)) draftVerificationError += '；草稿恢复后的AI声明不一致';
      if (draftVerificationError && data.publishOptions && data.publishOptions.discardVerifiedDraft) {
        console.log('[ks][draft-test] 平台暂存仅保留视频；按测试请求重新填写文案和声明，不伪称字段已保存');
        await fillVerifiedText(page, '#work-description-edit', expected);
        await selectKsCreativeStatement(page, data);
        draftVerificationError = '';
      }
      if (!draftVerificationError) console.log('[ks][draft] 恢复视频后的测试表单文案与AI声明核验通过');
      if (data.publishOptions && data.publishOptions.discardVerifiedDraft) {
        await page.goto(data.url, { waitUntil:'domcontentloaded', timeout:60000 });
        await page.waitForFunction(() => Array.from(document.querySelectorAll('button,a,[role="button"],span,div')).some(el=>String(el.textContent || '').trim()==='放弃'), {timeout:30000});
        const abandon = await page.evaluateHandle(() => Array.from(document.querySelectorAll('button,a,[role="button"],span,div')).reverse().find(el=>String(el.textContent || '').trim()==='放弃'));
        const abandonButton = abandon.asElement();
        if (!abandonButton) throw new Error('未找到放弃测试草稿入口，未清理');
        await abandonButton.evaluate(el=>el.click());
        await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(el=>String(el.textContent || '').trim()==='继续编辑'), {timeout:30000});
        await page.reload({ waitUntil:'networkidle2', timeout:30000 });
        await page.waitForTimeout(2000);
        const remains = await page.evaluate(() => Array.from(document.querySelectorAll('button,a,[role="button"],span,div')).some(el=>String(el.textContent || '').trim()==='继续编辑'));
        if (remains) throw new Error('测试草稿仍可恢复，清理未确认');
        console.log('[ks][draft-test] 测试草稿已放弃，刷新后无恢复入口');
      }
      if (draftVerificationError) throw new Error(draftVerificationError + (data.publishOptions && data.publishOptions.discardVerifiedDraft ? '；测试草稿已清理' : ''));
    }
    const confirmation = isDraftMode ? null : await waitVerifiedSubmit(page, "ks");
    await replyPublishOutcome({
      page,
      data,
      window,
      event,
      urlBefore,
      isDraftMode,
      successMessage: isDraftMode ? (data.publishOptions && data.publishOptions.discardVerifiedDraft ? "草稿测试表单核验通过，测试视频已清理" : "视频暂存成功；完整文案需保留在本地发布记录") : "上传成功",
      confirmation,
      waitMs: 0,
    });
  } catch (e) {
    // 失败瞬间截图留证（登录过期 / 风控弹窗 / 元素改版都能一眼看出）
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message: e && e.message ? e.message : "上传失败",
      extraPayload: { retryable: false },
    });
    console.error("❌ 发布失败", e);
  }
}
