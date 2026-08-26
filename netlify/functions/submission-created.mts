import type { Context } from "@netlify/functions";
import { db } from "../../db/index.js";
import { pedidos, configuracoes } from "../../db/schema.js";
import { eq } from "drizzle-orm";

interface FormPayload {
  form_name: string;
  data: Record<string, string>;
  created_at: string;
}

async function enviarViaFormSubmit(emailDestino: string, formData: Record<string, string>, subject: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(
      "https://formsubmit.co/ajax/" + encodeURIComponent(emailDestino),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          ...formData,
          _subject: subject,
          _template: "table",
          _captcha: "false",
        }),
        signal: controller.signal,
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`FormSubmit HTTP error: ${resp.status}`, text);
      return false;
    }

    const text = await resp.text();
    let data: Record<string, string> = {};
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON
    }

    if (data && data.success === "false") {
      console.error("FormSubmit error:", data.message);
      return false;
    }

    return true;
  } catch (e) {
    console.error("FormSubmit fetch error:", e);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

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

  let emailDestino = "rodrigo.demarco@globopharma.com.br";
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
    if (k !== "form-name" && k !== "bot-field") {
      formData[k] = v;
    }
  }

  const subject = payload.data["subject"] || `Novo Pedido ${pedidoId}`;

  const MAX_RETRIES = 3;
  let sent = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`Fallback email attempt ${attempt}/${MAX_RETRIES} for pedido: ${pedidoId}`);
    sent = await enviarViaFormSubmit(emailDestino, formData, subject);
    if (sent) {
      console.log(`Fallback email sent successfully on attempt ${attempt} for pedido: ${pedidoId}`);
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
    console.error(`All ${MAX_RETRIES} fallback email attempts FAILED for pedido: ${pedidoId}`);
  }

  return new Response("OK");
};
