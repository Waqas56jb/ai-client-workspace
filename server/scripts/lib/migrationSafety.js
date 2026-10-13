/**
 * Static safety checks for migration SQL. The migration runner refuses to apply
 * any file that fails these checks. Comments are stripped before checking.
 */
const FORBIDDEN = [
  { re: /\bdrop\s+(table|schema|database|view|materialized\s+view|type|extension|role|owned|index|trigger|policy|function|sequence)\b/i, why: 'DROP statements are not allowed' },
  { re: /\btruncate\b/i, why: 'TRUNCATE is not allowed' },
  { re: /\bdelete\s+from\b/i, why: 'DELETE FROM is not allowed in migrations' },
  { re: /\balter\s+table\s+(?!(if\s+exists\s+)?(only\s+)?public\.ai_workspace_)/i, why: 'ALTER TABLE may only target public.ai_workspace_* tables' },
  { re: /\balter\s+(extension|database|system|role|schema|default\s+privileges)\b/i, why: 'Global configuration changes are not allowed' },
  { re: /\bcreate\s+(or\s+replace\s+)?extension\b/i, why: 'Creating extensions is not allowed' },
  { re: /\bupdate\s+(?!public\.ai_workspace_)[\w."]+\s+set\b/i, why: 'UPDATE may only target public.ai_workspace_* tables' },
  { re: /\bgrant\s+[\w\s,()]+\s+on\s+(all\s+tables|schema)\b/i, why: 'Schema-wide grants are not allowed' },
];

/** Object names created by migrations must use the application prefix. */
const CREATE_NAMED = /\bcreate\s+(?:or\s+replace\s+)?(?:unique\s+)?(table|index|function|trigger|view|type|policy|sequence)\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi;

export function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** @returns {string[]} list of violations (empty = safe) */
export function checkMigrationSafety(sql) {
  const body = stripComments(sql);
  const problems = [];
  FORBIDDEN.forEach(({ re, why }) => {
    if (re.test(body)) problems.push(why);
  });
  let m;
  CREATE_NAMED.lastIndex = 0;
  while ((m = CREATE_NAMED.exec(body))) {
    const name = m[2].replace(/"/g, '').split('.').pop();
    if (!name.toLowerCase().startsWith('ai_workspace_')) problems.push(`${m[1]} "${m[2]}" must be prefixed ai_workspace_`);
  }
  return problems;
}
