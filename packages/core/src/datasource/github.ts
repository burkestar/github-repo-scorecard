import { Octokit } from "@octokit/rest";
import type {
  BranchProtection,
  PullStats,
  Release,
  RepoDataSource,
  RepoMeta,
  WorkflowFile,
} from "./types.js";

export interface GitHubDataSourceOptions {
  owner: string;
  repo: string;
  /** Personal access / app token. Optional but strongly recommended. */
  token?: string;
  /** Override base URL for GitHub Enterprise. */
  baseUrl?: string;
}

/** Reads a repository over the GitHub REST API. Memoizes every fetch. */
export class GitHubApiDataSource implements RepoDataSource {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private metaPromise?: Promise<RepoMeta>;
  private workflowsPromise?: Promise<WorkflowFile[]>;
  private languagesPromise?: Promise<Record<string, number>>;
  private pullStatsPromise?: Promise<PullStats>;
  private readonly fileCache = new Map<string, Promise<string | null>>();
  private readonly dirCache = new Map<string, Promise<string[]>>();

  constructor(opts: GitHubDataSourceOptions) {
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.octokit = new Octokit({
      auth: opts.token,
      baseUrl: opts.baseUrl,
      userAgent: "github-repo-scorecard",
    });
  }

  getMeta(): Promise<RepoMeta> {
    this.metaPromise ??= (async () => {
      const { data } = await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo,
      });
      let commitSha: string | null = null;
      try {
        const branch = await this.octokit.repos.getBranch({
          owner: this.owner,
          repo: this.repo,
          branch: data.default_branch,
        });
        commitSha = branch.data.commit.sha;
      } catch {
        // best-effort
      }
      return {
        owner: this.owner,
        name: this.repo,
        url: data.html_url,
        description: data.description,
        defaultBranch: data.default_branch,
        commitSha,
        isPrivate: data.private,
        isArchived: data.archived,
        license: data.license?.spdx_id ?? null,
        topics: data.topics ?? [],
        stargazers: data.stargazers_count,
        pushedAt: data.pushed_at,
        createdAt: data.created_at,
      } satisfies RepoMeta;
    })();
    return this.metaPromise;
  }

  readFile(path: string): Promise<string | null> {
    let cached = this.fileCache.get(path);
    if (!cached) {
      cached = (async () => {
        try {
          const { data } = await this.octokit.repos.getContent({
            owner: this.owner,
            repo: this.repo,
            path,
          });
          if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
            return null;
          }
          return Buffer.from(data.content, "base64").toString("utf8");
        } catch {
          return null;
        }
      })();
      this.fileCache.set(path, cached);
    }
    return cached;
  }

  async fileExists(path: string): Promise<boolean> {
    return (await this.readFile(path)) !== null;
  }

  listDir(path: string): Promise<string[]> {
    let cached = this.dirCache.get(path);
    if (!cached) {
      cached = (async () => {
        try {
          const { data } = await this.octokit.repos.getContent({
            owner: this.owner,
            repo: this.repo,
            path,
          });
          if (!Array.isArray(data)) return [];
          return data.map((e) => e.name);
        } catch {
          return [];
        }
      })();
      this.dirCache.set(path, cached);
    }
    return cached;
  }

  async findFile(paths: string[]): Promise<string | null> {
    for (const p of paths) {
      if (await this.fileExists(p)) return p;
    }
    return null;
  }

  listWorkflows(): Promise<WorkflowFile[]> {
    this.workflowsPromise ??= (async () => {
      const names = await this.listDir(".github/workflows");
      const yamls = names.filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"));
      const files = await Promise.all(
        yamls.map(async (name) => {
          const path = `.github/workflows/${name}`;
          const content = (await this.readFile(path)) ?? "";
          return { name, path, content } satisfies WorkflowFile;
        }),
      );
      return files;
    })();
    return this.workflowsPromise;
  }

  async getBranchProtection(branch: string): Promise<BranchProtection | null> {
    try {
      const { data } = await this.octokit.repos.getBranchProtection({
        owner: this.owner,
        repo: this.repo,
        branch,
      });
      return {
        enabled: true,
        requiresPullRequest: Boolean(data.required_pull_request_reviews),
        requiredApprovingReviewCount:
          data.required_pull_request_reviews?.required_approving_review_count ?? 0,
        requiresStatusChecks: Boolean(data.required_status_checks),
        requiredStatusChecks: data.required_status_checks?.contexts ?? [],
        enforceAdmins: Boolean(data.enforce_admins?.enabled),
        dismissStaleReviews: Boolean(
          data.required_pull_request_reviews?.dismiss_stale_reviews,
        ),
      } satisfies BranchProtection;
    } catch {
      // 403/404: no protection or insufficient scope. Report as "no protection".
      return null;
    }
  }

  getLanguages(): Promise<Record<string, number>> {
    this.languagesPromise ??= (async () => {
      try {
        const { data } = await this.octokit.repos.listLanguages({
          owner: this.owner,
          repo: this.repo,
        });
        return data;
      } catch {
        return {};
      }
    })();
    return this.languagesPromise;
  }

  async listReleases(limit: number): Promise<Release[]> {
    try {
      const { data } = await this.octokit.repos.listReleases({
        owner: this.owner,
        repo: this.repo,
        per_page: limit,
      });
      return data.map((r) => ({
        tag: r.tag_name,
        name: r.name,
        isPrerelease: r.prerelease,
        createdAt: r.created_at,
        assetNames: r.assets.map((a) => a.name),
      }));
    } catch {
      return [];
    }
  }

  getRecentPullStats(): Promise<PullStats> {
    this.pullStatsPromise ??= (async () => {
      try {
        const { data } = await this.octokit.pulls.list({
          owner: this.owner,
          repo: this.repo,
          state: "closed",
          sort: "updated",
          direction: "desc",
          per_page: 20,
        });
        const merged = data.filter((p) => p.merged_at);
        const mergeDays: number[] = [];
        let reviewed = 0;
        await Promise.all(
          merged.map(async (p) => {
            if (p.created_at && p.merged_at) {
              const days =
                (new Date(p.merged_at).getTime() - new Date(p.created_at).getTime()) /
                86_400_000;
              mergeDays.push(days);
            }
            try {
              const reviews = await this.octokit.pulls.listReviews({
                owner: this.owner,
                repo: this.repo,
                pull_number: p.number,
                per_page: 20,
              });
              if (reviews.data.some((rv) => rv.state === "APPROVED")) reviewed += 1;
            } catch {
              // ignore
            }
          }),
        );
        mergeDays.sort((a, b) => a - b);
        const median =
          mergeDays.length === 0
            ? null
            : (mergeDays[Math.floor(mergeDays.length / 2)] ?? null);
        return {
          sampled: merged.length,
          reviewed,
          medianMergeDays: median,
        } satisfies PullStats;
      } catch {
        return { sampled: 0, reviewed: 0, medianMergeDays: null };
      }
    })();
    return this.pullStatsPromise;
  }
}
