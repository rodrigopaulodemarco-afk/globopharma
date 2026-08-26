import { pgTable, serial, text, timestamp, integer, boolean, jsonb, doublePrecision, bigint, index } from "drizzle-orm/pg-core";

export const pedidos = pgTable("pedidos", {
  pk: serial().primaryKey(),
  id: text().notNull().unique(),
  ts: bigint({ mode: "number" }).notNull(),
  data: text().notNull(),
  representante: jsonb().notNull(),
  cliente: jsonb().notNull(),
  itens: jsonb().notNull(),
  totais: jsonb().notNull(),
  txt: text().default(""),
  txtCompleto: text("txt_completo").default(""),
  emailEnviado: boolean("email_enviado").default(false),
  emailDestino: text("email_destino").default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

export const produtos = pgTable("produtos", {
  pk: serial().primaryKey(),
  data: jsonb().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const acessos = pgTable("acessos", {
  pk: serial().primaryKey(),
  ts: bigint({ mode: "number" }).notNull(),
  data: text().notNull(),
  distribuidora: text().notNull(),
  distId: text("dist_id").default(""),
  nome: text().notNull(),
  regiao: text().default(""),
  telefone: text().default(""),
  cnpj: text().default(""),
  razao: text().default(""),
  fantasia: text().default(""),
  comprador: text().default(""),
  email: text().default(""),
  associativismo: text().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

export const configuracoes = pgTable("configuracoes", {
  pk: serial().primaryKey(),
  chave: text().notNull().unique(),
  valor: text().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const clientes = pgTable("clientes", {
  pk: serial().primaryKey(),
  cnpj: text().notNull().unique(),
  razao: text().notNull(),
  fantasia: text().notNull(),
  comprador: text().default(""),
  telefone: text().default(""),
  email: text().default(""),
  associativismo: text().default(""),
  cpf: text().default(""),
  dataNascimento: text("data_nascimento").default(""),
  totalPedidos: integer("total_pedidos").default(0),
  totalValor: doublePrecision("total_valor").default(0),
  ultimoPedido: timestamp("ultimo_pedido"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const consentimentosLgpd = pgTable("consentimentos_lgpd", {
  pk: serial().primaryKey(),
  cnpj: text().notNull(),
  razao: text().notNull(),
  fantasia: text().notNull(),
  comprador: text().default(""),
  email: text().default(""),
  telefone: text().default(""),
  ip: text().default(""),
  versaoTermos: text("versao_termos").notNull(),
  aceite: boolean().notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const usuarios = pgTable("usuarios", {
  pk: serial().primaryKey(),
  email: text().notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  senhaSalt: text("senha_salt").notNull(),
  cnpj: text().notNull(),
  razao: text().notNull(),
  fantasia: text().notNull(),
  associativismo: text().default(""),
  distribuidora: text().default(""),
  distId: text("dist_id").default(""),
  nomeCompleto: text("nome_completo").notNull(),
  cpf: text().notNull(),
  dataNascimento: text("data_nascimento").default(""),
  celular: text().default(""),
  autorizaInformacoes: boolean("autoriza_informacoes").default(false),
  declaracaoVeracidade: boolean("declaracao_veracidade").default(false),
  aceitaTermos: boolean("aceita_termos").default(false),
  emailVerificado: boolean("email_verificado").default(false),
  celularVerificado: boolean("celular_verificado").default(false),
  status: text().notNull().default("ativo"),
  ultimoAcesso: timestamp("ultimo_acesso"),
  totalAcessos: integer("total_acessos").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * Farmácias (CNPJs) que pertencem a uma mesma conta de acesso.
 * Um comprador entra com um único e-mail/senha e escolhe para qual
 * das suas farmácias o pedido será feito.
 */
export const usuarioFarmacias = pgTable("usuario_farmacias", {
  pk: serial().primaryKey(),
  usuarioPk: integer("usuario_pk")
    .notNull()
    .references(() => usuarios.pk, { onDelete: "cascade" }),
  cnpj: text().notNull().unique(),
  razao: text().notNull(),
  fantasia: text().notNull(),
  associativismo: text().default(""),
  comprador: text().default(""),
  telefone: text().default(""),
  email: text().default(""),
  principal: boolean().default(false),
  status: text().notNull().default("ativa"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("usuario_farmacias_usuario_pk_idx").on(t.usuarioPk),
]);
