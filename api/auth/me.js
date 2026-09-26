import {
  allowOnly,
  clearSessionCookies,
  COOKIE_ACCESS,
  noCache,
  parseCookies,
  publicUser,
  supabaseAdmin
} from "./_shared.js";

export default async function handler(req, res) {
  noCache(res);
  if (!allowOnly(req, res, ["GET"])) return;

  try {
    const cookies = parseCookies(req);
    const accessToken = cookies[COOKIE_ACCESS];

    if (!accessToken) {
      return res.status(401).json({
        ok: false,
        authenticated: false
      });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.auth.getUser(accessToken);

    if (error || !data?.user) {
      clearSessionCookies(res);

      return res.status(401).json({
        ok: false,
        authenticated: false
      });
    }

    return res.status(200).json({
      ok: true,
      authenticated: true,
      user: publicUser(data.user)
    });
  } catch (error) {
    console.error("ME_ERROR", error);

    return res.status(500).json({
      ok: false,
      error: "Não foi possível validar a sessão."
    });
  }
}
