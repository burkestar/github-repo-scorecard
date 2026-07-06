import { renderReportHtml } from "@scorecard/report/html";
import type { Scorecard } from "@scorecard/schema";
import { defineContentScript } from "wxt/sandbox";
import { getSettings } from "../utils/settings";

const TAB_ID = "scorecard-nav-tab";
const HOST_ID = "scorecard-modal-host";

/** Top-level GitHub paths that are NOT repositories. */
const RESERVED = new Set([
  "orgs", "users", "settings", "marketplace", "notifications", "explore",
  "topics", "trending", "collections", "events", "sponsors", "about",
  "pricing", "features", "new", "login", "join", "logout", "dashboard",
  "search", "apps", "organizations", "account", "codespaces", "pulls",
  "issues", "watching", "stars", "readme", "contact", "site", "security",
  "customer-stories", "team", "enterprise", "sponsors",
]);

function parseRepo(): { owner: string; repo: string } | null {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo || RESERVED.has(owner.toLowerCase())) return null;
  return { owner, repo };
}

function findNav(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>("ul.UnderlineNav-body") ??
    document.querySelector<HTMLElement>('nav[aria-label="Repository"] ul') ??
    null
  );
}

/** Custom-property theme block scoped to the modal's shadow host. */
const THEME_VARS = `
:host {
  color-scheme: light dark;
  --surface-1:#fcfcfb; --page:#f9f9f7; --text-primary:#0b0b0b; --text-secondary:#52514e;
  --muted:#898781; --gridline:#e1e0d9; --baseline:#c3c2b7; --border:rgba(11,11,11,.10);
  --series-1:#2a78d6; --series-1-fill:rgba(42,120,214,.16);
  --good:#0ca30c; --warning:#fab219; --serious:#ec835a; --critical:#d03b3b;
}
@media (prefers-color-scheme: dark){ :host {
  --surface-1:#1a1a19; --page:#0d0d0d; --text-primary:#fff; --text-secondary:#c3c2b7;
  --gridline:#2c2c2a; --baseline:#383835; --border:rgba(255,255,255,.10);
  --series-1:#3987e5; --series-1-fill:rgba(57,135,229,.20);
} }
.sc-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483000;
  display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:32px 16px;}
.sc-modal{position:relative;width:100%;max-width:1000px;background:var(--page);
  border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.4);}
.sc-close{position:absolute;top:10px;right:12px;z-index:1;border:none;cursor:pointer;
  background:var(--surface-1);color:var(--text-primary);border:1px solid var(--border);
  width:32px;height:32px;border-radius:8px;font-size:16px;line-height:1;}
.sc-state{padding:60px 24px;text-align:center;color:var(--text-secondary);
  font-family:system-ui,sans-serif;}
`;

function closeModal(): void {
  document.getElementById(HOST_ID)?.remove();
}

async function openModal(owner: string, repo: string): Promise<void> {
  closeModal();
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const setBody = (inner: string) => {
    shadow.innerHTML = `<style>${THEME_VARS}</style><div class="sc-backdrop"><div class="sc-modal"><button class="sc-close" title="Close">✕</button>${inner}</div></div>`;
    shadow.querySelector(".sc-close")?.addEventListener("click", closeModal);
    shadow.querySelector(".sc-backdrop")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeModal();
    });
  };

  setBody(`<div class="sc-state">Scoring ${owner}/${repo}…</div>`);

  try {
    const { server, token } = await getSettings();
    const url = `${server.replace(/\/$/, "")}/api/v1/score/github.com/${owner}/${repo}`;
    const res = await fetch(url, { headers: token ? { "x-github-token": token } : {} });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new Error(detail.detail ?? `service returned ${res.status}`);
    }
    const { scorecard } = (await res.json()) as { scorecard: Scorecard };
    setBody(renderReportHtml(scorecard, { fragment: true }));
  } catch (err) {
    setBody(
      `<div class="sc-state"><p><b>Could not load scorecard.</b></p><p>${
        (err as Error).message
      }</p><p style="font-size:13px">Set the service URL in the extension options.</p></div>`,
    );
  }
}

function injectTab(): void {
  const target = parseRepo();
  const nav = findNav();
  if (!target || !nav || nav.querySelector(`#${TAB_ID}`)) return;

  const li = document.createElement("li");
  li.className = "d-inline-flex";
  li.id = TAB_ID;
  li.style.cssText = "margin-left:8px;align-items:center;";
  const a = document.createElement("a");
  a.href = "#scorecard";
  a.textContent = "📊 Scorecard";
  a.style.cssText =
    "display:inline-flex;align-items:center;gap:4px;padding:8px 8px;font-size:14px;" +
    "color:inherit;text-decoration:none;border-bottom:2px solid transparent;cursor:pointer;";
  a.addEventListener("click", (e) => {
    e.preventDefault();
    void openModal(target.owner, target.repo);
  });
  li.appendChild(a);
  nav.appendChild(li);
}

export default defineContentScript({
  matches: ["*://github.com/*"],
  main() {
    injectTab();
    // GitHub is a SPA (Turbo). Re-inject after client-side navigations.
    document.addEventListener("turbo:load", injectTab);
    document.addEventListener("pjax:end", injectTab);
    const observer = new MutationObserver(() => injectTab());
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  },
});
