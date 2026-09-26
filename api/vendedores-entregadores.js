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
      const {data,error}=await supabase.from("vendedores_entregadores").select("*").eq("deletado",false).order("nome",{ascending:true});
      if(error)throw error;
      return res.status(200).json({ok:true,items:data||[]});
    }

    if(req.method==="POST"){
      const b=req.body||{};
      const nome=String(b.nome||"").trim();
      const funcao=["vendedor","entregador","ambos"].includes(b.funcao)?b.funcao:"vendedor";
      if(!nome)return res.status(400).json({error:"Informe o nome."});

      const {data,error}=await supabase.from("vendedores_entregadores").insert({
        nome,
        funcao,
        telefone:b.telefone?String(b.telefone).trim():null,
        documento:b.documento?String(b.documento).trim():null,
        comissao_percentual:Number(b.comissao_percentual||0),
        ativo:b.ativo!==false,
        criado_por:auth.user.id,
        criado_por_email:auth.user.email
      }).select("*").single();

      if(error)throw error;
      return res.status(201).json({ok:true,item:data});
    }

    if(req.method==="DELETE"){
      const id=String(req.query?.id||"").trim();
      if(!id)return res.status(400).json({error:"ID não informado."});

      const {error}=await supabase.from("vendedores_entregadores").update({
        deletado:true,ativo:false,atualizado_em:new Date().toISOString(),
        atualizado_por:auth.user.id,atualizado_por_email:auth.user.email
      }).eq("id",id);

      if(error)throw error;
      return res.status(200).json({ok:true});
    }

    res.setHeader("Allow","GET, POST, DELETE");
    return res.status(405).json({error:"Método não permitido."});

  }catch(error){
    console.error("EQUIPE_ERROR",error);
    return res.status(500).json({error:error?.message||"Erro interno."});
  }
}
