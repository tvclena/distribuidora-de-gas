import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./auth/require-auth.js";

function db(){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("Credenciais Supabase não configuradas.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

function txt(v,max=500){
  if(v===null||v===undefined)return null;
  const s=String(v).trim();
  return s?s.slice(0,max):null;
}

function normalize(b={}){
  return {
    nome:String(b.nome||"").trim().slice(0,160),
    codigo:String(b.codigo||"").trim().toUpperCase().slice(0,40),
    razao_social:txt(b.razao_social,180),
    cnpj:txt(b.cnpj,24),
    inscricao_estadual:txt(b.inscricao_estadual,50),
    responsavel:txt(b.responsavel,120),
    telefone:txt(b.telefone,30),
    whatsapp:txt(b.whatsapp,30),
    email:txt(b.email,180)?.toLowerCase()||null,
    cep:txt(b.cep,12),
    logradouro:txt(b.logradouro,180),
    numero:txt(b.numero,30),
    complemento:txt(b.complemento,120),
    bairro:txt(b.bairro,120),
    cidade:txt(b.cidade,120),
    estado:txt(b.estado,2)?.toUpperCase()||null,
    pais:txt(b.pais,80)||"Brasil",
    observacoes:txt(b.observacoes,1800),
    ativo:b.ativo!==false,
    principal:!!b.principal,
    controla_estoque:b.controla_estoque!==false,
    aceita_pedidos:b.aceita_pedidos!==false,
    permite_retirada:b.permite_retirada!==false,
    permite_entrega:b.permite_entrega!==false,
    horarios:b.horarios && typeof b.horarios==="object" ? b.horarios : {}
  };
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const auth=await requireAuth(req,res);
  if(!auth)return;
  const supabase=db();

  try{
    if(req.method==="GET"){
      const {data,error}=await supabase.from("lojas").select("*").eq("deletado",false).order("principal",{ascending:false}).order("nome",{ascending:true});
      if(error)throw error;
      return res.status(200).json({ok:true,items:data||[]});
    }

    if(req.method==="POST"){
      const p=normalize(req.body);
      if(!p.nome||!p.codigo)return res.status(400).json({error:"Informe nome e código da loja."});

      if(p.principal){
        await supabase.from("lojas").update({principal:false}).eq("deletado",false);
      }

      p.criado_por=auth.user.id;
      p.criado_por_email=auth.user.email;

      const {data,error}=await supabase.from("lojas").insert(p).select("*").single();
      if(error)throw error;

      return res.status(201).json({ok:true,item:data});
    }

    if(req.method==="PATCH"){
      const id=String(req.query?.id||"").trim();
      if(!id)return res.status(400).json({error:"ID não informado."});

      if(req.query?.acao==="principal"){
        await supabase.from("lojas").update({principal:false,atualizado_em:new Date().toISOString()}).eq("deletado",false);
        const {data,error}=await supabase.from("lojas").update({
          principal:true,
          atualizado_em:new Date().toISOString(),
          atualizado_por:auth.user.id,
          atualizado_por_email:auth.user.email
        }).eq("id",id).eq("deletado",false).select("*").single();
        if(error)throw error;
        return res.status(200).json({ok:true,item:data});
      }

      const p=normalize(req.body);
      if(!p.nome||!p.codigo)return res.status(400).json({error:"Informe nome e código da loja."});

      if(p.principal){
        await supabase.from("lojas").update({principal:false}).neq("id",id).eq("deletado",false);
      }

      p.atualizado_em=new Date().toISOString();
      p.atualizado_por=auth.user.id;
      p.atualizado_por_email=auth.user.email;

      const {data,error}=await supabase.from("lojas").update(p).eq("id",id).eq("deletado",false).select("*").single();
      if(error)throw error;

      return res.status(200).json({ok:true,item:data});
    }

    if(req.method==="DELETE"){
      const id=String(req.query?.id||"").trim();
      if(!id)return res.status(400).json({error:"ID não informado."});

      const {data:loja,error:readError}=await supabase.from("lojas").select("principal").eq("id",id).single();
      if(readError)throw readError;
      if(loja?.principal)return res.status(409).json({error:"Defina outra loja como principal antes de excluir esta unidade."});

      const {error}=await supabase.from("lojas").update({
        deletado:true,ativo:false,atualizado_em:new Date().toISOString(),
        atualizado_por:auth.user.id,atualizado_por_email:auth.user.email
      }).eq("id",id);
      if(error)throw error;

      return res.status(200).json({ok:true});
    }

    res.setHeader("Allow","GET, POST, PATCH, DELETE");
    return res.status(405).json({error:"Método não permitido."});

  }catch(error){
    console.error("LOJAS_ERROR",error);
    if(error?.code==="23505")return res.status(409).json({error:"Já existe uma loja com este código ou CNPJ."});
    return res.status(500).json({error:error?.message||"Erro interno."});
  }
}
