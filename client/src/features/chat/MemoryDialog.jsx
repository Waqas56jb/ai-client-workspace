import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Brain, Loader2, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui';
import { addMemory, deleteMemory, listMemories } from '@/services/chatApi';

export const memoryKey = (clientId) => ['client-memories', clientId];

/**
 * What the assistant remembers about one client. Facts are added when someone
 * states them in a chat ("I'm Sarah, the HR manager") or here by hand; deleting
 * one removes it for good. They are only ever used in this client's chats.
 */
export function MemoryDialog({ open, onClose, client }) {
  const qc = useQueryClient();
  const [fact, setFact] = useState('');
  const q = useQuery({ queryKey: memoryKey(client?.id), queryFn: () => listMemories(client.id), enabled: open && !!client?.id });
  const add = useMutation({
    mutationFn: () => addMemory(client.id, fact.trim()),
    onSuccess: () => {
      setFact('');
      qc.invalidateQueries({ queryKey: memoryKey(client.id) });
    },
    onError: (e) => toast.error(e?.message || 'Could not save that.'),
  });
  const remove = useMutation({
    mutationFn: (id) => deleteMemory(client.id, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: memoryKey(client.id) }),
    onError: (e) => toast.error(e?.message || 'Could not delete that.'),
  });

  return (
    <Dialog open={open} onClose={onClose} title={`What the AI remembers about ${client?.name || 'this client'}`} size="md">
      <p className="text-[15px] leading-6 text-muted">
        These facts are used in every chat for this client only. They are added when someone tells the AI a lasting fact (for example who signs the emails), or here by hand. Delete anything that is wrong.
      </p>
      <div className="mt-4 max-h-[45vh] overflow-y-auto scrollbar-thin">
        {q.isLoading ? (
          <p className="flex items-center gap-2 py-4 text-[15px] text-muted">
            <Loader2 size={17} className="animate-spin" aria-hidden /> Loading…
          </p>
        ) : q.isError ? (
          <p className="py-4 text-[15px] text-danger">Could not load the memory.</p>
        ) : !q.data?.length ? (
          <p className="flex items-center gap-2 py-4 text-[15px] text-muted">
            <Brain size={18} aria-hidden /> Nothing remembered yet.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((m) => (
              <li key={m.id} className="flex items-start gap-3 py-3">
                <span className="min-w-0 flex-1 text-[15.5px] leading-6 text-ink">{m.fact}</span>
                <button
                  type="button"
                  onClick={() => remove.mutate(m.id)}
                  disabled={remove.isPending}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger focus-ring"
                  aria-label={`Forget: ${m.fact}`}
                >
                  <Trash2 size={17} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (fact.trim().length >= 3) add.mutate();
        }}
      >
        <label htmlFor="memory-fact" className="sr-only">
          Add a fact to remember
        </label>
        <input
          id="memory-fact"
          value={fact}
          maxLength={500}
          onChange={(e) => setFact(e.target.value)}
          placeholder="Add a fact, e.g. Prices always include GST."
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[15.5px] text-ink outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
        />
        <button type="submit" disabled={add.isPending || fact.trim().length < 3} className="h-11 shrink-0 rounded-xl bg-brand px-4 text-[15px] font-semibold text-white hover:bg-brand-hover disabled:opacity-60 focus-ring">
          Add
        </button>
      </form>
    </Dialog>
  );
}
