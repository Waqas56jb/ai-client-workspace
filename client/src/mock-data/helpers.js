/** Relative timestamps keep the demo looking fresh whenever the workspace is seeded. */
export function ago(days = 0, hours = 0, minutes = 0) {
  return new Date(Date.now() - ((days * 24 + hours) * 60 + minutes) * 60000).toISOString();
}

export function ahead(days = 0) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}
