import type {
  BranchProtection,
  PullStats,
  Release,
  RepoDataSource,
  RepoMeta,
  WorkflowFile,
} from "../src/datasource/types.js";

export interface MockRepo {
  meta?: Partial<RepoMeta>;
  files?: Record<string, string>;
  dirs?: Record<string, string[]>;
  workflows?: WorkflowFile[];
  branchProtection?: BranchProtection | null;
  languages?: Record<string, number>;
  releases?: Release[];
  pullStats?: PullStats;
}

/** In-memory RepoDataSource for deterministic unit tests. */
export class MockDataSource implements RepoDataSource {
  constructor(private readonly r: MockRepo) {}

  async getMeta(): Promise<RepoMeta> {
    return {
      owner: "acme",
      name: "widget",
      url: "https://github.com/acme/widget",
      description: "test",
      defaultBranch: "main",
      commitSha: "abc123",
      isPrivate: false,
      isArchived: false,
      license: null,
      topics: [],
      stargazers: 0,
      pushedAt: null,
      createdAt: null,
      ...this.r.meta,
    };
  }
  async readFile(path: string): Promise<string | null> {
    return this.r.files?.[path] ?? null;
  }
  async fileExists(path: string): Promise<boolean> {
    return path in (this.r.files ?? {});
  }
  async listDir(path: string): Promise<string[]> {
    return this.r.dirs?.[path] ?? [];
  }
  async findFile(paths: string[]): Promise<string | null> {
    for (const p of paths) if (await this.fileExists(p)) return p;
    return null;
  }
  async listWorkflows(): Promise<WorkflowFile[]> {
    return this.r.workflows ?? [];
  }
  async getBranchProtection(): Promise<BranchProtection | null> {
    return this.r.branchProtection ?? null;
  }
  async getLanguages(): Promise<Record<string, number>> {
    return this.r.languages ?? {};
  }
  async listReleases(): Promise<Release[]> {
    return this.r.releases ?? [];
  }
  async getRecentPullStats(): Promise<PullStats> {
    return this.r.pullStats ?? { sampled: 0, reviewed: 0, medianMergeDays: null };
  }
}
