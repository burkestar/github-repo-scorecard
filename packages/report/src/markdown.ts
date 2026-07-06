import { type Badge, type LetterGrade, type Scorecard } from "@scorecard/schema";

const BADGE_COLOR: Record<LetterGrade, string> = {
  A: "brightgreen",
  B: "green",
  C: "yellow",
  D: "orange",
  F: "red",
};

/** shields.io endpoint badge for the overall grade. */
export function renderBadge(sc: Scorecard): Badge {
  return {
    schemaVersion: 1,
    label: "scorecard",
    message: `${sc.overall.grade} (${sc.overall.score})`,
    color: BADGE_COLOR[sc.overall.grade],
  };
}

/** GitHub-flavored markdown report (for PR comments, READMEs, gh output). */
export function renderMarkdown(sc: Scorecard): string {
  const { owner, name } = sc.repo;
  const out: string[] = [];
  out.push(`## Scorecard: ${owner}/${name} — Grade ${sc.overall.grade} (${sc.overall.score}/100)`);
  out.push("");
  out.push("| Dimension | Score | Grade |");
  out.push("| --- | --: | :-: |");
  for (const d of sc.dimensions) {
    out.push(`| ${d.label} | ${d.score} | ${d.grade} |`);
  }
  out.push("");
  if (sc.recommendations.length) {
    out.push("### Top recommendations");
    out.push("");
    for (const r of sc.recommendations.slice(0, 8)) {
      const doc = r.docUrl ? ` ([docs](${r.docUrl}))` : "";
      out.push(`- **${r.title}** (+${r.impact}) — ${r.detail}${doc}`);
    }
    out.push("");
  }
  if (sc.sources.openssf.provider === "unavailable") {
    out.push(`> ⚠ OpenSSF Scorecard unavailable — security dimension excluded.`);
    out.push("");
  }
  out.push(`_Generated ${sc.generatedAt} · ai-harness + OpenSSF Scorecard_`);
  return out.join("\n");
}
