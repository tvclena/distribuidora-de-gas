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
    produto: {
      tipo,
      nome: String(body.nome || "").trim(),
      categoria: body.categoria ? String(body.categoria).trim() : null,
      unidade: String(body.unidade || (tipo === "servico" ? "SERV" : "UN")).trim().toUpperCase(),
      codigo: body.codigo ? String(body.codigo).trim() : null,
      sku: body.sku ? String(body.sku).trim() : null,
      preco_venda: Number(body.preco_venda || 0),
      custo: Number(body.custo || 0),

      // Mantidos por compatibilidade.
      // O saldo oficial multi-loja fica em estoque_lojas.
      estoque_atual: 0,
      estoque_minimo: Number(body.estoque_minimo || 0),

      imagem_url: body.imagem_url ? String(body.imagem_url).trim() : null,
      descricao: body.descricao ? String(body.descricao).trim() : null,
      ativo: body.ativo !== false,
      controla_estoque: tipo === "produto" ? body.controla_estoque !== false : false,
      gera_retorno: geraRetorno,
      produto_retorno_id:
        geraRetorno && body.produto_retorno_id
          ? String(body.produto_retorno_id)
          : null,
      fator_retorno:
        geraRetorno
          ? Number(body.fator_retorno || 1)
          : 1
    },

    lojas_ids:
      tipo === "produto" && Array.isArray(body.lojas_ids)
        ? [...new Set(body.lojas_ids.map(String).filter(Boolean))]
        : []
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

async function validarLojas(supabase, tipo, lojasIds) {
  if (tipo !== "produto") return;

  if (!lojasIds.length) {
    throw new Error("Selecione pelo menos uma loja para o produto.");
  }

  const { data, error } = await supabase
    .from("lojas")
    .select("id,nome,ativo,deletado")
    .in("id", lojasIds);

  if (error) throw error;

  const validas = (data || []).filter(x => x.ativo && !x.deletado);

  if (validas.length !== lojasIds.length) {
    throw new Error("Uma ou mais lojas selecionadas são inválidas ou estão inativas.");
  }
}

async function sincronizarLojasProduto(supabase, produtoId, lojasIds, estoqueMinimo = 0) {
  const { error: deleteError } = await supabase
    .from("produto_lojas")
    .delete()
    .eq("produto_id", produtoId);

  if (deleteError) throw deleteError;

  if (!lojasIds.length) return;

  const vinculos = lojasIds.map(lojaId => ({
    produto_id: produtoId,
    loja_id: lojaId,
    ativo: true
  }));

  const { error: vinculoError } = await supabase
    .from("produto_lojas")
    .insert(vinculos);

  if (vinculoError) throw vinculoError;

  // Garante linha de estoque da loja, mas NÃO cria entrada/movimentação.
  for (const lojaId of lojasIds) {
    const { error } = await supabase
      .from("estoque_lojas")
      .upsert({
        loja_id: lojaId,
        produto_id: produtoId,
        estoque_minimo: Number(estoqueMinimo || 0)
      }, {
        onConflict: "loja_id,produto_id",
        ignoreDuplicates: false
      });

    if (error) throw error;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const supabase = adminClient();

  try {
    if (req.method === "GET") {
      const { data: produtos, error } = await supabase
        .from("produtos_servicos")
        .select("*")
        .eq("deletado", false)
        .order("nome", { ascending: true });

      if (error) throw error;

      const ids = (produtos || []).map(x => x.id);

      let vinculos = [];
      let saldos = [];

      if (ids.length) {
        const { data: v, error: vError } = await supabase
          .from("produto_lojas")
          .select("produto_id,loja_id,ativo,lojas:loja_id(id,nome,codigo,cidade,estado,principal)")
          .in("produto_id", ids)
          .eq("ativo", true);

        if (vError) throw vError;
        vinculos = v || [];

        const { data: e, error: eError } = await supabase
          .from("estoque_lojas")
          .select("produto_id,loja_id,estoque_atual,estoque_minimo")
          .in("produto_id", ids);

        if (eError) throw eError;
        saldos = e || [];
      }

      const items = (produtos || []).map(p => {
        const v = vinculos.filter(x => x.produto_id === p.id);
        const e = saldos.filter(x => x.produto_id === p.id);
        const total = e.reduce((s, x) => s + Number(x.estoque_atual || 0), 0);

        return {
          ...p,
          estoque_atual: total,
          lojas_ids: v.map(x => x.loja_id),
          lojas: v.map(x => ({
            ...(x.lojas || {}),
            estoque_atual: Number(e.find(s => s.loja_id === x.loja_id)?.estoque_atual || 0),
            estoque_minimo: Number(e.find(s => s.loja_id === x.loja_id)?.estoque_minimo || 0)
          }))
        };
      });

      return res.status(200).json({
        ok: true,
        items
      });
    }

    if (req.method === "POST") {
      const body = normalizeBody(req.body);
      const payload = body.produto;

      if (!payload.nome) {
        return res.status(400).json({ error: "Informe o nome." });
      }

      await validarRetorno(supabase, payload);
      await validarLojas(supabase, payload.tipo, body.lojas_ids);

      payload.criado_por = auth.user.id;
      payload.criado_por_email = auth.user.email;

      const { data, error } = await supabase
        .from("produtos_servicos")
        .insert(payload)
        .select("*")
        .single();

      if (error) throw error;

      await sincronizarLojasProduto(
        supabase,
        data.id,
        body.lojas_ids,
        payload.estoque_minimo
      );

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

      const body = normalizeBody(req.body);
      const payload = body.produto;

      if (!payload.nome) {
        return res.status(400).json({ error: "Informe o nome." });
      }

      await validarRetorno(supabase, payload, id);
      await validarLojas(supabase, payload.tipo, body.lojas_ids);

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

      await sincronizarLojasProduto(
        supabase,
        id,
        body.lojas_ids,
        payload.estoque_minimo
      );

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

      await supabase
        .from("produto_lojas")
        .update({ ativo: false })
        .eq("produto_id", id);

      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Método não permitido." });

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
