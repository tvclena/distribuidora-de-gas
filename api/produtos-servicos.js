import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "./auth/require-auth.js";

function adminClient(){
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;

  if(!url||!key){
    throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurada.");
  }

  return createClient(url,key,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
}

function normalizar(body={}){
  const tipo=body.tipo==="servico"?"servico":"produto";
  const geraRetorno=tipo==="produto" && body.gera_retorno===true;

  return {
    produto:{
      tipo,
      nome:String(body.nome||"").trim(),
      categoria:body.categoria?String(body.categoria).trim():null,
      unidade:String(body.unidade||(tipo==="servico"?"SERV":"UN")).trim().toUpperCase(),
      codigo:body.codigo?String(body.codigo).trim():null,
      sku:body.sku?String(body.sku).trim():null,
      preco_venda:Number(body.preco_venda||0),
      custo:Number(body.custo||0),

      // saldo oficial é estoque_lojas
      estoque_atual:0,
      estoque_minimo:0,

      imagem_url:body.imagem_url?String(body.imagem_url).trim():null,
      descricao:body.descricao?String(body.descricao).trim():null,
      ativo:body.ativo!==false,
      controla_estoque:tipo==="produto"?body.controla_estoque!==false:false,
      gera_retorno:geraRetorno,
      produto_retorno_id:
        geraRetorno && body.produto_retorno_id
          ? String(body.produto_retorno_id)
          : null,
      fator_retorno:
        geraRetorno
          ? Number(body.fator_retorno||1)
          : 1
    },

    lojas_ids:
      tipo==="produto" && Array.isArray(body.lojas_ids)
        ? [...new Set(body.lojas_ids.map(String).filter(Boolean))]
        : [],

    estoques:
      tipo==="produto" && Array.isArray(body.estoques_lojas)
        ? body.estoques_lojas.map(x=>({
            loja_id:String(x.loja_id||""),
            estoque_atual:Number(x.estoque_atual||0),
            estoque_minimo:Number(x.estoque_minimo||0)
          })).filter(x=>x.loja_id)
        : []
  };
}

async function validarRetorno(supabase,p,idAtual=null){
  if(!p.gera_retorno)return;

  if(!p.produto_retorno_id){
    throw new Error("Selecione qual produto deve retornar ao estoque.");
  }

  if(!Number.isFinite(p.fator_retorno)||p.fator_retorno<=0){
    throw new Error("O fator de retorno deve ser maior que zero.");
  }

  if(idAtual && p.produto_retorno_id===idAtual){
    throw new Error("O produto de retorno não pode ser o próprio produto.");
  }

  const {data,error}=await supabase
    .from("produtos_servicos")
    .select("id,tipo,ativo,deletado")
    .eq("id",p.produto_retorno_id)
    .single();

  if(error||!data||data.deletado||!data.ativo||data.tipo!=="produto"){
    throw new Error("O produto de retorno precisa ser um produto ativo.");
  }
}

async function validarLojas(supabase,tipo,lojasIds,estoques){
  if(tipo!=="produto")return;

  if(!lojasIds.length){
    throw new Error("Selecione pelo menos uma loja.");
  }

  const mapa=new Map(estoques.map(x=>[x.loja_id,x]));

  for(const id of lojasIds){
    if(!mapa.has(id)){
      throw new Error("Informe o estoque de todas as lojas selecionadas.");
    }
  }

  if(estoques.some(x=>
    !Number.isFinite(x.estoque_atual) ||
    !Number.isFinite(x.estoque_minimo) ||
    x.estoque_atual<0 ||
    x.estoque_minimo<0
  )){
    throw new Error("Os valores de estoque são inválidos.");
  }

  const {data,error}=await supabase
    .from("lojas")
    .select("id,ativo,deletado")
    .in("id",lojasIds);

  if(error)throw error;

  const validas=(data||[]).filter(x=>x.ativo&&!x.deletado);

  if(validas.length!==lojasIds.length){
    throw new Error("Uma ou mais lojas estão inativas ou inválidas.");
  }
}

async function sincronizarEstoques({
  supabase,
  produtoId,
  lojasIds,
  estoques,
  user,
  criacao
}){
  const {data:atuais,error:atuaisError}=await supabase
    .from("estoque_lojas")
    .select("loja_id,estoque_atual,estoque_minimo")
    .eq("produto_id",produtoId);

  if(atuaisError)throw atuaisError;

  const mapaAtual=new Map(
    (atuais||[]).map(x=>[
      x.loja_id,
      {
        estoque_atual:Number(x.estoque_atual||0),
        estoque_minimo:Number(x.estoque_minimo||0)
      }
    ])
  );

  const {error:disableError}=await supabase
    .from("produto_lojas")
    .update({ativo:false})
    .eq("produto_id",produtoId);

  if(disableError)throw disableError;

  for(const lojaId of lojasIds){
    const {error:vError}=await supabase
      .from("produto_lojas")
      .upsert({
        produto_id:produtoId,
        loja_id:lojaId,
        ativo:true
      },{
        onConflict:"produto_id,loja_id"
      });

    if(vError)throw vError;
  }

  for(const item of estoques){
    const antigo=mapaAtual.get(item.loja_id);
    const saldoAntes=antigo?.estoque_atual ?? 0;

    const {error:ensureError}=await supabase
      .from("estoque_lojas")
      .upsert({
        loja_id:item.loja_id,
        produto_id:produtoId,
        estoque_minimo:item.estoque_minimo,
        atualizado_em:new Date().toISOString()
      },{
        onConflict:"loja_id,produto_id"
      });

    if(ensureError)throw ensureError;

    const diferenca=item.estoque_atual-saldoAntes;

    if(Math.abs(diferenca)>0.0000001){
      const tipo=diferenca>0?"ajuste_positivo":"ajuste_negativo";

      const {error:movError}=await supabase.rpc(
        "registrar_movimentacao_estoque",
        {
          p_loja_id:item.loja_id,
          p_produto_id:produtoId,
          p_tipo:tipo,
          p_quantidade:Math.abs(diferenca),
          p_origem:criacao?"cadastro_produto":"ajuste_cadastro",
          p_origem_id:produtoId,
          p_origem_documento:null,
          p_observacao:criacao
            ?"Estoque inicial informado no cadastro do produto."
            :`Saldo alterado manualmente para ${item.estoque_atual}.`,
          p_usuario_id:user.id,
          p_usuario_email:user.email,
          p_chave_idempotencia:null
        }
      );

      if(movError)throw movError;
    }

    const {error:minError}=await supabase
      .from("estoque_lojas")
      .update({
        estoque_minimo:item.estoque_minimo,
        atualizado_em:new Date().toISOString()
      })
      .eq("loja_id",item.loja_id)
      .eq("produto_id",produtoId);

    if(minError)throw minError;
  }
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");

  const auth=await requireAuth(req,res);
  if(!auth)return;

  const supabase=adminClient();

  try{
    if(req.method==="GET"){
      const {data:produtos,error}=await supabase
        .from("produtos_servicos")
        .select("*")
        .eq("deletado",false)
        .order("nome",{ascending:true});

      if(error)throw error;

      const ids=(produtos||[]).map(x=>x.id);
      let vinculos=[];
      let saldos=[];

      if(ids.length){
        const {data:v,error:vError}=await supabase
          .from("produto_lojas")
          .select(`
            produto_id,
            loja_id,
            ativo,
            lojas:loja_id(
              id,
              nome,
              codigo,
              cidade,
              estado,
              principal
            )
          `)
          .in("produto_id",ids)
          .eq("ativo",true);

        if(vError)throw vError;
        vinculos=v||[];

        const {data:e,error:eError}=await supabase
          .from("estoque_lojas")
          .select("produto_id,loja_id,estoque_atual,estoque_minimo")
          .in("produto_id",ids);

        if(eError)throw eError;
        saldos=e||[];
      }

      const items=(produtos||[]).map(p=>{
        const v=vinculos.filter(x=>x.produto_id===p.id);
        const e=saldos.filter(x=>x.produto_id===p.id);

        return {
          ...p,
          estoque_atual:e.reduce((s,x)=>s+Number(x.estoque_atual||0),0),
          lojas_ids:v.map(x=>x.loja_id),
          lojas:v.map(x=>{
            const saldo=e.find(s=>s.loja_id===x.loja_id);

            return {
              ...(x.lojas||{}),
              estoque_atual:Number(saldo?.estoque_atual||0),
              estoque_minimo:Number(saldo?.estoque_minimo||0)
            };
          })
        };
      });

      return res.status(200).json({ok:true,items});
    }

    if(req.method==="POST"){
      const body=normalizar(req.body);
      const p=body.produto;

      if(!p.nome){
        return res.status(400).json({error:"Informe o nome."});
      }

      await validarRetorno(supabase,p);
      await validarLojas(
        supabase,
        p.tipo,
        body.lojas_ids,
        body.estoques
      );

      p.criado_por=auth.user.id;
      p.criado_por_email=auth.user.email;

      const {data,error}=await supabase
        .from("produtos_servicos")
        .insert(p)
        .select("*")
        .single();

      if(error)throw error;

      if(p.tipo==="produto"){
        await sincronizarEstoques({
          supabase,
          produtoId:data.id,
          lojasIds:body.lojas_ids,
          estoques:body.estoques,
          user:auth.user,
          criacao:true
        });
      }

      return res.status(201).json({ok:true,item:data});
    }

    if(req.method==="PATCH"){
      const id=String(req.query?.id||"").trim();

      if(!id){
        return res.status(400).json({error:"ID não informado."});
      }

      const body=normalizar(req.body);
      const p=body.produto;

      if(!p.nome){
        return res.status(400).json({error:"Informe o nome."});
      }

      await validarRetorno(supabase,p,id);
      await validarLojas(
        supabase,
        p.tipo,
        body.lojas_ids,
        body.estoques
      );

      p.atualizado_em=new Date().toISOString();
      p.atualizado_por=auth.user.id;
      p.atualizado_por_email=auth.user.email;

      const {data,error}=await supabase
        .from("produtos_servicos")
        .update(p)
        .eq("id",id)
        .eq("deletado",false)
        .select("*")
        .single();

      if(error)throw error;

      if(p.tipo==="produto"){
        await sincronizarEstoques({
          supabase,
          produtoId:id,
          lojasIds:body.lojas_ids,
          estoques:body.estoques,
          user:auth.user,
          criacao:false
        });
      }else{
        await supabase
          .from("produto_lojas")
          .update({ativo:false})
          .eq("produto_id",id);
      }

      return res.status(200).json({ok:true,item:data});
    }

    if(req.method==="DELETE"){
      const id=String(req.query?.id||"").trim();

      if(!id){
        return res.status(400).json({error:"ID não informado."});
      }

      const {data:vinculos,error:vinculoError}=await supabase
        .from("produtos_servicos")
        .select("id,nome")
        .eq("produto_retorno_id",id)
        .eq("gera_retorno",true)
        .eq("deletado",false);

      if(vinculoError)throw vinculoError;

      if((vinculos||[]).length){
        return res.status(409).json({
          error:"Este produto é usado como retorno de outro produto."
        });
      }

      const {error}=await supabase
        .from("produtos_servicos")
        .update({
          deletado:true,
          ativo:false,
          atualizado_em:new Date().toISOString(),
          atualizado_por:auth.user.id,
          atualizado_por_email:auth.user.email
        })
        .eq("id",id)
        .eq("deletado",false);

      if(error)throw error;

      await supabase
        .from("produto_lojas")
        .update({ativo:false})
        .eq("produto_id",id);

      return res.status(200).json({ok:true});
    }

    res.setHeader("Allow","GET, POST, PATCH, DELETE");
    return res.status(405).json({error:"Método não permitido."});

  }catch(error){
    console.error("PRODUTOS_SERVICOS_ERROR",error);

    if(error?.code==="23505"){
      return res.status(409).json({
        error:"Já existe um cadastro com este código ou SKU."
      });
    }

    return res.status(500).json({
      error:error?.message||"Erro interno."
    });
  }
}
