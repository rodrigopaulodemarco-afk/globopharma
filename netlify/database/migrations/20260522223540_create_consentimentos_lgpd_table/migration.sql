CREATE TABLE "consentimentos_lgpd" (
	"pk" serial PRIMARY KEY,
	"cnpj" text NOT NULL,
	"razao" text NOT NULL,
	"fantasia" text NOT NULL,
	"comprador" text DEFAULT '',
	"email" text DEFAULT '',
	"telefone" text DEFAULT '',
	"ip" text DEFAULT '',
	"versao_termos" text NOT NULL,
	"aceite" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
