import {
  type CheckResult,
  type CheckStatus,
  DIMENSION_META,
  type DimensionId,
  type DimensionScore,
  type Recommendation,
  type Scorecard,
  scoreToGrade,
} from "@scorecard/schema";
import { HARNESS_CHECKS } from "./checks/harness.js";
import type { Check } from "./checks/types.js";
import type { RepoDataSource } from "./datasource/types.js";
import { type OpenSSFResult } from "./openssf.js";

/** OpenSSF risk weights used to rank security sub-check recommendations. */
const OPENSSF_RISK: Record<string, number> = {
  "Dangerous-Workflow": 10,
  "Branch-Protection": 7.5,
  "Code-Review": 7.5,
  "Maintained": 7.5,
  "Signed-Releases": 7.5,
  "Token-Permissions": 7.5,
  "Vulnerabilities": 7.5,
  "Binary-Artifacts": 7.5,
  "Dependency-Update-Tool": 7.5,
  "Fuzzing": 5,
  "Packaging": 5,
  "Pinned-Dependencies": 5,
  "SAST": 5,
  "Security-Policy": 5,
  "Webhooks": 5,
  "CI-Tests": 2.5,
  "CII-Best-Practices": 2.5,
  "Contributors": 2.5,
  "License": 2.5,
};

export interface AggregateConfig {
  /** Share of the overall score from the ai-harness dimensions. Default 0.5. */
  harnessWeight?: number;
  /** Share from the OpenSSF security dimension. Default 0.5. */
  openssfWeight?: number;
}

const HARNESS_DIMS: DimensionId[] = [
  "architecture",
  "mechanical",
  "testing",
  "review",
  "ai_safeguards",
];

function statusFromScore(score: number): CheckStatus {
  if (score >= 100) return "pass";
  if (score <= 0) return "fail";
  return "partial";
}

/** Run every harness check and turn each into a CheckResult (impact filled later). */
async function runHarnessChecks(ds: RepoDataSource): Promise<CheckResult[]> {
  const results = await Promise.all(
    HARNESS_CHECKS.map(async (check: Check): Promise<CheckResult> => {
      try {
        const out = await check.run(ds);
        return {
          id: check.id,
          name: check.name,
          dimension: check.dimension,
          score: out.score,
          weight: check.weight,
          status: out.status,
          evidence: out.evidence,
          remediation: out.score >= 100 ? null : out.remediation ?? check.remediation,
          docUrl: check.docUrl ?? null,
          impact: 0,
        };
      } catch (err) {
        return {
          id: check.id,
          name: check.name,
          dimension: check.dimension,
          score: 0,
          weight: check.weight,
          status: "error" as CheckStatus,
          evidence: [`Check failed: ${(err as Error).message}`],
          remediation: check.remediation,
          docUrl: check.docUrl ?? null,
          impact: 0,
        };
      }
    }),
  );
  return results;
}

/** Turn OpenSSF sub-checks into security-dimension CheckResults. */
function openssfChecks(openssf: OpenSSFResult): CheckResult[] {
  return openssf.checks.map((c): CheckResult => {
    const score = c.score ?? 0;
    const inconclusive = c.score == null;
    return {
      id: `openssf.${c.name.toLowerCase()}`,
      name: c.name.replace(/-/g, " "),
      dimension: "security",
      score,
      weight: OPENSSF_RISK[c.name] ?? 5,
      status: inconclusive ? "not_applicable" : statusFromScore(score),
      evidence: c.reason ? [c.reason] : [],
      remediation:
        score >= 100 || inconclusive
          ? null
          : c.docShort ?? `Improve the OpenSSF "${c.name}" check.`,
      docUrl: c.docUrl,
      impact: 0,
    };
  });
}

/** Weighted mean of check scores within a dimension (ignores not_applicable). */
function dimensionScore(checks: CheckResult[]): number {
  const scored = checks.filter((c) => c.status !== "not_applicable" && c.status !== "error");
  const totalW = scored.reduce((s, c) => s + c.weight, 0);
  if (totalW === 0) return 0;
  return scored.reduce((s, c) => s + c.weight * c.score, 0) / totalW;
}

export interface AggregateInput {
  ds: RepoDataSource;
  openssf: OpenSSFResult;
  config?: AggregateConfig;
  startedAt?: number;
}

export async function aggregate(input: AggregateInput): Promise<Scorecard> {
  const started = input.startedAt ?? Date.now();
  const meta = await input.ds.getMeta();
  const config = input.config ?? {};
  const openssfAvailable = input.openssf.available && input.openssf.score != null;

  const harnessResults = await runHarnessChecks(input.ds);
  const securityResults = openssfChecks(input.openssf);
  const allChecks = [...harnessResults, ...securityResults];

  // --- effective dimension weights ------------------------------------------
  const harnessShare = config.harnessWeight ?? 0.5;
  const openssfShare = config.openssfWeight ?? 0.5;
  const harnessMetaSum = HARNESS_DIMS.reduce((s, d) => s + DIMENSION_META[d].weight, 0);

  const effectiveWeight: Record<DimensionId, number> = {
    architecture: 0,
    mechanical: 0,
    testing: 0,
    review: 0,
    ai_safeguards: 0,
    security: 0,
  };
  if (openssfAvailable) {
    const norm = harnessShare + openssfShare;
    for (const d of HARNESS_DIMS) {
      effectiveWeight[d] = ((DIMENSION_META[d].weight / harnessMetaSum) * harnessShare) / norm;
    }
    effectiveWeight.security = openssfShare / norm;
  } else {
    // Redistribute the security share across harness dimensions.
    for (const d of HARNESS_DIMS) {
      effectiveWeight[d] = DIMENSION_META[d].weight / harnessMetaSum;
    }
    effectiveWeight.security = 0;
  }

  // --- per-dimension scores --------------------------------------------------
  const dimensions: DimensionScore[] = [];
  const dimScoreById = {} as Record<DimensionId, number>;
  for (const dim of [...HARNESS_DIMS, "security" as const]) {
    if (dim === "security" && !openssfAvailable) continue;
    const dimChecks = allChecks.filter((c) => c.dimension === dim);
    const score =
      dim === "security"
        ? (input.openssf.score ?? 0) // use OpenSSF's own weighted aggregate
        : dimensionScore(dimChecks);
    dimScoreById[dim] = score;
    dimensions.push({
      id: dim,
      label: DIMENSION_META[dim].label,
      score: Math.round(score),
      weight: effectiveWeight[dim],
      grade: scoreToGrade(score),
    });
  }

  // --- overall ---------------------------------------------------------------
  const overallScore = dimensions.reduce((s, d) => s + d.weight * dimScoreById[d.id], 0);

  // --- per-check impact (overall points recoverable) ------------------------
  for (const dim of HARNESS_DIMS) {
    const dimChecks = harnessResults.filter((c) => c.dimension === dim);
    const sumW = dimChecks.reduce((s, c) => s + c.weight, 0) || 1;
    for (const c of dimChecks) {
      c.impact = effectiveWeight[dim] * (c.weight / sumW) * (100 - c.score);
    }
  }
  if (openssfAvailable) {
    const sumRisk = securityResults
      .filter((c) => c.status !== "not_applicable")
      .reduce((s, c) => s + c.weight, 0) || 1;
    for (const c of securityResults) {
      if (c.status === "not_applicable") continue;
      c.impact = effectiveWeight.security * (c.weight / sumRisk) * (100 - c.score);
    }
  }

  // --- recommendations (biggest overall wins first) -------------------------
  const recommendations: Recommendation[] = allChecks
    .filter((c) => c.score < 100 && c.status !== "not_applicable" && c.remediation)
    .sort((a, b) => b.impact - a.impact)
    .map((c) => ({
      checkId: c.id,
      dimension: c.dimension,
      title: c.name,
      detail: c.remediation!,
      docUrl: c.docUrl,
      impact: Math.round(c.impact * 10) / 10,
      priority: c.impact >= 4 ? "high" : c.impact >= 1.5 ? "medium" : ("low" as const),
    }));

  return {
    schemaVersion: 1,
    repo: {
      host: "github.com",
      owner: meta.owner,
      name: meta.name,
      url: meta.url,
      defaultBranch: meta.defaultBranch,
      commitSha: meta.commitSha,
      isPrivate: meta.isPrivate,
    },
    overall: {
      score: Math.round(overallScore),
      grade: scoreToGrade(overallScore),
    },
    dimensions,
    checks: allChecks.map((c) => ({ ...c, impact: Math.round(c.impact * 10) / 10 })),
    recommendations,
    sources: {
      harness: { provider: "native", rawScore: null, note: null },
      openssf: {
        provider: input.openssf.provider,
        rawScore: input.openssf.rawScore,
        note: input.openssf.note,
      },
    },
    weights: { harness: harnessShare, openssf: openssfAvailable ? openssfShare : 0 },
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}
