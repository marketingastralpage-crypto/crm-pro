/**
 * Supabase Edge Function: smtp-send
 * Sends a reply email via the configured SMTP server and saves it to the `emails` table.
 *
 * Expected JSON body:
 *   { to, subject, body, inReplyTo?, threadId? }
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(supabaseUrl, serviceKey);

    // Verify JWT via Supabase Auth API — immune to "legacy secret" toggle
    const { data: { user }, error: authErr } = await supa.auth.getUser(jwt);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    // Load SMTP settings — filtered by the requesting user
    const { data: cfg, error: cfgErr } = await supa
      .from("smtp_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (cfgErr || !cfg) throw new Error("Impostazioni SMTP non trovate nel database");
    if (!cfg.host || !cfg.user_email || !cfg.password) {
      throw new Error("Configurazione SMTP incompleta (host, user_email, password obbligatori)");
    }

    const { to, subject, body, inReplyTo, threadId } = await req.json();
    if (!to)   throw new Error("Destinatario (to) obbligatorio");
    if (!body) throw new Error("Corpo del messaggio obbligatorio");

    const smtpPort = cfg.porta || 587;
    // deno-lint-ignore no-explicit-any
    const transporter = (nodemailer as any).createTransport({
      host:   cfg.host,
      port:   smtpPort,
      secure: smtpPort === 465,
      auth:   { user: cfg.user_email, pass: cfg.password },
    });

    const newMessageId = `<crm-${Date.now()}-${Math.random().toString(36).slice(2)}@${cfg.host}>`;

    await transporter.sendMail({
      from:    cfg.user_email,
      to,
      subject,
      text:    body,
      messageId: newMessageId,
      ...(inReplyTo ? {
        inReplyTo:  `<${inReplyTo.replace(/[<>]/g, "")}>`,
        references: `<${inReplyTo.replace(/[<>]/g, "")}>`,
      } : {}),
    });

    // Save sent email to DB so it appears in "Inviata"
    await supa.from("emails").insert({
      message_id:  newMessageId,
      thread_id:   threadId || inReplyTo || newMessageId,
      from_name:   "",
      from_email:  cfg.user_email,
      to,
      subject,
      date:        new Date().toISOString(),
      folder:      "SENT",
      read:        true,
      text_body:   body,
      in_reply_to: inReplyTo || null,
      user_id:     userId,
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
