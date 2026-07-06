import type { Scorecard } from "@scorecard/schema";
import { aggregate, type AggregateConfig } from "./aggregate.js";
import { GitHubApiDataSource } from "./datasource/github.js";
import { LocalFsDataSource } from "./datasource/localfs.js";
import type { RepoDataSource } from "./datasource/types.js";
import { getOpenSSFScore } from "./openssf.js";

export * from "./datasource/types.js";
export { GitHubApiDataSource } from "./datasource/github.js";
export { LocalFsDataSource } from "./datasource/localfs.js";
export { getOpenSSFScore, type OpenSSFResult } from "./openssf.js";
export { aggregate, type AggregateConfig } from "./aggregate.js";
export { HARNESS_CHECKS } from "./checks/harness.js";

export interface ScoreOptions {
  owner: string;
  repo: string;
  /** GitHub token (used for the API data source and OpenSSF binary fallback). */
  token?: string;
  /** GitHub Enterprise base URL. */
  baseUrl?: string;
  /** Weight split between harness and OpenSSF. */
  config?: AggregateConfig;
  /** Disable the OpenSSF binary fallback (hosted API only). */
  disableOpenSSFBinary?: boolean;
}

/** Score a GitHub repository end to end (API data source + OpenSSF). */
export async function scoreRepository(opts: ScoreOptions): Promise<Scorecard> {
  const startedAt = Date.now();
  const ds = new GitHubApiDataSource({
    owner: opts.owner,
    repo: opts.repo,
    token: opts.token,
    baseUrl: opts.baseUrl,
  });
  const openssf = await getOpenSSFScore({
    owner: opts.owner,
    repo: opts.repo,
    token: opts.token,
    allowBinary: !opts.disableOpenSSFBinary,
  });
  return aggregate({ ds, openssf, config: opts.config, startedAt });
}

export interface ScoreLocalOptions {
  root: string;
  owner?: string;
  repo?: string;
  config?: AggregateConfig;
}

/** Score a local checkout (filesystem signals only; OpenSSF marked unavailable). */
export async function scoreLocalRepository(opts: ScoreLocalOptions): Promise<Scorecard> {
  const startedAt = Date.now();
  const ds: RepoDataSource = new LocalFsDataSource({
    root: opts.root,
    owner: opts.owner,
    repo: opts.repo,
  });
  const openssf = await getOpenSSFScore({
    owner: opts.owner ?? "local",
    repo: opts.repo ?? "local",
    allowBinary: false,
  });
  return aggregate({ ds, openssf, config: opts.config, startedAt });
}
