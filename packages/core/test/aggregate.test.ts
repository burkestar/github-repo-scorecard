import { describe, expect, it } from "vitest";
import { aggregate } from "../src/aggregate.js";
import type { OpenSSFResult } from "../src/openssf.js";
import { MockDataSource } from "./mock-datasource.js";

const noOpenSSF: OpenSSFResult = {
  available: false,
  provider: "unavailable",
  rawScore: null,
  score: null,
  checks: [],
  note: "test",
};

const goodOpenSSF: OpenSSFResult = {
  available: true,
  provider: "hosted-api",
  rawScore: 8.5,
  score: 85,
  checks: [
    { name: "Branch-Protection", score: 100, reason: "enabled", docUrl: null, docShort: "x" },
    { name: "Code-Review", score: 50, reason: "some", docUrl: null, docShort: "Require reviews" },
  ],
  note: null,
};

describe("aggregate", () => {
  it("gives a bare repo a low grade and OpenSSF weight of 0 when unavailable", async () => {
    const ds = new MockDataSource({ files: {} });
    const card = await aggregate({ ds, openssf: noOpenSSF });
    expect(card.overall.score).toBeLessThan(40);
    expect(card.overall.grade).toBe("F");
    expect(card.weights.openssf).toBe(0);
    // no security dimension when OpenSSF is unavailable
    expect(card.dimensions.find((d) => d.id === "security")).toBeUndefined();
  });

  it("rewards a well-run repo and includes the security dimension", async () => {
    const ds = new MockDataSource({
      files: {
        "README.md": "x".repeat(1200),
        "CLAUDE.md": "This project uses AI agents. Error handling conventions: ...",
        "ARCHITECTURE.md": "arch",
        "CONTRIBUTING.md": "contributing with ai agents; design first; conventions",
        "CODEOWNERS": "* @acme/core",
        ".github/pull_request_template.md": "template",
        "SECURITY.md": "security",
        "tsconfig.json": '{ "compilerOptions": { "strict": true } }',
        ".prettierrc": "{}",
        ".eslintrc.json": "{}",
        ".github/dependabot.yml": "version: 2",
        ".pre-commit-config.yaml": "repos: []",
      },
      dirs: { "docs/adr": ["0001-record.md"], tests: ["a.test.ts"] },
      languages: { TypeScript: 1000 },
      workflows: [
        {
          name: "ci.yml",
          path: ".github/workflows/ci.yml",
          content:
            "on:\n  pull_request:\njobs:\n  test:\n    steps:\n      - run: pnpm lint && vitest run --coverage\n  codeql:\n    uses: github/codeql-action\non:\n  schedule:\n    - cron: '0 0 * * 0'\n",
        },
      ],
      branchProtection: {
        enabled: true,
        requiresPullRequest: true,
        requiredApprovingReviewCount: 1,
        requiresStatusChecks: true,
        requiredStatusChecks: ["test"],
        enforceAdmins: true,
        dismissStaleReviews: true,
      },
      pullStats: { sampled: 10, reviewed: 10, medianMergeDays: 1 },
    });
    const card = await aggregate({ ds, openssf: goodOpenSSF });
    expect(card.overall.score).toBeGreaterThan(70);
    expect(["A", "B"]).toContain(card.overall.grade);
    expect(card.dimensions.find((d) => d.id === "security")?.score).toBe(85);
  });

  it("ranks recommendations by descending impact", async () => {
    const ds = new MockDataSource({ files: {} });
    const card = await aggregate({ ds, openssf: goodOpenSSF });
    const impacts = card.recommendations.map((r) => r.impact);
    const sorted = [...impacts].sort((a, b) => b - a);
    expect(impacts).toEqual(sorted);
    expect(card.recommendations.length).toBeGreaterThan(0);
  });

  it("produces dimension weights that sum to ~1", async () => {
    const ds = new MockDataSource({ files: {} });
    const card = await aggregate({ ds, openssf: goodOpenSSF });
    const total = card.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});
