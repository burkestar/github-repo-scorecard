import type { Scorecard } from "@scorecard/schema";
import { describe, expect, it } from "vitest";
import { renderBadge, renderMarkdown, renderRadarSvg, renderReportHtml } from "../src/index.js";

const sc: Scorecard = {
  schemaVersion: 1,
  repo: {
    host: "github.com",
    owner: "acme",
    name: "widget",
    url: "https://github.com/acme/widget",
    defaultBranch: "main",
    commitSha: "abc",
    isPrivate: false,
  },
  overall: { score: 72, grade: "B" },
  dimensions: [
    { id: "architecture", label: "Architecture Docs", score: 60, weight: 0.12, grade: "C" },
    { id: "mechanical", label: "Mechanical Constraints", score: 80, weight: 0.16, grade: "B" },
    { id: "testing", label: "Testing & Stability", score: 70, weight: 0.16, grade: "B" },
    { id: "review", label: "Review & Drift", score: 55, weight: 0.12, grade: "C" },
    { id: "ai_safeguards", label: "AI Safeguards", score: 40, weight: 0.08, grade: "D" },
    { id: "security", label: "Security (OpenSSF)", score: 90, weight: 0.36, grade: "A" },
  ],
  checks: [
    {
      id: "arch.readme",
      name: "README",
      dimension: "architecture",
      score: 50,
      weight: 1,
      status: "partial",
      evidence: ["short"],
      remediation: "Expand it",
      docUrl: null,
      impact: 1.2,
    },
  ],
  recommendations: [
    {
      checkId: "arch.readme",
      dimension: "architecture",
      title: "README",
      detail: "Expand it",
      docUrl: null,
      impact: 1.2,
      priority: "medium",
    },
  ],
  sources: {
    harness: { provider: "native", rawScore: null, note: null },
    openssf: { provider: "hosted-api", rawScore: 9, note: null },
  },
  weights: { harness: 0.5, openssf: 0.5 },
  generatedAt: "2026-07-06T00:00:00.000Z",
  durationMs: 100,
};

describe("renderers", () => {
  it("radar svg has one vertex per dimension and the score labels", () => {
    const svg = renderRadarSvg(sc.dimensions);
    expect(svg).toContain("<svg");
    expect((svg.match(/<circle/g) ?? []).length).toBe(sc.dimensions.length);
    expect(svg).toContain(">90<"); // security score label
  });

  it("html report is self-contained and names the repo + grade", () => {
    const html = renderReportHtml(sc);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("acme/widget");
    expect(html).toContain(">B<");
    expect(html).not.toContain("http://cdn"); // no external assets
  });

  it("fragment mode omits the document shell (for shadow-DOM embedding)", () => {
    const frag = renderReportHtml(sc, { fragment: true });
    expect(frag.startsWith("<style>")).toBe(true);
    expect(frag).not.toContain("<!doctype");
  });

  it("badge encodes the overall grade with a shields color", () => {
    const badge = renderBadge(sc);
    expect(badge).toEqual({ schemaVersion: 1, label: "scorecard", message: "B (72)", color: "green" });
  });

  it("markdown lists dimensions and recommendations", () => {
    const md = renderMarkdown(sc);
    expect(md).toContain("| Security (OpenSSF) | 90 | A |");
    expect(md).toContain("**README**");
  });
});
