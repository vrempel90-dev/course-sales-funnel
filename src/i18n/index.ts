import type { Language } from "@prisma/client";
import { ru } from "./ru";
import { kz } from "./kz";

export type Key = keyof typeof ru;
export function t(key: Key | string, language: Language = "RU") {
  return (
    (language === "KZ" ? kz[key as Key] : undefined) || ru[key as Key] || key
  );
}
export function localized<T extends { language: Language }>(
  rows: T[],
  language: Language,
): T | undefined {
  return (
    rows.find((row) => row.language === language) ??
    rows.find((row) => row.language === "RU")
  );
}
export function content<T extends { language: Language }>(
  rows: T[],
  language: Language,
  key: keyof T,
): string {
  const value = rows.find((row) => row.language === language)?.[key];
  const fallback = rows.find((row) => row.language === "RU")?.[key];
  return String(
    typeof value === "string" && value.trim() ? value : fallback || "",
  );
}

export function translateMessage(message: string, language: Language = "RU") {
  const entry = Object.entries(ru)
    .filter(([key]) => key.startsWith("error."))
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, value]) => message.startsWith(value));
  return entry
    ? t(entry[0], language) + message.slice(entry[1].length)
    : message;
}
