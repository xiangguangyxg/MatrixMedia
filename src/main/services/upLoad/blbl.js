import { fillVerifiedText } from "./verifiedForm.js";
import path from "path";
import { applyOriginalDeclaration, verifyDeclarationsBeforeSubmit } from "./originalDeclaration.js";
import { pausePublishStep } from "./publishStepPacing.js";
import {
  readPageUrl,
  replyPublishFailure,
  replyPublishOutcome,
} from "./publishOutcome.js";
import {
  getCreativeStatementOption,
  resolveBlblCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import {
  pollPageUntil,
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
} from "./uploadTimeouts.js";
import {
  buildPlatformVideoText,
  normalizeVideoTags,
} from "../../../shared/videoMetadata.js";

async function waitForBlblAutoCover(page) {
  await pollPageUntil(
    page,
    () => {
      const main = document.querySelector(".cover-main");
      if (!main) return false;
      const empty = main.querySelector(".cover-empty");
      const img = main.querySelector(".cover-img");
      return !empty && !!img;
    },
    WAIT_UPLOAD_PROCESSING_MS,
    2000,
    "哔哩哔哩封面自动生成超时"
  );
}

export function findBlblCoverEntry(root = document) {
  return root.querySelector(".cover-empty");
}

/**
 * 视频上传成功后默认设置封面：
 * 点击「封面设置」→ 弹窗中滑块往左滑 10px → 点击「完成」。
 * 任何步骤失败均跳过，不阻断发布。
 */
async function handleBlblCover(page) {
  try {
    // 1. 等待并点击新版封面设置入口
    const deadline = Date.now() + WAIT_SELECTOR_APPEAR_MS;
    let coverEntry = null;
    while (!coverEntry && Date.now() < deadline) {
      const handle = await page
        .evaluateHandle(findBlblCoverEntry)
        .catch(() => null);
      coverEntry = handle?.asElement() || null;
      if (!coverEntry) {
        await handle?.dispose();
        await page.waitForTimeout(2000);
      }
    }
    if (!coverEntry) throw new Error("未找到哔哩哔哩封面设置入口");
    await coverEntry.click({ delay: 200 });
    await coverEntry.dispose();
    console.log("[blbl] 已点击封面设置入口");

    // 2. 等待封面编辑弹窗
    await page.waitForSelector(".cover-editor.bcc-dialog__wrap", {
      visible: true,
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    await page.waitForTimeout(1000); // 等待弹窗内组件渲染

    // 3. 滑块往左滑 10px
    const handle = await page.waitForSelector(".vue-slider-dot-handle", {
      visible: true,
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    const box = await handle.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx - 10, cy, { steps: 5 });
      await page.mouse.up();
      console.log("[blbl] 滑块已往左滑 10px");
    }

    await page.waitForTimeout(500);

    // 4. 点击「完成」按钮
    const submitClicked = await page.evaluate(() => {
      const container = document.querySelector(".cover-editor") || document;
      const btns = container.querySelectorAll(".button.submit");
      for (const btn of btns) {
        if ((btn.textContent || "").trim().includes("完成")) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    if (submitClicked) {
      console.log("[blbl] 封面设置完成");
    } else {
      console.warn("[blbl] 未找到封面完成按钮，跳过");
    }

    await page.waitForTimeout(1000); // 等待弹窗关闭
  } catch (e) {
    console.warn("[blbl] 封面设置失败，跳过:", e?.message || e);
  }
}

// 不使用依赖屏幕坐标或 requestAnimationFrame 的长等待；隐藏窗口也能处理下拉菜单。
async function waitBlblSelector(page, selector, visible = false) {
  // 参数显式传入页面函数，避免打包后闭包变量名失效。
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const found = await page.evaluate((s, v) => {
      const el = document.querySelector(s);
      if (!el) return false;
      if (!v) return true;
      const style = el.ownerDocument.defaultView.getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    }, selector, visible);
    if (found) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`哔哩哔哩页面控件未就绪：${selector}`);
}

async function clickBlblSelector(page, selector) {
  await assertBlblReady(page);
  await waitBlblSelector(page, selector);
  const clicked = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`哔哩哔哩页面控件已移除：${selector}`);
}

/** 验证弹窗需本人处理，不能继续将标题/简介误输入验证码框。 */
export async function assertBlblReady(page) {
  const reason = await page.evaluate(() => {
    for (const el of document.querySelectorAll("h2,h3,p,span,div")) {
      const text = (el.innerText || el.textContent || "").trim();
      if (!/^(请完成短信验证|请进行安全验证|请完成安全验证|请完成验证|请先完成实名认证)$/.test(text)) continue;
      const r = el.getBoundingClientRect();
      const style = el.ownerDocument.defaultView.getComputedStyle(el);
      if (r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none") return text;
    }
    return "";
  });
  if (reason) {
    const error = new Error(`哔哩哔哩要求本人完成验证：${reason}；已停止输入和投稿`);
    error.requiresVerification = true;
    throw error;
  }
}

export async function selectBlblCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement;
  const opt = getCreativeStatementOption(value);
  const label = resolveBlblCreativeStatementLabel(value);
  await clickBlblSelector(page, ".statement-content .bcc-select-input-wrap");
  await waitBlblSelector(page, ".statement-content .bcc-select-list-wrap", true);
  await pausePublishStep(page, data, "declarationOpen");
  const picked = await page.evaluate((text, authOption) => {
    const options = document.querySelectorAll(authOption
      ? ".statement-content .auth-content .option-text"
      : ".statement-content li.bcc-option span");
    for (const span of options) {
      if ((span.textContent || "").trim() === text) {
        span.closest(authOption ? ".auth-content" : "li.bcc-option").click();
        return true;
      }
    }
    return false;
  }, label, !!opt.optionalAuth);
  if (!picked) throw new Error(`未找到哔哩哔哩创作声明选项：${label}`);
  await page.waitForTimeout(300);
  const selected = await page.evaluate((text, authOption) => {
    if (authOption) {
      // 授权声明是独立选项；不可仅凭输入框或点击次数推断成功。
      const option = document.querySelector(".statement-content .auth-content");
      return !!option && (option.textContent || "").trim() === text &&
        !!option.querySelector(".option-text-selected,.icon-sprite-duihao,.bcc-icon-ic_MenuButton-tick,.selected,.checked");
    }
    const input = document.querySelector(".statement-content input");
    return !!input && input.value.trim() === text;
  }, label, !!opt.optionalAuth);
  if (!selected) throw new Error(`哔哩哔哩创作声明核验失败：${label}`);
}

export async function selectBlblCategory(page, category = "影视") {
  await clickBlblSelector(page, ".video-human-type .select-controller");
  await waitBlblSelector(page, ".human-type-list", true);
  const picked = await page.evaluate((name) => {
    const item = Array.from(document.querySelectorAll(".human-type-list [title]"))
      .find(el => el.getAttribute("title") === name);
    if (!item) return false;
    item.click();
    return true;
  }, category);
  if (!picked) throw new Error(`未找到哔哩哔哩分区：${category}`);
  await page.waitForTimeout(300);
  const selected = await page.evaluate((name) => {
    const el = document.querySelector(".video-human-type .select-item-cont");
    return !!el && (el.textContent || "").trim() === name;
  }, category);
  if (!selected) throw new Error(`哔哩哔哩分区核验失败：${category}`);
}

export async function waitBlblUpload(page, { stallMs = 120000, timeoutMs = WAIT_UPLOAD_PROCESSING_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let progress = "", changedAt = Date.now();
  while (Date.now() < deadline) {
    await assertBlblReady(page);
    const state = await page.evaluate(() => {
      const root = document.querySelector(".file-item-content-status");
      const text = root ? (root.innerText || root.textContent || "").trim() : "";
      return { done: !!(root && root.querySelector(".success")), text,
        error: !!(root && root.querySelector(".error,.fail,.failed")) || /上传失败|上传错误/.test(text) };
    });
    if (state.error) throw new Error(`哔哩哔哩视频上传失败：${state.text}`);
    if (state.done) return;
    // 仅比较已上传字节量；倒计时/速度变化不能掩盖实际上传停滞。
    const current = ((state.text.match(/已经上传[：:]\s*([^/]+)\//) || [])[1] || "").replace(/\s+/g, "");
    if (current && current !== progress) { progress = current; changedAt = Date.now(); }
    if (Date.now() - changedAt >= stallMs) throw new Error("哔哩哔哩上传连续两分钟无进度；请检查网络或平台提示，勿重复投稿");
    await page.waitForTimeout(500);
  }
  throw new Error("哔哩哔哩视频上传完成超时");
}

export async function waitBlblSubmit(page, isDraftMode) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const url = readPageUrl(page);
    if (/passport|\/login(?:[/?#]|$)/i.test(url)) return { ok: false, message: "出现登录或验证页面，请本人处理" };
    if (/\/platform\/upload-manager\//.test(url)) return { ok: true, message: "已返回稿件管理页，请核实审核状态" };
    const state = await page.evaluate((draft) => {
      const visibleText = Array.from(document.querySelectorAll("div,p,h1,h2,h3,span,a,button"))
        .filter(el => { const r=el.getBoundingClientRect(); return r.width>0 && r.height>0; })
        .map(el => (el.innerText || el.textContent || "").replace(/\s+/g, "").trim());
      // B站首稿成功页保持原投稿URL；两项专属操作同时出现才判成功。
      const completePage = !draft && visibleText.includes("查看进度") && visibleText.includes("再投一个");
      const nodes = Array.from(document.querySelectorAll('[role="alert"],.bcc-message,.bcc-message-notice,.bcc-form-item-error'));
      const texts = nodes.filter(el => { const r=el.getBoundingClientRect(); return r.width>0 && r.height>0; })
        .map(el => (el.innerText || el.textContent || "").trim());
      return { success: completePage || texts.some(s => draft ? /^(存草稿成功|草稿保存成功)[！!。.]?$/.test(s) : /^(投稿成功|发布成功)[！!。.]?$/.test(s)),
        error: texts.filter(s => /失败|错误|不能为空|必填|验证码|请.{0,20}(选择|填写|验证)/.test(s)).join("；").slice(0,400) };
    }, isDraftMode).catch(() => ({ success: false, error: "" }));
    if (state.success) return { ok: true, message: isDraftMode ? "页面明确提示草稿保存成功" : "页面明确提示投稿成功" };
    if (state.error) return { ok: false, message: state.error };
    await page.waitForTimeout(500);
  }
  return { ok: false, message: "提交后未观察到明确成功信号；请核查后台，勿重复投稿" };
}

export default async function (page, data, window, event) {
  const isDraftMode = data.publishMode === "draft" || data.publishToDraft === true;
  const text = buildPlatformVideoText("哔哩哔哩", data.data);
  let submissionAttempted = false;
  try {
    await assertBlblReady(page);
    await waitBlblSelector(page, '.bcc-upload input[type="file"]');
    const upload = await page.$('.bcc-upload input[type="file"]');
    await upload.uploadFile(path.resolve(data.filePath));
    await pausePublishStep(page, data, "fileSelected");
    await page.waitForTimeout(500);
    await assertBlblReady(page);
    await fillVerifiedText(page, '.input-instance input[placeholder="请输入稿件标题"]', text.title);
    await pausePublishStep(page, data, "title");
    await selectBlblCreativeStatement(page, data);
    await pausePublishStep(page, data, "declaration");
    await selectBlblCategory(page, data.publishOptions && data.publishOptions.category || "影视");
    await pausePublishStep(page, data, "category");
    await assertBlblReady(page);
    await fillVerifiedText(page, ".desc-container .ql-editor", text.description || "");
    await pausePublishStep(page, data, "description");
    await waitBlblSelector(page, ".tag-container .input-instance input");
    const input = await page.$(".tag-container .input-instance input");
    await input.focus();
    for (const tag of normalizeVideoTags(data.data.tags)) {
      await page.keyboard.type(tag, { delay: 100 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
    }
    await waitBlblUpload(page);
    await pausePublishStep(page, data, "tagsAndUploadReady");
    // 已有自动封面时不再等不存在的 cover-empty（最长五分钟）。
    const hasCover = await page.evaluate(() => !!document.querySelector(".cover-main .cover-img"));
    if (!hasCover) await handleBlblCover(page);
    const urlBefore = readPageUrl(page);
    // 单击提交；结果不确定时返回 needsAttention，绝不自动二次点击或重传。
    const submitSelector = isDraftMode ? ".submit-draft" : ".submit-container .submit-add";
    await waitBlblSelector(page, submitSelector);
    await applyOriginalDeclaration(page, data);
    await pausePublishStep(page, data, "beforeSubmit");
    await verifyDeclarationsBeforeSubmit(page, data);
    await assertBlblReady(page);
    submissionAttempted = true;
    await clickBlblSelector(page, submitSelector);
    const confirmation = await waitBlblSubmit(page, isDraftMode);
    await replyPublishOutcome({ page, data, window, event, urlBefore, isDraftMode,
      confirmation, successMessage: confirmation.message, extraPayload: { retryable: false }, waitMs: 0 });
  } catch (e) {
    if (submissionAttempted) {
      await replyPublishOutcome({ page, data, window, event, isDraftMode,
        confirmation: { ok: false, message: "提交结果未确认，请核查后台，勿重复投稿：" + (e && e.message || "页面异常") },
        extraPayload: { retryable: false }, waitMs: 0 });
      return;
    }
    await replyPublishFailure({ page, data, window, event, message: e && e.message || "哔哩哔哩发布失败",
      extraPayload: { retryable: false, needsAttention: !!(e && (e.requiresVerification || e.needsAttention)) } });
  }
}
