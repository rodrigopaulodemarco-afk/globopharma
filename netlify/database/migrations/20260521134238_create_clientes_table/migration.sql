CREATE TABLE "clientes" (
	"pk" serial PRIMARY KEY,
	"cnpj" text NOT NULL UNIQUE,
	"razao" text NOT NULL,
	"fantasia" text NOT NULL,
	"comprador" text DEFAULT '',
	"telefone" text DEFAULT '',
	"email" text DEFAULT '',
	"associativismo" text DEFAULT '',
	"total_pedidos" integer DEFAULT 0,
	"total_valor" double precision DEFAULT 0,
	"ultimo_pedido" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
