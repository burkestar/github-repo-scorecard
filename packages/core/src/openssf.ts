import { spawn } from "node:child_process";

/**
 * OpenSSF Scorecard integration. Strategy:
 *   1. Try the hosted API (api.scorecard.dev) for cron-scanned public repos.
 *   2. Fall back to running the `scorecard` binary (needs a GITHUB_TOKEN and the
 *      binary/Docker on PATH) for arbitrary or private repos.
 * Both paths are normalized to the same shape. OpenSSF scores checks 0–10 with
 * -1 meaning "inconclusive"; we normalize the aggregate to 0–100.
 */

export interface OpenSSFCheck {
  name: string;
  /** 0–100 normalized, or null if inconclusive (raw -1). */
  score: number | null;
  reason: string;
  docUrl: string | null;
  docShort: string | null;
}

export interface OpenSSFResult {
  available: boolean;
  provider: "hosted-api" | "binary" | "unavailable";
  /** Raw OpenSSF aggregate, 0–10, or null. */
  rawScore: number | null;
  /** Normalized 0–100 aggregate, or null. */
  score: number | null;
  checks: OpenSSFCheck[];
  note: string | null;
}

interface RawScorecard {
  score?: number;
  checks?: Array<{
    name: string;
    score: number;
    reason?: string;
    documentation?: { short?: string; url?: string };
  }>;
}

function normalizeRaw(raw: RawScorecard, provider: "hosted-api" | "binary"): OpenSSFResult {
  const checks: OpenSSFCheck[] = (raw.checks ?? []).map((c) => ({
    name: c.name,
    score: typeof c.score === "number" && c.score >= 0 ? c.score * 10 : null,
    reason: c.reason ?? "",
    docUrl: c.documentation?.url ?? null,
    docShort: c.documentation?.short ?? null,
  }));
  const raw10 = typeof raw.score === "number" && raw.score >= 0 ? raw.score : null;
  return {
    available: true,
    provider,
    rawScore: raw10,
    score: raw10 != null ? Math.round(raw10 * 10) : null,
    checks,
    note: null,
  };
}

const unavailable = (note: string): OpenSSFResult => ({
  available: false,
  provider: "unavailable",
  rawScore: null,
  score: null,
  checks: [],
  note,
});

export interface OpenSSFOptions {
  owner: string;
  repo: string;
  /** Token used by the binary fallback. */
  token?: string;
  /** Allow spawning the local `scorecard` binary. Default true. */
  allowBinary?: boolean;
  /** Path/command for the binary. Default "scorecard". */
  binaryPath?: string;
  fetchImpl?: typeof fetch;
}

async function tryHostedApi(
  owner: string,
  repo: string,
  fetchImpl: typeof fetch,
): Promise<OpenSSFResult | null> {
  const url = `https://api.scorecard.dev/projects/github.com/${owner}/${repo}`;
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (res.status === 404) return null; // not scanned
    if (!res.ok) return null;
    const raw = (await res.json()) as RawScorecard;
    return normalizeRaw(raw, "hosted-api");
  } catch {
    return null;
  }
}

async function tryBinary(
  owner: string,
  repo: string,
  token: string | undefined,
  binaryPath: string,
): Promise<OpenSSFResult | null> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      binaryPath,
      [`--repo=github.com/${owner}/${repo}`, "--format=json", "--show-details=false"],
      {
        env: { ...process.env, ...(token ? { GITHUB_TOKEN: token } : {}) },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", () => resolvePromise(null)); // binary not installed
    child.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolvePromise(null);
        return;
      }
      try {
        const raw = JSON.parse(stdout) as RawScorecard;
        resolvePromise(normalizeRaw(raw, "binary"));
      } catch {
        resolvePromise(null);
      }
    });
  });
}

export async function getOpenSSFScore(opts: OpenSSFOptions): Promise<OpenSSFResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const hosted = await tryHostedApi(opts.owner, opts.repo, fetchImpl);
  if (hosted) return hosted;

  if (opts.allowBinary !== false) {
    const bin = await tryBinary(
      opts.owner,
      opts.repo,
      opts.token,
      opts.binaryPath ?? "scorecard",
    );
    if (bin) return bin;
  }

  return unavailable(
    "OpenSSF Scorecard unavailable: repo not in the hosted dataset and the scorecard binary is not installed. Install github.com/ossf/scorecard for full coverage.",
  );
}
