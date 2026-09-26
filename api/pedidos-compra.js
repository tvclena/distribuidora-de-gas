import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./auth/require-auth.js";

function db(){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Credenciais Supabase não configuradas.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

function norm(b={}){
  return {
    loja_id:b.loja_id||null,
    fornecedor_id:b.fornecedor_id||null,
    data_pedido:b.data_pedido||new Date().toISOString().slice(0,10),
    previsao_entrega:b.previsao_entrega||null,
    documento:b.documento?String(b.documento).trim():null,
    comprador:b.comprador?String(b.comprador).trim():null,
    observacoes:b.observacoes?String(b.observacoes).trim():null,
    itens:Array.isArray(b.itens)?b.itens.map(x=>({produto_id:String(x.produto_id||""),quantidade:Number(x.quantidade||0),custo_unitario:Number(x.custo_unitario||0),desconto:Number(x.desconto||0)})):[]
  }
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const auth=await requireAuth(req,res);if(!auth)return;
  const supabase=db();
  try{
    if(req.method==="GET"){
      const id=String(req.query?.id||"").trim();
      if(id){
        const {data:p,error}=await supabase.from("pedidos_compra").select("*").eq("id",id).single();if(error)throw error;
        const {data:itens,error:iError}=await supabase.from("pedido_compra_itens").select("*").eq("pedido_id",id).order("ordem",{ascending:true});if(iError)throw iError;
        const {data:rec,error:rError}=await supabase.from("pedido_compra_recebimentos").select("*").eq("pedido_id",id).order("data_recebimento",{ascending:false});if(rError)throw rError;
        return res.status(200).json({ok:true,item:{...p,itens:itens||[],recebimentos:rec||[]}});
      }
      const {data,error}=await supabase.from("pedidos_compra").select("*").order("data_pedido",{ascending:false}).limit(1000);if(error)throw error;
      return res.status(200).json({ok:true,items:data||[]});
    }

    if(req.method==="POST"){
      const b=norm(req.body);if(!b.loja_id||!b.fornecedor_id||!b.itens.length)return res.status(400).json({error:"Informe loja, fornecedor e produtos."});
      const {data,error}=await supabase.rpc("criar_pedido_compra",{p_loja_id:b.loja_id,p_fornecedor_id:b.fornecedor_id,p_data_pedido:b.data_pedido,p_previsao_entrega:b.previsao_entrega,p_documento:b.documento,p_comprador:b.comprador,p_observacoes:b.observacoes,p_itens:b.itens,p_usuario_id:auth.user.id,p_usuario_email:auth.user.email});if(error)throw error;
      return res.status(201).json({ok:true,item:data});
    }

    if(req.method==="PUT"){
      const id=String(req.query?.id||"").trim(),b=norm(req.body);if(!id)return res.status(400).json({error:"ID não informado."});
      const {data,error}=await supabase.rpc("editar_pedido_compra",{p_pedido_id:id,p_loja_id:b.loja_id,p_fornecedor_id:b.fornecedor_id,p_data_pedido:b.data_pedido,p_previsao_entrega:b.previsao_entrega,p_documento:b.documento,p_comprador:b.comprador,p_observacoes:b.observacoes,p_itens:b.itens,p_usuario_id:auth.user.id,p_usuario_email:auth.user.email});if(error)throw error;
      return res.status(200).json({ok:true,item:data});
    }

    if(req.method==="PATCH"){
      const id=String(req.query?.id||"").trim(),acao=String(req.body?.acao||"");if(!id)return res.status(400).json({error:"ID não informado."});
      if(acao==="receber"){
        const itens=Array.isArray(req.body?.itens)?req.body.itens.map(x=>({item_id:String(x.item_id||""),quantidade:Number(x.quantidade||0)})).filter(x=>x.item_id&&x.quantidade>0):[];
        if(!itens.length)return res.status(400).json({error:"Informe os itens recebidos."});
        const {data,error}=await supabase.rpc("receber_pedido_compra",{p_pedido_id:id,p_data_recebimento:req.body?.data_recebimento||new Date().toISOString().slice(0,10),p_documento:req.body?.documento||null,p_serie:req.body?.serie||null,p_observacao:req.body?.observacao||null,p_itens:itens,p_usuario_id:auth.user.id,p_usuario_email:auth.user.email});if(error)throw error;
        return res.status(200).json({ok:true,item:data});
      }
      if(acao==="cancelar"){
        const {data,error}=await supabase.rpc("cancelar_pedido_compra",{p_pedido_id:id,p_usuario_id:auth.user.id,p_usuario_email:auth.user.email});if(error)throw error;
        return res.status(200).json({ok:true,item:data});
      }
      return res.status(400).json({error:"Ação inválida."});
    }

    res.setHeader("Allow","GET, POST, PUT, PATCH");return res.status(405).json({error:"Método não permitido."});
  }catch(error){
    console.error("PEDIDOS_COMPRA_ERROR",error);
    return res.status(500).json({error:error?.message||"Erro interno."});
  }
}
