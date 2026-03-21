/**
 * Supabase Edge Function: imap-fetch
 * Reads emails from the configured IMAP server and upserts them into the `emails` table.
 *
 * Required Supabase table (run once in SQL Editor):
 *
 *   CREATE TABLE emails (
 *     id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
 *     message_id   TEXT        UNIQUE,
 *     thread_id    TEXT,
 *     from_name    TEXT,
 *     from_email   TEXT,
 *     "to"         TEXT,
 *     subject      TEXT,
 *     date         TIMESTAMPTZ,
 *     folder       TEXT        DEFAULT 'INBOX',
 *     read         BOOLEAN     DEFAULT FALSE,
 *     text_body    TEXT,
 *     html_body    TEXT,
 *     in_reply_to  TEXT,
 *     created_at   TIMESTAMPTZ DEFAULT NOW()
 *   );
 *   CREATE INDEX ON emails (folder, date DESC);
 *   CREATE INDEX ON emails (thread_id);
 *   CREATE INDEX ON emails (message_id);
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1";
import { simpleParser } from "npm:mailparser@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function decodeBase64Url(s: string): string {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Extract userId from JWT
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    let userId: string;
    try {
      const payload = JSON.parse(decodeBase64Url(jwt.split(".")[1]));
      if (!payload?.sub) throw new Error("no sub");
      userId = payload.sub;
    } catch {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(supabaseUrl, serviceKey);

    // Load IMAP/SMTP settings from DB — filtered by the requesting user
    const { data: cfg, error: cfgErr } = await supa
      .from("smtp_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (cfgErr || !cfg) throw new Error("Impostazioni IMAP non trovate nel database");
    if (!cfg.imap_host || !cfg.user_email || !cfg.password) {
      throw new Error("Configurazione IMAP incompleta (imap_host, user_email, password obbligatori)");
    }

    const body = await req.json().catch(() => ({}));
    const folder: string = body.folder || "INBOX";

    const imapPort = cfg.imap_porta || 993;
    const client = new ImapFlow({
      host: cfg.imap_host,
      port: imapPort,
      secure: imapPort === 993,
      auth: { user: cfg.user_email, pass: cfg.password },
      logger: false,
    });

    await client.connect();

    // deno-lint-ignore no-explicit-any
    const emails: Record<string, any>[] = [];
    const lock = await client.getMailboxLock(folder);

    try {
      // deno-lint-ignore no-explicit-any
      const status: any = await client.status(folder, { messages: true });
      const total: number = status.messages ?? 0;

      if (total > 0) {
        const rangeStart = Math.max(1, total - 29); // fetch last 30 messages
        for await (const msg of client.fetch(`${rangeStart}:${total}`, {
          envelope: true,
          source: true,
          flags: true,
        })) {
          try {
            // deno-lint-ignore no-explicit-any
            const parsed = await simpleParser(msg.source as any);
            const fromAddr = parsed.from?.value?.[0];
            const inReplyTo = parsed.inReplyTo || null;
            const msgId = parsed.messageId ||
              `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            emails.push({
              message_id:  msgId,
              thread_id:   inReplyTo || msgId,
              from_name:   fromAddr?.name  || "",
              from_email:  fromAddr?.address || "",
              to:          parsed.to?.text  || "",
              subject:     parsed.subject   || "",
              date:        (parsed.date || new Date()).toISOString(),
              folder,
              // deno-lint-ignore no-explicit-any
              read:        (msg.flags as any as Set<string>).has("\\Seen"),
              text_body:   (parsed.text || "").slice(0, 8000),
              html_body:   (parsed.html  || "").slice(0, 50000),
              in_reply_to: inReplyTo,
            });
          } catch (_) {
            // skip malformed messages silently
          }
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();

    let upserted = 0;
    if (emails.length > 0) {
      // Upsert email content WITHOUT the read column so we never overwrite
      // a locally-marked-read email back to false. New rows get read=false by default.
      const emailsToUpsert = emails.map(({ read: _read, ...rest }) => ({ ...rest, user_id: userId }));

      const { error: upsertErr } = await supa
        .from("emails")
        .upsert(emailsToUpsert, { onConflict: "user_id,message_id", ignoreDuplicates: false });
      if (upsertErr) throw new Error("Errore salvataggio email: " + upsertErr.message);
      upserted = emails.length;

      // If IMAP reports \\Seen, propagate that to the DB (false→true only, never true→false)
      const seenIds = emails.filter(e => e.read).map(e => e.message_id);
      if (seenIds.length > 0) {
        await supa.from("emails").update({ read: true }).eq("user_id", userId).in("message_id", seenIds);
      }
    }

    return new Response(JSON.stringify({ ok: true, count: upserted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[imap-fetch]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
