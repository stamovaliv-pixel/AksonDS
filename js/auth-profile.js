/* AKSon DockSlot — one verified auth/profile lookup shared by page, navigation and notifications. */
(() => {
  let profilePromise = null;

  window.dockslotGetAuthProfile = () => {
    if (!profilePromise) {
      profilePromise = (async () => {
        const sb = window.supabaseClient;
        if (!sb?.auth) return { user: null, profile: null, error: new Error('Supabase client is unavailable.') };

        try {
          // getUser validates the JWT with Supabase Auth; do not replace with getSession
          // for authorization decisions. The profile role/block status is read from DB.
          const { data: authData, error: authError } = await sb.auth.getUser();
          if (authError) return { user: null, profile: null, error: authError };
          const user = authData?.user || null;
          if (!user) return { user: null, profile: null, error: null };

          const { data: profile, error: profileError } = await sb
            .from('profiles')
            .select('role, is_blocked')
            .eq('id', user.id)
            .maybeSingle();

          return { user, profile: profile || null, error: profileError || null };
        } catch (error) {
          return { user: null, profile: null, error };
        }
      })();
    }
    return profilePromise;
  };

  // Explicit invalidation is available for any future in-page account switch flow.
  window.dockslotResetAuthProfile = () => { profilePromise = null; };
})();
