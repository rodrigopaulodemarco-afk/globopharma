import type { Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { pedidos, configuracoes } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { enviarEmail } from "../lib/email.js";

interface FormPayload {
  form_name: string;
  data: Record<string, string>;
  created_at: string;
}

const EMAIL_PADRAO = "rodrigo.demarco@globopharma.com.br";
const MAX_RETRIES = 3;

export default async (req: Request, context: Context) => {
  const { payload } = (await req.json()) as { payload: FormPayload };

  if (payload.form_name !== "pedido") {
    return new Response("OK");
  }

  const pedidoId = payload.data["pedido-id"];
  if (!pedidoId) {
    return new Response("OK");
  }

  let alreadySent = false;
  try {
    const [row] = await db
      .select({ emailEnviado: pedidos.emailEnviado })
      .from(pedidos)
      .where(eq(pedidos.id, pedidoId))
      .limit(1);
    if (row?.emailEnviado) alreadySent = true;
  } catch (e) {
    console.error("Failed to check emailEnviado:", e);
  }

  if (alreadySent) {
    return new Response("OK");
  }

  let emailDestino = EMAIL_PADRAO;
  try {
    const [cfg] = await db
      .select({ valor: configuracoes.valor })
      .from(configuracoes)
      .where(eq(configuracoes.chave, "email_destino"))
      .limit(1);
    if (cfg?.valor) emailDestino = cfg.valor;
  } catch (e) {
    console.error("Failed to fetch email config:", e);
  }

  const formData: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload.data)) {
    if (k !== "form-name" && k !== "bot-field" && k !== "subject") {
      formData[k] = v;
    }
  }

  const subject = payload.data["subject"] || `Novo Pedido ${pedidoId}`;

  let sent = false;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`Fallback email attempt ${attempt}/${MAX_RETRIES} for pedido: ${pedidoId}`);
    const result = await enviarEmail(emailDestino, subject, formData);

    if (result.ok) {
      sent = true;
      console.log(`Fallback email sent successfully on attempt ${attempt} for pedido: ${pedidoId}`);
      break;
    }

    lastError = result.detail || "unknown error";
    console.error(`Fallback email attempt ${attempt} failed:`, lastError);

    if (result.retriable === false) {
      console.error("Erro definitivo, abortando novas tentativas:", lastError);
      break;
    }

    if (attempt < MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  if (sent) {
    try {
      await db
        .update(pedidos)
        .set({ emailEnviado: true })
        .where(eq(pedidos.id, pedidoId));
    } catch (e) {
      console.error("Failed to update emailEnviado flag for pedido:", pedidoId, e);
    }
  } else {
    console.error(`Fallback email FAILED for pedido: ${pedidoId} — ${lastError}`);
  }

  return new Response("OK");
};
