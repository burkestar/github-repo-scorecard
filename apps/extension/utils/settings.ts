import { browser } from "wxt/browser";

export const DEFAULT_SERVER = "http://localhost:8787";

export interface Settings {
  server: string;
  token: string;
}

export async function getSettings(): Promise<Settings> {
  const s = (await browser.storage.sync.get(["server", "token"])) as Partial<Settings>;
  return { server: s.server || DEFAULT_SERVER, token: s.token || "" };
}

export async function setSettings(s: Settings): Promise<void> {
  await browser.storage.sync.set({ server: s.server, token: s.token });
}
