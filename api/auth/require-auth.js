import {
  COOKIE_ACCESS,
  parseCookies,
  publicUser,
  supabaseAdmin
} from "./_shared.js";

/**
 * Use esta função dentro de QUALQUER outra API protegida.
 *
 * Exemplo:
 * const auth = await requireAuth(req, res);
 * if (!auth) return;
 * console.log(auth.user.id);
 */
export async function requireAuth(req, res) {
  const cookies = parseCookies(req);
  const accessToken = cookies[COOKIE_ACCESS];

  if (!accessToken) {
    res.status(401).json({ error: "Não autenticado." });
    return null;
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data?.user) {
    res.status(401).json({ error: "Sessão inválida ou expirada." });
    return null;
  }

  return {
    accessToken,
    user: publicUser(data.user),
    rawUser: data.user
  };
}
