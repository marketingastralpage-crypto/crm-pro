/**
 * Supabase Edge Function: imap-fetch
 * Reads emails from IMAP and upserts into `emails`. Supports batch pagination
 * for full-mailbox sync via `offset` + `batch_size` params.
 *
 * Body params:
 *   folder     (string)  "INBOX" | "SENT"  — default "INBOX"
 *   offset     (number)  how many messages from the end to skip — default 0
 *   batch_size (number)  messages per call — default 50, max 100
 *   job_id     (string)  UUID of email_sync_jobs row — optional, updates progress
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1";
import { simpleParser } from "npm:mailparser@3";

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

    // Verify JWT — immune to "legacy secret" toggle
    const { data: { user }, error: authErr } = await supa.auth.getUser(jwt);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    // Load IMAP/SMTP settings
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
    const folder: string    = body.folder     || "INBOX";
    const offset: number    = Math.max(0, Number(body.offset) || 0);
    const batchSize: number = Math.min(Math.max(1, Number(body.batch_size) || 50), 100);
    const jobId: string | null = body.job_id || null;

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
    let total = 0;
    const lock = await client.getMailboxLock(folder);

    try {
      // deno-lint-ignore no-explicit-any
      const status: any = await client.status(folder, { messages: true });
      total = status.messages ?? 0;

      if (total > 0 && offset < total) {
        // Sequence range: count backwards from newest by `offset`, fetch `batchSize`
        const rangeEnd   = total - offset;
        const rangeStart = Math.max(1, rangeEnd - batchSize + 1);

        for await (const msg of client.fetch(`${rangeStart}:${rangeEnd}`, {
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
      // Upsert WITHOUT read column so we never overwrite locally-read state
      const emailsToUpsert = emails.map(({ read: _read, ...rest }) => ({ ...rest, user_id: userId }));

      const { error: upsertErr } = await supa
        .from("emails")
        .upsert(emailsToUpsert, { onConflict: "user_id,message_id", ignoreDuplicates: false });
      if (upsertErr) throw new Error("Errore salvataggio email: " + upsertErr.message);
      upserted = emails.length;

      // Propagate \\Seen flag (false→true only, never overwrite local true→false)
      const seenIds = emails.filter(e => e.read).map(e => e.message_id);
      if (seenIds.length > 0) {
        await supa.from("emails").update({ read: true }).eq("user_id", userId).in("message_id", seenIds);
      }
    }

    // `done` is true when this batch reaches the oldest messages
    const rangeStart = Math.max(1, total - offset - batchSize + 1);
    const done = total === 0 || offset >= total || rangeStart === 1;

    // Update job progress if a job_id was provided
    if (jobId) {
      const newSynced = offset + upserted;
      const jobUpdate: Record<string, unknown> = {
        synced_messages: newSynced,
        total_messages: total,
        updated_at: new Date().toISOString(),
      };
      if (done) {
        jobUpdate.status = "completed";
        jobUpdate.completed_at = new Date().toISOString();
      }
      await supa.from("email_sync_jobs").update(jobUpdate).eq("id", jobId).eq("user_id", userId);
    }

    return new Response(JSON.stringify({ ok: true, count: upserted, total, offset, done }), {
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
