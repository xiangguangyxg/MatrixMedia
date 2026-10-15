import fs from "fs";
import crypto from "crypto";
import { normalizeOriginalDeclaration } from "../../../shared/originalDeclaration.js";
import { pausePublishStep } from "./publishStepPacing.js";

const PLATFORM_CODES = { 抖音: "dy", 视频号: "sph", 快手: "ks", 小红书: "xhs", 哔哩哔哩: "blbl" };
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

export async function prepareOriginalDeclaration(data) {
  const review = normalizeOriginalDeclaration(data.publishOptions && data.publishOptions.originalDeclaration);
  if (!review.eligible && data.data && data.data.creativeStatement === "self_made_no_repost") {
    throw new Error("自制禁转载声明需要已核实的原创资格，不能静默忽略或取消请求");
  }
  if (!review.eligible) return review;
  if (review.platform !== PLATFORM_CODES[data.pt]) throw new Error("原创资格审查的目标平台不匹配");
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(data.filePath)) {
    if (data.assertPublishTaskActive) data.assertPublishTaskActive();
    hash.update(chunk);
  }
  if (hash.digest("hex") !== review.fileSha256) throw new Error("原创资格审查与当前视频 SHA256 不匹配");
  return review;
}

// 在页面上下文执行；不依赖闭包，也不把普通标题或 AI 单选项当作原创复选框。
export function originalDeclarationDom(action, args) {
  const roots = [document];
  for (let i = 0; i < roots.length; i++) {
    for (const el of roots[i].querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
  }
  const all = selector => roots.flatMap(root => Array.from(root.querySelectorAll(selector)));
  const norm = text => String(text || "").replace(/\s+/g, "").trim();
  const visible = el => {
    if (!el || el.closest("[hidden]")) return false;
    const rect = el.getBoundingClientRect(), style = el.ownerDocument.defaultView.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  };
  const aiLabels = { dy: ["内容由AI生成"], sph: ["含AI生成内容", "内容由AI生成", "Contains AI-generated content"], ks: ["内容为AI生成", "内容由AI生成"], xhs: ["笔记含AI合成内容"], blbl: ["含AI生成内容", "内容由人工智能生成", "内容由AI生成"] };
  const dialogSelector = '.declare-original-dialog,[role="dialog"],.ant-modal,.semi-modal,.bcc-dialog,.d-modal,.weui-desktop-dialog';
  const isOriginalDialog = el => /声明原创|原创声明|原创协议/.test(el.textContent);
  if (action === "ai") {
    const selectors = { dy: '[class*="selectText-"]', sph: ".post-with-mark-tag .select-display", ks: ".ant-select-selection-item", xhs: '[id^="__xhs_stmt_"] .d-select-description, [id^="__xhs_stmt_"] .d-select-placeholder', blbl: ".statement-content input" };
    const values = all(selectors[args.platform]).filter(visible).map(el => norm(el.value || el.getAttribute("title") || el.textContent));
    const label = aiLabels[args.platform].find(label => values.includes(norm(label)));
    // 页面可能仍展示上一次已选值，不能用它证明尚未确认的声明弹窗已完成。
    const pendingConfirmation = all(dialogSelector).some(el => visible(el) && !isOriginalDialog(el) &&
      /AI|人工智能|合成/i.test(el.textContent) && /声明|标注|label/i.test(el.textContent));
    if (pendingConfirmation) return { verified: false, label: label || "", pendingConfirmation: true };
    return { verified: Boolean(label), label: label || "" };
  }
  if (action === "authDropdown") {
    const trigger = document.querySelector(".statement-content .bcc-select-input-wrap");
    if (!visible(trigger)) return false;
    trigger.click();
    return true;
  }
  const labels = new Set(["原创", "声明原创", "原创声明", "声明为原创", "作品为原创", "此作品为原创"]);
  const candidates = [];
  for (const el of all('label,[role="checkbox"],[role="switch"],input[type="checkbox"],input[type="radio"],.bcc-checkbox,.declare-original-checkbox')) {
    if (!visible(el)) continue;
    const label = norm(el.getAttribute("aria-label") || el.textContent || "");
    if (!labels.has(label)) continue;
    const input = el.matches("input") ? el : el.querySelector('input[type="checkbox"],input[type="radio"]');
    const role = el.matches('[role="checkbox"],[role="switch"]') ? el : el.querySelector('[role="checkbox"],[role="switch"]');
    // 有原生 input、ARIA 或已知组件状态才可以操作；不能盲点标题。
    if (!input && !role && !el.matches('.bcc-checkbox,.declare-original-checkbox')) continue;
    const target = input || role || el;
    if (candidates.some(item => item.target === target)) continue;
    const aria = target.getAttribute("aria-checked");
    const checked = input ? input.checked : aria === "true" ? true : aria === "false" ? false : null;
    candidates.push({ el, target, label, checked, disabled: Boolean(target.disabled || target.getAttribute("aria-disabled") === "true"), radio: Boolean(input && input.type === "radio") });
  }
  // 小红书把文字标题和开关放在兄弟节点；只匹配“原创声明”这一行，
  // 读取其原生 checkbox，不能把 PK 封面等其它 d-switch 当成原创。
  if (args.platform === "xhs") for (const row of all(".custom-switch-card")) {
    const title = row.querySelector(".custom-switch-text-content .has-tips");
    const input = row.querySelector('.custom-switch-switch input[type="checkbox"]');
    const toggle = row.querySelector(".custom-switch-switch .d-switch");
    if (!visible(row) || norm(title && title.textContent) !== "原创声明" || !input || !toggle) continue;
    if (candidates.some(item => item.target === input)) continue;
    const durations = all("video").map(el => Number(el.duration)).filter(value => Number.isFinite(value) && value > 0);
    const durationSeconds = Math.max(0, ...durations);
    candidates.push({ el: toggle, target: input, label: "原创声明", checked: input.checked,
      disabled: Boolean(input.disabled || toggle.classList.contains("disabled")), radio: false,
      durationSeconds, restriction: durationSeconds > 0 && durationSeconds < 10 ? "xhs_duration_below_10_seconds" : "" });
  }
  // B站的授权声明是独立开关，可以和 AI 声明共存；绝不选首发/独家。
  if (args.platform === "blbl") for (const el of all(".statement-content .auth-content")) {
    const label = norm(el.textContent);
    // 该组件关闭菜单时仍保留 Vue 状态，动画可让几何尺寸为零；读明确勾选标记，
    // 不以视口几何推断授权状态，也不把其它隐藏菜单纳入通用控件匹配。
    if (label === "内容为自制：未经作者允许，禁止转载") {
      candidates.push({ el, target: el, label, checked: Boolean(el.querySelector(".option-text-selected,.icon-sprite-duihao,.bcc-icon-ic_MenuButton-tick,.selected,.checked")), disabled: false, radio: false });
    }
  }
  if (action === "click") {
    const match = candidates.find(item => item.label === args.label);
    if (!match || match.disabled) return false;
    if (match.radio && !args.desired) return false;
    if (match.checked !== args.desired) match.el.click();
  }
  if (action === "dialog" || action === "confirm") {
    const matches = all(dialogSelector).filter(visible).filter(isOriginalDialog);
    const dialogs = matches.filter(el => !matches.some(other => other !== el && el.contains(other)));
    if (dialogs.length > 1) return { ambiguous: true };
    const dialog = dialogs[0];
    if (!dialog) return null;
    if (action === "confirm") {
      const agreements = Array.from(dialog.querySelectorAll('input[type="checkbox"]')).filter(input => {
        const wrapper = input.closest('label,.d-checkbox');
        const text = norm(wrapper && wrapper.textContent);
        return /已阅读|同意.*原创|原创.*协议/.test(text) && !/独家|首发|付费|营销/.test(text);
      });
      for (const input of agreements) {
        if (input.disabled) return { error: "原创协议勾选框不可用" };
        if (!input.checked) {
          // 小红书由 d-checkbox 父节点处理点击；不能只写 checked 属性。
          (input.closest('.d-checkbox') || input).click();
          return { pending: true, consentChecked: false };
        }
      }
      if (args.platform === "xhs" && dialog.querySelector('.originalContainer') && agreements.length !== 1) return { error: "未找到唯一的原创声明须知勾选框" };
      const button = Array.from(dialog.querySelectorAll("button")).find(el => visible(el) && !el.disabled && /^(同意|确定|确认|声明原创|同意并声明原创)$/.test(norm(el.textContent)));
      if (!button) return { pending: true, consentChecked: agreements.length > 0 && agreements.every(input => input.checked) };
      button.click();
      return { consentChecked: agreements.length > 0 && agreements.every(input => input.checked), buttonClicked: true };
    }
    return { text: String(dialog.innerText || dialog.textContent || "").trim() };
  }
  return candidates.map(({ label, checked, disabled, radio, durationSeconds, restriction }) => ({ label, checked, disabled, radio, durationSeconds, restriction }));
}

async function readAi(page, data, platform) {
  if (!data.data || data.data.creativeStatement !== "ai_generated") return null;
  const state = await page.evaluate(originalDeclarationDom, "ai", { platform });
  if (!state.verified) throw new Error("AI 声明未核验或被原创操作改变，已停止提交");
  return state;
}

export async function applyOriginalDeclaration(page, data) {
  const platform = PLATFORM_CODES[data.pt];
  if (!platform) return;
  const review = { ...(data.originalDeclarationReview || { eligible: false, reason: "未提供原创资格审查，不声明原创" }) };
  const result = { platform, eligible: review.eligible, reason: review.reason, status: "checking", verified: false, checkedAt: new Date().toISOString() };
  data.originalDeclarationResult = result;
  let opened = false;
  try {
    const ai = await readAi(page, data, platform);
    let controls = await page.evaluate(originalDeclarationDom, "read", { platform });
    if (platform === "blbl" && !controls.length) {
      opened = await page.evaluate(originalDeclarationDom, "authDropdown", { platform });
      if (opened) {
        for (let i = 0; i < 25; i++) {
          controls = await page.evaluate(originalDeclarationDom, "read", { platform });
          if (controls.length) break;
          await page.waitForTimeout(200);
        }
      }
    }
    if (!controls.length) {
      result.status = "not_offered";
      result.reason = "当前已加载投稿页未提供可独立核验的原创控件；不等同于已声明原创";
    } else {
      if (controls.length !== 1) throw new Error("原创控件不唯一，已停止提交以避免误选");
      const control = controls[0];
      result.label = control.label;
      if (control.durationSeconds > 0) result.videoDurationSeconds = control.durationSeconds;
      if (control.restriction === "xhs_duration_below_10_seconds") {
        result.requestedEligible = review.eligible;
        result.eligible = review.eligible = false;
        result.runtimeRestriction = control.restriction;
        result.reason = "小红书视频时长小于10秒，不支持原创声明；保留AI声明且不勾选原创";
      }
      if (typeof control.checked !== "boolean") throw new Error("原创控件选中状态无法识别，已停止提交");
      if (control.disabled && review.eligible) throw new Error("原创控件不可用，不能确认账号资格");
      const clicked = await page.evaluate(originalDeclarationDom, "click", { platform, label: control.label, desired: review.eligible });
      if (!clicked && control.checked !== review.eligible) throw new Error("原创控件无法切换");
      await pausePublishStep(page, data, "originalDeclaration");
      const dialog = await page.evaluate(originalDeclarationDom, "dialog", { platform });
      if (dialog) {
        result.termsText = dialog.text || "";
        result.termsSha256 = sha256(result.termsText);
        if (dialog.ambiguous || !review.eligible || review.acceptedTermsSha256 !== result.termsSha256) throw new Error("原创协议尚未核对或已变更，保留页面并停止提交");
        if (/独家|首发/.test(result.termsText)) throw new Error("原创协议包含独家或首发条件，本流程不自动接受");
        if (data.data && data.data.creativeStatement === "ai_generated" && /(?:不得|不能|不支持|不属于).{0,30}(?:AI|人工智能)|(?:AI|人工智能).{0,30}(?:不得|不能|不支持|不属于)/i.test(result.termsText)) throw new Error("原创协议对 AI 内容有限制，须重新判断资格");
        let confirmation;
        for (let i = 0; i < 25; i++) {
          confirmation = await page.evaluate(originalDeclarationDom, "confirm", { platform });
          if (!confirmation || confirmation.error || confirmation.buttonClicked) break;
          await page.waitForTimeout(200);
        }
        if (!confirmation || confirmation.error || !confirmation.buttonClicked) throw new Error(confirmation && confirmation.error || "原创协议勾选或确认按钮核验失败");
        result.confirmation = confirmation;
      }
      let verified = false;
      for (let i = 0; i < 25; i++) {
        const states = await page.evaluate(originalDeclarationDom, "read", { platform });
        const pendingDialog = await page.evaluate(originalDeclarationDom, "dialog", { platform });
        if (!pendingDialog && states.length === 1 && states[0].label === control.label && states[0].checked === review.eligible) { verified = true; break; }
        await page.waitForTimeout(200);
      }
      if (!verified) throw new Error("原创声明选中状态核验失败");
      if (await page.evaluate(originalDeclarationDom, "dialog", { platform })) throw new Error("原创协议仍未确认，已停止提交");
      if (result.confirmation) result.confirmation.closed = true;
      result.status = review.eligible ? "selected" : "not_claimed";
      result.verified = true;
      result.selected = review.eligible;
    }
    data.creativeStatementVerification = await readAi(page, data, platform) || ai;
    console.log("[original-declaration]", JSON.stringify(result));
    return result;
  } catch (error) {
    result.status = "failed";
    result.error = error.message;
    error.retryable = false;
    error.needsAttention = true;
    throw error;
  } finally {
    if (opened) await page.evaluate(originalDeclarationDom, "authDropdown", { platform }).catch(() => {});
  }
}

// 上传处理、封面和最终停顿可能耗时；真正提交前再次读取状态，不能复用过期的核验。
export async function verifyDeclarationsBeforeSubmit(page, data) {
  const platform = PLATFORM_CODES[data.pt];
  if (!platform) return;
  try {
    if (data.assertPublishTaskActive) data.assertPublishTaskActive();
    const result = data.originalDeclarationResult;
    if (!result || result.status === "failed") throw new Error("原创声明核查尚未完成");
    const states = await page.evaluate(originalDeclarationDom, "read", { platform });
    if (result.selected && states.some(state => state.restriction === "xhs_duration_below_10_seconds")) {
      throw new Error("提交前确认小红书视频不足10秒，不能声明原创，已停止提交");
    }
    if (result.status === "not_offered") {
      if (states.length) throw new Error("提交前出现新的原创控件，须重新核查资格和状态");
    } else if (states.length !== 1 || states[0].label !== result.label || states[0].checked !== result.selected) {
      throw new Error("提交前原创声明状态发生变化，已停止提交");
    }
    data.creativeStatementVerification = await readAi(page, data, platform);
    if (await page.evaluate(originalDeclarationDom, "dialog", { platform })) {
      throw new Error("提交前原创协议仍未确认，已停止提交");
    }
    if (data.assertPublishTaskActive) data.assertPublishTaskActive();
    result.lastVerifiedAt = new Date().toISOString();
  } catch (error) {
    if (data.originalDeclarationResult) data.originalDeclarationResult.status = "failed";
    error.retryable = false;
    error.needsAttention = true;
    throw error;
  }
}
