/**
 * Source-agnostic view of a repository. Checks are written against this
 * interface so they run identically over the GitHub API (remote) or a local
 * checkout (filesystem). Implementations are expected to memoize network reads.
 */

export interface RepoMeta {
  owner: string;
  name: string;
  url: string;
  description: string | null;
  defaultBranch: string;
  commitSha: string | null;
  isPrivate: boolean;
  isArchived: boolean;
  license: string | null;
  topics: string[];
  stargazers: number;
  /** ISO timestamp of the last push, or null if unknown. */
  pushedAt: string | null;
  /** ISO timestamp the repo was created. */
  createdAt: string | null;
}

export interface WorkflowFile {
  name: string;
  path: string;
  content: string;
}

export interface BranchProtection {
  enabled: boolean;
  requiresPullRequest: boolean;
  requiredApprovingReviewCount: number;
  requiresStatusChecks: boolean;
  requiredStatusChecks: string[];
  enforceAdmins: boolean;
  dismissStaleReviews: boolean;
}

export interface Release {
  tag: string;
  name: string | null;
  isPrerelease: boolean;
  createdAt: string;
  /** Names of attached release assets (used to detect signatures/provenance). */
  assetNames: string[];
}

export interface PullStats {
  /** Recent merged PRs sampled. */
  sampled: number;
  /** How many of the sampled merged PRs had at least one approving review. */
  reviewed: number;
  /** Median days-to-merge across the sample, or null if not enough data. */
  medianMergeDays: number | null;
}

/**
 * The read surface every check depends on. All methods must be side-effect free
 * and cache their results; a single scorecard run may call them repeatedly.
 */
export interface RepoDataSource {
  getMeta(): Promise<RepoMeta>;

  /** True if a file exists at the exact path (repo-root relative). */
  fileExists(path: string): Promise<boolean>;

  /** File contents, or null if it does not exist. */
  readFile(path: string): Promise<string | null>;

  /** Directory entry names (files + subdirs) at a repo-relative dir. */
  listDir(path: string): Promise<string[]>;

  /** First path from `paths` that exists, or null. */
  findFile(paths: string[]): Promise<string | null>;

  /** All GitHub Actions workflow files with their contents. */
  listWorkflows(): Promise<WorkflowFile[]>;

  /** Branch protection for a branch, or null if none / not accessible. */
  getBranchProtection(branch: string): Promise<BranchProtection | null>;

  /** Detected languages by byte count. */
  getLanguages(): Promise<Record<string, number>>;

  /** Up to `limit` most recent releases. */
  listReleases(limit: number): Promise<Release[]>;

  /** Review/merge stats over recent merged PRs. */
  getRecentPullStats(): Promise<PullStats>;
}
