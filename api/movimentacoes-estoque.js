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

  if(req.method!=="GET"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"Método não permitido."});
  }

  try{
    const supabase=db();

    const {data,error}=await supabase
      .from("movimentacoes_estoque")
      .select(`
        id,
        loja_id,
        produto_id,
        tipo,
        quantidade,
        unidade,
        estoque_antes,
        estoque_depois,
        origem,
        origem_id,
        origem_documento,
        observacao,
        usuario_id,
        usuario_email,
        criado_em,
        lojas:loja_id ( nome ),
        produtos_servicos:produto_id ( nome, codigo, sku )
      `)
      .order("criado_em",{ascending:false})
      .limit(2000);

    if(error)throw error;

    const items=(data||[]).map(x=>({
      id:x.id,
      loja_id:x.loja_id,
      loja_nome:x.lojas?.nome||null,
      produto_id:x.produto_id,
      produto_nome:x.produtos_servicos?.nome||"Produto removido",
      produto_codigo:x.produtos_servicos?.codigo||null,
      produto_sku:x.produtos_servicos?.sku||null,
      tipo:x.tipo,
      quantidade:x.quantidade,
      unidade:x.unidade,
      estoque_antes:x.estoque_antes,
      estoque_depois:x.estoque_depois,
      origem:x.origem,
      origem_id:x.origem_id,
      origem_documento:x.origem_documento,
      observacao:x.observacao,
      usuario_id:x.usuario_id,
      usuario_email:x.usuario_email,
      criado_em:x.criado_em
    }));

    return res.status(200).json({ok:true,items});

  }catch(error){
    console.error("MOVIMENTACOES_ESTOQUE_ERROR",error);
    return res.status(500).json({error:error?.message||"Erro ao carregar movimentações."});
  }
}
