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

// deno-lint-ignore no-explicit-any
function buildImapClient(cfg: Record<string, any>): ImapFlow {
  const imapPort = Number(cfg.imap_porta) || 993;
  const isSecureMail = typeof cfg.imap_host === "string" &&
    cfg.imap_host.includes("securemail.pro");

  // deno-lint-ignore no-explicit-any
  const options: Record<string, any> = {
    host: cfg.imap_host,
    port: imapPort,
    secure: imapPort === 993,
    auth: {
      user: cfg.user_email,
      pass: cfg.password,
      ...(isSecureMail ? { loginMethod: "AUTH=LOGIN" } : {}),
    },
    logger: false,
    tls: {
      rejectUnauthorized: false,
      ...(isSecureMail ? { servername: cfg.imap_host } : {}),
    },
    connectionTimeout: isSecureMail ? 30000 : 15000,
    greetingTimeout:   isSecureMail ? 30000 : 15000,
    socketTimeout:     isSecureMail ? 60000 : 30000,
  };

  if (isSecureMail) {
    options.disableCompression = true;
    options.disableAutoEnable  = true;
    options.disableBinary      = true;
  }

  return new ImapFlow(options);
}

function serializeImapError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    // deno-lint-ignore no-explicit-any
    const e = err as any;
    return {
      message:        e.message        ?? null,
      code:           e.code           ?? null,
      responseText:   e.responseText   ?? null,
      responseStatus: e.responseStatus ?? null,
      stack:          e.stack          ?? null,
    };
  }
  return { message: String(err) };
}

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
    const logicalFolder: string = body.folder || "INBOX";
    const offset: number    = Math.max(0, Number(body.offset) || 0);
    const batchSize: number = Math.min(Math.max(1, Number(body.batch_size) || 50), 100);
    const jobId: string | null = body.job_id || null;

    // Map logical folder name to actual IMAP folder name on the server.
    // "INBOX" is standard; "SENT" varies by provider (Gmail, Outlook, etc.)
    const realFolder = logicalFolder === "SENT"
      ? (cfg.imap_sent_folder || "Sent")
      : logicalFolder;

    const client = buildImapClient(cfg);

    await client.connect();

    // deno-lint-ignore no-explicit-any
    const emails: Record<string, any>[] = [];
    let total = 0;

    try {
      const lock = await client.getMailboxLock(realFolder, { readOnly: true });
      try {
        // mailbox.exists è popolato da getMailboxLock — evita un round-trip STATUS aggiuntivo
        total = client.mailbox?.exists ?? 0;

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
                folder:      logicalFolder,   // always use logical name in DB ("INBOX"/"SENT")
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
    } finally {
      await client.logout().catch(() => {});
    }

    let upserted = 0;
    if (emails.length > 0) {
      // Upsert WITHOUT read column so we never overwrite locally-read state
      const emailsToUpsert = emails.map(({ read: _read, ...rest }) => ({ ...rest, user_id: userId }));

      const { error: upsertErr } = await supa
        .from("emails")
        .upsert(emailsToUpsert, { onConflict: "user_id,message_id", ignoreDuplicates: true });
      if (upsertErr) throw new Error("Errore salvataggio email: " + upsertErr.message);
      upserted = emails.length;

      // Propagate \\Seen flag (false→true only, never overwrite local true→false)
      const seenIds = emails.filter(e => e.read).map(e => e.message_id);
      if (seenIds.length > 0) {
        await supa.from("emails").update({ read: true }).eq("user_id", userId).in("message_id", seenIds);
      }
    }

    // `done` is true when this batch reaches the oldest messages
    const rangeEnd2  = total - offset;
    const rangeStart = Math.max(1, rangeEnd2 - batchSize + 1);
    const attempted  = (total > 0 && offset < total) ? (rangeEnd2 - rangeStart + 1) : 0;
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

    return new Response(JSON.stringify({ ok: true, count: upserted, attempted, total, offset, done }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const errObj = serializeImapError(e);
    console.error("[imap-fetch]", JSON.stringify(errObj));
    // Return 200 so the Supabase client passes the body through (non-2xx swallows the message)
    return new Response(JSON.stringify({ error: errObj.message, detail: errObj }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
