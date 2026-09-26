import {
  allowOnly,
  clearSessionCookies,
  noCache,
  publicUser,
  setSessionCookies,
  supabasePublic
} from "./_shared.js";

export default async function handler(req, res) {
  noCache(res);
  if (!allowOnly(req, res, ["POST"])) return;

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      clearSessionCookies(res);
      return res.status(400).json({
        ok: false,
        error: "Informe o e-mail e a senha."
      });
    }

    if (email.length > 320 || password.length > 1000) {
      clearSessionCookies(res);
      return res.status(400).json({
        ok: false,
        error: "Dados de login inválidos."
      });
    }

    const supabase = supabasePublic();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data?.session || !data?.user) {
      clearSessionCookies(res);

      // Não devolvemos detalhes internos do Supabase para o front.
      return res.status(401).json({
        ok: false,
        error: "E-mail ou senha inválidos."
      });
    }

    setSessionCookies(res, data.session);

    return res.status(200).json({
      ok: true,
      user: publicUser(data.user)
    });
  } catch (error) {
    console.error("LOGIN_ERROR", error);

    clearSessionCookies(res);
    return res.status(500).json({
      ok: false,
      error: "Não foi possível realizar o login."
    });
  }
}
