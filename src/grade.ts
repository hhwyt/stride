/** Spec grading gate: block garbage input before decomposition. */
export interface Grade {
  grade: "GOOD" | "NEEDS_WORK";
  placeholders: number;
  ok: boolean;
  hits: string[];
}

export function gradeText(text: string): Grade {
  const matches = text.match(/\bTBD\b|\bTODO\b|\bFIXME\b|\{\{[^}]*\}\}/g) ?? [];
  const ok = matches.length === 0;
  return {
    grade: ok ? "GOOD" : "NEEDS_WORK",
    placeholders: matches.length,
    ok,
    hits: [...new Set(matches)],
  };
}
