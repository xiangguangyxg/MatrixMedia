// 原创资格由素材与平台条件审查提供，不从标题、模板或 AI 配音自动推断。
export function normalizeOriginalDeclaration(value) {
  if (value == null) return { eligible: false, reason: "未提供原创资格审查，不声明原创" };
  if (typeof value !== "object" || Array.isArray(value) || typeof value.eligible !== "boolean") {
    throw new Error("originalDeclaration 必须包含布尔值 eligible");
  }
  if (value.exclusive === true || value.firstPublished === true) throw new Error("原创声明不接受首发或独家承诺");
  const result = { eligible: value.eligible, reason: String(value.reason || "").trim() };
  if (!result.reason) throw new Error("原创资格审查必须说明原因");
  if (value.eligible) {
    if (!Array.isArray(value.evidence) || !value.evidence.length || value.evidence.some(v => typeof v !== "string" || !v.trim())) throw new Error("原创资格审查必须提供证据路径或来源");
    if (!/^[a-f\d]{64}$/i.test(value.fileSha256 || "")) throw new Error("原创资格审查必须绑定视频 SHA256");
    if (!["dy", "sph", "ks", "xhs", "blbl"].includes(value.platform)) throw new Error("原创资格审查必须指定目标平台");
    result.evidence = value.evidence.map(v => v.trim());
    result.fileSha256 = value.fileSha256.toLowerCase();
    result.platform = value.platform;
    if (value.acceptedTermsSha256 != null) {
      if (!/^[a-f\d]{64}$/i.test(value.acceptedTermsSha256)) throw new Error("原创协议 SHA256 格式错误");
      result.acceptedTermsSha256 = value.acceptedTermsSha256.toLowerCase();
    }
  }
  return result;
}
