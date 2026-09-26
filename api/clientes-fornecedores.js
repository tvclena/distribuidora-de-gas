import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./auth/require-auth.js";

function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurada.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function texto(valor, limite = 500) {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  return s ? s.slice(0, limite) : null;
}

function normalizeBody(body = {}) {
  const tipoPermitido = ["cliente", "fornecedor", "ambos"];
  const pessoaPermitida = ["fisica", "juridica"];

  const tipo = tipoPermitido.includes(body.tipo) ? body.tipo : "cliente";
  const tipo_pessoa = pessoaPermitida.includes(body.tipo_pessoa) ? body.tipo_pessoa : "fisica";

  return {
    tipo,
    tipo_pessoa,
    nome: String(body.nome || "").trim().slice(0, 180),
    nome_fantasia: tipo_pessoa === "juridica" ? texto(body.nome_fantasia, 180) : null,
    documento: texto(body.documento, 30),
    inscricao_estadual: tipo_pessoa === "juridica" ? texto(body.inscricao_estadual, 50) : null,
    telefone: texto(body.telefone, 30),
    whatsapp: texto(body.whatsapp, 30),
    email: texto(body.email, 180)?.toLowerCase() || null,
    contato_responsavel: texto(body.contato_responsavel, 120),
    cep: texto(body.cep, 12),
    logradouro: texto(body.logradouro, 180),
    numero: texto(body.numero, 30),
    complemento: texto(body.complemento, 120),
    bairro: texto(body.bairro, 120),
    cidade: texto(body.cidade, 120),
    estado: texto(body.estado, 2)?.toUpperCase() || null,
    observacoes: texto(body.observacoes, 1800),
    ativo: body.ativo !== false
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const supabase = adminClient();

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("clientes_fornecedores")
        .select("*")
        .eq("deletado", false)
        .order("nome", { ascending: true });

      if (error) throw error;

      return res.status(200).json({
        ok: true,
        items: data || []
      });
    }

    if (req.method === "POST") {
      const payload = normalizeBody(req.body);

      if (!payload.nome) {
        return res.status(400).json({
          error: "Informe o nome ou razão social."
        });
      }

      payload.criado_por = auth.user.id;
      payload.criado_por_email = auth.user.email;

      const { data, error } = await supabase
        .from("clientes_fornecedores")
        .insert(payload)
        .select("*")
        .single();

      if (error) throw error;

      return res.status(201).json({
        ok: true,
        item: data
      });
    }

    if (req.method === "PATCH") {
      const id = String(req.query?.id || "").trim();

      if (!id) {
        return res.status(400).json({ error: "ID não informado." });
      }

      const payload = normalizeBody(req.body);

      if (!payload.nome) {
        return res.status(400).json({
          error: "Informe o nome ou razão social."
        });
      }

      payload.atualizado_em = new Date().toISOString();
      payload.atualizado_por = auth.user.id;
      payload.atualizado_por_email = auth.user.email;

      const { data, error } = await supabase
        .from("clientes_fornecedores")
        .update(payload)
        .eq("id", id)
        .eq("deletado", false)
        .select("*")
        .single();

      if (error) throw error;

      return res.status(200).json({
        ok: true,
        item: data
      });
    }

    if (req.method === "DELETE") {
      const id = String(req.query?.id || "").trim();

      if (!id) {
        return res.status(400).json({ error: "ID não informado." });
      }

      const { error } = await supabase
        .from("clientes_fornecedores")
        .update({
          deletado: true,
          ativo: false,
          atualizado_em: new Date().toISOString(),
          atualizado_por: auth.user.id,
          atualizado_por_email: auth.user.email
        })
        .eq("id", id)
        .eq("deletado", false);

      if (error) throw error;

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Método não permitido." });

  } catch (error) {
    console.error("CLIENTES_FORNECEDORES_ERROR", error);

    if (error?.code === "23505") {
      return res.status(409).json({
        error: "Já existe um cadastro ativo com este CPF/CNPJ."
      });
    }

    return res.status(500).json({
      error: error?.message || "Erro interno."
    });
  }
}
