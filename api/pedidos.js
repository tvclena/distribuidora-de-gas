import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./auth/require-auth.js";

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Credenciais Supabase não configuradas.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

const STATUS = ["aberto","confirmado","em_entrega","concluido","cancelado"];
const PAGAMENTOS = [
  "dinheiro","pix","cartao_credito","cartao_debito",
  "boleto","transferencia","prazo","outro"
];

function normalizarPedido(body = {}) {
  const forma = PAGAMENTOS.includes(body.forma_pagamento)
    ? body.forma_pagamento
    : "dinheiro";

  return {
    cliente_id: body.cliente_id || null,
    vendedor_id: body.vendedor_id || null,
    entregador_id: body.entregador_id || null,
    tipo_atendimento: ["retirada","entrega","balcao"].includes(body.tipo_atendimento)
      ? body.tipo_atendimento
      : "retirada",
    data_pedido: body.data_pedido || new Date().toISOString(),
    previsao_entrega: body.previsao_entrega || null,
    status: STATUS.includes(body.status) ? body.status : "aberto",
    forma_pagamento: forma,
    status_pagamento: body.status_pagamento === "pendente" ? "pendente" : "pago",
    data_vencimento: forma === "prazo" ? body.data_vencimento || null : null,
    condicao_pagamento: forma === "prazo"
      ? String(body.condicao_pagamento || "30 dias").trim()
      : null,
    valor_recebido: Number(body.valor_recebido || 0),
    observacao_pagamento: body.observacao_pagamento
      ? String(body.observacao_pagamento).trim()
      : null,
    desconto_geral: Number(body.desconto_geral || 0),
    frete: Number(body.frete || 0),
    observacoes: body.observacoes ? String(body.observacoes).trim() : null,
    itens: Array.isArray(body.itens) ? body.itens : []
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const supabase = db();

  try {
    // =========================================================
    // GET - LISTAR OU ABRIR PEDIDO
    // =========================================================
    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();

      if (id) {
        const { data: pedido, error } = await supabase
          .from("pedidos")
          .select("*")
          .eq("id", id)
          .single();

        if (error) throw error;

        const { data: itens, error: itensError } = await supabase
          .from("pedido_itens")
          .select("*")
          .eq("pedido_id", id)
          .order("ordem", { ascending: true });

        if (itensError) throw itensError;

        return res.status(200).json({
          ok: true,
          item: {
            ...pedido,
            itens: itens || []
          }
        });
      }

      const { data, error } = await supabase
        .from("pedidos")
        .select("*")
        .order("data_pedido", { ascending: false })
        .limit(500);

      if (error) throw error;

      return res.status(200).json({
        ok: true,
        items: data || []
      });
    }

    // =========================================================
    // POST - CRIAR PEDIDO
    // =========================================================
    if (req.method === "POST") {
      const body = normalizarPedido(req.body);

      if (!body.cliente_id) {
        return res.status(400).json({ error: "Selecione o cliente." });
      }

      if (!body.itens.length) {
        return res.status(400).json({
          error: "Adicione pelo menos um item."
        });
      }

      if (body.forma_pagamento === "prazo" && !body.data_vencimento) {
        return res.status(400).json({
          error: "Informe a data de vencimento."
        });
      }

      const { data, error } = await supabase.rpc(
        "criar_pedido_completo",
        {
          p_cliente_id: body.cliente_id,
          p_vendedor_id: body.vendedor_id,
          p_entregador_id: body.entregador_id,
          p_tipo_atendimento: body.tipo_atendimento,
          p_data_pedido: body.data_pedido,
          p_previsao_entrega: body.previsao_entrega,
          p_status: body.status,
          p_forma_pagamento: body.forma_pagamento,
          p_status_pagamento: body.status_pagamento,
          p_data_vencimento: body.data_vencimento,
          p_condicao_pagamento: body.condicao_pagamento,
          p_valor_recebido: body.valor_recebido,
          p_observacao_pagamento: body.observacao_pagamento,
          p_desconto_geral: body.desconto_geral,
          p_frete: body.frete,
          p_observacoes: body.observacoes,
          p_itens: body.itens,
          p_usuario_id: auth.user.id,
          p_usuario_email: auth.user.email
        }
      );

      if (error) throw error;

      return res.status(201).json({
        ok: true,
        item: data
      });
    }

    // =========================================================
    // PUT - EDITAR PEDIDO COMPLETO
    // =========================================================
    if (req.method === "PUT") {
      const id = String(req.query?.id || "").trim();

      if (!id) {
        return res.status(400).json({ error: "ID não informado." });
      }

      const body = normalizarPedido(req.body);

      if (!body.cliente_id) {
        return res.status(400).json({ error: "Selecione o cliente." });
      }

      if (!body.itens.length) {
        return res.status(400).json({
          error: "Adicione pelo menos um item."
        });
      }

      if (body.forma_pagamento === "prazo" && !body.data_vencimento) {
        return res.status(400).json({
          error: "Informe a data de vencimento."
        });
      }

      const { data: atual, error: atualError } = await supabase
        .from("pedidos")
        .select("id,status")
        .eq("id", id)
        .single();

      if (atualError) throw atualError;

      if (atual.status === "cancelado") {
        return res.status(409).json({
          error: "Pedido cancelado não pode ser editado."
        });
      }

      if (atual.status === "concluido") {
        return res.status(409).json({
          error: "Pedido já entregue não pode ser editado."
        });
      }

      const { data, error } = await supabase.rpc(
        "atualizar_pedido_completo",
        {
          p_pedido_id: id,
          p_cliente_id: body.cliente_id,
          p_vendedor_id: body.vendedor_id,
          p_entregador_id: body.entregador_id,
          p_tipo_atendimento: body.tipo_atendimento,
          p_data_pedido: body.data_pedido,
          p_previsao_entrega: body.previsao_entrega,
          p_status: body.status,
          p_forma_pagamento: body.forma_pagamento,
          p_status_pagamento: body.status_pagamento,
          p_data_vencimento: body.data_vencimento,
          p_condicao_pagamento: body.condicao_pagamento,
          p_valor_recebido: body.valor_recebido,
          p_observacao_pagamento: body.observacao_pagamento,
          p_desconto_geral: body.desconto_geral,
          p_frete: body.frete,
          p_observacoes: body.observacoes,
          p_itens: body.itens,
          p_usuario_id: auth.user.id,
          p_usuario_email: auth.user.email
        }
      );

      if (error) throw error;

      return res.status(200).json({
        ok: true,
        item: data
      });
    }

    // =========================================================
    // PATCH - ALTERAR STATUS / DAR COMO ENTREGUE / CANCELAR
    // =========================================================
    if (req.method === "PATCH") {
      const id = String(req.query?.id || "").trim();

      if (!id) {
        return res.status(400).json({ error: "ID não informado." });
      }

      const status = String(req.body?.status || "");

      if (!STATUS.includes(status)) {
        return res.status(400).json({ error: "Status inválido." });
      }

      const update = {
        status,
        atualizado_em: new Date().toISOString(),
        atualizado_por: auth.user.id,
        atualizado_por_email: auth.user.email
      };

      if (status === "concluido") {
        update.entregue_em = new Date().toISOString();
      }

      if (status === "cancelado") {
        update.cancelado_em = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from("pedidos")
        .update(update)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;

      return res.status(200).json({
        ok: true,
        item: data
      });
    }

    res.setHeader("Allow", "GET, POST, PUT, PATCH");
    return res.status(405).json({
      error: "Método não permitido."
    });

  } catch (error) {
    console.error("PEDIDOS_ERROR", error);

    return res.status(500).json({
      error: error?.message || "Erro interno."
    });
  }
}
