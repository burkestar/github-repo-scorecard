import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  BranchProtection,
  PullStats,
  Release,
  RepoDataSource,
  RepoMeta,
  WorkflowFile,
} from "./types.js";

export interface LocalFsDataSourceOptions {
  root: string;
  owner?: string;
  repo?: string;
  url?: string;
  defaultBranch?: string;
}

/**
 * Reads a repository from a local checkout. Filesystem-only signals (files,
 * workflows, languages) are fully available; server-side signals that require
 * the GitHub API (branch protection, PR review stats, releases) are reported as
 * absent so checks degrade gracefully rather than error.
 */
export class LocalFsDataSource implements RepoDataSource {
  private readonly root: string;
  private readonly opts: LocalFsDataSourceOptions;

  constructor(opts: LocalFsDataSourceOptions) {
    this.root = resolve(opts.root);
    this.opts = opts;
  }

  async getMeta(): Promise<RepoMeta> {
    const licenseFile = await this.findFile(["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"]);
    return {
      owner: this.opts.owner ?? "local",
      name: this.opts.repo ?? this.root.split("/").pop() ?? "repo",
      url: this.opts.url ?? `file://${this.root}`,
      description: null,
      defaultBranch: this.opts.defaultBranch ?? "main",
      commitSha: null,
      isPrivate: false,
      isArchived: false,
      license: licenseFile ? "DETECTED" : null,
      topics: [],
      stargazers: 0,
      pushedAt: null,
      createdAt: null,
    };
  }

  async readFile(path: string): Promise<string | null> {
    try {
      return await readFile(join(this.root, path), "utf8");
    } catch {
      return null;
    }
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      await stat(join(this.root, path));
      return true;
    } catch {
      return false;
    }
  }

  async listDir(path: string): Promise<string[]> {
    try {
      return await readdir(join(this.root, path));
    } catch {
      return [];
    }
  }

  async findFile(paths: string[]): Promise<string | null> {
    for (const p of paths) {
      if (await this.fileExists(p)) return p;
    }
    return null;
  }

  async listWorkflows(): Promise<WorkflowFile[]> {
    const names = await this.listDir(".github/workflows");
    const yamls = names.filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"));
    return Promise.all(
      yamls.map(async (name) => {
        const path = `.github/workflows/${name}`;
        return { name, path, content: (await this.readFile(path)) ?? "" };
      }),
    );
  }

  async getBranchProtection(_branch: string): Promise<BranchProtection | null> {
    return null; // not observable from a local checkout
  }

  async getLanguages(): Promise<Record<string, number>> {
    // Approximate by extension counts over top-level + common source dirs.
    const exts: Record<string, string> = {
      ".ts": "TypeScript",
      ".tsx": "TypeScript",
      ".js": "JavaScript",
      ".jsx": "JavaScript",
      ".py": "Python",
      ".go": "Go",
      ".rs": "Rust",
      ".java": "Java",
      ".rb": "Ruby",
      ".c": "C",
      ".cpp": "C++",
    };
    const counts: Record<string, number> = {};
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 3) return;
      let entries: string[];
      try {
        entries = await readdir(join(this.root, dir));
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === "node_modules" || entry === ".git" || entry.startsWith(".")) continue;
        const rel = dir ? `${dir}/${entry}` : entry;
        const s = await stat(join(this.root, rel)).catch(() => null);
        if (!s) continue;
        if (s.isDirectory()) {
          await walk(rel, depth + 1);
        } else {
          const dot = entry.lastIndexOf(".");
          if (dot >= 0) {
            const lang = exts[entry.slice(dot)];
            if (lang) counts[lang] = (counts[lang] ?? 0) + Number(s.size);
          }
        }
      }
    };
    await walk("", 0);
    return counts;
  }

  async listReleases(_limit: number): Promise<Release[]> {
    return [];
  }

  async getRecentPullStats(): Promise<PullStats> {
    return { sampled: 0, reviewed: 0, medianMergeDays: null };
  }
}
