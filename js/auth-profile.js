/* AKSon DockSlot — one verified auth/profile lookup shared by page, navigation and notifications.
   Preflight the SDK-managed session before calling Auth /user: never send the anon API key
   to getUser() when there is no real user session. */
(() => {
  let profilePromise = null;

  const decodeJwtPayload = (token) => {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      return null;
    }
  };

  const clearInvalidLocalSession = async (sb, reason) => {
    console.warn('[DockSlot auth] Invalid local session was cleared:', reason);
    // Local-only signout avoids sending the malformed token back to Auth /logout.
    try { await sb.auth.signOut({ scope: 'local' }); } catch (_) { /* local cleanup is best effort */ }
  };

  window.dockslotGetAuthProfile = () => {
    if (!profilePromise) {
      profilePromise = (async () => {
        const sb = window.supabaseClient;
        if (!sb?.auth) return { user: null, profile: null, error: new Error('Supabase client is unavailable.') };

        try {
          // Read the SDK-managed session first. Without a real access token, do not call
          // getUser(): the client's fallback Authorization can otherwise be its anon key.
          const { data: sessionData, error: sessionError } = await sb.auth.getSession();
          if (sessionError) return { user: null, profile: null, error: sessionError };

          const session = sessionData?.session || null;
          const sessionUserId = String(session?.user?.id || '');
          const accessToken = session?.access_token;
          if (!sessionUserId || typeof accessToken !== 'string' || !accessToken.trim()) {
            return { user: null, profile: null, error: null };
          }

          // A Supabase user access token must identify the same user as the stored session.
          // This is only a preflight guard; Auth server validation below remains authoritative.
          const claims = decodeJwtPayload(accessToken);
          if (!claims?.sub || String(claims.sub) !== sessionUserId) {
            await clearInvalidLocalSession(sb, !claims?.sub ? 'access token has no sub claim' : 'token subject does not match session user');
            return { user: null, profile: null, error: new Error('Сессия авторизации повреждена. Войдите в DockSlot заново.') };
          }

          // Pass the exact user access token explicitly so the API key can never be
          // mistaken for the user's identity in this validation request.
          const { data: authData, error: authError } = await sb.auth.getUser(accessToken);
          if (authError) {
            const message = String(authError?.message || '');
            const code = String(authError?.code || '');
            if (code === 'bad_jwt' || /missing sub claim|invalid claim/i.test(message)) {
              await clearInvalidLocalSession(sb, message || code);
            }
            return { user: null, profile: null, error: authError };
          }

          const user = authData?.user || null;
          if (!user || String(user.id) !== sessionUserId) {
            if (user && String(user.id) !== sessionUserId) {
              await clearInvalidLocalSession(sb, 'Auth user does not match stored session user');
            }
            return { user: null, profile: null, error: null };
          }

          const { data: profile, error: profileError } = await sb
            .from('profiles')
            .select('role, is_blocked, inn, company_name')
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

  // Explicit invalidation is available for account switches and auth-state changes.
  window.dockslotResetAuthProfile = () => { profilePromise = null; };
})();
