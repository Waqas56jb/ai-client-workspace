import { apiClient, call, notFound, ServiceError } from './apiClient';
import { mutate, getDb } from './mock/db';
import { logActivity } from './mock/relations';
import { getSupabase } from '@/lib/supabaseClient';

/** Fields a member may change on their own profile (email/active status are admin-managed). */
const SELF_FIELDS = ['name', 'role', 'avatarColor'];

/**
 * Demo team records. Editing them changes the shared mock workspace only — it does
 * not create or modify real user accounts.
 */
export const userService = {
  list: () =>
    call({
      mock: () => getDb().users,
      api: () => apiClient.get('/users'),
    }),

  get: (id) =>
    call({
      mock: () => {
        const u = getDb().users.find((x) => x.id === id);
        if (!u) throw notFound('Team member');
        return u;
      },
      api: () => apiClient.get(`/users/${id}`),
    }),

  update: (id, patch) =>
    call({
      mock: () =>
        mutate((db) => {
          const u = db.users.find((x) => x.id === id);
          if (!u) throw notFound('Team member');
          if (patch.email && db.users.some((x) => x.id !== id && x.email.toLowerCase() === patch.email.toLowerCase())) {
            throw new ServiceError('Another team member already uses this email.');
          }
          Object.assign(u, patch);
          logActivity(db, { type: 'team_updated', resourceType: 'user', resourceId: id, description: `Updated team profile for ${u.name}` });
          return u;
        }),
      api: async () => {
        const body = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => SELF_FIELDS.includes(k)));
        const supabase = await getSupabase();
        const { data } = await supabase.auth.getSession();
        const selfId = data?.session?.user?.id;
        // Members can only edit their own profile; the API answers 403 for anyone else.
        return apiClient.patch(id === selfId || id === 'me' ? '/users/me' : `/users/${id}`, body);
      },
    }),
};
