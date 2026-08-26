CREATE TABLE "acessos" (
	"pk" serial PRIMARY KEY,
	"ts" bigint NOT NULL,
	"data" text NOT NULL,
	"distribuidora" text NOT NULL,
	"dist_id" text DEFAULT '',
	"nome" text NOT NULL,
	"regiao" text DEFAULT '',
	"telefone" text DEFAULT '',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "configuracoes" (
	"pk" serial PRIMARY KEY,
	"chave" text NOT NULL UNIQUE,
	"valor" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pedidos" (
	"pk" serial PRIMARY KEY,
	"id" text NOT NULL UNIQUE,
	"ts" bigint NOT NULL,
	"data" text NOT NULL,
	"representante" jsonb NOT NULL,
	"cliente" jsonb NOT NULL,
	"itens" jsonb NOT NULL,
	"totais" jsonb NOT NULL,
	"txt" text DEFAULT '',
	"txt_completo" text DEFAULT '',
	"email_enviado" boolean DEFAULT false,
	"email_destino" text DEFAULT '',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "produtos" (
	"pk" serial PRIMARY KEY,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
