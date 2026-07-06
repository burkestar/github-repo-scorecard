import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { scoreLocalRepository } from "@scorecard/core";
import { renderMarkdown, renderTerminal } from "@scorecard/report";
import type { Scorecard } from "@scorecard/schema";

const DEFAULT_SERVER = process.env.SCORECARD_SERVER ?? "https://scorecard.dev.example";

const HELP = `gh scorecard — grade a GitHub repository (security + AI-readiness)

USAGE
  gh scorecard [<owner/repo>] [flags]

  With no argument, uses the current repository (via 'gh repo view').

FLAGS
  --json           Print the raw scorecard JSON
  --markdown       Print a markdown report (good for PR comments)
  --open           Open the full visual report in your browser
  --local          Score a local checkout instead of calling the service
                   (filesystem signals only; OpenSSF excluded)
  --refresh        Bypass the service cache and recompute
  --server <url>   Scorecard service base URL (default: $SCORECARD_SERVER)
  --token <tok>    GitHub token (default: 'gh auth token')
  -h, --help       Show this help
`;

function ghRepoFromCwd(): string | null {
  try {
    const out = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function ghToken(): string | undefined {
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function openInBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    execFileSync(cmd, [url], { stdio: "ignore" });
  } catch {
    console.log(`Open: ${url}`);
  }
}

async function fetchScore(
  server: string,
  owner: string,
  repo: string,
  token: string | undefined,
  refresh: boolean,
): Promise<Scorecard> {
  const url = `${server.replace(/\/$/, "")}/api/v1/score/github.com/${owner}/${repo}${refresh ? "?refresh=true" : ""}`;
  const res = await fetch(url, {
    headers: token ? { "x-github-token": token } : {},
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
    throw new Error(body.detail ?? body.error ?? `service returned ${res.status}`);
  }
  const data = (await res.json()) as { scorecard: Scorecard };
  return data.scorecard;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      markdown: { type: "boolean" },
      open: { type: "boolean" },
      local: { type: "boolean" },
      refresh: { type: "boolean" },
      server: { type: "string" },
      token: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const target = positionals[0] ?? ghRepoFromCwd();
  const server = values.server ?? DEFAULT_SERVER;

  // Local mode: score the working directory without the service.
  if (values.local) {
    const card = await scoreLocalRepository({ root: process.cwd() });
    emit(card, values, server);
    return;
  }

  if (!target || !target.includes("/")) {
    process.stderr.write("error: provide <owner/repo> or run inside a GitHub repo.\n\n" + HELP);
    process.exitCode = 1;
    return;
  }
  const [owner, repo] = target.split("/", 2) as [string, string];
  const token = values.token ?? ghToken();

  if (values.open) {
    openInBrowser(`${server.replace(/\/$/, "")}/report/${owner}/${repo}`);
    return;
  }

  const card = await fetchScore(server, owner, repo, token, Boolean(values.refresh));
  emit(card, values, server);
}

function emit(
  card: Scorecard,
  values: { json?: boolean; markdown?: boolean },
  _server: string,
): void {
  if (values.json) {
    process.stdout.write(JSON.stringify(card, null, 2) + "\n");
  } else if (values.markdown) {
    process.stdout.write(renderMarkdown(card) + "\n");
  } else {
    process.stdout.write(renderTerminal(card) + "\n");
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
