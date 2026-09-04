import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { usuarios, clientes, configuracoes, consentimentosLgpd, acessos, usuarioFarmacias } from "../../db/schema.js";
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { enviarEmail } from "../lib/email.js";

/* ============ SENHA ============ */
function gerarHash(senha: string, salt?: string) {
  const s = salt || randomBytes(16).toString("hex");
  const hash = scryptSync(senha, s, 64).toString("hex");
  return { hash, salt: s };
}

function conferirSenha(senha: string, hash: string, salt: string) {
  try {
    const calc = Buffer.from(scryptSync(senha, salt, 64).toString("hex"), "hex");
    const alvo = Buffer.from(hash, "hex");
    if (calc.length !== alvo.length) return false;
    return timingSafeEqual(calc, alvo);
  } catch {
    return false;
  }
}

/* ============ CÓDIGO DE RECUPERAÇÃO DE SENHA ============ */
/*
 * O código é derivado por HMAC (estilo TOTP) e não precisa de tabela nova:
 * entram na conta o e-mail, o hash da senha atual e a janela de tempo. Como o
 * hash da senha faz parte da entrada, o código deixa de valer assim que a senha
 * é trocada — ou seja, não dá para usar o mesmo código duas vezes.
 */
const CODIGO_ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem I, O, 0 e 1
const CODIGO_TAMANHO = 8;
const CODIGO_JANELA_MS = 15 * 60 * 1000;

function segredoRecuperacao() {
  return process.env.RECUPERACAO_SECRET || process.env.NETLIFY_DATABASE_URL || "";
}

/*
 * O código só protege a conta se o e-mail realmente chegar ao usuário. Sem
 * domínio validado no Resend (variável EMAIL_REMETENTE), o envio só funciona
 * para o dono da conta do Resend, então a recuperação segue conferindo o CNPJ.
 */
function modoRecuperacao(): "codigo" | "cnpj" {
  const podeEnviar = Boolean(process.env.EMAIL_REMETENTE) && Boolean(segredoRecuperacao());
  return podeEnviar ? "codigo" : "cnpj";
}

function janelaAtual() {
  return Math.floor(Date.now() / CODIGO_JANELA_MS);
}

function gerarCodigo(email: string, senhaHash: string, janela: number) {
  const mac = createHmac("sha256", segredoRecuperacao())
    .update(`${email}|${senhaHash}|${janela}`)
    .digest();
  let codigo = "";
  for (let i = 0; i < CODIGO_TAMANHO; i++) codigo += CODIGO_ALFABETO[mac[i] % CODIGO_ALFABETO.length];
  return codigo;
}

function codigoConfere(codigo: string, email: string, senhaHash: string) {
  const limpo = String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (limpo.length !== CODIGO_TAMANHO) return false;
  let ok = false;
  // Aceita a janela atual e a anterior: o código dura de 15 a 30 minutos.
  for (const janela of [janelaAtual(), janelaAtual() - 1]) {
    const esperado = Buffer.from(gerarCodigo(email, senhaHash, janela));
    const informado = Buffer.from(limpo);
    if (informado.length === esperado.length && timingSafeEqual(informado, esperado)) ok = true;
  }
  return ok;
}

/* ============ CONSULTA À RECEITA FEDERAL ============ */
/*
 * Não existe API pública oficial da Receita Federal (a do Serpro é paga). O que
 * consultamos é a base de dados abertos do CNPJ, publicada pela própria Receita
 * e servida pela BrasilAPI, com a Minha Receita como segunda fonte. É o mesmo
 * dado do cartão CNPJ, atualizado mensalmente — uma empresa aberta há poucas
 * semanas pode ainda não constar.
 */
const CNAES_FARMACIA = [
  "4771701", // Comércio varejista de produtos farmacêuticos, sem manipulação de fórmulas
  "4771702", // Comércio varejista de produtos farmacêuticos, com manipulação de fórmulas
  "4771703", // Comércio varejista de produtos farmacêuticos homeopáticos
];
const RECEITA_TIMEOUT_MS = 8000;
const RECEITA_FONTES = [
  (c: string) => `https://brasilapi.com.br/api/cnpj/v1/${c}`,
  (c: string) => `https://minhareceita.org/${c}`,
];

type ConsultaReceita =
  | { ok: true; cnaePrincipal: string; atividade: string; situacao: string }
  | { ok: false; motivo: "nao_encontrado" | "indisponivel"; detalhe?: string };

async function consultarReceita(cnpj: string): Promise<ConsultaReceita> {
  const c = soDigitos(cnpj);
  if (c.length !== 14) return { ok: false, motivo: "indisponivel", detalhe: "CNPJ incompleto" };

  let ultimoErro = "";

  for (const montarUrl of RECEITA_FONTES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RECEITA_TIMEOUT_MS);
    try {
      const resp = await fetch(montarUrl(c), { signal: controller.signal });

      // 404 é resposta legítima da base: o CNPJ não existe lá.
      if (resp.status === 404) return { ok: false, motivo: "nao_encontrado" };

      if (!resp.ok) {
        ultimoErro = `HTTP ${resp.status}`;
        continue;
      }

      const d = (await resp.json()) as Record<string, unknown>;
      return {
        ok: true,
        cnaePrincipal: soDigitos(d.cnae_fiscal),
        atividade: String(d.cnae_fiscal_descricao || ""),
        situacao: String(d.descricao_situacao_cadastral || "").toUpperCase(),
      };
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, motivo: "indisponivel", detalhe: ultimoErro };
}

/*
 * Devolve a mensagem de recusa, ou "" quando o CNPJ pode se cadastrar.
 * Consulta indisponível NÃO bloqueia: uma queda da fonte não pode travar a
 * entrada de clientes novos — o cadastro segue e um aviso é enviado por e-mail.
 */
function recusaPorAtividade(r: ConsultaReceita): string {
  if (!r.ok) return "";

  if (r.situacao && r.situacao !== "ATIVA") {
    return `Este CNPJ está com situação cadastral "${r.situacao}" na Receita Federal. Regularize a situação ou fale com o seu representante.`;
  }

  if (!CNAES_FARMACIA.includes(r.cnaePrincipal)) {
    const atividade = r.atividade ? ` A atividade principal registrada é "${r.atividade}".` : "";
    return `Este portal atende farmácias e drogarias. O CNPJ informado não tem comércio varejista de produtos farmacêuticos como atividade principal na Receita Federal.${atividade} Se houver engano, fale com o seu representante.`;
  }

  return "";
}

/* Avisa o responsável quando um cadastro passou sem confirmação da Receita. */
async function avisarReceitaNaoConferida(dados: {
  cnpj: string;
  razao: string;
  fantasia: string;
  email: string;
  motivo: string;
  detalhe?: string;
}) {
  try {
    let destino = "rodrigo.demarco@globopharma.com.br";
    const [cfg] = await db
      .select({ valor: configuracoes.valor })
      .from(configuracoes)
      .where(eq(configuracoes.chave, "email_destino"))
      .limit(1);
    if (cfg?.valor) destino = cfg.valor;

    await enviarEmail(destino, `Cadastro sem confirmação da Receita — ${dados.fantasia}`, {
      "Aviso": "A conta foi criada, mas não foi possível confirmar a atividade do CNPJ na Receita Federal.",
      "CNPJ": dados.cnpj,
      "Razão Social": dados.razao,
      "Nome Fantasia": dados.fantasia,
      "E-mail da conta": dados.email,
      "Motivo": dados.motivo === "nao_encontrado" ? "CNPJ não encontrado na base da Receita" : "Consulta indisponível",
      "Detalhe": dados.detalhe || "-",
      "O que fazer": "Confira o CNPJ manualmente e bloqueie a conta no painel administrativo se não for uma farmácia.",
    });
  } catch (e) {
    console.error("Falha ao avisar sobre cadastro sem confirmação da Receita:", e);
  }
}

/* ============ VALIDACOES ============ */
const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function cnpjValido(valor: string) {
  const c = soDigitos(valor);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = calc(c.slice(0, 12));
  const d2 = calc(c.slice(0, 12) + String(d1));
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

function cpfValido(valor: string) {
  const c = soDigitos(valor);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (qtd: number) => {
    let soma = 0;
    for (let i = 0; i < qtd; i++) soma += Number(c[i]) * (qtd + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

function emailValido(valor: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(valor || "").trim());
}

function nascimentoValido(valor: string) {
  const m = String(valor || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  const d = new Date(ano, mes - 1, dia);
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return false;
  const hoje = new Date();
  if (d > hoje) return false;
  return ano >= 1900;
}

/** Mesmas regras exibidas na tela de cadastro da loja. */
function problemasSenha(senha: string) {
  const s = String(senha || "");
  const erros: string[] = [];
  if (s.length < 6 || s.length > 10) erros.push("A senha deve ter entre 6 e 10 caracteres");
  if (!/\d/.test(s)) erros.push("A senha deve conter ao menos 1 número");
  if (!/[!@#$%^&*()_+{}|:"<>?~\-]/.test(s)) erros.push("A senha deve conter ao menos 1 caractere especial");
  return erros;
}

const normalizarEmail = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Teto de lojas por conta — evita cadastro em massa por engano. */
const LIMITE_FARMACIAS = 50;

function semSegredos<T extends Record<string, unknown>>(u: T) {
  const { senhaHash, senhaSalt, ...resto } = u as Record<string, unknown>;
  return resto;
}

function erro(mensagem: string, status = 400) {
  return Response.json({ ok: false, error: mensagem }, { status });
}

/** Mantém a base de Clientes do admin em dia com a conta recém-criada. */
async function sincronizarCliente(u: {
  cnpj: string;
  razao: string;
  fantasia: string;
  nomeCompleto: string;
  celular: string;
  email: string;
  associativismo: string;
}) {
  const existente = await db.select().from(clientes).where(eq(clientes.cnpj, u.cnpj)).limit(1);
  if (existente.length) {
    await db
      .update(clientes)
      .set({
        razao: u.razao,
        fantasia: u.fantasia,
        comprador: u.nomeCompleto,
        telefone: u.celular,
        email: u.email,
        associativismo: u.associativismo,
        updatedAt: new Date(),
      })
      .where(eq(clientes.cnpj, u.cnpj));
  } else {
    await db.insert(clientes).values({
      cnpj: u.cnpj,
      razao: u.razao,
      fantasia: u.fantasia,
      comprador: u.nomeCompleto,
      telefone: u.celular,
      email: u.email,
      associativismo: u.associativismo,
    });
  }
}

/* ============ FARMACIAS DA CONTA ============ */

/** Farmácias de uma conta, com a principal sempre no topo. */
async function listarFarmacias(usuarioPk: number) {
  return db
    .select()
    .from(usuarioFarmacias)
    .where(eq(usuarioFarmacias.usuarioPk, usuarioPk))
    .orderBy(desc(usuarioFarmacias.principal), asc(usuarioFarmacias.fantasia));
}

/**
 * Contas criadas antes do multi-CNPJ não têm linha em usuario_farmacias.
 * Na primeira vez que a conta é usada, a farmácia do cadastro vira a principal.
 */
async function garantirFarmaciaPrincipal(u: typeof usuarios.$inferSelect) {
  const atuais = await listarFarmacias(u.pk);
  if (atuais.length) return atuais;
  if (!u.cnpj || !u.cnpj.trim()) return atuais;

  try {
    await db
      .insert(usuarioFarmacias)
      .values({
        usuarioPk: u.pk,
        cnpj: u.cnpj,
        razao: u.razao,
        fantasia: u.fantasia,
        associativismo: u.associativismo || "",
        comprador: u.nomeCompleto,
        telefone: u.celular || "",
        email: u.email,
        principal: true,
        status: "ativa",
      })
      .onConflictDoNothing();
  } catch (e) {
    console.error("Falha ao criar farmácia principal:", e);
  }
  return listarFarmacias(u.pk);
}

/** O CNPJ já pertence a alguma conta (cadastro antigo ou farmácia vinculada)? */
async function cnpjJaUsado(cnpj: string, ignorarUsuarioPk?: number) {
  const limpo = soDigitos(cnpj);
  if (limpo.length !== 14) return false;

  const naConta = await db
    .select({ pk: usuarios.pk })
    .from(usuarios)
    .where(sql`regexp_replace(${usuarios.cnpj}, '\\D', '', 'g') = ${limpo}`)
    .limit(1);
  if (naConta.length && naConta[0].pk !== ignorarUsuarioPk) return true;

  const naFarmacia = await db
    .select({ usuarioPk: usuarioFarmacias.usuarioPk })
    .from(usuarioFarmacias)
    .where(sql`regexp_replace(${usuarioFarmacias.cnpj}, '\\D', '', 'g') = ${limpo}`)
    .limit(1);
  if (naFarmacia.length && naFarmacia[0].usuarioPk !== ignorarUsuarioPk) return true;

  return false;
}

/**
 * Confere que quem chama é mesmo o dono da conta.
 * Segue o modelo já usado pela loja: pk + e-mail da sessão precisam bater.
 */
async function contaDaSessao(body: Record<string, unknown>) {
  const pk = Number(body.contaPk);
  const email = normalizarEmail(body.email);
  if (!pk || !email) return null;
  const achados = await db.select().from(usuarios).where(eq(usuarios.pk, pk)).limit(1);
  const u = achados[0];
  if (!u || u.email !== email || u.status !== "ativo") return null;
  return u;
}

async function tratar(req: Request) {
  const url = new URL(req.url);

  /* ---------- LISTAGEM PARA O ADMIN ---------- */
  if (req.method === "GET") {
    const todos = await db.select().from(usuarios).orderBy(desc(usuarios.createdAt));
    if (!todos.length) return Response.json([]);

    // Uma consulta só para todas as lojas: o admin lista conta + CNPJs juntos.
    const vinculos = await db
      .select()
      .from(usuarioFarmacias)
      .where(inArray(usuarioFarmacias.usuarioPk, todos.map((u) => u.pk)))
      .orderBy(desc(usuarioFarmacias.principal), asc(usuarioFarmacias.fantasia));

    const porConta = new Map<number, typeof vinculos>();
    for (const f of vinculos) {
      const lista = porConta.get(f.usuarioPk) || [];
      lista.push(f);
      porConta.set(f.usuarioPk, lista);
    }

    return Response.json(
      todos.map((u) => {
        const farmacias = porConta.get(u.pk) || [];
        // Conta antiga ainda sem vínculo: mostra a farmácia do cadastro.
        const efetivas = farmacias.length
          ? farmacias
          : u.cnpj
            ? [{
                pk: 0,
                usuarioPk: u.pk,
                cnpj: u.cnpj,
                razao: u.razao,
                fantasia: u.fantasia,
                associativismo: u.associativismo || "",
                comprador: u.nomeCompleto,
                telefone: u.celular || "",
                email: u.email,
                principal: true,
                status: "ativa",
                createdAt: u.createdAt,
                updatedAt: u.updatedAt,
              }]
            : [];
        return { ...semSegredos(u), farmacias: efetivas, totalFarmacias: efetivas.length };
      })
    );
  }

  if (req.method === "DELETE") {
    const pk = Number(url.searchParams.get("pk"));
    if (!pk) return erro("pk obrigatório");
    await db.delete(usuarios).where(eq(usuarios.pk, pk));
    return Response.json({ ok: true });
  }

  if (req.method !== "POST") {
    return erro("Método não permitido", 405);
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  /* ---------- ETAPA 1: E-MAIL / CNPJ JÁ EM USO? ---------- */
  if (action === "disponibilidade") {
    const email = normalizarEmail(body.email);
    const cnpj = soDigitos(body.cnpj);
    let emailEmUso = false;
    let cnpjEmUso = false;

    if (email) {
      const r = await db.select({ pk: usuarios.pk }).from(usuarios).where(eq(usuarios.email, email)).limit(1);
      emailEmUso = r.length > 0;
    }
    if (cnpj.length === 14) {
      cnpjEmUso = await cnpjJaUsado(cnpj);
    }

    // Só consulta a Receita se o CNPJ ainda estiver livre: a mensagem de "já
    // existe conta" é mais útil e evita uma consulta desnecessária.
    let receita: { consultada: boolean; motivo: string } | null = null;
    if (cnpj.length === 14 && !cnpjEmUso) {
      const r = await consultarReceita(cnpj);
      receita = { consultada: r.ok, motivo: recusaPorAtividade(r) };
    }

    return Response.json({ ok: true, emailEmUso, cnpjEmUso, receita });
  }

  /* ---------- CADASTRO ---------- */
  if (action === "cadastrar") {
    const email = normalizarEmail(body.email);
    const cnpj = String(body.cnpj || "").trim();
    const razao = String(body.razao || "").trim();
    const fantasia = String(body.fantasia || "").trim();
    const nomeCompleto = String(body.nomeCompleto || "").trim();
    const celular = String(body.celular || "").trim();
    const associativismo = String(body.associativismo || "").trim();
    const distribuidora = String(body.distribuidora || "").trim();
    const distId = String(body.distId || "").trim();
    const senha = String(body.senha || "");

    if (!cnpjValido(cnpj)) return erro("CNPJ inválido. Verifique se digitou corretamente.");
    if (!razao) return erro("Razão Social é obrigatória");
    if (!fantasia) return erro("Nome Fantasia é obrigatório");
    if (!nomeCompleto || nomeCompleto.split(/\s+/).length < 2) return erro("Informe o nome completo");
    if (!emailValido(email)) return erro("E-mail deve ter formato válido");
    if (soDigitos(celular).length !== 11) return erro("Celular deve ter DDD + 9 dígitos");
    if (!body.autorizaInformacoes) return erro("Você deve autorizar receber informações");
    if (!body.declaracaoVeracidade) return erro("Você deve declarar a veracidade dos dados");
    if (!body.aceitaTermos) return erro("Você deve aceitar os termos e condições");

    const errosSenha = problemasSenha(senha);
    if (errosSenha.length) return erro(errosSenha[0]);

    const jaExisteEmail = await db.select({ pk: usuarios.pk }).from(usuarios).where(eq(usuarios.email, email)).limit(1);
    if (jaExisteEmail.length) return erro("Já existe uma conta com este e-mail. Faça login ou recupere sua senha.", 409);

    if (await cnpjJaUsado(cnpj)) {
      return erro("Já existe uma conta para este CNPJ. Faça login ou recupere sua senha.", 409);
    }

    // A checagem também roda na etapa 1 do formulário, mas é aqui que ela vale:
    // o front pode ser contornado, esta é a porta que realmente cria a conta.
    const receita = await consultarReceita(cnpj);
    const recusa = recusaPorAtividade(receita);
    if (recusa) return erro(recusa, 403);

    const { hash, salt } = gerarHash(senha);

    const [criado] = await db
      .insert(usuarios)
      .values({
        email,
        senhaHash: hash,
        senhaSalt: salt,
        cnpj,
        razao,
        fantasia,
        associativismo,
        distribuidora,
        distId,
        nomeCompleto,
        cpf: "",
        celular,
        autorizaInformacoes: true,
        declaracaoVeracidade: true,
        aceitaTermos: true,
        status: "ativo",
      })
      .returning();

    await sincronizarCliente({
      cnpj,
      razao,
      fantasia,
      nomeCompleto,
      celular,
      email,
      associativismo,
    });

    // A farmácia do cadastro é a principal da conta; outras podem ser
    // adicionadas depois, pela própria loja, sem criar um novo login.
    await db
      .insert(usuarioFarmacias)
      .values({
        usuarioPk: criado.pk,
        cnpj,
        razao,
        fantasia,
        associativismo,
        comprador: nomeCompleto,
        telefone: celular,
        email,
        principal: true,
        status: "ativa",
      })
      .onConflictDoNothing();

    // Registro de consentimento LGPD do aceite feito no cadastro.
    try {
      await db.insert(consentimentosLgpd).values({
        cnpj,
        razao,
        fantasia,
        comprador: nomeCompleto,
        email,
        telefone: celular,
        ip: req.headers.get("x-nf-client-connection-ip") || "",
        versaoTermos: String(body.versaoTermos || "Maio/2026"),
        aceite: true,
      });
    } catch (e) {
      console.error("Falha ao registrar consentimento LGPD:", e);
    }

    if (!receita.ok) {
      console.error(`Cadastro sem confirmação da Receita: CNPJ ${soDigitos(cnpj)} (${receita.motivo})`);
      await avisarReceitaNaoConferida({
        cnpj,
        razao,
        fantasia,
        email,
        motivo: receita.motivo,
        detalhe: receita.detalhe,
      });
    }

    const farmaciasCriadas = await listarFarmacias(criado.pk);
    return Response.json({ ok: true, usuario: semSegredos(criado), farmacias: farmaciasCriadas }, { status: 201 });
  }

  /* ---------- LOGIN ---------- */
  if (action === "login") {
    const email = normalizarEmail(body.email);
    const senha = String(body.senha || "");
    if (!email || !senha) return erro("Informe e-mail e senha");

    const encontrados = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
    const u = encontrados[0];

    // Mensagem genérica para não revelar quais e-mails existem.
    if (!u || !conferirSenha(senha, u.senhaHash, u.senhaSalt)) {
      return erro("E-mail ou senha incorretos", 401);
    }
    if (u.status !== "ativo") {
      return erro("Conta bloqueada. Entre em contato com o seu representante.", 403);
    }

    await db
      .update(usuarios)
      .set({ ultimoAcesso: new Date(), totalAcessos: (u.totalAcessos || 0) + 1, updatedAt: new Date() })
      .where(eq(usuarios.pk, u.pk));

    // Log de acesso (mesma base de 30 dias usada pelo admin).
    try {
      await db.insert(acessos).values({
        ts: Date.now(),
        data: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        distribuidora: String(body.distribuidora || u.distribuidora || ""),
        distId: String(body.distId || u.distId || ""),
        nome: u.fantasia || u.razao,
        regiao: "",
        telefone: u.celular || "",
        cnpj: u.cnpj,
        razao: u.razao,
        fantasia: u.fantasia,
        comprador: u.nomeCompleto,
        email: u.email,
        associativismo: u.associativismo || "",
      });
    } catch (e) {
      console.error("Falha ao registrar acesso:", e);
    }

    const farmacias = await garantirFarmaciaPrincipal(u);

    return Response.json({
      ok: true,
      usuario: semSegredos({ ...u, totalAcessos: (u.totalAcessos || 0) + 1 }),
      farmacias,
    });
  }

  /* ---------- RECUPERAR ACESSO ---------- */
  if (action === "recuperar-modo") {
    return Response.json({ ok: true, modo: modoRecuperacao() });
  }

  if (action === "recuperar-solicitar") {
    const email = normalizarEmail(body.email);
    if (!emailValido(email)) return erro("Informe um e-mail válido.");
    if (modoRecuperacao() !== "codigo") return erro("Envio de código indisponível.", 400);

    const [u] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);

    if (u && u.status === "ativo") {
      const codigo = gerarCodigo(u.email, u.senhaHash, janelaAtual());
      const envio = await enviarEmail(u.email, "Código para redefinir sua senha — Globo Pharma OL", {
        "Olá": u.nomeCompleto,
        "Código": codigo,
        "Validade": "cerca de 15 minutos",
        "Se não foi você": "Ignore este e-mail. Sua senha atual continua valendo e nada foi alterado.",
      });
      if (!envio.ok) console.error("Falha ao enviar código de recuperação:", envio.detail);
    }

    // Resposta idêntica exista ou não a conta: não revela quem tem cadastro.
    return Response.json({ ok: true });
  }

  if (action === "recuperar-verificar" || action === "recuperar-redefinir") {
    const email = normalizarEmail(body.email);
    const encontrados = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
    const u = encontrados[0];
    const modo = modoRecuperacao();
    const confere =
      !!u &&
      (modo === "codigo"
        ? codigoConfere(String(body.codigo || ""), u.email, u.senhaHash)
        : soDigitos(u.cnpj) === soDigitos(body.cnpj));

    if (!confere) {
      return erro(
        modo === "codigo"
          ? "Código inválido ou expirado. Peça um novo código."
          : "Os dados informados não conferem com nenhum cadastro. Confira ou fale com seu representante.",
        401
      );
    }
    if (u.status !== "ativo") {
      return erro("Conta bloqueada. Entre em contato com o seu representante.", 403);
    }

    if (action === "recuperar-verificar") {
      return Response.json({ ok: true, nomeCompleto: u.nomeCompleto });
    }

    const errosSenha = problemasSenha(String(body.novaSenha || ""));
    if (errosSenha.length) return erro(errosSenha[0]);

    const { hash, salt } = gerarHash(String(body.novaSenha));
    await db
      .update(usuarios)
      .set({ senhaHash: hash, senhaSalt: salt, updatedAt: new Date() })
      .where(eq(usuarios.pk, u.pk));

    return Response.json({ ok: true });
  }

  /* ---------- TROCA DE SENHA PELO PRÓPRIO CLIENTE ---------- */
  if (action === "alterar-senha") {
    const email = normalizarEmail(body.email);
    const encontrados = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
    const u = encontrados[0];
    if (!u || !conferirSenha(String(body.senhaAtual || ""), u.senhaHash, u.senhaSalt)) {
      return erro("Senha atual incorreta", 401);
    }
    const errosSenha = problemasSenha(String(body.novaSenha || ""));
    if (errosSenha.length) return erro(errosSenha[0]);

    const { hash, salt } = gerarHash(String(body.novaSenha));
    await db
      .update(usuarios)
      .set({ senhaHash: hash, senhaSalt: salt, updatedAt: new Date() })
      .where(eq(usuarios.pk, u.pk));
    return Response.json({ ok: true });
  }

  /* ---------- FARMÁCIAS DA CONTA (MULTI-CNPJ) ---------- */
  if (action === "farmacias-listar") {
    const u = await contaDaSessao(body);
    if (!u) return erro("Sessão inválida. Entre novamente.", 401);
    const farmacias = await garantirFarmaciaPrincipal(u);
    return Response.json({ ok: true, farmacias });
  }

  if (action === "farmacia-adicionar") {
    const u = await contaDaSessao(body);
    if (!u) return erro("Sessão inválida. Entre novamente.", 401);

    const cnpj = String(body.cnpj || "").trim();
    const razao = String(body.razao || "").trim();
    const fantasia = String(body.fantasia || "").trim();
    const associativismo = String(body.associativismo || "").trim();

    if (!cnpjValido(cnpj)) return erro("CNPJ inválido. Verifique se digitou corretamente.");
    if (!razao) return erro("Razão Social é obrigatória");
    if (!fantasia) return erro("Nome Fantasia é obrigatório");

    const atuais = await garantirFarmaciaPrincipal(u);
    if (atuais.length >= LIMITE_FARMACIAS) {
      return erro(`Cada conta pode ter até ${LIMITE_FARMACIAS} farmácias. Fale com o seu representante.`);
    }
    if (atuais.some((f) => soDigitos(f.cnpj) === soDigitos(cnpj))) {
      return erro("Esta farmácia já está cadastrada na sua conta.", 409);
    }
    if (await cnpjJaUsado(cnpj, u.pk)) {
      return erro("Este CNPJ já pertence a outra conta. Fale com o seu representante.", 409);
    }

    const [nova] = await db
      .insert(usuarioFarmacias)
      .values({
        usuarioPk: u.pk,
        cnpj,
        razao,
        fantasia,
        associativismo,
        comprador: u.nomeCompleto,
        telefone: u.celular || "",
        email: u.email,
        principal: false,
        status: "ativa",
      })
      .returning();

    // Mantém a base de Clientes do admin em dia com a nova loja.
    await sincronizarCliente({
      cnpj,
      razao,
      fantasia,
      nomeCompleto: u.nomeCompleto,
      celular: u.celular || "",
      email: u.email,
      associativismo,
    });

    return Response.json({ ok: true, farmacia: nova, farmacias: await listarFarmacias(u.pk) }, { status: 201 });
  }

  if (action === "farmacia-remover") {
    const u = await contaDaSessao(body);
    if (!u) return erro("Sessão inválida. Entre novamente.", 401);

    const pk = Number(body.pk);
    if (!pk) return erro("pk obrigatório");

    const alvo = await db
      .select()
      .from(usuarioFarmacias)
      .where(and(eq(usuarioFarmacias.pk, pk), eq(usuarioFarmacias.usuarioPk, u.pk)))
      .limit(1);
    if (!alvo.length) return erro("Farmácia não encontrada nesta conta.", 404);
    if (alvo[0].principal) {
      return erro("A farmácia principal é a do cadastro e não pode ser removida.");
    }

    // A loja sai da conta, mas o histórico de pedidos e a base de
    // Clientes continuam intactos no admin.
    await db.delete(usuarioFarmacias).where(eq(usuarioFarmacias.pk, pk));
    return Response.json({ ok: true, farmacias: await listarFarmacias(u.pk) });
  }

  /* ---------- AÇÕES DO ADMIN ---------- */
  if (action === "admin-status") {
    const pk = Number(body.pk);
    const status = body.status === "bloqueado" ? "bloqueado" : "ativo";
    if (!pk) return erro("pk obrigatório");
    await db.update(usuarios).set({ status, updatedAt: new Date() }).where(eq(usuarios.pk, pk));
    return Response.json({ ok: true, status });
  }

  if (action === "admin-verificar") {
    const pk = Number(body.pk);
    if (!pk) return erro("pk obrigatório");
    const valor = !!body.valor;
    const campo = body.campo === "celular" ? "celular" : "email";
    await db
      .update(usuarios)
      .set(campo === "celular" ? { celularVerificado: valor, updatedAt: new Date() } : { emailVerificado: valor, updatedAt: new Date() })
      .where(eq(usuarios.pk, pk));
    return Response.json({ ok: true });
  }

  if (action === "admin-redefinir-senha") {
    const pk = Number(body.pk);
    if (!pk) return erro("pk obrigatório");
    const errosSenha = problemasSenha(String(body.novaSenha || ""));
    if (errosSenha.length) return erro(errosSenha[0]);
    const { hash, salt } = gerarHash(String(body.novaSenha));
    await db
      .update(usuarios)
      .set({ senhaHash: hash, senhaSalt: salt, updatedAt: new Date() })
      .where(eq(usuarios.pk, pk));
    return Response.json({ ok: true });
  }

  return erro("Ação desconhecida");
}

/* Qualquer falha inesperada sai como JSON: o front sempre faz res.json(). */
export default async (req: Request) => {
  try {
    return await tratar(req);
  } catch (e) {
    console.error("auth:", e);
    return erro("Não foi possível concluir a operação. Tente novamente.", 500);
  }
};

export const config: Config = {
  path: "/api/auth",
};
