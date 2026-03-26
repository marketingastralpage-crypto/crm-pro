// send-push — Edge Function
// Finds all due push_queue entries and delivers them via Web Push.
// Called on every app load (from client) AND can be scheduled via pg_cron.

import webpush from "npm:web-push@3";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL            = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY        = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY       = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT           = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@astralpage.it";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fetch notifications due now (fire_at <= now, not yet sent)
  const now = new Date().toISOString();
  const { data: queue, error: qErr } = await admin
    .from("push_queue")
    .select("id, user_id, title, body")
    .lte("fire_at", now)
    .eq("sent", false)
    .limit(100);

  if (qErr) return new Response(JSON.stringify({ error: qErr.message }), { status: 500, headers: cors });
  if (!queue || queue.length === 0) return new Response(JSON.stringify({ sent: 0 }), { headers: cors });

  // Group by user to batch subscription lookups
  const userIds = [...new Set(queue.map((n: any) => n.user_id))];
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  const subsByUser: Record<string, any[]> = {};
  for (const s of subs || []) {
    (subsByUser[s.user_id] ||= []).push(s);
  }

  const expiredEndpoints: string[] = [];
  let sent = 0;

  for (const item of queue) {
    const userSubs = subsByUser[item.user_id] || [];
    for (const sub of userSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: item.title, body: item.body, tag: item.id })
        );
        sent++;
      } catch (e: any) {
        // 410 = subscription expired/unsubscribed
        if (e.statusCode === 410 || e.statusCode === 404) {
          expiredEndpoints.push(sub.endpoint);
        }
      }
    }
    // Mark as sent regardless (to avoid re-trying indefinitely)
    await admin.from("push_queue").update({ sent: true }).eq("id", item.id);
  }

  // Clean up expired subscriptions
  if (expiredEndpoints.length > 0) {
    await admin.from("push_subscriptions").delete().in("endpoint", expiredEndpoints);
  }

  return new Response(JSON.stringify({ sent, expired: expiredEndpoints.length }), { headers: cors });
});
