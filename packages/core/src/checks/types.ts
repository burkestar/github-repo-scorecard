import type { CheckStatus, DimensionId } from "@scorecard/schema";
import type { RepoDataSource } from "../datasource/types.js";

export interface CheckOutcome {
  /** 0–100 for this check. */
  score: number;
  status: CheckStatus;
  evidence: string[];
  /** Only needed when not fully passing. */
  remediation?: string;
}

export interface Check {
  id: string;
  name: string;
  dimension: DimensionId;
  /** Relative weight within its dimension. */
  weight: number;
  docUrl?: string;
  /** Default remediation text if the check does not supply one. */
  remediation: string;
  run(ds: RepoDataSource): Promise<CheckOutcome>;
}

// --- small helpers shared by checks -----------------------------------------

export const pass = (evidence: string[]): CheckOutcome => ({
  score: 100,
  status: "pass",
  evidence,
});

export const fail = (evidence: string[], remediation?: string): CheckOutcome => ({
  score: 0,
  status: "fail",
  evidence,
  remediation,
});

export const partial = (
  score: number,
  evidence: string[],
  remediation?: string,
): CheckOutcome => ({
  score,
  status: score >= 100 ? "pass" : score <= 0 ? "fail" : "partial",
  evidence,
  remediation,
});

/** Pass if any of the candidate files exists. */
export async function existsCheck(
  ds: RepoDataSource,
  paths: string[],
  label: string,
): Promise<CheckOutcome> {
  const found = await ds.findFile(paths);
  return found
    ? pass([`Found ${found}`])
    : fail([`None found: ${paths.join(", ")}`], `Add ${label} (e.g. ${paths[0]}).`);
}

/** Concatenate all workflow file contents for pattern probing. */
export async function allWorkflowText(ds: RepoDataSource): Promise<string> {
  const wfs = await ds.listWorkflows();
  return wfs.map((w) => w.content).join("\n").toLowerCase();
}

/** True if any workflow content matches any of the given lowercased needles. */
export async function workflowMentions(
  ds: RepoDataSource,
  needles: string[],
): Promise<boolean> {
  const text = await allWorkflowText(ds);
  return needles.some((n) => text.includes(n.toLowerCase()));
}
