import { z } from "zod";

/**
 * Canonical scorecard schema shared by the scoring engine, the backend service,
 * and every client (CLI, MCP, browser extension). Everything is expressed with
 * zod so the same definitions provide both runtime validation and TS types.
 */

/** The five ai-harness dimensions plus the OpenSSF security dimension. */
export const DIMENSION_IDS = [
  "architecture",
  "mechanical",
  "testing",
  "review",
  "ai_safeguards",
  "security",
] as const;

export const DimensionId = z.enum(DIMENSION_IDS);
export type DimensionId = z.infer<typeof DimensionId>;

/** Human-readable labels + default weights (must sum to 1.0). */
export const DIMENSION_META: Record<
  DimensionId,
  { label: string; weight: number; description: string }
> = {
  architecture: {
    label: "Architecture Docs",
    weight: 0.15,
    description: "Docs an AI agent needs to work safely: ADRs, agent instructions, module boundaries, API docs.",
  },
  mechanical: {
    label: "Mechanical Constraints",
    weight: 0.2,
    description: "Automated guardrails: CI, linting, formatting, type safety, dependency auditing.",
  },
  testing: {
    label: "Testing & Stability",
    weight: 0.2,
    description: "Test suite depth wired into CI: coverage, blocking jobs, property/fuzz/contract tests.",
  },
  review: {
    label: "Review & Drift",
    weight: 0.15,
    description: "Code review enforcement, PR templates, review bots, doc-sync and drift prevention.",
  },
  ai_safeguards: {
    label: "AI Safeguards",
    weight: 0.1,
    description: "Explicit norms for AI-assisted work: small batches, design-before-code, security path marking.",
  },
  security: {
    label: "Security (OpenSSF)",
    weight: 0.2,
    description: "OpenSSF Scorecard: branch protection, code review, SAST, signed releases, pinned deps, vulns.",
  },
};

export const CheckStatus = z.enum([
  "pass",
  "partial",
  "fail",
  "not_applicable",
  "error",
]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const LetterGrade = z.enum(["A", "B", "C", "D", "F"]);
export type LetterGrade = z.infer<typeof LetterGrade>;

/** One evaluated check (a single ai-harness or OpenSSF probe). */
export const CheckResult = z.object({
  id: z.string(),
  name: z.string(),
  dimension: DimensionId,
  /** Normalized 0–100 score for this individual check. */
  score: z.number().min(0).max(100),
  /** Relative weight of this check within its dimension. */
  weight: z.number().min(0),
  status: CheckStatus,
  /** Short factual observations backing the score. */
  evidence: z.array(z.string()).default([]),
  /** What to do to improve, if the check is not passing. */
  remediation: z.string().nullable().default(null),
  docUrl: z.string().url().nullable().default(null),
  /**
   * Estimated points added to the OVERALL score if this check were brought to
   * a perfect score. Used to rank recommendations by impact.
   */
  impact: z.number().min(0).default(0),
});
export type CheckResult = z.infer<typeof CheckResult>;

/** Aggregate score for one dimension (a radar axis). */
export const DimensionScore = z.object({
  id: DimensionId,
  label: z.string(),
  /** 0–100 aggregate for the dimension. */
  score: z.number().min(0).max(100),
  /** Weight of this dimension in the overall score. */
  weight: z.number().min(0),
  grade: LetterGrade,
});
export type DimensionScore = z.infer<typeof DimensionScore>;

/** A prioritized, actionable improvement step surfaced to the user. */
export const Recommendation = z.object({
  checkId: z.string(),
  dimension: DimensionId,
  title: z.string(),
  detail: z.string(),
  docUrl: z.string().url().nullable().default(null),
  /** Overall-score points recoverable by acting on this. Higher = do first. */
  impact: z.number().min(0),
  priority: z.enum(["high", "medium", "low"]),
});
export type Recommendation = z.infer<typeof Recommendation>;

export const RepoRef = z.object({
  host: z.string().default("github.com"),
  owner: z.string(),
  name: z.string(),
  url: z.string().url(),
  defaultBranch: z.string().nullable().default(null),
  commitSha: z.string().nullable().default(null),
  isPrivate: z.boolean().default(false),
});
export type RepoRef = z.infer<typeof RepoRef>;

export const SourceInfo = z.object({
  /** "hosted-api" | "binary" | "native" | "unavailable". */
  provider: z.string(),
  /** Raw upstream score if applicable (e.g. OpenSSF 0–10 aggregate). */
  rawScore: z.number().nullable().default(null),
  note: z.string().nullable().default(null),
});
export type SourceInfo = z.infer<typeof SourceInfo>;

/** The full result object returned everywhere. */
export const Scorecard = z.object({
  schemaVersion: z.literal(1).default(1),
  repo: RepoRef,
  overall: z.object({
    score: z.number().min(0).max(100),
    grade: LetterGrade,
  }),
  dimensions: z.array(DimensionScore),
  checks: z.array(CheckResult),
  recommendations: z.array(Recommendation),
  sources: z.object({
    harness: SourceInfo,
    openssf: SourceInfo,
  }),
  weights: z.object({
    harness: z.number(),
    openssf: z.number(),
  }),
  generatedAt: z.string(),
  /** ms spent computing, for diagnostics. */
  durationMs: z.number().nullable().default(null),
});
export type Scorecard = z.infer<typeof Scorecard>;

// ---------------------------------------------------------------------------
// HTTP API contract (server <-> clients)
// ---------------------------------------------------------------------------

export const ScoreQuery = z.object({
  /** Force recompute, bypassing cache. */
  refresh: z.boolean().optional(),
});
export type ScoreQuery = z.infer<typeof ScoreQuery>;

export const ScoreResponse = z.object({
  scorecard: Scorecard,
  cached: z.boolean(),
});
export type ScoreResponse = z.infer<typeof ScoreResponse>;

export const ErrorResponse = z.object({
  error: z.string(),
  detail: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** shields.io endpoint badge shape. */
export const Badge = z.object({
  schemaVersion: z.literal(1),
  label: z.string(),
  message: z.string(),
  color: z.string(),
});
export type Badge = z.infer<typeof Badge>;

// ---------------------------------------------------------------------------
// Grading helpers (shared so every surface grades identically)
// ---------------------------------------------------------------------------

export function scoreToGrade(score: number): LetterGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export const GRADE_COLORS: Record<LetterGrade, string> = {
  A: "#22c55e",
  B: "#84cc16",
  C: "#eab308",
  D: "#f97316",
  F: "#ef4444",
};
