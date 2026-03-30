import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0/me';

// ─── helpers ────────────────────────────────────────────────────────────────

function getEnv(key: string): string {
  const val = Deno.env.get(key);
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

async function getValidAccessToken(userId: string, supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: token, error } = await supabase
    .from('outlook_calendar_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !token) throw new Error('NOT_CONNECTED');

  // Still valid (with 60s buffer)
  const expiresAt = Number(token.expires_at);
  if (Date.now() < (expiresAt - 60_000)) return token.access_token;

  // Refresh
  const res = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getEnv('MICROSOFT_CLIENT_ID'),
      client_secret: getEnv('MICROSOFT_CLIENT_SECRET'),
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
      scope: 'Calendars.ReadWrite offline_access',
    }),
  });

  const refreshed = await res.json();
  if (!res.ok || !refreshed.access_token) {
    throw new Error(`REFRESH_FAILED: ${JSON.stringify(refreshed)}`);
  }

  await supabase.from('outlook_calendar_tokens').update({
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

  const res = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: getEnv('MICROSOFT_CLIENT_ID'),
      client_secret: getEnv('MICROSOFT_CLIENT_SECRET'),
      redirect_uri,
      grant_type: 'authorization_code',
      scope: 'Calendars.ReadWrite offline_access',
    }),
  });

  const tokens = await res.json();
  if (!res.ok || !tokens.access_token) return { error: tokens.error_description || 'Token exchange failed' };

  const { error: upsertError } = await supabase.from('outlook_calendar_tokens').upsert({
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
    .from('outlook_calendar_tokens')
    .select('id')
    .eq('user_id', userId)
    .single();
  return { connected: !!data };
}

async function handleGetEvents(userId: string, supabase: ReturnType<typeof createClient>) {
  const timeMin = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

  // Always load local-only events (not synced to any external calendar)
  const { data: localEvents } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .is('outlook_event_id', null)
    .is('google_event_id', null)
    .gte('start_time', timeMin)
    .lte('start_time', timeMax);

  // Try to fetch Outlook Calendar events
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(userId, supabase);
  } catch {
    return { connected: false, events: localEvents || [] };
  }

  const res = await fetch(
    `${GRAPH_BASE}/calendarView?startDateTime=${encodeURIComponent(timeMin)}&endDateTime=${encodeURIComponent(timeMax)}&$top=250&$orderby=start/dateTime`,
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`Outlook Calendar get_events failed: ${res.status} ${errBody}`);
    return { connected: true, events: localEvents || [], outlook_error: `${res.status}: ${errBody}` };
  }

  const graph = await res.json();

  const outlookEvents = (graph.value || []).map((item: Record<string, unknown>) => {
    const start = item.start as Record<string, string> | undefined;
    const end = item.end as Record<string, string> | undefined;
    const attendees = (item.attendees as Array<{ emailAddress: { address: string } }>) || [];
    const onlineMeeting = item.onlineMeeting as Record<string, string> | undefined;
    // Graph returns dateTime in local time without timezone — append Z only if no offset present
    const toISO = (dt?: string) => dt ? (dt.endsWith('Z') || dt.includes('+') ? dt : dt + 'Z') : null;
    return {
      id: item.id,
      outlook_event_id: item.id,
      title: (item.subject as string) || '(senza titolo)',
      start_time: toISO(start?.dateTime),
      end_time: toISO(end?.dateTime),
      color: null,
      notes: (item.body as Record<string, string>)?.content || null,
      guests: attendees.map((a) => a.emailAddress?.address).filter(Boolean),
      meet_link: onlineMeeting?.joinUrl || null,
    };
  });

  const allEvents = [...outlookEvents, ...(localEvents || [])];
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

  let outlookEventId: string | null = null;
  let outlookError: string | null = null;
  let meetLink: string | null = null;

  const isAllDay = !start_time.includes('T');

  try {
    const accessToken = await getValidAccessToken(userId, supabase);
    const endDT = end_time || new Date(new Date(start_time).getTime() + 3600000).toISOString();

    const graphEvent: Record<string, unknown> = {
      subject: title,
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    };

    if (isAllDay) {
      graphEvent.isAllDay = true;
      graphEvent.start = { dateTime: start_time + 'T00:00:00', timeZone: 'Europe/Rome' };
      graphEvent.end = { dateTime: (end_time || start_time) + 'T00:00:00', timeZone: 'Europe/Rome' };
    } else {
      graphEvent.start = { dateTime: start_time, timeZone: 'Europe/Rome' };
      graphEvent.end = { dateTime: endDT, timeZone: 'Europe/Rome' };
    }

    if (notes) graphEvent.body = { contentType: 'text', content: notes };
    if (guests && guests.length > 0) {
      graphEvent.attendees = guests.map((email: string) => ({
        emailAddress: { address: email },
        type: 'required',
      }));
    }

    const res = await fetch(`${GRAPH_BASE}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphEvent),
    });

    if (res.ok) {
      const created = await res.json();
      outlookEventId = created.id;
      meetLink = (created.onlineMeeting as Record<string, string>)?.joinUrl || null;
    } else {
      const errBody = await res.text();
      outlookError = `Outlook API ${res.status}: ${errBody}`;
      console.error('Outlook Calendar create_event failed:', outlookError);
    }
  } catch (e) {
    outlookError = e instanceof Error ? e.message : String(e);
    console.error('Outlook Calendar create_event exception:', outlookError);
  }

  // Save to local DB
  const { data, error } = await supabase.from('calendar_events').insert({
    user_id: userId,
    outlook_event_id: outlookEventId,
    title,
    start_time,
    end_time: end_time || null,
    guests: guests || [],
    color: color || '#7c5ef0',
    notes: notes || null,
    contact_id: contact_id || null,
    meet_link: meetLink,
  }).select().single();

  if (error) return { error: `DB insert failed: ${error.message}` };

  return {
    success: true,
    event: data,
    meet_link: meetLink,
    synced_to_outlook: !!outlookEventId,
    outlook_error: outlookError,
  };
}

async function handleUpdateEvent(body: Record<string, unknown>, userId: string, supabase: ReturnType<typeof createClient>) {
  const { event_id, outlook_event_id, title, start_time, end_time, guests, color, notes } = body as {
    event_id?: string;
    outlook_event_id?: string;
    title: string;
    start_time: string;
    end_time?: string;
    guests?: string[];
    color?: string;
    notes?: string;
  };

  if (!title || !start_time) return { error: 'Missing title or start_time' };

  let oEventId = outlook_event_id;
  let outlookError: string | null = null;

  if (event_id && !oEventId) {
    const { data } = await supabase.from('calendar_events').select('outlook_event_id').eq('id', event_id).eq('user_id', userId).single();
    if (data?.outlook_event_id) oEventId = data.outlook_event_id;
  }

  if (oEventId) {
    try {
      const accessToken = await getValidAccessToken(userId, supabase);
      const endDT = end_time || new Date(new Date(start_time).getTime() + 3600000).toISOString();
      const graphEvent: Record<string, unknown> = {
        subject: title,
        start: { dateTime: start_time, timeZone: 'Europe/Rome' },
        end: { dateTime: endDT, timeZone: 'Europe/Rome' },
      };
      if (notes) graphEvent.body = { contentType: 'text', content: notes };
      if (guests && guests.length > 0) {
        graphEvent.attendees = guests.map((email: string) => ({
          emailAddress: { address: email },
          type: 'required',
        }));
      }

      const res = await fetch(`${GRAPH_BASE}/events/${encodeURIComponent(oEventId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(graphEvent),
      });

      if (!res.ok) {
        const errBody = await res.text();
        outlookError = `Outlook API ${res.status}: ${errBody}`;
        console.error('Outlook Calendar update_event failed:', outlookError);
      }
    } catch (e) {
      outlookError = e instanceof Error ? e.message : String(e);
      console.error('Outlook Calendar update_event exception:', outlookError);
    }
  }

  if (event_id) {
    const { error } = await supabase.from('calendar_events').update({
      title, start_time, end_time: end_time || null,
      guests: guests || [], color: color || '#7c5ef0',
      notes: notes || null, updated_at: new Date().toISOString(),
    }).eq('id', event_id).eq('user_id', userId);
    if (error) return { error: `DB update failed: ${error.message}` };
  }

  return { success: true, outlook_error: outlookError };
}

async function handleDeleteEvent(body: Record<string, unknown>, userId: string, supabase: ReturnType<typeof createClient>) {
  const { event_id, outlook_event_id } = body as { event_id?: string; outlook_event_id?: string };

  if (!event_id && !outlook_event_id) return { error: 'Missing event_id or outlook_event_id' };

  let oEventId = outlook_event_id;
  let outlookError: string | null = null;

  if (event_id && !oEventId) {
    const { data } = await supabase.from('calendar_events').select('outlook_event_id').eq('id', event_id).eq('user_id', userId).single();
    if (data?.outlook_event_id) oEventId = data.outlook_event_id;
  }

  if (oEventId) {
    try {
      const accessToken = await getValidAccessToken(userId, supabase);
      const res = await fetch(`${GRAPH_BASE}/events/${encodeURIComponent(oEventId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok && res.status !== 404) {
        const errBody = await res.text();
        outlookError = `Outlook API ${res.status}: ${errBody}`;
        console.error('Outlook Calendar delete_event failed:', outlookError);
      }
    } catch (e) {
      outlookError = e instanceof Error ? e.message : String(e);
      console.error('Outlook Calendar delete_event exception:', outlookError);
    }
  }

  if (event_id) {
    const { error } = await supabase.from('calendar_events').delete().eq('id', event_id).eq('user_id', userId);
    if (error) return { error: `DB delete failed: ${error.message}` };
  }

  return { success: true, outlook_error: outlookError };
}

async function handleDisconnect(userId: string, supabase: ReturnType<typeof createClient>) {
  await supabase.from('outlook_calendar_tokens').delete().eq('user_id', userId);
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

    const supabase = createClient(
      getEnv('SUPABASE_URL'),
      getEnv('SUPABASE_SERVICE_ROLE_KEY')
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = user.id;

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
