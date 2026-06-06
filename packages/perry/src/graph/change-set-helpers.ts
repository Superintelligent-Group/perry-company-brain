// change-set-helpers — split out of change-set.ts
import { type GraphMemorySyncInput } from "./memory";

const knownProjects = ["Wallace", "Perry", "Atlas", "Notion Wiki", "Discord Ops", "Graph Memory"];

export function inferProject(input: GraphMemorySyncInput): string | undefined {
  return (
    input.route?.project ??
    inferProjectFromText(input.note.folderName) ??
    inferProjectFromText(input.note.title) ??
    inferProjectFromText(
      [
        ...input.knowledge.decisions.map((item) => item.text),
        ...input.knowledge.actionItems.map((item) => item.text),
      ].join("\n")
    )
  );
}

export function inferProjectFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return knownProjects.find((project) => text.toLowerCase().includes(project.toLowerCase()));
}

export function projectStableKey(project: string): string {
  return `project:${normalizeKey(project)}`;
}

export function personKey(name?: string, email?: string): string {
  return `person:${normalizeKey(email ?? name ?? "unknown")}`;
}

export function normalizeKey(value: string | undefined): string {
  return (value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 160);
}

export function compactExcerpt(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const compact = value
    .replace(/\bprivate notes?\s*:.*$/gimu, "")
    .replace(/\btranscript\s*:.*$/gimu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return compact.length > 500 ? `${compact.slice(0, 497).trimEnd()}...` : compact;
}

export function validIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function cleanProperties(
  properties: Record<string, string | number | boolean | null | undefined>
): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) output[key] = value;
  }
  return output;
}

export function unique(items: Array<string | undefined> | undefined): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items ?? []) {
    const normalized = item?.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}
