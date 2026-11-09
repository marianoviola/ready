import type { Source } from "./types";
import { getDomain, isScriptableUrl, normalizeUrl } from "./url";

export interface SourceInput {
  name: string;
  url: string;
  subscribed: boolean;
  note?: string;
}

export function normalizeSourceUrl(value: string): string {
  const trimmed = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  if (!isScriptableUrl(candidate)) {
    throw new Error("Source URL must use http or https.");
  }
  return normalizeUrl(candidate);
}

export function sourceFromInput(
  input: SourceInput,
  existing?: Source,
  now = Date.now()
): Source {
  const normalizedUrl = normalizeSourceUrl(input.url);
  const name = input.name.trim() || getDomain(normalizedUrl);
  const note = input.note?.trim();

  return {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    url: normalizedUrl,
    normalizedUrl,
    domain: getDomain(normalizedUrl),
    subscribed: input.subscribed,
    note: note || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}
