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

function normalizeBody(body = {}) {
  const tipo = body.tipo === "servico" ? "servico" : "produto";
  const geraRetorno = tipo === "produto" && body.gera_retorno === true;

  return {
    tipo,
    nome: String(body.nome || "").trim(),
    categoria: body.categoria ? String(body.categoria).trim() : null,
    unidade: String(body.unidade || (tipo === "servico" ? "SERV" : "UN")).trim().toUpperCase(),
    codigo: body.codigo ? String(body.codigo).trim() : null,
    sku: body.sku ? String(body.sku).trim() : null,

    preco_venda: Number(body.preco_venda || 0),
    custo: Number(body.custo || 0),

    estoque_atual: tipo === "produto"
      ? Number(body.estoque_atual || 0)
      : 0,

    estoque_minimo: tipo === "produto"
      ? Number(body.estoque_minimo || 0)
      : 0,

    imagem_url: body.imagem_url
      ? String(body.imagem_url).trim()
      : null,

    descricao: body.descricao
      ? String(body.descricao).trim()
      : null,

    ativo: body.ativo !== false,

    controla_estoque:
      tipo === "produto"
        ? body.controla_estoque !== false
        : false,

    gera_retorno: geraRetorno,

    produto_retorno_id:
      geraRetorno && body.produto_retorno_id
        ? String(body.produto_retorno_id)
        : null,

    fator_retorno:
      geraRetorno
        ? Number(body.fator_retorno || 1)
        : 1
  };
}

async function validarRetorno(supabase, payload, idAtual = null) {
  if (!payload.gera_retorno) return;

  if (!payload.produto_retorno_id) {
    throw new Error("Selecione qual produto deve retornar ao estoque.");
  }

  if (!Number.isFinite(payload.fator_retorno) || payload.fator_retorno <= 0) {
    throw new Error("O fator de retorno deve ser maior que zero.");
  }

  if (idAtual && payload.produto_retorno_id === idAtual) {
    throw new Error("O produto de retorno não pode ser o próprio produto.");
  }

  const { data, error } = await supabase
    .from("produtos_servicos")
    .select("id,nome,tipo,ativo,deletado")
    .eq("id", payload.produto_retorno_id)
    .single();

  if (error || !data) {
    throw new Error("Produto de retorno não encontrado.");
  }

  if (data.deletado || !data.ativo || data.tipo !== "produto") {
    throw new Error("O produto de retorno precisa ser um produto ativo.");
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const supabase = adminClient();

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("produtos_servicos")
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
          error: "Informe o nome."
        });
      }

      await validarRetorno(supabase, payload);

      payload.criado_por = auth.user.id;
      payload.criado_por_email = auth.user.email;

      const { data, error } = await supabase
        .from("produtos_servicos")
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
        return res.status(400).json({
          error: "ID não informado."
        });
      }

      const payload = normalizeBody(req.body);

      if (!payload.nome) {
        return res.status(400).json({
          error: "Informe o nome."
        });
      }

      await validarRetorno(supabase, payload, id);

      payload.atualizado_em = new Date().toISOString();
      payload.atualizado_por = auth.user.id;
      payload.atualizado_por_email = auth.user.email;

      const { data, error } = await supabase
        .from("produtos_servicos")
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
        return res.status(400).json({
          error: "ID não informado."
        });
      }

      const { data: vinculos, error: vinculoError } = await supabase
        .from("produtos_servicos")
        .select("id,nome")
        .eq("produto_retorno_id", id)
        .eq("gera_retorno", true)
        .eq("deletado", false);

      if (vinculoError) throw vinculoError;

      if ((vinculos || []).length) {
        const nomes = vinculos.slice(0, 3).map(x => x.nome).join(", ");

        return res.status(409).json({
          error:
            `Este produto está configurado como retorno de: ${nomes}. ` +
            `Remova o vínculo antes de excluir.`
        });
      }

      const { error } = await supabase
        .from("produtos_servicos")
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

    return res.status(405).json({
      error: "Método não permitido."
    });

  } catch (error) {
    console.error("PRODUTOS_SERVICOS_ERROR", error);

    if (error?.code === "23505") {
      return res.status(409).json({
        error: "Já existe um cadastro com este código ou SKU."
      });
    }

    return res.status(500).json({
      error: error?.message || "Erro interno."
    });
  }
}
