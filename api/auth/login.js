import {
  allowOnly, clearSessionCookies, noCache, publicUser,
  setSessionCookies, supabasePublic
} from "./_shared.js";

function emailAutorizado(email) {
  const lista = String(process.env.EMAILS_AUTORIZADOS || "")
    .split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  return lista.includes(String(email || "").trim().toLowerCase());
}

export default async function handler(req, res) {
  noCache(res);
  if (!allowOnly(req, res, ["POST"])) return;

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      clearSessionCookies(res);
      return res.status(400).json({ ok:false, error:"Informe o e-mail e a senha." });
    }

    if (!emailAutorizado(email)) {
      clearSessionCookies(res);
      return res.status(403).json({ ok:false, error:"Este e-mail não está autorizado a acessar o sistema." });
    }

    const supabase = supabasePublic();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data?.session || !data?.user) {
      clearSessionCookies(res);
      return res.status(401).json({ ok:false, error:"E-mail ou senha inválidos." });
    }

    if (!emailAutorizado(data.user.email)) {
      clearSessionCookies(res);
      return res.status(403).json({ ok:false, error:"Este e-mail não está autorizado a acessar o sistema." });
    }

    setSessionCookies(res, data.session);
    return res.status(200).json({ ok:true, user:publicUser(data.user) });

  } catch (error) {
    console.error("LOGIN_ERROR", error);
    clearSessionCookies(res);
    return res.status(500).json({ ok:false, error:"Não foi possível realizar o login." });
  }
}
