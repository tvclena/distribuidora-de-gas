import {
  allowOnly,
  clearSessionCookies,
  COOKIE_REFRESH,
  noCache,
  parseCookies,
  publicUser,
  setSessionCookies,
  supabasePublic
} from "./_shared.js";

export default async function handler(req, res) {
  noCache(res);
  if (!allowOnly(req, res, ["POST"])) return;

  try {
    const cookies = parseCookies(req);
    const refreshToken = cookies[COOKIE_REFRESH];

    if (!refreshToken) {
      clearSessionCookies(res);

      return res.status(401).json({
        ok: false,
        authenticated: false
      });
    }

    const supabase = supabasePublic();

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error || !data?.session || !data?.user) {
      clearSessionCookies(res);

      return res.status(401).json({
        ok: false,
        authenticated: false
      });
    }

    setSessionCookies(res, data.session);

    return res.status(200).json({
      ok: true,
      authenticated: true,
      user: publicUser(data.user)
    });
  } catch (error) {
    console.error("REFRESH_ERROR", error);

    clearSessionCookies(res);
    return res.status(401).json({
      ok: false,
      authenticated: false
    });
  }
}
