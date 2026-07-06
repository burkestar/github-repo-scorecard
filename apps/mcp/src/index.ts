import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { scoreRepository } from "@scorecard/core";
import type { Scorecard } from "@scorecard/schema";
import { z } from "zod";

const SERVER = process.env.SCORECARD_SERVER;
const TOKEN = process.env.GITHUB_TOKEN;

/**
 * Resolve a scorecard either via the hosted service (if SCORECARD_SERVER is set)
 * or by computing it directly with @scorecard/core (standalone mode). Either way
 * the coding agent gets the same canonical Scorecard object.
 */
async function getScorecard(owner: string, repo: string, refresh: boolean): Promise<Scorecard> {
  if (SERVER) {
    const url = `${SERVER.replace(/\/$/, "")}/api/v1/score/github.com/${owner}/${repo}${
      refresh ? "?refresh=true" : ""
    }`;
    const res = await fetch(url, { headers: TOKEN ? { "x-github-token": TOKEN } : {} });
    if (!res.ok) throw new Error(`service returned ${res.status}`);
    const data = (await res.json()) as { scorecard: Scorecard };
    return data.scorecard;
  }
  return scoreRepository({ owner, repo, token: TOKEN });
}

function reportUrl(owner: string, repo: string): string | null {
  return SERVER ? `${SERVER.replace(/\/$/, "")}/report/${owner}/${repo}` : null;
}

const server = new McpServer({ name: "github-repo-scorecard", version: "0.1.0" });

server.registerTool(
  "score_repository",
  {
    title: "Score a GitHub repository",
    description:
      "Grade a GitHub repository across security (OpenSSF Scorecard) and AI-readiness " +
      "(ai-harness) dimensions. Returns an overall A–F grade, per-dimension scores, and " +
      "ranked recommendations. Use before recommending or contributing to a repo.",
    inputSchema: {
      owner: z.string().describe("Repository owner/org, e.g. 'facebook'"),
      repo: z.string().describe("Repository name, e.g. 'react'"),
      refresh: z.boolean().optional().describe("Bypass any cache and recompute"),
    },
  },
  async ({ owner, repo, refresh }) => {
    const sc = await getScorecard(owner, repo, Boolean(refresh));
    const url = reportUrl(owner, repo);
    const summary = {
      repo: `${sc.repo.owner}/${sc.repo.name}`,
      grade: sc.overall.grade,
      score: sc.overall.score,
      dimensions: sc.dimensions.map((d) => ({ label: d.label, score: d.score, grade: d.grade })),
      topRecommendations: sc.recommendations.slice(0, 5),
      reportUrl: url,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    };
  },
);

server.registerTool(
  "get_recommendations",
  {
    title: "Get prioritized repo improvements",
    description:
      "Return only the ranked, actionable steps to improve a repository's scorecard, " +
      "ordered by how many overall points each would recover.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
    },
  },
  async ({ owner, repo }) => {
    const sc = await getScorecard(owner, repo, false);
    const lines = sc.recommendations.map(
      (r, i) => `${i + 1}. [${r.priority}] ${r.title} (+${r.impact}) — ${r.detail}`,
    );
    return {
      content: [
        {
          type: "text",
          text:
            `Recommendations for ${owner}/${repo} (grade ${sc.overall.grade}, ${sc.overall.score}/100):\n\n` +
            (lines.join("\n") || "No outstanding recommendations."),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("github-repo-scorecard MCP server ready (stdio)");
