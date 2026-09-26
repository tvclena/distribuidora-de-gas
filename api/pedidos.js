import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./auth/require-auth.js";

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Credenciais Supabase não configuradas.");
  return createClient(url, key, { auth:{persistSession:false,autoRefreshToken:false} });
}

const allowedStatus = ["aberto","confirmado","em_entrega","concluido","cancelado"];

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const auth = await requireAuth(req,res);
  if(!auth) return;
  const supabase = db();

  try{
    if(req.method==="GET"){
      const id = String(req.query?.id||"").trim();

      if(id){
        const {data:pedido,error} = await supabase
          .from("pedidos")
          .select("*")
          .eq("id",id)
          .single();
        if(error) throw error;

        const {data:itens,error:itensError} = await supabase
          .from("pedido_itens")
          .select("*")
          .eq("pedido_id",id)
          .order("ordem",{ascending:true});
        if(itensError) throw itensError;

        return res.status(200).json({ok:true,item:{...pedido,itens:itens||[]}});
      }

      const {data,error} = await supabase
        .from("pedidos")
        .select("*")
        .order("data_pedido",{ascending:false})
        .limit(500);
      if(error) throw error;
      return res.status(200).json({ok:true,items:data||[]});
    }

    if(req.method==="POST"){
      const body = req.body || {};
      if(!body.cliente_id) return res.status(400).json({error:"Selecione o cliente."});
      if(!Array.isArray(body.itens) || !body.itens.length) return res.status(400).json({error:"Adicione pelo menos um item."});

      const forma = String(body.forma_pagamento||"dinheiro");
      if(forma==="prazo" && !body.data_vencimento) return res.status(400).json({error:"Informe a data de vencimento."});

      const payload = {
        p_cliente_id: body.cliente_id,
        p_vendedor_id: body.vendedor_id || null,
        p_entregador_id: body.entregador_id || null,
        p_tipo_atendimento: body.tipo_atendimento || "retirada",
        p_data_pedido: body.data_pedido || new Date().toISOString(),
        p_previsao_entrega: body.previsao_entrega || null,
        p_status: allowedStatus.includes(body.status) ? body.status : "aberto",
        p_forma_pagamento: forma,
        p_status_pagamento: body.status_pagamento === "pendente" ? "pendente" : "pago",
        p_data_vencimento: body.data_vencimento || null,
        p_condicao_pagamento: body.condicao_pagamento || null,
        p_valor_recebido: Number(body.valor_recebido || 0),
        p_observacao_pagamento: body.observacao_pagamento || null,
        p_desconto_geral: Number(body.desconto_geral || 0),
        p_frete: Number(body.frete || 0),
        p_observacoes: body.observacoes || null,
        p_itens: body.itens,
        p_usuario_id: auth.user.id,
        p_usuario_email: auth.user.email
      };

      const {data,error} = await supabase.rpc("criar_pedido_completo",payload);
      if(error) throw error;

      return res.status(201).json({ok:true,item:data});
    }

    if(req.method==="PATCH"){
      const id = String(req.query?.id||"").trim();
      if(!id) return res.status(400).json({error:"ID não informado."});

      const status = String(req.body?.status||"");
      if(!allowedStatus.includes(status)) return res.status(400).json({error:"Status inválido."});

      const {data,error} = await supabase
        .from("pedidos")
        .update({
          status,
          atualizado_em:new Date().toISOString(),
          atualizado_por:auth.user.id,
          atualizado_por_email:auth.user.email
        })
        .eq("id",id)
        .select("*")
        .single();

      if(error) throw error;
      return res.status(200).json({ok:true,item:data});
    }

    res.setHeader("Allow","GET, POST, PATCH");
    return res.status(405).json({error:"Método não permitido."});

  }catch(error){
    console.error("PEDIDOS_ERROR",error);
    return res.status(500).json({error:error?.message||"Erro interno."});
  }
}
