/* AKSon DockSlot — verified auth/profile lookup with safe diagnostics. */
(() => {
  let profilePromise = null;
  let authSubscription = null;
  let authEventVersion = 0;

  const decodeJwtMetadata = (token) => {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return { jwtShapeValid: false, hasSub: false, role: null, issuer: null, expiresAt: null };
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
      return {
        jwtShapeValid: true,
        hasSub: typeof payload.sub === 'string' && payload.sub.length > 0,
        role: typeof payload.role === 'string' ? payload.role : null,
        issuer: typeof payload.iss === 'string' ? payload.iss : null,
        expiresAt: Number.isFinite(payload.exp) ? new Date(payload.exp * 1000).toISOString() : null
      };
    } catch (_) {
      return { jwtShapeValid: false, hasSub: false, role: null, issuer: null, expiresAt: null };
    }
  };

  const installAuthListener = (sb) => {
    if (authSubscription || typeof sb?.auth?.onAuthStateChange !== 'function') return;
    try {
      const result = sb.auth.onAuthStateChange((event) => {
        // A cached profile must never survive sign-out, token refresh, or account switch.
        authEventVersion += 1;
        profilePromise = null;
        if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
          console.info('[DockSlot auth diagnostic] Auth state changed:', event);
        }
      });
      authSubscription = result?.data?.subscription || true;
    } catch (error) {
      console.warn('[DockSlot auth diagnostic] Could not subscribe to auth changes:', error?.message || error);
    }
  };

  const logAuthFailure = (error, token, stack, page, eventVersion) => {
    const jwt = decodeJwtMetadata(token);
    console.warn('[DockSlot auth diagnostic] getUser validation failed', {
      at: new Date().toISOString(),
      page,
      errorCode: error?.code || null,
      errorName: error?.name || null,
      status: error?.status || null,
      message: error?.message || String(error),
      sessionTokenPresent: !!token,
      ...jwt,
      authEventVersion: eventVersion,
      callStack: stack
    });
  };

  window.dockslotGetAuthProfile = () => {
    if (!profilePromise) {
      const callStack = new Error('dockslotGetAuthProfile caller').stack || null;
      profilePromise = (async () => {
        const sb = window.supabaseClient;
        if (!sb?.auth) return { user: null, profile: null, error: new Error('Supabase client is unavailable.') };
        installAuthListener(sb);

        try {
          // Read the active session first. Do not call /auth/v1/user with the public anon key
          // when no user session exists; that request cannot identify a user and may emit bad_jwt.
          const { data: sessionData, error: sessionError } = await sb.auth.getSession();
          if (sessionError) return { user: null, profile: null, error: sessionError };
          const accessToken = sessionData?.session?.access_token;
          if (!accessToken) return { user: null, profile: null, error: null };

          const requestEventVersion = authEventVersion;
          const { data: authData, error: authError } = await sb.auth.getUser(accessToken);
          if (authError) {
            logAuthFailure(authError, accessToken, callStack, window.location?.pathname || null, requestEventVersion);
            return { user: null, profile: null, error: authError };
          }
          const user = authData?.user || null;
          if (!user) return { user: null, profile: null, error: null };

          // If the account changed while validation was in flight, do not return stale profile data.
          if (requestEventVersion !== authEventVersion) {
            return window.dockslotGetAuthProfile();
          }

          const { data: profile, error: profileError } = await sb
            .from('profiles')
            .select('role, is_blocked, inn, company_name')
            .eq('id', user.id)
            .maybeSingle();

          return { user, profile: profile || null, error: profileError || null };
        } catch (error) {
          console.warn('[DockSlot auth diagnostic] Unexpected profile lookup failure', {
            at: new Date().toISOString(),
            page: window.location?.pathname || null,
            message: error?.message || String(error),
            callStack
          });
          return { user: null, profile: null, error };
        }
      })();
    }
    return profilePromise;
  };

  window.dockslotResetAuthProfile = () => { profilePromise = null; };
})();
