import { config } from '@/lib/config';
import { getAccessToken } from '@/lib/supabaseClient';
import { apiClient, ServiceError } from './apiClient';

/**
 * Every HTTP call the chat workspace makes. AI requests only START work here
 * (202 + generationId); the chat follows progress with GET /ai/generations/:id
 * (see useGeneration in features/chat/useChatData.js), so a reload or a closed
 * tab never loses an answer that is still being written.
 */

/**
 * The chat message: the server works out what it needs (answer, write, new picture,
 * edit of a picture, question back, or an honest "can't do that") and starts it.
 * imageRefs = a picture the user chose ({ fileId } or { outputId, versionId }).
 * options = the user's preferences (format, tone, picture size), used when relevant.
 * Returns { status: 'queued' | 'clarify' | 'answered', generationId?, conversation, userMessage, assistantMessage? }
 */
export async function sendMessage({ taskId, conversationId, prompt, attachmentIds, imageRefs, options, replacesMessageId, idempotencyKey }) {
  const res = await apiClient.post(
    '/ai/assistant/message',
    { taskId, conversationId, prompt, attachmentIds: attachmentIds || [], imageRefs: imageRefs || [], options: options || {}, replacesMessageId },
    { idempotencyKey },
  );
  return res.data;
}

/** The client's own place for assistant chats: { clientId, jobId, taskId } (created once on the server). */
export const startSession = async (clientId) => (await apiClient.post('/assistant/session', { clientId })).data;

/**
 * Starts a written answer. Returns the server's envelope data:
 * { generationId, status: 'queued' | 'clarify', conversation, userMessage, assistantMessage? }
 */
export async function startWriting({ taskId, conversationId, prompt, options, attachmentIds, clarifiesMessageId, replacesMessageId, idempotencyKey }) {
  const res = await apiClient.post(
    '/ai/writing/generate',
    { taskId, conversationId, prompt, options: options || {}, attachmentIds: attachmentIds || [], clarifiesMessageId, replacesMessageId },
    { idempotencyKey },
  );
  return res.data;
}

export const getGeneration = async (id) => (await apiClient.get(`/ai/generations/${id}`)).data;
export const retryGeneration = async (id, idempotencyKey) => (await apiClient.post(`/ai/generations/${id}/retry`, {}, { idempotencyKey })).data;
export const regenerateOutput = async (outputId, idempotencyKey) => (await apiClient.post(`/ai/outputs/${outputId}/regenerate`, {}, { idempotencyKey })).data;

/** All outputs of one chat, each with every version (so "Image 2" always shows the version it was). */
export const chatOutputs = async (conversationId) => (await apiClient.getAll('/outputs', { params: { conversationId, withVersions: true } })).data || [];

export const getFile = async (id) => (await apiClient.get(`/files/${id}`)).data;
export const renameChat = async (id, title) => (await apiClient.patch(`/conversations/${id}`, { title })).data;
export const archiveChat = async (id) => (await apiClient.patch(`/conversations/${id}`, { archived: true })).data;

/**
 * Uploads one file with REAL progress (XMLHttpRequest exposes upload events; fetch does not).
 * @param {{ file: File, clientId, jobId, taskId, description?, onProgress?: (fraction: number) => void, signal?: AbortSignal }} p
 * @returns {Promise<object>} the stored file record
 */
export async function uploadFile({ file, clientId, jobId, taskId, description = 'Added in a chat', onProgress, signal }) {
  const token = await getAccessToken();
  const form = new FormData();
  // Text fields first, file last (the server reads fields in order).
  Object.entries({ clientId, jobId, taskId, category: 'attachment', description }).forEach(([k, v]) => v && form.append(k, v));
  form.append('file', file, file.name);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${config.apiBaseUrl.replace(/\/$/, '')}/files/upload`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let json = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && json?.success !== false) return resolve(json?.data);
      const err = json?.error || {};
      reject(new ServiceError(err.message || (xhr.status === 413 ? 'The file is too large.' : 'Upload failed. Please try again.'), { status: xhr.status, code: err.code || `http_${xhr.status}` }));
    };
    xhr.onerror = () => reject(new ServiceError('Upload failed. Check your connection and try again.', { status: 0, code: 'network' }));
    xhr.onabort = () => reject(new ServiceError('Upload cancelled.', { status: 0, code: 'aborted' }));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/** What the assistant remembers about a client (only ever used in that client's chats). */
export const listMemories = async (clientId) => (await apiClient.get(`/clients/${clientId}/memories`)).data || [];
export const addMemory = async (clientId, fact) => (await apiClient.post(`/clients/${clientId}/memories`, { fact })).data;
export const deleteMemory = async (clientId, id) => (await apiClient.delete(`/clients/${clientId}/memories/${id}`)).data;

/**
 * Follows an answer while it is being written (Server-Sent Events over fetch, so
 * the sign-in token can be sent). onText gets the full text so far after every piece.
 * Resolves when the stream ends; the finished answer is then read from the API as usual.
 */
export async function streamGeneration(id, { onText, signal }) {
  const token = await getAccessToken();
  const res = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}/ai/generations/${id}/stream`, {
    headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal,
  });
  if (!res.ok || !res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      if (!block.startsWith('data: ')) continue;
      let event;
      try {
        event = JSON.parse(block.slice(6));
      } catch {
        continue;
      }
      if (event.type === 'snapshot') text = event.text || '';
      else if (event.type === 'delta') text += event.text || '';
      else continue;
      onText(text);
    }
  }
}
