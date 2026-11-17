import type { DocumentRef } from "./types";

/** 单文件文本读取上限；超出后仅记录元信息，不读取全文。 */
export const MAX_IMPORT_BYTES = 256 * 1024;

export const IMPORT_ACCEPT = ".json,.txt,.md,.csv";

export const IMPORT_NOTICE =
  "浏览器仅读取你主动选择的文件，不扫描本地目录；PDF/DOCX 暂不支持全文索引；单个文本不超过 256KB，超出仅记录元信息。";

const ACCEPTED_EXTENSIONS = [".json", ".txt", ".md", ".csv"] as const;

export interface ImportDocumentResult {
  document: DocumentRef;
  oversized: boolean;
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

export function isAcceptedImportFile(fileName: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

export function nextUserDocumentId(existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const match = /^DOC-USER-(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `DOC-USER-${String(max + 1).padStart(3, "0")}`;
}

/**
 * 演示版按扩展名推断资料类别：Markdown 视为说明书，纯文本视为规程，
 * CSV/JSON 归入其他资料；不解析文件内容做语义分类。
 */
export function inferDocumentKind(fileName: string): DocumentRef["kind"] {
  switch (extensionOf(fileName)) {
    case ".md":
      return "manual";
    case ".txt":
      return "procedure";
    case ".csv":
    case ".json":
      return "other";
    default:
      return "other";
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function compactSummary(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 200) : "用户导入文件，未读取到文本内容。";
}

/**
 * 从用户主动选择的文件生成 DocumentRef。
 * 超过 256KB 时不读取内容，contentExcerpt 留空，仅保留文件名与大小说明。
 */
export async function buildImportedDocument(
  file: File,
  options: { assetId?: string; updatedAt: string; existingIds: string[] },
): Promise<ImportDocumentResult> {
  const oversized = file.size > MAX_IMPORT_BYTES;
  let text = "";
  if (!oversized) {
    try {
      text = await file.text();
    } catch {
      text = "";
    }
  }

  const contentExcerpt = oversized ? "" : text.slice(0, 2000);
  const fileType = extensionOf(file.name).replace(".", "").toUpperCase() || "TXT";

  return {
    oversized,
    document: {
      id: nextUserDocumentId(options.existingIds),
      title: file.name,
      version: "导入-1",
      assetIds: options.assetId ? [options.assetId] : [],
      kind: inferDocumentKind(file.name),
      reviewed: false,
      source: "user-upload",
      sourceLabel: "用户导入",
      updatedAt: options.updatedAt,
      summary: oversized
        ? `文件大小 ${formatFileSize(file.size)}，超出 256KB 文本读取上限，仅记录元信息。`
        : compactSummary(text),
      contentExcerpt: contentExcerpt || undefined,
      lineOrSection: "本地文件导入（未解析章节）",
      fileType,
      unavailable: false,
    },
  };
}
