import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./auth/require-auth.js";

function db(){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("Credenciais Supabase não configuradas.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");

  const auth=await requireAuth(req,res);
  if(!auth)return;

  const supabase=db();

  try{
    if(req.method==="GET"){
      const {data,error}=await supabase
        .from("entradas_estoque")
        .select("*")
        .order("data_entrada",{ascending:false})
        .limit(500);

      if(error)throw error;

      return res.status(200).json({
        ok:true,
        items:data||[]
      });
    }

    if(req.method==="POST"){
      const b=req.body||{};

      if(!b.loja_id){
        return res.status(400).json({error:"Selecione a loja."});
      }

      if(!Array.isArray(b.itens)||!b.itens.length){
        return res.status(400).json({error:"Adicione pelo menos um produto."});
      }

      const itens=b.itens.map(x=>({
        produto_id:String(x.produto_id||""),
        quantidade:Number(x.quantidade||0),
        custo_unitario:Number(x.custo_unitario||0),
        lote:x.lote?String(x.lote).trim():null,
        validade:x.validade||null
      }));

      if(itens.some(x=>!x.produto_id||!Number.isFinite(x.quantidade)||x.quantidade<=0)){
        return res.status(400).json({error:"Existe item com quantidade inválida."});
      }

      const {data,error}=await supabase.rpc(
        "registrar_entrada_estoque",
        {
          p_loja_id:b.loja_id,
          p_fornecedor_id:b.fornecedor_id||null,
          p_data_entrada:b.data_entrada||new Date().toISOString(),
          p_documento:b.documento||null,
          p_serie:b.serie||null,
          p_referencia:b.referencia||null,
          p_observacoes:b.observacoes||null,
          p_itens:itens,
          p_usuario_id:auth.user.id,
          p_usuario_email:auth.user.email
        }
      );

      if(error)throw error;

      return res.status(201).json({
        ok:true,
        item:data
      });
    }

    res.setHeader("Allow","GET, POST");
    return res.status(405).json({error:"Método não permitido."});

  }catch(error){
    console.error("ENTRADAS_ESTOQUE_ERROR",error);
    return res.status(500).json({
      error:error?.message||"Erro ao registrar entrada."
    });
  }
}
