import { getSettings, setSettings } from "../../utils/settings";

async function init(): Promise<void> {
  const serverEl = document.getElementById("server") as HTMLInputElement;
  const tokenEl = document.getElementById("token") as HTMLInputElement;
  const statusEl = document.getElementById("status") as HTMLSpanElement;
  const saveEl = document.getElementById("save") as HTMLButtonElement;

  const current = await getSettings();
  serverEl.value = current.server;
  tokenEl.value = current.token;

  saveEl.addEventListener("click", async () => {
    await setSettings({ server: serverEl.value.trim(), token: tokenEl.value.trim() });
    statusEl.textContent = "Saved ✓";
    setTimeout(() => (statusEl.textContent = ""), 1500);
  });
}

void init();
