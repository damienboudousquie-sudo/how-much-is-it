import { AsyncLocalStorage } from "node:async_hooks";
import { isLang, translate, type Lang } from "@osu-pp/shared";

const store = new AsyncLocalStorage<Lang>();

export function bindLang(header: unknown): void {
  const value = Array.isArray(header) ? header[0] : header;
  store.enterWith(isLang(value) ? value : "en");
}

export function tr(key: string, vars?: Record<string, string | number>): string {
  return translate(store.getStore() ?? "en", key, vars);
}
