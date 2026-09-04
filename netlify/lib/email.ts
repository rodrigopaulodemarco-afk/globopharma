/**
 * Envio de e-mail transacional via Resend.
 *
 * Variáveis de ambiente (Netlify → Project configuration → Environment variables):
 *   RESEND_API_KEY    obrigatória. Chave da API do Resend (re_...).
 *   EMAIL_REMETENTE   opcional. Remetente, ex.: "Globo Pharma OL <pedidos@globopharma.com.br>".
 *                     Padrão: "Globo Pharma OL <onboarding@resend.dev>" (funciona sem validar domínio).
 *   EMAIL_COPIA       opcional. Cópia (Cc), aceita vários separados por vírgula.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REMETENTE_PADRAO = "Globo Pharma OL <onboarding@resend.dev>";
const TIMEOUT_MS = 15000;

export interface ResultadoEnvio {
  ok: boolean;
  /** Descrição do erro, quando ok = false. */
  detail?: string;
  /** false quando repetir a tentativa não adianta (chave inválida, remetente não validado, etc.). */
  retriable?: boolean;
}

/** Campos que devem ser renderizados em bloco monoespaçado, e não em linha de tabela. */
const CAMPOS_BLOCO = ["itens", "layout txt", "itens-resumo", "layout-txt"];

function escapeHtml(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lista(valor: string | undefined): string[] {
  return (valor || "")
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Monta o corpo HTML do e-mail a partir do payload rotulado do pedido. */
export function montarHtml(payload: Record<string, unknown>): string {
  const linhas: string[] = [];
  const blocos: string[] = [];

  for (const [chave, valor] of Object.entries(payload)) {
    if (valor === undefined || valor === null || valor === "") continue;
    const texto = String(valor);

    if (CAMPOS_BLOCO.includes(chave.toLowerCase()) || texto.includes("\n")) {
      blocos.push(
        `<h3 style="font:600 14px/1.4 Arial,sans-serif;color:#1f2937;margin:24px 0 8px">${escapeHtml(chave)}</h3>` +
          `<pre style="font:12px/1.5 Menlo,Consolas,monospace;background:#f6f7f9;border:1px solid #e5e7eb;` +
          `border-radius:6px;padding:12px;white-space:pre-wrap;word-break:break-word;margin:0;color:#111827">` +
          `${escapeHtml(texto)}</pre>`
      );
    } else {
      linhas.push(
        `<tr>` +
          `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font:600 13px/1.4 Arial,sans-serif;` +
          `color:#4b5563;white-space:nowrap;vertical-align:top">${escapeHtml(chave)}</td>` +
          `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font:13px/1.4 Arial,sans-serif;` +
          `color:#111827">${escapeHtml(texto)}</td>` +
          `</tr>`
      );
    }
  }

  return (
    `<div style="max-width:720px;margin:0 auto;padding:24px;background:#ffffff">` +
    `<h2 style="font:700 18px/1.3 Arial,sans-serif;color:#111827;margin:0 0 16px">Globo Pharma OL — Notificação de Pedido</h2>` +
    `<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px">${linhas.join("")}</table>` +
    blocos.join("") +
    `<p style="font:11px/1.5 Arial,sans-serif;color:#9ca3af;margin-top:24px">` +
    `Enviado automaticamente pelo portal de pedidos da Globo Pharma.</p>` +
    `</div>`
  );
}

/** Versão texto puro, para clientes de e-mail que não renderizam HTML. */
export function montarTexto(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}:\n${String(v)}\n`)
    .join("\n");
}

/**
 * Envia um e-mail pela API do Resend. Uma única tentativa — quem chama controla os retries
 * e deve parar quando `retriable` vier false.
 */
export async function enviarEmail(
  emailDestino: string,
  subject: string,
  payload: Record<string, unknown>
): Promise<ResultadoEnvio> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      retriable: false,
      detail: "RESEND_API_KEY não configurada nas variáveis de ambiente do Netlify",
    };
  }

  const destinatarios = lista(emailDestino);
  if (destinatarios.length === 0) {
    return { ok: false, retriable: false, detail: "emailDestino vazio ou inválido" };
  }

  const corpo: Record<string, unknown> = {
    from: process.env.EMAIL_REMETENTE || REMETENTE_PADRAO,
    to: destinatarios,
    subject: subject || "Novo Pedido",
    html: montarHtml(payload),
    text: montarTexto(payload),
  };

  const copia = lista(process.env.EMAIL_COPIA);
  if (copia.length > 0) corpo.cc = copia;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
      signal: controller.signal,
    });

    const texto = await resp.text();

    if (resp.ok) return { ok: true };

    // 401/403 = chave inválida; 422 = remetente/destinatário recusado. Repetir não resolve.
    const definitivo = resp.status === 401 || resp.status === 403 || resp.status === 422;
    return {
      ok: false,
      retriable: !definitivo,
      detail: `Resend HTTP ${resp.status}: ${texto.slice(0, 500)}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, retriable: true, detail: msg };
  } finally {
    clearTimeout(timeout);
  }
}
