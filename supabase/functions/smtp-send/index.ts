/**
 * Supabase Edge Function: smtp-send
 * Sends an email via the configured SMTP server and saves it to the `emails` table.
 *
 * Expected JSON body:
 *   { to, subject, body, inReplyTo?, threadId?, includeFooter? }
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildPublicStorageUrl(supabaseUrl: string, bucket: string, path: string): string {
  const normalizedPath = path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${normalizedPath}`;
}

// deno-lint-ignore no-explicit-any
function buildFooterHtml(cfg: Record<string, any>, supabaseUrl: string): string {
  const companyName = normalizeString(cfg.footer_company_name);
  const address = normalizeString(cfg.footer_address);
  const vatNumber = normalizeString(cfg.footer_vat_number);
  const phone = normalizeString(cfg.footer_phone);
  const senderEmail = normalizeString(cfg.user_email);
  const logoPath = normalizeString(cfg.footer_logo_path);
  const currentYear = new Date().getFullYear();

  const linkStyle = "color:#1a0dab; text-decoration:none;";
  const paragraphStyle = "margin:2px 0;";
  const safeCompanyName = escapeHtml(companyName);
  const safeAddress = escapeHtml(address);
  const safeVatNumber = escapeHtml(vatNumber);
  const safeEmail = escapeHtml(senderEmail);
  const safePhone = escapeHtml(phone);
  const logoUrl = logoPath ? buildPublicStorageUrl(supabaseUrl, "email-assets", logoPath) : "";
  const phoneHref = phone.replace(/[^\d+]/g, "");

  const socialLinks = [
    { label: "Facebook", href: normalizeString(cfg.footer_social_facebook_url) },
    { label: "Instagram", href: normalizeString(cfg.footer_social_instagram_url) },
    { label: "LinkedIn", href: normalizeString(cfg.footer_social_linkedin_url) },
    { label: "TikTok", href: normalizeString(cfg.footer_social_tiktok_url) },
  ].filter((item) => item.href);

  const legalLinks = [
    { label: "LIA", href: normalizeString(cfg.footer_lia_url) },
    { label: "Disiscrizione", href: normalizeString(cfg.footer_unsubscribe_url) },
    { label: "Privacy Policy", href: normalizeString(cfg.footer_privacy_url) },
  ].filter((item) => item.href);

  const socialHtml = socialLinks.length > 0
    ? `<p style="margin:10px 0 0 0; font-size:12px; color:#333;">Seguici su: ${
      socialLinks.map((item) =>
        `<a href="${escapeHtml(item.href)}" style="${linkStyle}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}</a>`
      ).join(" &middot; ")
    }</p>`
    : "";

  const legalHtml = legalLinks.length > 0
    ? `<p style="margin:6px 0; font-size:11px; color:#555;">${
      legalLinks.map((item) =>
        `<a href="${escapeHtml(item.href)}" style="${linkStyle}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}</a>`
      ).join(" &middot; ")
    }</p>`
    : "";

  const dividerHtml = legalHtml ? `<p style="margin:10px 0; border-top:1px solid #ddd;"></p>` : "";
  const logoHtml = logoUrl
    ? `<p style="margin:0 0 8px 0;"><img src="${logoUrl}" alt="${safeCompanyName || "Logo"}" style="display:block; width:120px; max-width:120px; height:auto; border:0;"></p>`
    : "";

  const contactParts = [
    `<a href="mailto:${safeEmail}" style="${linkStyle}">${safeEmail}</a>`,
    phone
      ? `<a href="tel:${escapeHtml(phoneHref)}" style="${linkStyle}">${safePhone}</a>`
      : "",
  ].filter(Boolean);

  return `
<br><br>
<table cellpadding="0" cellspacing="0" role="presentation" style="font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#333; width:100%; max-width:600px;">
  <tr>
    <td style="padding:0; margin:0;">
      ${logoHtml}
      <p style="margin:0; font-weight:bold; font-size:14px; color:#000;">${safeCompanyName}</p>
      <p style="${paragraphStyle}">${safeAddress}</p>
      <p style="${paragraphStyle}">P.IVA ${safeVatNumber}</p>
      <p style="${paragraphStyle}">${contactParts.join(" | ")}</p>
      ${socialHtml}
      ${dividerHtml}
      ${legalHtml}
      <p style="margin:8px 0 0 0; font-size:10px; color:#777;">&copy; ${currentYear} ${safeCompanyName} Tutti i diritti riservati.</p>
    </td>
  </tr>
</table>`.trim();
}

// deno-lint-ignore no-explicit-any
function buildHtmlBody(bodyText: string, cfg: Record<string, any>, supabaseUrl: string): string {
  return `
<div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.6; color:#222;">
  ${textToHtml(bodyText)}
</div>
${buildFooterHtml(cfg, supabaseUrl)}`.trim();
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(supabaseUrl, serviceKey);

    // Verify JWT via Supabase Auth API - immune to "legacy secret" toggle
    const { data: { user }, error: authErr } = await supa.auth.getUser(jwt);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    // Load SMTP settings - filtered by the requesting user
    const { data: cfg, error: cfgErr } = await supa
      .from("smtp_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (cfgErr || !cfg) throw new Error("Impostazioni SMTP non trovate nel database");
    if (!cfg.host || !cfg.user_email || !cfg.password) {
      throw new Error("Configurazione SMTP incompleta (host, user_email, password obbligatori)");
    }

    const payload = await req.json();
    const to = normalizeString(payload?.to);
    const subject = typeof payload?.subject === "string" ? payload.subject : "";
    const body = typeof payload?.body === "string" ? payload.body : "";
    const inReplyTo = normalizeString(payload?.inReplyTo);
    const threadId = normalizeString(payload?.threadId);
    const includeFooter = payload?.includeFooter === true;

    if (!to) throw new Error("Destinatario (to) obbligatorio");
    if (!body.trim()) throw new Error("Corpo del messaggio obbligatorio");

    let htmlBody: string | null = null;
    if (includeFooter) {
      const missingFields = [
        !normalizeString(cfg.footer_company_name) ? "ragione sociale" : "",
        !normalizeString(cfg.footer_address) ? "indirizzo" : "",
        !normalizeString(cfg.footer_vat_number) ? "partita IVA" : "",
      ].filter(Boolean);

      if (missingFields.length > 0) {
        throw new Error(`Footer email incompleto. Compila: ${missingFields.join(", ")}.`);
      }

      htmlBody = buildHtmlBody(body, cfg, supabaseUrl);
    }

    const smtpPort = cfg.porta || 587;
    // deno-lint-ignore no-explicit-any
    const transporter = (nodemailer as any).createTransport({
      host: cfg.host,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: cfg.user_email, pass: cfg.password },
    });

    const newMessageId = `<crm-${Date.now()}-${Math.random().toString(36).slice(2)}@${cfg.host}>`;

    await transporter.sendMail({
      from: cfg.user_email,
      to,
      subject,
      text: body,
      ...(htmlBody ? { html: htmlBody } : {}),
      messageId: newMessageId,
      ...(inReplyTo ? {
        inReplyTo: `<${inReplyTo.replace(/[<>]/g, "")}>`,
        references: `<${inReplyTo.replace(/[<>]/g, "")}>`,
      } : {}),
    });

    // Save sent email to DB so it appears in "Inviata"
    await supa.from("emails").insert({
      message_id: newMessageId,
      thread_id: threadId || inReplyTo || newMessageId,
      from_name: "",
      from_email: cfg.user_email,
      to,
      subject,
      date: new Date().toISOString(),
      folder: "SENT",
      read: true,
      text_body: body,
      html_body: htmlBody,
      in_reply_to: inReplyTo || null,
      user_id: userId,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[smtp-send]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
