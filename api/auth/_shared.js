import { createClient } from "@supabase/supabase-js";

export const COOKIE_ACCESS = "dist_access_token";
export const COOKIE_REFRESH = "dist_refresh_token";

export function env() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("SUPABASE_URL não configurada.");
  if (!anon) throw new Error("SUPABASE_ANON_KEY não configurada.");

  return { url, anon, service };
}

export function supabasePublic() {
  const { url, anon } = env();

  return createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export function supabaseAdmin() {
  const { url, anon, service } = env();

  return createClient(url, service || anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const cookies = {};

  raw.split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i === -1) return;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) return;

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  });

  return cookies;
}

function cookieBase(maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}

export function setSessionCookies(res, session) {
  const access = encodeURIComponent(session.access_token);
  const refresh = encodeURIComponent(session.refresh_token);

  // Access token: usa o expires_in do Supabase com margem mínima.
  const accessMaxAge = Math.max(Number(session.expires_in || 3600), 60);

  // Refresh token: 30 dias no navegador. O Supabase continua sendo
  // a autoridade real sobre a validade/revogação do token.
  const refreshMaxAge = 60 * 60 * 24 * 30;

  res.setHeader("Set-Cookie", [
    `${COOKIE_ACCESS}=${access}; ${cookieBase(accessMaxAge)}`,
    `${COOKIE_REFRESH}=${refresh}; ${cookieBase(refreshMaxAge)}`
  ]);
}

export function clearSessionCookies(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  res.setHeader("Set-Cookie", [
    `${COOKIE_ACCESS}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`,
    `${COOKIE_REFRESH}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`
  ]);
}

export function allowOnly(req, res, methods) {
  if (!methods.includes(req.method)) {
    res.setHeader("Allow", methods.join(", "));
    res.status(405).json({ error: "Método não permitido." });
    return false;
  }
  return true;
}

export function noCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export function publicUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email || null,
    phone: user.phone || null,
    created_at: user.created_at || null,
    last_sign_in_at: user.last_sign_in_at || null,
    user_metadata: user.user_metadata || {},
    app_metadata: user.app_metadata || {}
  };
}
