CREATE TABLE "usuario_farmacias" (
	"pk" serial PRIMARY KEY,
	"usuario_pk" integer NOT NULL,
	"cnpj" text NOT NULL UNIQUE,
	"razao" text NOT NULL,
	"fantasia" text NOT NULL,
	"associativismo" text DEFAULT '',
	"comprador" text DEFAULT '',
	"telefone" text DEFAULT '',
	"email" text DEFAULT '',
	"principal" boolean DEFAULT false,
	"status" text DEFAULT 'ativa' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "usuario_farmacias_usuario_pk_idx" ON "usuario_farmacias" ("usuario_pk");--> statement-breakpoint
ALTER TABLE "usuario_farmacias" ADD CONSTRAINT "usuario_farmacias_usuario_pk_usuarios_pk_fkey" FOREIGN KEY ("usuario_pk") REFERENCES "usuarios"("pk") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "usuario_farmacias" ("usuario_pk", "cnpj", "razao", "fantasia", "associativismo", "comprador", "telefone", "email", "principal", "status", "created_at")
SELECT "pk", "cnpj", "razao", "fantasia", COALESCE("associativismo", ''), "nome_completo", COALESCE("celular", ''), "email", true, 'ativa', COALESCE("created_at", now())
FROM "usuarios"
WHERE "cnpj" IS NOT NULL AND btrim("cnpj") <> ''
ON CONFLICT ("cnpj") DO NOTHING;
