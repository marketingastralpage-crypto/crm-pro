import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

// ─── helpers ────────────────────────────────────────────────────────────────

function getEnv(key: string): string {
  const val = Deno.env.get(key);
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

// Decode base64url (JWT uses base64url, not standard base64)
function decodeBase64Url(str: string): string {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
  return atob(padded);
}

async function getValidAccessToken(userId: string, supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: token, error } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !token) throw new Error('NOT_CONNECTED');

  // Still valid (with 60s buffer)
  const expiresAt = Number(token.expires_at);
  if (Date.now() < (expiresAt - 60_000)) return token.access_token;

  // Refresh
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getEnv('GOOGLE_CLIENT_ID'),
      client_secret: getEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const refreshed = await res.json();
  if (!res.ok || !refreshed.access_token) {
    throw new Error(`REFRESH_FAILED: ${JSON.stringify(refreshed)}`);
  }

  await supabase.from('google_calendar_tokens').update({
    access_token: refreshed.access_token,
    expires_at: Date.now() + refreshed.expires_in * 1000,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);

  return refreshed.access_token;
}

// ─── action handlers ─────────────────────────────────────────────────────────

async function handleExchangeToken(body: Record<string, string>, userId: string, supabase: ReturnType<typeof createClient>) {
  const { code, redirect_uri } = body;
  if (!code || !redirect_uri) return { error: 'Missing code or redirect_uri' };

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: getEnv('GOOGLE_CLIENT_ID'),
      client_secret: getEnv('GOOGLE_CLIENT_SECRET'),
      redirect_uri,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await res.json();
  if (!res.ok || !tokens.access_token) return { error: tokens.error_description || 'Token exchange failed' };

  const { error: upsertError } = await supabase.from('google_calendar_tokens').upsert({
    user_id: userId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (upsertError) return { error: `DB error: ${upsertError.message}` };

  return { success: true };
}

async function handleGetStatus(userId: string, supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from('google_calendar_tokens')
    .select('id')
    .eq('user_id', userId)
    .single();
  return { connected: !!data };
}

async function handleGetEvents(userId: string, supabase: ReturnType<typeof createClient>) {
  const timeMin = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

  // Always load local-only events (created in app, not synced to Google)
  const { data: localEvents } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .is('google_event_id', null)
    .gte('start_time', timeMin)
    .lte('start_time', timeMax);

  // Try to fetch Google Calendar events
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId, supabase);
  } catch {
    // Not connected or token invalid — return only local events
    return { connected: false, events: localEvents || [] };
  }

  const res = await fetch(
    `${GOOGLE_CALENDAR_BASE}/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=250`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    // Google API failed — still return local events
    const errBody = await res.text();
    console.error(`Google Calendar get_events failed: ${res.status} ${errBody}`);
    return { connected: true, events: localEvents || [], google_error: `${res.status}: ${errBody}` };
  }

  const gcal = await res.json();

  const googleEvents = (gcal.items || []).map((item: Record<string, unknown>) => {
    const start = item.start as Record<string, string> | undefined;
    const end = item.end as Record<string, string> | undefined;
    return {
      id: item.id, // use google event id as the local id for display
      google_event_id: item.id,
      title: item.summary || '(senza titolo)',
      start_time: start?.dateTime || start?.date,
      end_time: end?.dateTime || end?.date,
      color: null, // colorId is a number, not hex — ignore for display
      notes: item.description || null,
      guests: ((item.attendees as Array<{ email: string }>) || []).map((a) => a.email),
    };
  });

  // Merge: Google events + local-only events
  const allEvents = [...googleEvents, ...(localEvents || [])];
  return { connected: true, events: allEvents };
}

async function handleCreateEvent(body: Record<string, unknown>, userId: string, supabase: ReturnType<typeof createClient>) {
  const { title, start_time, end_time, guests, color, notes, contact_id } = body as {
    title: string;
    start_time: string;
    end_time?: string;
    guests?: string[];
    color?: string;
    notes?: string;
    contact_id?: string;
  };

  if (!title || !start_time) return { error: 'Missing title or start_time' };

  let googleEventId: string | null = null;
  let googleError: string | null = null;

  // Try to create in Google Calendar if connected
  try {
    const accessToken = await getValidAccessToken(userId, supabase);

    const endDT = end_time || new Date(new Date(start_time).getTime() + 3600000).toISOString();

    const gcalEvent: Record<string, unknown> = {
      summary: title,
      start: { dateTime: start_time, timeZone: 'Europe/Rome' },
      end: { dateTime: endDT, timeZone: 'Europe/Rome' },
    };
    if (notes) gcalEvent.description = notes;
    if (guests && guests.length > 0) {
      gcalEvent.attendees = guests.map((email: string) => ({ email }));
    }

    const res = await fetch(`${GOOGLE_CALENDAR_BASE}/calendars/primary/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(gcalEvent),
    });

    if (res.ok) {
      const created = await res.json();
      googleEventId = created.id;
    } else {
      const errBody = await res.text();
      googleError = `Google API ${res.status}: ${errBody}`;
      console.error('Google Calendar create_event failed:', googleError);
    }
  } catch (e) {
    googleError = e instanceof Error ? e.message : String(e);
    console.error('Google Calendar create_event exception:', googleError);
  }

  // Save to local DB
  const { data, error } = await supabase.from('calendar_events').insert({
    user_id: userId,
    google_event_id: googleEventId,
    title,
    start_time,
    end_time: end_time || null,
    guests: guests || [],
    color: color || '#7c5ef0',
    notes: notes || null,
    contact_id: contact_id || null,
  }).select().single();

  if (error) return { error: `DB insert failed: ${error.message}` };

  return {
    success: true,
    event: data,
    synced_to_google: !!googleEventId,
    google_error: googleError, // exposed for debugging — null when sync succeeded
  };
}

async function handleUpdateEvent(body: Record<string, unknown>, userId: string, supabase: ReturnType<typeof createClient>) {
  const { event_id, google_event_id, title, start_time, end_time, guests, color, notes } = body as {
    event_id?: string;
    google_event_id?: string;
    title: string;
    start_time: string;
    end_time?: string;
    guests?: string[];
    color?: string;
    notes?: string;
  };

  if (!title || !start_time) return { error: 'Missing title or start_time' };

  let gEventId = google_event_id;
  let googleError: string | null = null;

  // Look up google_event_id from local DB if not provided
  if (event_id && !gEventId) {
    const { data } = await supabase.from('calendar_events').select('google_event_id').eq('id', event_id).eq('user_id', userId).single();
    if (data?.google_event_id) gEventId = data.google_event_id;
  }

  // Update in Google Calendar
  if (gEventId) {
    try {
      const accessToken = await getValidAccessToken(userId, supabase);
      const endDT = end_time || new Date(new Date(start_time).getTime() + 3600000).toISOString();
      const gcalEvent: Record<string, unknown> = {
        summary: title,
        start: { dateTime: start_time, timeZone: 'Europe/Rome' },
        end: { dateTime: endDT, timeZone: 'Europe/Rome' },
      };
      if (notes) gcalEvent.description = notes;
      if (guests && guests.length > 0) gcalEvent.attendees = guests.map((email: string) => ({ email }));

      const res = await fetch(`${GOOGLE_CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(gEventId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(gcalEvent),
      });

      if (!res.ok) {
        const errBody = await res.text();
        googleError = `Google API ${res.status}: ${errBody}`;
        console.error('Google Calendar update_event failed:', googleError);
      }
    } catch (e) {
      googleError = e instanceof Error ? e.message : String(e);
      console.error('Google Calendar update_event exception:', googleError);
    }
  }

  // Update local DB record (if local event_id provided)
  if (event_id) {
    const { error } = await supabase.from('calendar_events').update({
      title, start_time, end_time: end_time || null,
      guests: guests || [], color: color || '#7c5ef0',
      notes: notes || null, updated_at: new Date().toISOString(),
    }).eq('id', event_id).eq('user_id', userId);
    if (error) return { error: `DB update failed: ${error.message}` };
  }

  return { success: true, google_error: googleError };
}

async function handleDeleteEvent(body: Record<string, unknown>, userId: string, supabase: ReturnType<typeof createClient>) {
  const { event_id, google_event_id } = body as { event_id?: string; google_event_id?: string };

  if (!event_id && !google_event_id) return { error: 'Missing event_id or google_event_id' };

  let gEventId = google_event_id;
  let googleError: string | null = null;

  // Look up google_event_id from DB if not provided
  if (event_id && !gEventId) {
    const { data } = await supabase.from('calendar_events').select('google_event_id').eq('id', event_id).eq('user_id', userId).single();
    if (data?.google_event_id) gEventId = data.google_event_id;
  }

  // Delete from Google Calendar
  if (gEventId) {
    try {
      const accessToken = await getValidAccessToken(userId, supabase);
      const res = await fetch(`${GOOGLE_CALENDAR_BASE}/calendars/primary/events/${encodeURIComponent(gEventId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok && res.status !== 410) { // 410 = already deleted
        const errBody = await res.text();
        googleError = `Google API ${res.status}: ${errBody}`;
        console.error('Google Calendar delete_event failed:', googleError);
      }
    } catch (e) {
      googleError = e instanceof Error ? e.message : String(e);
      console.error('Google Calendar delete_event exception:', googleError);
    }
  }

  // Delete from local DB
  if (event_id) {
    const { error } = await supabase.from('calendar_events').delete().eq('id', event_id).eq('user_id', userId);
    if (error) return { error: `DB delete failed: ${error.message}` };
  }

  return { success: true, google_error: googleError };
}

async function handleDisconnect(userId: string, supabase: ReturnType<typeof createClient>) {
  try {
    const { data: token } = await supabase
      .from('google_calendar_tokens')
      .select('access_token')
      .eq('user_id', userId)
      .single();
    if (token?.access_token) {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${token.access_token}`, { method: 'POST' });
    }
  } catch { /* ignore revoke errors */ }

  await supabase.from('google_calendar_tokens').delete().eq('user_id', userId);
  return { success: true };
}

// ─── main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace('Bearer ', '');

    let userId: string;
    try {
      const payload = JSON.parse(decodeBase64Url(jwt.split('.')[1]));
      if (!payload?.sub) throw new Error('no sub');
      userId = payload.sub;
    } catch {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      getEnv('SUPABASE_URL'),
      getEnv('SUPABASE_SERVICE_ROLE_KEY')
    );

    const body = await req.json();
    const { action, ...params } = body;

    let result: Record<string, unknown>;

    switch (action) {
      case 'exchange_token':
        result = await handleExchangeToken(params as Record<string, string>, userId, supabase);
        break;
      case 'get_status':
        result = await handleGetStatus(userId, supabase);
        break;
      case 'get_events':
        result = await handleGetEvents(userId, supabase);
        break;
      case 'create_event':
        result = await handleCreateEvent(params as Record<string, unknown>, userId, supabase);
        break;
      case 'update_event':
        result = await handleUpdateEvent(params as Record<string, unknown>, userId, supabase);
        break;
      case 'delete_event':
        result = await handleDeleteEvent(params as Record<string, unknown>, userId, supabase);
        break;
      case 'disconnect':
        result = await handleDisconnect(userId, supabase);
        break;
      default:
        result = { error: `Unknown action: ${action}` };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('Edge function unhandled error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
