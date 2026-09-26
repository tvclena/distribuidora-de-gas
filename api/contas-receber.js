import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./auth/require-auth.js";

function db(){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Credenciais Supabase não configuradas.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

function bodyNorm(b={}){
  return {
    cliente_id:b.cliente_id||null,
    loja_id:b.loja_id||null,
    documento:b.documento?String(b.documento).trim():null,
    descricao:String(b.descricao||"").trim(),
    data_emissao:b.data_emissao||new Date().toISOString().slice(0,10),
    competencia:b.competencia||null,
    vencimento:b.vencimento||null,
    valor_original:Number(b.valor_original||0),
    desconto:Number(b.desconto||0),
    juros:Number(b.juros||0),
    multa:Number(b.multa||0),
    status:b.status==="cancelado"?"cancelado":"pendente",
    observacoes:b.observacoes?String(b.observacoes).trim():null
  };
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const auth=await requireAuth(req,res);if(!auth)return;
  const supabase=db();
  try{
    if(req.method==="GET"){
      const id=String(req.query?.id||"").trim();
      if(id){
        const {data,error}=await supabase.from("contas_receber").select("*").eq("id",id).single();if(error)throw error;
        const {data:recebimentos,error:rError}=await supabase.from("contas_receber_recebimentos").select("*").eq("conta_id",id).order("data_recebimento",{ascending:false});if(rError)throw rError;
        return res.status(200).json({ok:true,item:{...data,recebimentos:recebimentos||[]}});
      }
      const {data,error}=await supabase.from("contas_receber").select("*").order("vencimento",{ascending:true}).limit(2000);if(error)throw error;
      return res.status(200).json({ok:true,items:data||[]});
    }

    if(req.method==="POST"){
      const b=bodyNorm(req.body);
      if(!b.cliente_id||!b.descricao||!b.vencimento||b.valor_original<=0)return res.status(400).json({error:"Preencha cliente, descrição, vencimento e valor."});
      const {data,error}=await supabase.rpc("criar_conta_receber_manual",{p_cliente_id:b.cliente_id,p_loja_id:b.loja_id,p_documento:b.documento,p_descricao:b.descricao,p_data_emissao:b.data_emissao,p_competencia:b.competencia,p_vencimento:b.vencimento,p_valor_original:b.valor_original,p_desconto:b.desconto,p_juros:b.juros,p_multa:b.multa,p_status:b.status,p_observacoes:b.observacoes,p_usuario_id:auth.user.id,p_usuario_email:auth.user.email});
      if(error)throw error;return res.status(201).json({ok:true,item:data});
    }

    if(req.method==="PUT"){
      const id=String(req.query?.id||"").trim();if(!id)return res.status(400).json({error:"ID não informado."});
      const b=bodyNorm(req.body);
      const {data,error}=await supabase.rpc("editar_conta_receber",{p_conta_id:id,p_cliente_id:b.cliente_id,p_loja_id:b.loja_id,p_documento:b.documento,p_descricao:b.descricao,p_data_emissao:b.data_emissao,p_competencia:b.competencia,p_vencimento:b.vencimento,p_valor_original:b.valor_original,p_desconto:b.desconto,p_juros:b.juros,p_multa:b.multa,p_status:b.status,p_observacoes:b.observacoes,p_usuario_id:auth.user.id,p_usuario_email:auth.user.email});
      if(error)throw error;return res.status(200).json({ok:true,item:data});
    }

    if(req.method==="PATCH"){
      const id=String(req.query?.id||"").trim();if(!id)return res.status(400).json({error:"ID não informado."});
      const acao=String(req.body?.acao||"");
      if(acao==="receber"){
        const {data,error}=await supabase.rpc("registrar_recebimento_conta",{p_conta_id:id,p_valor:Number(req.body?.valor||0),p_data_recebimento:req.body?.data_recebimento||new Date().toISOString().slice(0,10),p_forma_pagamento:req.body?.forma_pagamento||"outro",p_referencia:req.body?.referencia||null,p_observacao:req.body?.observacao||null,p_usuario_id:auth.user.id,p_usuario_email:auth.user.email});
        if(error)throw error;return res.status(200).json({ok:true,item:data});
      }
      if(acao==="cancelar"||acao==="reabrir"){
        const {data,error}=await supabase.rpc("alterar_status_conta_receber",{p_conta_id:id,p_acao:acao,p_usuario_id:auth.user.id,p_usuario_email:auth.user.email});
        if(error)throw error;return res.status(200).json({ok:true,item:data});
      }
      return res.status(400).json({error:"Ação inválida."});
    }

    res.setHeader("Allow","GET, POST, PUT, PATCH");return res.status(405).json({error:"Método não permitido."});
  }catch(error){
    console.error("CONTAS_RECEBER_ERROR",error);
    return res.status(500).json({error:error?.message||"Erro interno."});
  }
}
