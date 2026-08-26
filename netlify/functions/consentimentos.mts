import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { consentimentosLgpd } from "../../db/schema.js";
import { desc } from "drizzle-orm";

export default async (req: Request) => {
  if (req.method === "GET") {
    const all = await db
      .select()
      .from(consentimentosLgpd)
      .orderBy(desc(consentimentosLgpd.createdAt));
    return Response.json(all);
  }

  if (req.method === "POST") {
    const body = await req.json();
    const [row] = await db
      .insert(consentimentosLgpd)
      .values({
        cnpj: body.cnpj,
        razao: body.razao,
        fantasia: body.fantasia,
        comprador: body.comprador || "",
        email: body.email || "",
        telefone: body.telefone || "",
        ip: body.ip || "",
        versaoTermos: body.versaoTermos || "Maio/2026",
        aceite: body.aceite ?? true,
      })
      .returning();
    return Response.json(row, { status: 201 });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/consentimentos",
};
