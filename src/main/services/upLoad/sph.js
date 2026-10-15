import { fillVerifiedText, waitVerifiedSubmit, statementAliases } from "./verifiedForm.js";
import path from "path";
import { applyOriginalDeclaration, verifyDeclarationsBeforeSubmit } from "./originalDeclaration.js";
import { pausePublishStep } from "./publishStepPacing.js";
import maybeClosePublishWindow from "./closeWindow.js";
import { resolveVideoLinkOption } from "../../../shared/videoLink.js";
import {
  isCreativeStatementNone,
  resolveSphCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import { attachSphVideoLink } from "./sphLink.js";
import {
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
  pollPageUntil,
} from "./uploadTimeouts.js";
import { buildPlatformVideoText } from "../../../shared/videoMetadata.js";
import {
  readPageUrl,
  replyPublishFailure,
  replyPublishOutcome,
} from "./publishOutcome.js";

/**
 * 选择视频号「视频标注」（.post-with-mark-tag）。
 * 自行拍摄时间/地点、转载来源为平台选填，本轮只点主选项。
 */
async function applySphCreativeStatement(page, value, data) {
  if (isCreativeStatementNone(value)) return;
  const label = resolveSphCreativeStatementLabel(value);
  const aliases = statementAliases(label, value);
  if (!label || label === "无标注" || label === "无需标注") return;

  const opened = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return false;
    const trigger = root.querySelector(".post-with-mark-tag .select-display");
    if (!trigger) return false;
    trigger.click();
    return true;
  });
  if (!opened) {
    throw new Error("视频标注：未找到入口，已停止提交");
  }
  await pausePublishStep(page, data, "declarationOpen");

  await page.waitForTimeout(300);
  const clicked = await page.evaluate((expected) => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return false;
    const options = Array.from(root.querySelectorAll(".mark-tag-option"));
    const target = options.find((item) => {
      const main = item.querySelector(".option-main");
      return expected.includes(String((main && main.textContent) || "").trim());
    });
    if (!target) return false;
    target.click();
    return true;
  }, aliases);
  if (!clicked) {
    await page.keyboard.press("Escape");
    throw new Error(`视频标注：未找到选项「${label}」，已停止提交`);
  }
  const selected = await page.evaluate(() => { const app = document.querySelector("wujie-app.wujie_iframe"); const el = app && app.shadowRoot && app.shadowRoot.querySelector(".post-with-mark-tag .select-display"); return String(el && el.textContent || "").trim(); });
  if (!aliases.includes(selected)) throw new Error("视频标注选中值核验失败：" + selected);
  console.log(`[sph][mark-tag] 已核验：${label}`);
  await page.waitForTimeout(400);
}

async function clickSphDraftButton(page) {
  const draftBtn = await page.waitForSelector(
    "wujie-app.wujie_iframe >>> .form-btns>div:first-child button",
    { timeout: WAIT_SELECTOR_APPEAR_MS }
  );
  if (!draftBtn) throw new Error("未找到视频号保存草稿按钮");
  await draftBtn.click({ delay: 200 });
  await page.waitForTimeout(1000);
}

async function clickSphPublishButton(page) {
  const publishBtn = await page.waitForSelector(
    "wujie-app.wujie_iframe >>> .form-btns>div:last-child button",
    { timeout: WAIT_SELECTOR_APPEAR_MS }
  );
  if (!publishBtn) throw new Error("未找到视频号发布按钮");
  await publishBtn.click({ delay: 200 });
  await page.waitForTimeout(1000);
}

async function waitSphUploadProcessing(page) {
  await pollPageUntil(
    page,
    () => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      if (!app || !app.shadowRoot) return false;
      const tag = app.shadowRoot.querySelector(".tag-inner");
      return !!(tag && tag.textContent.trim() === "删除");
    },
    WAIT_UPLOAD_PROCESSING_MS,
    2000,
    "等待视频处理超时（未出现「删除」标签）"
  );
  await page.waitForTimeout(2000);
}

async function fallbackLinkFailureToDraft(page, data, window, event, error) {
  const detail =
    (error && error.message) ||
    (typeof error === "string" ? error : String(error));
  try {
    // 链接在表单前半段填写；失败时仍需等待视频处理完成后才能可靠保存草稿。
    await waitSphUploadProcessing(page);
    await clickSphDraftButton(page);
    event.reply("puppeteerFile-done", {
      ...data,
      status: true,
      outcome: "draft_saved",
      publishMode: "draft",
      publishToDraft: true,
      needsAttention: true,
      failureStage: "video_link",
      message: `视频号链接添加失败，视频已保存为草稿：${detail}`,
    });
    maybeClosePublishWindow({ ...data, closeWindowAfterPublish: true }, window);
    return true;
  } catch (draftError) {
    const draftDetail =
      (draftError && draftError.message) || String(draftError || "未知错误");
    throw new Error(
      `视频号链接添加失败：${detail}；保存草稿也失败：${draftDetail}`
    );
  }
}

export default async function (page, data, window, event, onFinish) {
  const isDraftMode =
    data.publishMode === "draft" || data.publishToDraft === true;

  console.log(data);
  await page.waitForTimeout(1000 * 5);
  try {
    const sel = 'wujie-app.wujie_iframe >>> input[type="file"]';

    const uploadInput = await page.waitForSelector(sel, {
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    if (!uploadInput) throw new Error("上传 input 不存在");
    await uploadInput.uploadFile(path.resolve(data.filePath));
    await uploadInput.evaluate((el) => {
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitSphUploadProcessing(page);

    const text = buildPlatformVideoText("视频号", data.data);
    await pausePublishStep(page, data, "uploadReady");
    const titleInput = await page.waitForSelector(
      "wujie-app.wujie_iframe >>> .post-desc-box .input-editor",
      { timeout: WAIT_SELECTOR_APPEAR_MS }
    );
    // 传统input/textarea的操作
    await fillVerifiedText(page, "wujie-app.wujie_iframe >>> .post-desc-box .input-editor", text.description);
    await pausePublishStep(page, data, "descriptionAndTags");
    const shortTitle = text.shortTitle;
    if (shortTitle) {
      const sel2 =
        'wujie-app.wujie_iframe >>> input[placeholder="填写短标题有机会获得更多流量"]';
      const uploadInput2 = await page.waitForSelector(sel2, {
        timeout: WAIT_SELECTOR_APPEAR_MS,
      });
      let newBt = shortTitle.replace(/[，。、\/,;:!?'"()\[\]{}<>]/g, " ");
      await fillVerifiedText(page, sel2, newBt);
      await pausePublishStep(page, data, "shortTitle");
    } else {
      console.log("视频号短标题未填写，跳过");
    }

    const link = resolveVideoLinkOption("视频号", data.publishOptions);
    if (link && link.enabled === true) {
      try {
        const selectedLink = await attachSphVideoLink(page, link);
        console.log(
          `[sph][link] 已添加 ${selectedLink.type} ${selectedLink.value}: ${
            selectedLink.label || ""
          }`
        );
      } catch (linkError) {
        console.error("[sph][link] 添加链接失败:", linkError);
        const handled = await fallbackLinkFailureToDraft(
          page,
          data,
          window,
          event,
          linkError
        );
        if (handled) return;
      }
    }

    await applySphCreativeStatement(page, data.data && data.data.creativeStatement, data);
    await pausePublishStep(page, data, "declaration");

    await applyOriginalDeclaration(page, data);
    await waitSphUploadProcessing(page);

    // 所有表单项（包括商品）完成后，草稿和发布只能二选一执行。
    await pausePublishStep(page, data, "beforeSubmit");
    await verifyDeclarationsBeforeSubmit(page, data);
    const urlBefore = readPageUrl(page);
    if (isDraftMode) await clickSphDraftButton(page);
    else await clickSphPublishButton(page);
    console.log(
      isDraftMode ? "✅ 视频号视频已保存草稿" : "✅ 视频号视频上传成功"
    );
    const confirmation = isDraftMode ? null : await waitVerifiedSubmit(page, "sph");
    await replyPublishOutcome({
      page,
      data,
      window,
      event,
      urlBefore,
      isDraftMode,
      successMessage: isDraftMode ? "保存草稿成功" : "上传成功",
      confirmation,
      waitMs: 0,
    });
  } catch (err) {
    const detail =
      (err && err.message) || (typeof err === "string" ? err : String(err));
    console.error("❌ 视频号发布失败:", err);
    // 失败瞬间截图留证（登录过期 / 风控弹窗 / 元素改版都能一眼看出）
    await replyPublishFailure({
      page,
      data,
      window,
      event,
      message:
        detail && detail.length > 400
          ? `${detail.slice(0, 400)}…`
          : detail || "上传失败",
      closeWindow: true,
      extraPayload: { retryable: false, needsAttention: Boolean(err && err.needsAttention) },
    });
  }
}
