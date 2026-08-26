import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { clientes, pedidos } from "../../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";

export default async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const cnpj = url.searchParams.get("cnpj");

    if (cnpj) {
      const rows = await db.select().from(clientes).where(eq(clientes.cnpj, cnpj)).limit(1);
      if (!rows.length) return Response.json(null);

      const cliente = rows[0];
      const pedidosCliente = await db
        .select()
        .from(pedidos)
        .where(sql`${pedidos.cliente}->>'cnpj' = ${cnpj}`)
        .orderBy(desc(pedidos.ts));

      return Response.json({ ...cliente, pedidos: pedidosCliente });
    }

    const all = await db.select().from(clientes).orderBy(desc(clientes.updatedAt));
    return Response.json(all);
  }

  if (req.method === "POST") {
    const body = await req.json();

    if (body.action === "sync") {
      const allPedidos = await db.select().from(pedidos).orderBy(desc(pedidos.ts));
      const clienteMap: Record<string, any> = {};

      for (const p of allPedidos) {
        const cli = p.cliente as any;
        const cnpjRaw = (cli?.cnpj || "").replace(/\D/g, "");
        if (!cnpjRaw || cnpjRaw.length !== 14) continue;

        const totais = p.totais as any;
        const total = Number(totais?.total) || 0;

        if (!clienteMap[cnpjRaw]) {
          clienteMap[cnpjRaw] = {
            cnpj: cli.cnpj,
            razao: cli.razao || "",
            fantasia: cli.fantasia || "",
            comprador: cli.comprador || "",
            telefone: cli.telefone || "",
            email: cli.email || "",
            associativismo: cli.associativismo || "",
            totalPedidos: 0,
            totalValor: 0,
            ultimoPedido: null,
          };
        }
        clienteMap[cnpjRaw].totalPedidos += 1;
        clienteMap[cnpjRaw].totalValor += total;
        if (!clienteMap[cnpjRaw].ultimoPedido || p.ts > clienteMap[cnpjRaw].ultimoPedido) {
          clienteMap[cnpjRaw].ultimoPedido = new Date(p.ts);
        }
        if (cli.razao) clienteMap[cnpjRaw].razao = cli.razao;
        if (cli.fantasia) clienteMap[cnpjRaw].fantasia = cli.fantasia;
        if (cli.comprador) clienteMap[cnpjRaw].comprador = cli.comprador;
        if (cli.telefone) clienteMap[cnpjRaw].telefone = cli.telefone;
        if (cli.email) clienteMap[cnpjRaw].email = cli.email;
        if (cli.associativismo) clienteMap[cnpjRaw].associativismo = cli.associativismo;
      }

      let upserted = 0;
      for (const cnpjRaw of Object.keys(clienteMap)) {
        const c = clienteMap[cnpjRaw];
        const existing = await db.select().from(clientes).where(eq(clientes.cnpj, c.cnpj)).limit(1);
        if (existing.length) {
          await db.update(clientes).set({
            razao: c.razao,
            fantasia: c.fantasia,
            comprador: c.comprador,
            telefone: c.telefone,
            email: c.email,
            associativismo: c.associativismo,
            totalPedidos: c.totalPedidos,
            totalValor: c.totalValor,
            ultimoPedido: c.ultimoPedido,
            updatedAt: new Date(),
          }).where(eq(clientes.cnpj, c.cnpj));
        } else {
          await db.insert(clientes).values({
            cnpj: c.cnpj,
            razao: c.razao,
            fantasia: c.fantasia,
            comprador: c.comprador,
            telefone: c.telefone,
            email: c.email,
            associativismo: c.associativismo,
            totalPedidos: c.totalPedidos,
            totalValor: c.totalValor,
            ultimoPedido: c.ultimoPedido,
          });
        }
        upserted++;
      }

      return Response.json({ ok: true, synced: upserted });
    }

    if (body.action === "historico") {
      const cnpj = body.cnpj;
      if (!cnpj) return Response.json({ error: "cnpj required" }, { status: 400 });

      const pedidosCliente = await db
        .select()
        .from(pedidos)
        .where(sql`${pedidos.cliente}->>'cnpj' = ${cnpj}`)
        .orderBy(desc(pedidos.ts));

      const meses: Record<string, { pedidos: number; valor: number; itens: any[] }> = {};
      for (const p of pedidosCliente) {
        const d = new Date(p.ts);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!meses[key]) meses[key] = { pedidos: 0, valor: 0, itens: [] };
        meses[key].pedidos++;
        meses[key].valor += Number((p.totais as any)?.total) || 0;
        const itensArr = (p.itens as any[]) || [];
        for (const it of itensArr) {
          meses[key].itens.push({
            data: p.data,
            pedidoId: p.id,
            nome: it.nome,
            qty: it.qty,
            precoLiq: it.precoLiq,
            st: it.st,
            subtotal: it.subtotal,
          });
        }
      }

      return Response.json({ cnpj, meses, totalPedidos: pedidosCliente.length });
    }

    if (!body.cnpj || !body.razao || !body.fantasia) {
      return Response.json({ error: "cnpj, razao and fantasia required" }, { status: 400 });
    }
    const existing = await db.select().from(clientes).where(eq(clientes.cnpj, body.cnpj)).limit(1);
    if (existing.length) {
      await db.update(clientes).set({
        razao: body.razao,
        fantasia: body.fantasia,
        comprador: body.comprador || "",
        telefone: body.telefone || "",
        email: body.email || "",
        associativismo: body.associativismo || "",
        updatedAt: new Date(),
      }).where(eq(clientes.cnpj, body.cnpj));
    } else {
      await db.insert(clientes).values({
        cnpj: body.cnpj,
        razao: body.razao,
        fantasia: body.fantasia,
        comprador: body.comprador || "",
        telefone: body.telefone || "",
        email: body.email || "",
        associativismo: body.associativismo || "",
      });
    }
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE") {
    const cnpj = url.searchParams.get("cnpj");
    if (!cnpj) return Response.json({ error: "cnpj required" }, { status: 400 });
    await db.delete(clientes).where(eq(clientes.cnpj, cnpj));
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/clientes",
};
