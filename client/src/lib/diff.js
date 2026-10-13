/**
 * Word-level diff (LCS) for comparing text versions.
 * Returns [{ type: 'same'|'added'|'removed', text }].
 */
export function diffWords(a = '', b = '') {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  // Guard against very large inputs in the browser
  if (A.length * B.length > 4_000_000) {
    return [
      { type: 'removed', text: a },
      { type: 'added', text: b },
    ];
  }
  const m = A.length;
  const n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  const push = (type, text) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      push('same', A[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('removed', A[i]);
      i += 1;
    } else {
      push('added', B[j]);
      j += 1;
    }
  }
  while (i < m) push('removed', A[i++]);
  while (j < n) push('added', B[j++]);
  return out;
}
