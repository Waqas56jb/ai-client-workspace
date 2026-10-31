/**
 * "Image 1, Image 2 …" for one chat.
 *
 * Every picture in the thread — photos the user added and images the AI made —
 * gets a number in the order it first appears. The numbers come only from the
 * stored messages (message order, then attachment / output order), so reloading
 * the chat gives the same numbers. Each entry points at real stored records:
 *   upload    → { fileId }                 (sent as an attachment)
 *   generated → { outputId, versionId }    (sent as the exact image to edit)
 */

const keyOfFile = (fileId) => `file:${fileId}`;
const keyOfVersion = (versionId) => `version:${versionId}`;

/**
 * The exact version each assistant message produced: messageId → [version per outputId].
 * New messages store `versionIds`; for older ones the nth message showing an output
 * is taken to have made its nth version (that is how revisions were appended).
 */
export function messageVersions(messages, outputsById) {
  const seen = {};
  const map = new Map();
  for (const m of messages) {
    if (m.role === 'user' || !m.outputIds?.length) continue;
    map.set(
      m.id,
      m.outputIds.map((outputId, i) => {
        const o = outputsById[outputId];
        if (!o) return null;
        const versions = o.versions || [];
        seen[outputId] = (seen[outputId] || 0) + 1;
        const id = m.versionIds?.[i];
        if (id) return versions.find((v) => v.id === id) || (o.currentVersion?.id === id ? o.currentVersion : null) || o.currentVersion;
        return versions[seen[outputId] - 1] || o.currentVersion;
      }),
    );
  }
  return map;
}

/**
 * @param {object[]} messages  active thread, oldest first
 * @param {Record<string, object>} outputsById
 * @param {Record<string, object>} filesById
 * @returns {{ list: object[], byKey: Map<string, object> }}
 */
export function buildImageIndex(messages, outputsById, filesById, versionsByMessage = messageVersions(messages, outputsById)) {
  const list = [];
  const byKey = new Map();
  const add = (entry) => {
    if (byKey.has(entry.key)) return;
    const numbered = { ...entry, number: list.length + 1, label: `Image ${list.length + 1}` };
    list.push(numbered);
    byKey.set(entry.key, numbered);
  };
  for (const m of messages) {
    if (m.role === 'user') {
      for (const fileId of m.attachmentIds || []) {
        const f = filesById[fileId];
        if (f && f.kind === 'image') add({ key: keyOfFile(fileId), kind: 'upload', fileId, name: f.name, src: f.previewUrl || null, messageId: m.id });
      }
    } else {
      (m.outputIds || []).forEach((outputId, i) => {
        const o = outputsById[outputId];
        if (!o || o.kind !== 'image') return;
        const v = versionsByMessage.get(m.id)?.[i];
        if (!v) return;
        add({ key: keyOfVersion(v.id), kind: 'generated', outputId, versionId: v.id, versionNumber: v.versionNumber, name: o.title, src: v.image?.previewUrl || null, messageId: m.id });
      });
    }
  }
  return { list, byKey };
}

export const imageKey = { file: keyOfFile, version: keyOfVersion };

const LABEL_RE = /\b(?:image|picture|photo|pic)\s*(?:no\.?|number|#)?\s*(\d{1,3})\b/i;
const DEICTIC_RE = /\b(?:this|that|the|same|previous|last|above|earlier|first|my)\s+(?:image|picture|photo|pic|one)\b|\b(?:image|picture|photo)\s+(?:above|before)\b/i;
const PHOTO_WORDS_RE = /\b(?:attach(?:ed|ing)?|my (?:photo|picture|image|logo)|this (?:photo|picture|image)|the (?:photo|picture|image) (?:above|i (?:sent|added|attached)))\b/i;

/**
 * "use Image 2 …" → Image 2, shown as a removable chip so the user sees which
 * picture will be used. Vaguer references ("the image above", "the original") are
 * worked out by the server from the whole chat.
 */
export function suggestImageReference(text, index) {
  if (!text || !index?.list.length) return null;
  const m = text.match(LABEL_RE);
  const entry = m ? index.list[Number(m[1]) - 1] : null;
  return entry ? { entry, reason: 'label' } : null;
}

/** True when the text talks about a photo the user seems to mean to add ("if I attach an image…"). */
export const mentionsPhoto = (text) => PHOTO_WORDS_RE.test(text || '') || DEICTIC_RE.test(text || '');
