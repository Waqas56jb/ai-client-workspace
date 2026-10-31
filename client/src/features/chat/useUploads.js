import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadFile } from '@/services/chatApi';
import { checkChatFile, fileType } from '@/lib/fileValidation';
import { createId } from '@/lib/utils';

export const MAX_FILES = 20;

/**
 * Files waiting in the composer. Each item:
 *   { id, name, size, isImage, previewUrl, status: 'waiting' | 'uploading' | 'ready' | 'error' | 'invalid', progress, error, fileId }
 * Upload starts as soon as a file is added (so Send is quick); Send stays
 * disabled until every kept file is 'ready'. `scope` = { clientId, jobId, taskId }
 * of the client's chat place (null while it is being prepared — files then wait).
 * The list is cleared whenever the client changes.
 */
export function useUploads(scope, mode, clientId) {
  const [items, setItems] = useState([]);
  const controllers = useRef(new Map());

  const patch = (id, p) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const run = useCallback(
    async (item, file) => {
      if (!scope?.taskId) return;
      const ctrl = new AbortController();
      controllers.current.set(item.id, ctrl);
      patch(item.id, { status: 'uploading', progress: 0, error: null });
      try {
        // Some browsers give no type for a picked file; send the one its name implies.
        const typed = file.type ? file : new File([file], file.name, { type: fileType(file) });
        const rec = await uploadFile({ file: typed, ...scope, signal: ctrl.signal, onProgress: (p) => patch(item.id, { progress: p }) });
        // extract = whether a document's text could be read ({ status: ok | partial | failed | unsupported | model, error })
        patch(item.id, { status: 'ready', progress: 1, fileId: rec.id, extract: rec.extract || null });
      } catch (e) {
        if (e?.code === 'aborted') return;
        patch(item.id, { status: 'error', error: e?.status === 0 ? 'Upload failed. Check your connection and try again.' : e?.message || 'Upload failed. Please try again.' });
      } finally {
        controllers.current.delete(item.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope?.clientId, scope?.jobId, scope?.taskId],
  );

  const files = useRef(new Map()); // id → File (kept for "Try again")

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const add = useCallback(
    (list) => {
      const incoming = Array.from(list || []);
      const room = MAX_FILES - itemsRef.current.filter((x) => x.status !== 'invalid').length;
      const created = incoming.map((file, i) => {
        const problem = !clientId
          ? 'Choose the client first, then add the file.'
          : i >= room
            ? `You can add up to ${MAX_FILES} files to one message.`
            : checkChatFile(file, mode);
        const isImage = /^image\//.test(fileType(file));
        return {
          file,
          item: {
            id: createId('up'),
            name: file.name || 'Pasted image',
            size: file.size,
            isImage,
            previewUrl: isImage && !problem ? URL.createObjectURL(file) : null,
            status: problem ? 'invalid' : scope?.taskId ? 'uploading' : 'waiting',
            progress: 0,
            error: problem,
            fileId: null,
          },
        };
      });
      setItems((current) => [...current, ...created.map((c) => c.item)]);
      created.forEach(({ file, item }) => {
        if (item.status === 'invalid') return;
        files.current.set(item.id, file);
        if (item.status === 'uploading') run(item, file);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, run, scope?.taskId, clientId],
  );

  // Files added while the client's chat place was being prepared start now.
  useEffect(() => {
    if (!scope?.taskId) return;
    itemsRef.current.filter((x) => x.status === 'waiting').forEach((x) => run(x, files.current.get(x.id)));
  }, [scope?.taskId, run]);

  const retry = useCallback((id) => {
    const file = files.current.get(id);
    if (file) run({ id }, file);
  }, [run]);

  const remove = useCallback((id) => {
    controllers.current.get(id)?.abort();
    files.current.delete(id);
    setItems((list) => {
      const gone = list.find((x) => x.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return list.filter((x) => x.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    files.current.clear();
    setItems((list) => {
      list.forEach((x) => x.previewUrl && URL.revokeObjectURL(x.previewUrl));
      return [];
    });
  }, []);

  // Another client's files must never travel into this client's chat.
  const lastClient = useRef(clientId);
  useEffect(() => {
    if (lastClient.current && lastClient.current !== clientId) clear();
    lastClient.current = clientId;
  }, [clientId, clear]);
  useEffect(() => clear, [clear]); // and nothing keeps uploading after the page closes

  const kept = items.filter((x) => x.status !== 'invalid');
  return {
    items,
    add,
    retry,
    remove,
    clear,
    uploading: kept.some((x) => x.status === 'uploading' || x.status === 'waiting'),
    failed: kept.some((x) => x.status === 'error'),
    readyIds: kept.filter((x) => x.status === 'ready').map((x) => x.fileId),
    readyImages: kept.filter((x) => x.status === 'ready' && x.isImage),
  };
}
