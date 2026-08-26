CREATE TABLE "usuarios" (
	"pk" serial PRIMARY KEY,
	"email" text NOT NULL UNIQUE,
	"senha_hash" text NOT NULL,
	"senha_salt" text NOT NULL,
	"cnpj" text NOT NULL,
	"razao" text NOT NULL,
	"fantasia" text NOT NULL,
	"associativismo" text DEFAULT '',
	"distribuidora" text DEFAULT '',
	"dist_id" text DEFAULT '',
	"nome_completo" text NOT NULL,
	"cpf" text NOT NULL,
	"data_nascimento" text DEFAULT '',
	"celular" text DEFAULT '',
	"autoriza_informacoes" boolean DEFAULT false,
	"declaracao_veracidade" boolean DEFAULT false,
	"aceita_termos" boolean DEFAULT false,
	"email_verificado" boolean DEFAULT false,
	"celular_verificado" boolean DEFAULT false,
	"status" text DEFAULT 'ativo' NOT NULL,
	"ultimo_acesso" timestamp,
	"total_acessos" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "cpf" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN "data_nascimento" text DEFAULT '';