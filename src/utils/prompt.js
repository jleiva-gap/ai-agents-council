function longestFenceRun(text = "", fenceChar = "`") {
  const pattern = new RegExp(`\\${fenceChar}+`, "g");
  let longest = 0;
  for (const match of String(text ?? "").matchAll(pattern)) {
    longest = Math.max(longest, match[0].length);
  }
  return longest;
}

export function buildFencedCodeBlock(text = "", info = "text") {
  const content = String(text ?? "").trim();
  const fenceLength = Math.max(3, longestFenceRun(content, "`") + 1);
  const fence = "`".repeat(fenceLength);
  return `${fence}${info ? String(info).trim() : ""}\n${content}\n${fence}`;
}

export function wrapPromptDataBlock(tagName, content = "") {
  const tag = String(tagName ?? "data")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "data";
  const normalizedContent = String(content ?? "").trim();
  return `<${tag}>\n${normalizedContent}\n</${tag}>`;
}
