export type TemplateScope = "page" | "position";

export interface TemplateRecord {
  id: string;
  name: string;
  scope: TemplateScope;
  version: number;
  createdAt: string;
  note: string;
  snapshot: string;
}

export interface TemplateSummary {
  id: string;
  name: string;
  scope: TemplateScope;
  latestVersion: number;
  versions: TemplateRecord[];
}

export interface CreateTemplateInput {
  id?: string;
  name: string;
  scope: TemplateScope;
  note?: string;
  snapshot: string;
  createdAt?: string;
}

export const TEMPLATE_STORAGE_KEY = "tanggang-demo-templates-v1";

const SCOPES: TemplateScope[] = ["page", "position"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTemplateRecord(value: unknown): value is TemplateRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.scope === "page" || value.scope === "position") &&
    typeof value.version === "number" &&
    typeof value.createdAt === "string" &&
    typeof value.note === "string" &&
    typeof value.snapshot === "string"
  );
}

function nextTemplateId(records: TemplateRecord[]): string {
  let max = 0;
  for (const record of records) {
    const match = /^tpl-(\d+)$/.exec(record.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `tpl-${String(max + 1).padStart(3, "0")}`;
}

/**
 * 按模板 id 聚合版本，保留最高版本作为当前名称与范围。
 * 返回结果按名称升序，组内版本按 version 倒序。
 */
export function listTemplates(records: TemplateRecord[]): TemplateSummary[] {
  const grouped = new Map<string, TemplateSummary>();
  for (const record of records) {
    const existing = grouped.get(record.id);
    if (!existing) {
      grouped.set(record.id, {
        id: record.id,
        name: record.name,
        scope: record.scope,
        latestVersion: record.version,
        versions: [record],
      });
      continue;
    }
    existing.versions.push(record);
    if (record.version > existing.latestVersion) {
      existing.latestVersion = record.version;
      existing.name = record.name;
      existing.scope = record.scope;
    }
  }
  return [...grouped.values()]
    .map((summary) => ({
      ...summary,
      versions: summary.versions
        .slice()
        .sort((a, b) => b.version - a.version),
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "zh-Hans-CN") || a.id.localeCompare(b.id),
    );
}

/**
 * 新建模板或为已有模板追加版本。不修改入参，返回新数组。
 */
export function createTemplateVersion(
  records: TemplateRecord[],
  input: CreateTemplateInput,
): TemplateRecord[] {
  const name = input.name.trim();
  if (!name) throw new Error("模板名称不能为空");
  if (!SCOPES.includes(input.scope)) throw new Error("模板范围必须是页面或岗位");
  const snapshot = input.snapshot.trim();
  if (!snapshot) throw new Error("模板快照不能为空");

  const createdAt = input.createdAt ?? new Date().toISOString();
  const note = input.note?.trim() ?? "";
  const id = input.id?.trim();

  if (id) {
    const versions = records.filter((record) => record.id === id);
    if (versions.length === 0) throw new Error(`模板 ${id} 不存在`);
    const version = Math.max(...versions.map((record) => record.version)) + 1;
    return [
      ...records,
      { id, name, scope: input.scope, version, createdAt, note, snapshot },
    ];
  }

  return [
    ...records,
    {
      id: nextTemplateId(records),
      name,
      scope: input.scope,
      version: 1,
      createdAt,
      note,
      snapshot,
    },
  ];
}

/**
 * 回滚不覆盖历史版本，而是基于旧快照生成一个更高版本的新记录。
 */
export function rollbackTemplate(
  records: TemplateRecord[],
  templateId: string,
  version: number,
  createdAt = new Date().toISOString(),
  note?: string,
): TemplateRecord[] {
  const versions = records.filter((record) => record.id === templateId);
  if (versions.length === 0) throw new Error(`模板 ${templateId} 不存在`);
  const target = versions.find((record) => record.version === version);
  if (!target) throw new Error(`模板 ${templateId} 不存在版本 v${version}`);
  const nextVersion = Math.max(...versions.map((record) => record.version)) + 1;
  return [
    ...records,
    {
      ...target,
      version: nextVersion,
      createdAt,
      note: note?.trim() || `回滚至 v${version}`,
      snapshot: target.snapshot,
    },
  ];
}

/**
 * 删除模板的全部版本记录。
 */
export function deleteTemplate(
  records: TemplateRecord[],
  templateId: string,
): TemplateRecord[] {
  const next = records.filter((record) => record.id !== templateId);
  if (next.length === records.length) throw new Error(`模板 ${templateId} 不存在`);
  return next;
}

export function readTemplates(): TemplateRecord[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTemplateRecord);
  } catch {
    return [];
  }
}

export function writeTemplates(records: TemplateRecord[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 本地存储不可用时保持内存态，演示不中断。
  }
}
