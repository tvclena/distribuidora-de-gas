import {
  allowOnly,
  clearSessionCookies,
  COOKIE_ACCESS,
  noCache,
  parseCookies,
  supabaseAdmin
} from "./_shared.js";

export default async function handler(req, res) {
  noCache(res);
  if (!allowOnly(req, res, ["POST"])) return;

  try {
    const cookies = parseCookies(req);
    const accessToken = cookies[COOKIE_ACCESS];

    // Encerrar no navegador é obrigatório.
    // Revogar no Supabase é uma tentativa adicional.
    if (accessToken) {
      try {
        const supabase = supabaseAdmin();
        await supabase.auth.admin.signOut(accessToken, "local");
      } catch (error) {
        console.warn("Falha ao revogar sessão no Supabase:", error);
      }
    }

    clearSessionCookies(res);

    return res.status(200).json({
      ok: true
    });
  } catch (error) {
    console.error("LOGOUT_ERROR", error);
    clearSessionCookies(res);

    return res.status(200).json({
      ok: true
    });
  }
}
