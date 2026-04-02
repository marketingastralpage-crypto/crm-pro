/**
 * Supabase Edge Function: imap-action
 * Performs IMAP operations on a specific email message.
 *
 * Body params:
 *   email_id  (string)  UUID of the email row in DB
 *   action    (string)  one of: mark_read | mark_unread | star | unstar | archive | trash | spam
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1";

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

    const body = await req.json().catch(() => ({}));
    const emailId: string = body.email_id || "";
    const action:  string = body.action   || "";

    if (!emailId || !action) throw new Error("email_id e action sono obbligatori");

    // Load email row from DB
    const { data: email, error: emailErr } = await supa
      .from("emails")
      .select("id, message_id, folder")
      .eq("id", emailId)
      .eq("user_id", userId)
      .maybeSingle();

    if (emailErr || !email) throw new Error("Email non trovata");

    // Load IMAP/SMTP settings
    const { data: cfg, error: cfgErr } = await supa
      .from("smtp_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (cfgErr || !cfg) throw new Error("Impostazioni IMAP non trovate");
    if (!cfg.imap_host || !cfg.user_email || !cfg.password) {
      throw new Error("Configurazione IMAP incompleta");
    }

    // Map logical DB folder → real IMAP folder name
    const folderMap: Record<string, string> = {
      INBOX:   "INBOX",
      SENT:    cfg.imap_sent_folder    || "Sent",
      ARCHIVE: cfg.imap_archive_folder || "Archive",
      TRASH:   cfg.imap_trash_folder   || "Trash",
      SPAM:    cfg.imap_spam_folder    || "Junk",
    };
    const sourceImapFolder = folderMap[email.folder] || "INBOX";

    const imapPort = Number(cfg.imap_porta) || 993;
    const client = new ImapFlow({
      host: cfg.imap_host,
      port: imapPort,
      secure: imapPort === 993,
      auth: { user: cfg.user_email, pass: cfg.password },
      logger: false,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 20000,
    });

    await client.connect();
    let imapOk = false;

    try {
      const lock = await client.getMailboxLock(sourceImapFolder);
      try {
        // Search for the message by Message-ID header (strip angle brackets for search)
        const rawMsgId = (email.message_id || "").replace(/^<|>$/g, "");
        // deno-lint-ignore no-explicit-any
        const uids: number[] = (await (client as any).search(
          { header: { "message-id": rawMsgId } },
          { uid: true }
        )) as number[];

        if (uids.length > 0) {
          const uidStr = uids.join(",");

          if (action === "mark_read") {
            // deno-lint-ignore no-explicit-any
            await (client as any).messageFlagsAdd(uidStr, ["\\Seen"], { uid: true });
            imapOk = true;
          } else if (action === "mark_unread") {
            // deno-lint-ignore no-explicit-any
            await (client as any).messageFlagsRemove(uidStr, ["\\Seen"], { uid: true });
            imapOk = true;
          } else if (action === "star") {
            // deno-lint-ignore no-explicit-any
            await (client as any).messageFlagsAdd(uidStr, ["\\Flagged"], { uid: true });
            imapOk = true;
          } else if (action === "unstar") {
            // deno-lint-ignore no-explicit-any
            await (client as any).messageFlagsRemove(uidStr, ["\\Flagged"], { uid: true });
            imapOk = true;
          } else if (action === "archive") {
            const dest = cfg.imap_archive_folder || "Archive";
            // deno-lint-ignore no-explicit-any
            await (client as any).messageMove(uidStr, dest, { uid: true });
            imapOk = true;
          } else if (action === "trash") {
            const dest = cfg.imap_trash_folder || "Trash";
            // deno-lint-ignore no-explicit-any
            await (client as any).messageMove(uidStr, dest, { uid: true });
            imapOk = true;
          } else if (action === "spam") {
            const dest = cfg.imap_spam_folder || "Junk";
            // deno-lint-ignore no-explicit-any
            await (client as any).messageMove(uidStr, dest, { uid: true });
            imapOk = true;
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, imap_ok: imapOk }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[imap-action]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
