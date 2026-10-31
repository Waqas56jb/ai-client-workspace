/** Upload allowlist. The declared MIME type must agree with the sniffed content. */
export const UPLOAD_TYPES = {
  'image/png': { category: 'image', exts: ['png'] },
  'image/jpeg': { category: 'image', exts: ['jpg', 'jpeg'] },
  'image/webp': { category: 'image', exts: ['webp'] },
  'image/gif': { category: 'image', exts: ['gif'] },
  'application/pdf': { category: 'document', exts: ['pdf'] },
  'text/plain': { category: 'text', exts: ['txt'], textual: true },
  'text/markdown': { category: 'text', exts: ['md', 'markdown'], textual: true },
  'text/csv': { category: 'document', exts: ['csv'], textual: true },
  'application/msword': { category: 'document', exts: ['doc'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { category: 'document', exts: ['docx'] },
  'application/vnd.ms-excel': { category: 'document', exts: ['xls'] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { category: 'document', exts: ['xlsx'] },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { category: 'document', exts: ['pptx'] },
};

/** Text extracted from a reference document for AI context is capped. */
export const MAX_REFERENCE_CHARS = 60_000;
/** All documents of one request together (≈ 40k tokens). */
export const MAX_REFERENCE_TOTAL_CHARS = 160_000;
