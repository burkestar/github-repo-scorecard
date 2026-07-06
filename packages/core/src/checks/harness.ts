import type { Check } from "./types.js";
import {
  allWorkflowText,
  existsCheck,
  fail,
  partial,
  pass,
  workflowMentions,
} from "./types.js";

/**
 * TypeScript port of the ai-harness-scorecard checks, grouped into its five
 * weighted dimensions. Each check reads through the RepoDataSource so it works
 * over the GitHub API or a local checkout. Deterministic: no LLM, no network
 * beyond the data source.
 *
 * Reference: https://github.com/markmishaev76/ai-harness-scorecard
 */

// --- 1. Architecture Documentation ------------------------------------------

const architecture: Check[] = [
  {
    id: "arch.agent-instructions",
    name: "Agent instructions file",
    dimension: "architecture",
    weight: 2,
    remediation:
      "Add an agent guide (CLAUDE.md, AGENTS.md, .cursorrules, or .github/copilot-instructions.md) describing conventions and constraints for AI-assisted changes.",
    docUrl: "https://docs.claude.com/en/docs/claude-code/memory",
    run: (ds) =>
      existsCheck(
        ds,
        [
          "CLAUDE.md",
          "AGENTS.md",
          ".cursorrules",
          ".cursor/rules",
          ".github/copilot-instructions.md",
          ".windsurfrules",
        ],
        "agent instructions file",
      ),
  },
  {
    id: "arch.architecture-doc",
    name: "Architecture documentation",
    dimension: "architecture",
    weight: 2,
    remediation:
      "Document the system's high-level architecture (ARCHITECTURE.md or docs/architecture.*) so agents understand module boundaries before editing.",
    run: (ds) =>
      existsCheck(
        ds,
        [
          "ARCHITECTURE.md",
          "docs/architecture.md",
          "docs/ARCHITECTURE.md",
          "docs/architecture/README.md",
        ],
        "architecture document",
      ),
  },
  {
    id: "arch.adr",
    name: "Architecture Decision Records",
    dimension: "architecture",
    weight: 1,
    remediation:
      "Adopt ADRs (docs/adr/ or docs/decisions/) to record why key decisions were made, giving agents durable rationale.",
    run: async (ds) => {
      const dirs = ["docs/adr", "docs/decisions", "doc/adr", "adr"];
      for (const d of dirs) {
        const entries = await ds.listDir(d);
        if (entries.some((e) => e.endsWith(".md"))) {
          return pass([`Found ${entries.filter((e) => e.endsWith(".md")).length} ADR(s) in ${d}`]);
        }
      }
      return fail(["No ADR directory found"]);
    },
  },
  {
    id: "arch.contributing",
    name: "Contributing guide",
    dimension: "architecture",
    weight: 1,
    remediation: "Add CONTRIBUTING.md describing setup, workflow, and expectations.",
    run: (ds) =>
      existsCheck(
        ds,
        ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md"],
        "contributing guide",
      ),
  },
  {
    id: "arch.readme-depth",
    name: "Substantive README",
    dimension: "architecture",
    weight: 1,
    remediation:
      "Expand the README to at least a few hundred characters covering purpose, setup, and usage.",
    run: async (ds) => {
      const readme =
        (await ds.readFile("README.md")) ??
        (await ds.readFile("README.rst")) ??
        (await ds.readFile("readme.md"));
      if (!readme) return fail(["No README found"], "Add a README.md.");
      const len = readme.trim().length;
      if (len >= 800) return pass([`README is ${len} chars`]);
      if (len >= 200) return partial(50, [`README is only ${len} chars`], "Expand the README with setup and usage sections.");
      return fail([`README is only ${len} chars`], "Flesh out the README.");
    },
  },
];

// --- 2. Mechanical Constraints ----------------------------------------------

const mechanical: Check[] = [
  {
    id: "mech.ci",
    name: "Continuous integration",
    dimension: "mechanical",
    weight: 3,
    remediation:
      "Add a CI workflow (.github/workflows/*.yml) that runs on pull requests.",
    run: async (ds) => {
      const wfs = await ds.listWorkflows();
      if (wfs.length === 0)
        return fail(["No GitHub Actions workflows"], "Add a CI workflow under .github/workflows/.");
      const text = wfs.map((w) => w.content).join("\n").toLowerCase();
      const onPr = text.includes("pull_request");
      return onPr
        ? pass([`${wfs.length} workflow(s), triggered on pull_request`])
        : partial(60, [`${wfs.length} workflow(s) but none trigger on pull_request`], "Trigger CI on pull_request so changes are gated.");
    },
  },
  {
    id: "mech.lint",
    name: "Linting configured",
    dimension: "mechanical",
    weight: 2,
    remediation:
      "Add a linter config (eslint, ruff, golangci-lint, clippy, rubocop) and run it in CI.",
    run: async (ds) => {
      const configFound = await ds.findFile([
        ".eslintrc",
        ".eslintrc.js",
        ".eslintrc.json",
        ".eslintrc.cjs",
        "eslint.config.js",
        "eslint.config.mjs",
        ".ruff.toml",
        "ruff.toml",
        ".golangci.yml",
        ".golangci.yaml",
        ".rubocop.yml",
      ]);
      const inWorkflow = await workflowMentions(ds, [
        "eslint",
        "ruff",
        "golangci",
        "clippy",
        "rubocop",
        "lint",
      ]);
      if (configFound && inWorkflow) return pass([`Config ${configFound} + linted in CI`]);
      if (configFound || inWorkflow)
        return partial(60, [configFound ? `Config ${configFound}` : "Referenced in CI"], "Add both a linter config and a CI lint step.");
      return fail(["No linter config or CI lint step"]);
    },
  },
  {
    id: "mech.format",
    name: "Formatter configured",
    dimension: "mechanical",
    weight: 1,
    remediation: "Add an auto-formatter (prettier, black, gofmt, rustfmt) and enforce it.",
    run: async (ds) => {
      const cfg = await ds.findFile([
        ".prettierrc",
        ".prettierrc.json",
        ".prettierrc.js",
        "prettier.config.js",
        ".editorconfig",
        "rustfmt.toml",
        ".rustfmt.toml",
      ]);
      const inWf = await workflowMentions(ds, ["prettier", "black", "gofmt", "rustfmt", "format"]);
      return cfg || inWf
        ? pass([cfg ? `Config ${cfg}` : "Formatter runs in CI"])
        : fail(["No formatter configuration"]);
    },
  },
  {
    id: "mech.types",
    name: "Type safety",
    dimension: "mechanical",
    weight: 2,
    remediation:
      "Enable static typing (tsconfig strict, mypy/pyright, or a typed language) and check it in CI.",
    run: async (ds) => {
      const langs = Object.keys(await ds.getLanguages());
      const typedLang = langs.some((l) => ["Go", "Rust", "Java", "C#", "TypeScript"].includes(l));
      const tsconfig = await ds.readFile("tsconfig.json");
      const strict = tsconfig?.includes("\"strict\"") && tsconfig.includes("true");
      const typeChecker = await ds.findFile([
        "mypy.ini",
        ".mypy.ini",
        "pyrightconfig.json",
      ]);
      if ((tsconfig && strict) || typeChecker)
        return pass([strict ? "tsconfig strict mode" : `Type checker ${typeChecker}`]);
      if (typedLang) return partial(70, [`Statically typed language: ${langs.join(", ")}`], "Enforce type checks in CI.");
      if (tsconfig) return partial(50, ["tsconfig present but strict not enabled"], "Enable \"strict\": true.");
      return fail(["No type-safety signal detected"]);
    },
  },
  {
    id: "mech.dep-audit",
    name: "Dependency auditing",
    dimension: "mechanical",
    weight: 2,
    remediation:
      "Enable Dependabot/Renovate and/or a vulnerability audit step (npm audit, pip-audit, govulncheck) in CI.",
    run: async (ds) => {
      const cfg = await ds.findFile([
        ".github/dependabot.yml",
        ".github/dependabot.yaml",
        "renovate.json",
        ".renovaterc",
        ".renovaterc.json",
      ]);
      const inWf = await workflowMentions(ds, [
        "npm audit",
        "pip-audit",
        "govulncheck",
        "cargo audit",
        "snyk",
        "trivy",
      ]);
      return cfg || inWf
        ? pass([cfg ? `Config ${cfg}` : "Audit runs in CI"])
        : fail(["No dependency update or audit tooling"]);
    },
  },
  {
    id: "mech.precommit",
    name: "Pre-commit / git hooks",
    dimension: "mechanical",
    weight: 1,
    remediation: "Add pre-commit hooks (.pre-commit-config.yaml, husky, or lefthook) to catch issues before push.",
    run: (ds) =>
      existsCheck(
        ds,
        [".pre-commit-config.yaml", ".husky", "lefthook.yml", ".lefthook.yml"],
        "pre-commit hook config",
      ),
  },
];

// --- 3. Testing & Stability -------------------------------------------------

const testing: Check[] = [
  {
    id: "test.suite-in-ci",
    name: "Tests run in CI",
    dimension: "testing",
    weight: 3,
    remediation: "Add a CI step that runs the test suite (pytest, jest/vitest, go test, cargo test).",
    run: async (ds) => {
      const inWf = await workflowMentions(ds, [
        "pytest",
        "jest",
        "vitest",
        "go test",
        "cargo test",
        "npm test",
        "pnpm test",
        "yarn test",
        " test ",
        "run test",
      ]);
      return inWf
        ? pass(["Test command found in a workflow"])
        : fail(["No test invocation detected in CI"]);
    },
  },
  {
    id: "test.present",
    name: "Test files present",
    dimension: "testing",
    weight: 2,
    remediation: "Add a test suite; place tests under tests/, __tests__, or *_test.* files.",
    run: async (ds) => {
      const dirs = ["tests", "test", "__tests__", "spec"];
      for (const d of dirs) {
        const entries = await ds.listDir(d);
        if (entries.length > 0) return pass([`Found test directory ${d}/ (${entries.length} entries)`]);
      }
      return fail(["No conventional test directory found"]);
    },
  },
  {
    id: "test.coverage",
    name: "Coverage measured",
    dimension: "testing",
    weight: 2,
    remediation: "Measure coverage in CI (codecov, coveralls, --coverage) and optionally enforce a threshold.",
    run: async (ds) => {
      const inWf = await workflowMentions(ds, ["coverage", "codecov", "coveralls", "--cov", "nyc"]);
      const cfg = await ds.findFile(["codecov.yml", ".codecov.yml", ".coveragerc"]);
      return inWf || cfg
        ? pass([cfg ? `Config ${cfg}` : "Coverage reported in CI"])
        : fail(["No coverage measurement detected"]);
    },
  },
  {
    id: "test.blocking",
    name: "Tests block merges",
    dimension: "testing",
    weight: 2,
    remediation:
      "Require the test status check to pass in branch protection so failing tests block merges.",
    run: async (ds) => {
      const meta = await ds.getMeta();
      const bp = await ds.getBranchProtection(meta.defaultBranch);
      if (!bp) return partial(30, ["Branch protection not readable"], "Enable branch protection with required status checks.");
      if (bp.requiresStatusChecks && bp.requiredStatusChecks.length > 0)
        return pass([`Required checks: ${bp.requiredStatusChecks.slice(0, 3).join(", ")}`]);
      return fail(["No required status checks on the default branch"]);
    },
  },
  {
    id: "test.advanced",
    name: "Advanced testing (fuzz/property/mutation)",
    dimension: "testing",
    weight: 1,
    remediation:
      "Add higher-assurance testing where it matters: fuzzing, property-based, mutation, or contract tests.",
    run: async (ds) => {
      const text = await allWorkflowText(ds);
      const signals = ["fuzz", "hypothesis", "proptest", "quickcheck", "mutation", "stryker", "pact", "contract test"];
      const hit = signals.filter((s) => text.includes(s));
      return hit.length
        ? pass([`Found: ${hit.join(", ")}`])
        : fail(["No advanced testing signals"]);
    },
  },
];

// --- 4. Review & Drift Prevention -------------------------------------------

const review: Check[] = [
  {
    id: "review.branch-protection",
    name: "Code review required",
    dimension: "review",
    weight: 3,
    remediation:
      "Require pull-request reviews on the default branch (branch protection → require approvals ≥ 1).",
    run: async (ds) => {
      const meta = await ds.getMeta();
      const bp = await ds.getBranchProtection(meta.defaultBranch);
      if (!bp) {
        const stats = await ds.getRecentPullStats();
        if (stats.sampled >= 3) {
          const ratio = stats.reviewed / stats.sampled;
          return partial(
            Math.round(ratio * 80),
            [`${stats.reviewed}/${stats.sampled} recent merged PRs had an approving review`],
            "Enforce reviews via branch protection rather than relying on convention.",
          );
        }
        return fail(["Branch protection not enabled / not readable"]);
      }
      if (bp.requiresPullRequest && bp.requiredApprovingReviewCount >= 1)
        return pass([`Requires ${bp.requiredApprovingReviewCount} approving review(s)`]);
      if (bp.requiresPullRequest) return partial(60, ["PRs required but 0 approvals mandated"], "Require at least one approving review.");
      return fail(["Reviews not required"]);
    },
  },
  {
    id: "review.codeowners",
    name: "CODEOWNERS defined",
    dimension: "review",
    weight: 1,
    remediation: "Add a CODEOWNERS file so the right people are auto-requested for review.",
    run: (ds) =>
      existsCheck(
        ds,
        ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"],
        "CODEOWNERS file",
      ),
  },
  {
    id: "review.pr-template",
    name: "Pull request template",
    dimension: "review",
    weight: 1,
    remediation: "Add a PR template (.github/pull_request_template.md) to standardize review context.",
    run: (ds) =>
      existsCheck(
        ds,
        [
          ".github/pull_request_template.md",
          ".github/PULL_REQUEST_TEMPLATE.md",
          "docs/pull_request_template.md",
        ],
        "PR template",
      ),
  },
  {
    id: "review.bot",
    name: "Automated review / scheduled checks",
    dimension: "review",
    weight: 1,
    remediation:
      "Add an automated reviewer (CodeQL, codeql-action, review bot) or a scheduled CI run to catch drift.",
    run: async (ds) => {
      const text = await allWorkflowText(ds);
      const hasSchedule = text.includes("schedule:") || text.includes("cron:");
      const hasBot = ["codeql", "reviewdog", "danger", "sonar"].some((s) => text.includes(s));
      if (hasBot && hasSchedule) return pass(["Automated review bot + scheduled run"]);
      if (hasBot || hasSchedule) return partial(60, [hasBot ? "Review bot present" : "Scheduled run present"], "Add both an automated reviewer and a scheduled run.");
      return fail(["No review bot or scheduled workflow"]);
    },
  },
];

// --- 5. AI-Specific Safeguards ----------------------------------------------

const aiSafeguards: Check[] = [
  {
    id: "ai.norms",
    name: "AI usage norms documented",
    dimension: "ai_safeguards",
    weight: 2,
    remediation:
      "Document norms for AI-assisted contributions (in the agent guide or CONTRIBUTING): what agents may/may not do.",
    run: async (ds) => {
      const candidates = ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md", ".github/copilot-instructions.md"];
      for (const c of candidates) {
        const text = (await ds.readFile(c))?.toLowerCase();
        if (text && /\b(ai|agent|llm|copilot|claude|assistant)\b/.test(text)) {
          return pass([`AI norms referenced in ${c}`]);
        }
      }
      return fail(["No documented AI/agent usage norms"]);
    },
  },
  {
    id: "ai.security-paths",
    name: "Security-critical paths marked",
    dimension: "ai_safeguards",
    weight: 1,
    remediation:
      "Mark security-sensitive areas (SECURITY.md scope, CODEOWNERS on sensitive dirs, or explicit callouts in the agent guide).",
    run: async (ds) => {
      const security = await ds.findFile(["SECURITY.md", ".github/SECURITY.md"]);
      const codeowners = await ds.findFile(["CODEOWNERS", ".github/CODEOWNERS"]);
      if (security && codeowners) return pass(["SECURITY.md + CODEOWNERS present"]);
      if (security || codeowners) return partial(60, [security ? "SECURITY.md present" : "CODEOWNERS present"], "Combine a security policy with CODEOWNERS on sensitive paths.");
      return fail(["No security-path signals"]);
    },
  },
  {
    id: "ai.small-batches",
    name: "Small-batch / review discipline",
    dimension: "ai_safeguards",
    weight: 1,
    remediation:
      "Encourage small, reviewable changes: fast median PR merge time and required review keep AI output auditable.",
    run: async (ds) => {
      const stats = await ds.getRecentPullStats();
      if (stats.sampled < 3) return partial(50, ["Not enough merged PRs to assess"], "Adopt a small-PR workflow with prompt review.");
      const reviewedRatio = stats.reviewed / stats.sampled;
      const score = Math.round(reviewedRatio * 100);
      return partial(
        score,
        [`${stats.reviewed}/${stats.sampled} recent PRs reviewed`, stats.medianMergeDays != null ? `median merge ${stats.medianMergeDays.toFixed(1)}d` : "merge time unknown"],
        score >= 100 ? undefined : "Ensure changes are reviewed before merge.",
      );
    },
  },
  {
    id: "ai.error-policy",
    name: "Error-handling / design guidance",
    dimension: "ai_safeguards",
    weight: 1,
    remediation:
      "Document error-handling conventions and a design-before-code expectation in the agent guide so agents don't improvise.",
    run: async (ds) => {
      const candidates = ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md", "docs/conventions.md"];
      for (const c of candidates) {
        const text = (await ds.readFile(c))?.toLowerCase();
        if (text && /(error handling|error-handling|design.?first|design before|conventions?)/.test(text)) {
          return pass([`Guidance found in ${c}`]);
        }
      }
      return fail(["No documented error-handling/design conventions"]);
    },
  },
];

export const HARNESS_CHECKS: Check[] = [
  ...architecture,
  ...mechanical,
  ...testing,
  ...review,
  ...aiSafeguards,
];
