import { serve } from "@hono/node-server";
import { scoreRepository } from "@scorecard/core";
import { renderBadge, renderReportHtml } from "@scorecard/report";
import type { Scorecard } from "@scorecard/schema";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createCache } from "./cache.js";

const cache = createCache({
  dbPath: process.env.CACHE_DB ?? "scorecard-cache.sqlite",
  ttlMs: Number(process.env.CACHE_TTL_MS ?? 24 * 60 * 60 * 1000),
});

const serverToken = process.env.GITHUB_TOKEN;

const app = new Hono();

// The browser extension calls this cross-origin from github.com.
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true }));

interface ComputeResult {
  scorecard: Scorecard;
  cached: boolean;
}

async function compute(
  owner: string,
  repo: string,
  token: string | undefined,
  refresh: boolean,
): Promise<ComputeResult> {
  const key = `${owner}/${repo}`.toLowerCase();
  if (!refresh) {
    const hit = cache.get(key);
    if (hit) return { scorecard: hit.scorecard, cached: true };
  }
  const scorecard = await scoreRepository({
    owner,
    repo,
    token: token ?? serverToken,
  });
  cache.set(key, scorecard);
  return { scorecard, cached: false };
}

function tokenFrom(c: { req: { header: (k: string) => string | undefined } }): string | undefined {
  return c.req.header("x-github-token") ?? undefined;
}

app.get("/api/v1/score/github.com/:owner/:repo", async (c) => {
  const { owner, repo } = c.req.param();
  const refresh = c.req.query("refresh") === "true";
  try {
    const result = await compute(owner, repo, tokenFrom(c), refresh);
    return c.json({ scorecard: result.scorecard, cached: result.cached });
  } catch (err) {
    return c.json(
      { error: "score_failed", detail: (err as Error).message },
      502,
    );
  }
});

app.get("/report/:owner/:repo", async (c) => {
  const { owner, repo } = c.req.param();
  const refresh = c.req.query("refresh") === "true";
  try {
    const { scorecard } = await compute(owner, repo, tokenFrom(c), refresh);
    return c.html(renderReportHtml(scorecard));
  } catch (err) {
    return c.html(
      `<!doctype html><body style="font-family:system-ui;padding:2rem"><h1>Scorecard error</h1><p>${
        (err as Error).message
      }</p></body>`,
      502,
    );
  }
});

app.get("/badge/:owner/:repo", async (c) => {
  const { owner, repo } = c.req.param();
  try {
    const { scorecard } = await compute(owner, repo, tokenFrom(c), false);
    return c.json(renderBadge(scorecard));
  } catch {
    return c.json({ schemaVersion: 1, label: "scorecard", message: "error", color: "lightgrey" });
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`scorecard server listening on http://localhost:${port}`);

export { app };
