
// ─────────────────────────────────────────────
// ANDROID PWA INSTALL PROMPT
// Must be captured as early as possible before the browser dismisses it
// ─────────────────────────────────────────────
let _deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredInstallPrompt = e;
});
window.addEventListener('appinstalled', () => {
  _deferredInstallPrompt = null;
});

// ─────────────────────────────────────────────
// SUPABASE CONFIG
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://qabqqizrlzsswuervggx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kb1b29guFbEOKk-J-bDdeA_fE_KYUN3';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);
window.db = db;

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const STAGES = ['Lead generico','Cold call','Email inviata','Call fissata','Preventivo inviato','Call annullata','Followup inviato','Non interessato','Cliente'];
const PRIORITIES = ['Bassa','Media','Alta'];
const NEXT_ACTIONS = ['Inviare Email','Preparare preventivo','Chiudere il contratto','Chiamare','Delivery','Contatto futuro'];

const STAGE_CLASS = {
  'Lead generico':'s-lead-generico','Cold call':'s-cold-call','Email inviata':'s-email-inviata','Call fissata':'s-call-fissata',
  'Preventivo inviato':'s-preventivo','Call annullata':'s-call-annullata','Followup inviato':'s-followup',
  'Non interessato':'s-non-interessato','Cliente':'s-cliente'
};
const STAGE_COLOR = {
  'Lead generico':'#94a3b8','Cold call':'#f87171','Email inviata':'#60a5fa','Call fissata':'#a88bf5','Preventivo inviato':'#fbbf24',
  'Call annullata':'#f87171','Followup inviato':'#2dd4bf','Non interessato':'#6b7280','Cliente':'#4ade80'
};
const PRIO_CLASS = {'Alta':'p-alta','Media':'p-media','Bassa':'p-bassa'};

const FIELDS = ['nome','cognome','azienda','ruolo','email','telefono','linkedin','sito',
  'via','citta','provincia','stato',
  'stage','priorita','prossima_azione','data_azione','valore_offerta','valore_rinnovo',
  'durata_mesi','ltv','data_chiusura','data_rinnovo','note'];

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let contacts = [];
let currentUser = null;
let currentView = 'dashboard';
let editingId = null;
let importBatch = null;
let dashDays = 7;
let sortField = 'import_order', sortDir = 'asc';
let fText = '', fStage = '', fPrio = '';
let contactsViewMode = 'list';
let selectedContacts = new Set();
let contactsPage = 0;
let contactsPageSize = 100;
window.getCurrentUser = () => currentUser;
window.getContacts = () => contacts;

// Calendar state
let calendarEvents = [];
let googleCalendarConnected = false;
let outlookCalendarConnected = false;
let calendarProvider = null; // 'google' | 'outlook' | null
let calendarConnected = false; // true if any calendar is connected
let currentCalDate = new Date();
let calView = 'month';
let calSelectedColor = '#7c5ef0';
let calEditingEvent = null; // null = create mode, object = edit mode
let calEventsLoaded = false; // cache flag — skip reload on navigation
let habitState = {
  mode: 'daily',
  monthStart: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
  rows: [],
  loadedMonth: null,
  loading: false,
  pendingKeys: new Set(),
  showArchived: false,
  modalEditingId: null
};
// IMPORTANT: replace with your actual Google OAuth Client ID
const GOOGLE_CLIENT_ID = '1039132871315-8c58atac9ujkgitiaqi6omr48pioj6rj.apps.googleusercontent.com';
// IMPORTANT: replace with your actual Microsoft Azure App Client ID
const MICROSOFT_CLIENT_ID = 'YOUR_MICROSOFT_CLIENT_ID';

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────
function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loader').style.display = 'none';
}

function hideLoginScreen(user) {
  currentUser = user;
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('userEmail').textContent = user.email || '';
}

function toggleLoginPwd() {
  const inp = document.getElementById('loginPassword');
  const btn = inp.parentElement.querySelector('.lpwd-toggle');
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
}

async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn      = document.getElementById('loginBtn');
  const errEl    = document.getElementById('loginError');

  btn.disabled = true; btn.textContent = 'Accesso in corso...';
  errEl.classList.remove('show');

  const { data, error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    errEl.textContent = 'Credenziali non valide. Riprova.';
    errEl.classList.add('show');
    btn.disabled = false; btn.textContent = 'Accedi';
    return;
  }

  hideLoginScreen(data.user);
  await bootApp();

  if (window._pendingCalendarCode) {
    await exchangeCalendarToken(window._pendingCalendarCode);
    delete window._pendingCalendarCode;
  }
}

async function handleLogout() {
  await db.auth.signOut();
  document.getElementById('userEmail').textContent = '';
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.remove('show');
  showLoginScreen();
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
async function init() {
  // Handle Calendar OAuth callbacks (Google or Outlook) from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const oauthCode = urlParams.get('code');
  const oauthState = urlParams.get('state');
  if (oauthCode && oauthState === 'calendar_auth') {
    history.replaceState({}, '', window.location.pathname);
    window._pendingCalendarCode = oauthCode;
  }
  if (oauthCode && oauthState === 'outlook_calendar_auth') {
    history.replaceState({}, '', window.location.pathname);
    window._pendingOutlookCode = oauthCode;
  }

  // Check existing session
  const { data: { session } } = await db.auth.getSession();

  if (!session) {
    showLoginScreen();
    return;
  }

  hideLoginScreen(session.user);
  await bootApp();

  // Process pending calendar OAuth codes now that user is authenticated
  if (window._pendingCalendarCode) {
    await exchangeCalendarToken(window._pendingCalendarCode);
    delete window._pendingCalendarCode;
  }
  if (window._pendingOutlookCode) {
    await exchangeOutlookToken(window._pendingOutlookCode);
    delete window._pendingOutlookCode;
  }

  // Listen for session expiry
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') showLoginScreen();
  });
}

async function bootApp() {
  // Column list
  const cg = document.getElementById('colGrid');
  if (!cg.children.length) {
    FIELDS.forEach(f => cg.innerHTML += `<div class="col-item">${f}</div>`);
  }

  // LTV auto-calc
  ['f_valore_offerta','f_valore_rinnovo','f_durata_mesi'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.ltv) { el.dataset.ltv = '1'; el.addEventListener('input', calcLTV); }
  });

  await Promise.all([loadContacts(), loadSmtpSettings(), loadCampaigns()]);
  initNotifications(); // async, runs in background - no await needed
  resumeEmailSyncIfPending(); // resume any sync interrupted by reload/re-login

  // Hide loader
  const loader = document.getElementById('loader');
  loader.style.opacity = '0';
  setTimeout(() => loader.style.display = 'none', 300);
}

function normalizeStage(c) {
  if (!c.stage || !STAGES.includes(c.stage)) c.stage = 'Lead generico';
  return c;
}

async function loadContacts() {
  const PAGE = 1000;
  let all = [], from = 0;
  while (true) {
    const { data, error } = await db.from('contacts').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    if (error) {
      console.error(error);
      document.getElementById('dbDot').classList.add('offline');
      toast('Errore connessione database', 'err');
      return;
    }
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  contacts = all.map(normalizeStage);
  document.getElementById('dbDot').classList.remove('offline');
  document.getElementById('sideCount').textContent = contacts.length;
  renderView();
}

// ─────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────
/* ── SIDEBAR TOGGLE (mobile) ── */
function toggleSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  sidebar.classList.toggle('open');
  backdrop.classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('appSidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('open');
}

function navigate(view) {
  // Close sidebar on mobile after navigation
  if (window.innerWidth <= 768) closeSidebar();
  // Clear email auto-sync when leaving email view
  if (view !== 'email' && window._emailSyncInterval) {
    clearInterval(window._emailSyncInterval);
    window._emailSyncInterval = null;
  }
  currentView = view;
  document.querySelectorAll('.nav-item[data-view]').forEach(el =>
    el.classList.toggle('active', el.dataset.view === view));
  const titles = { dashboard:'Dashboard', contacts:'Contatti', pipeline:'Pipeline', email:'Email', settings:'Impostazioni', campaigns:'Campagne Email', calendario:'Calendario', contracts:'Contratti', habits:'Habit Tracker', 'contact-generator':'Genera Contatti' };
  document.getElementById('pageTitle').textContent = titles[view] || '';
  // Reset content layout for non-email/pipeline views
  const content = document.getElementById('content');
  content.style.padding = '';
  content.style.overflow = '';
  content.style.display = '';
  content.style.flexDirection = '';
  updateTopbar(view);
  renderView();
}

function updateTopbar(view) {
  const el = document.getElementById('topbarActions');
  if (!el) return;
  if (view === 'email') {
    el.innerHTML = `<button class="btn btn-secondary" onclick="syncEmails()">🔄 Sincronizza Email</button>`;
  } else if (view === 'calendario') {
    syncCalendarTopbar();
  } else if (view === 'contracts') {
    el.innerHTML = '';
  } else if (view === 'habits') {
    syncHabitTopbar();
  } else if (view === 'settings' || view === 'campaigns' || view === 'contact-generator') {
    el.innerHTML = '';
  } else {
    const isMobile = window.innerWidth <= 480;
    el.innerHTML = `<button class="btn btn-secondary" onclick="openImport()">📤 ${isMobile ? '' : 'Importa'}</button>
      <button class="btn btn-primary" onclick="openContactModal()">＋ ${isMobile ? 'Aggiungi' : 'Aggiungi Contatto'}</button>`;
  }
}

function renderView() {
  document.getElementById('sideCount').textContent = contacts.length;
  if (currentView === 'dashboard') renderDashboard();
  else if (currentView === 'contacts') renderContacts();
  else if (currentView === 'pipeline') renderPipeline();
  else if (currentView === 'email') renderEmail();
  else if (currentView === 'settings') renderSettings();
  else if (currentView === 'campaigns') renderCampaigns();
  else if (currentView === 'calendario') renderCalendar();
  else if (currentView === 'contracts') renderContracts();
  else if (currentView === 'habits') renderHabitTracker();
  else if (currentView === 'contact-generator') renderContactGenerator();
}

// ─────────────────────────────────────────────
// GENERATORE CONTATTI
// ─────────────────────────────────────────────

let cgMessages = [];
let cgPhase = 'idle';      // 'idle' | 'chat' | 'generating' | 'results'
let cgExtracted = null;    // { location_en, industry_en, count }
let cgJobId = null;
let cgContacts = [];
let cgCredits = null;
let cgPollTimer = null;

async function cgLoadCredits() {
  try {
    const { data, error } = await db.from('user_credits').select('credits').maybeSingle();
    // data null = nessuna riga → crediti 0; mostriamo comunque il valore
    cgCredits = (!error && data != null) ? data.credits : 0;
    const cnt = document.getElementById('creditsCount');
    const badge = document.getElementById('creditsBadge');
    const lbl = document.getElementById('cgCreditsLabel');
    if (cnt) cnt.textContent = cgCredits;
    if (badge) badge.style.display = 'flex';
    if (lbl) lbl.innerHTML = `💎 Crediti: <strong>${cgCredits}</strong>`;
  } catch(_) {}
}

function renderContactGenerator() {
  cgLoadCredits();

  const content = document.getElementById('content');
  content.style.padding = '0';
  content.style.overflow = 'hidden';
  content.style.display = 'flex';
  content.style.flexDirection = 'column';

  content.innerHTML = `
    <div class="cg-wrap" id="cgWrap">
      <div class="cg-header">
        <span class="cg-title">🤖 Genera Contatti</span>
        <div style="display:flex;align-items:center;gap:8px">
          <button onclick="cgResetChat()" style="background:transparent;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.6);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer" title="Inizia una nuova ricerca">↺ Reset</button>
          <span class="cg-credits-badge" id="cgCreditsLabel">${cgCredits !== null ? '💎 Crediti: <strong>'+cgCredits+'</strong>' : '💎 Caricamento...'}</span>
        </div>
      </div>
      <div class="cg-messages" id="cgMessages"></div>
      <div id="cgResultsArea"></div>
      <div class="cg-input-row">
        <textarea class="cg-input" id="cgInput" placeholder="Descrivi il tipo di contatti che cerchi..." rows="1"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();cgSend()}"
          oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
        <button class="cg-send" id="cgSendBtn" onclick="cgSend()">Invia</button>
      </div>
    </div>`;

  if (cgMessages.length === 0) {
    cgAddBotMessage('Ciao! Dimmi che tipo di contatti stai cercando.\n\n⚠️ Specifica sempre una regione italiana (es. Lombardia, Emilia-Romagna, Sicilia) oppure "tutta l\'Italia". Le città singole (Milano, Bologna, Roma…) non sono supportate.\n\nAd esempio:\n• "Commercialisti in Emilia-Romagna"\n• "Avvocati nel Lazio"\n• "Dentisti in Toscana"\n• "Consulenti finanziari in tutta l\'Italia"');
  } else {
    cgRenderMessages();
    if (cgPhase === 'results') cgRenderResults();
  }
}

function cgAddBotMessage(text) {
  cgMessages.push({ role: 'bot', text });
  cgRenderMessages();
}

function cgAddUserMessage(text) {
  cgMessages.push({ role: 'user', text });
  cgRenderMessages();
}

function cgResetChat() {
  if (cgPollTimer) { clearTimeout(cgPollTimer); cgPollTimer = null; }
  cgMessages = [];
  cgPhase = 'idle';
  cgExtracted = null;
  cgJobId = null;
  cgContacts = [];
  const resultsArea = document.getElementById('cgResultsArea');
  if (resultsArea) resultsArea.innerHTML = '';
  cgSetInputEnabled(true);
  cgAddBotMessage('Ciao! Dimmi che tipo di contatti stai cercando.\n\n⚠️ Specifica sempre una regione italiana (es. Lombardia, Emilia-Romagna, Sicilia) oppure "tutta l\'Italia". Le città singole (Milano, Bologna, Roma…) non sono supportate.\n\nAd esempio:\n• "Commercialisti in Emilia-Romagna"\n• "Avvocati nel Lazio"\n• "Dentisti in Toscana"\n• "Consulenti finanziari in tutta l\'Italia"');
}

function cgRenderMessages() {
  const el = document.getElementById('cgMessages');
  if (!el) return;
  el.innerHTML = cgMessages.map(m => `
    <div class="cg-msg ${m.role === 'bot' ? 'bot' : 'user'}">
      <div class="cg-avatar">${m.role === 'bot' ? '🤖' : '👤'}</div>
      <div class="cg-bubble">${m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')}</div>
    </div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function cgShowTyping() {
  const el = document.getElementById('cgMessages');
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'cg-msg bot';
  div.id = 'cgTyping';
  div.innerHTML = '<div class="cg-avatar">🤖</div><div class="cg-bubble"><div class="cg-typing"><span></span><span></span><span></span></div></div>';
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function cgHideTyping() {
  const el = document.getElementById('cgTyping');
  if (el) el.remove();
}

function cgSetInputEnabled(enabled) {
  const inp = document.getElementById('cgInput');
  const btn = document.getElementById('cgSendBtn');
  if (inp) inp.disabled = !enabled;
  if (btn) btn.disabled = !enabled;
}

async function cgSend() {
  const inp = document.getElementById('cgInput');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  if (cgPhase === 'generating') return;

  inp.value = '';
  inp.style.height = 'auto';
  cgAddUserMessage(text);
  cgSetInputEnabled(false);

  // Build history for LLM (skip the welcome message — role bot at index 0)
  const history = cgMessages
    .filter((m, i) => !(i === 0 && m.role === 'bot'))
    .map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.text }));

  cgShowTyping();

  try {
    const { data, error } = await db.functions.invoke('contact-bot-chat', {
      body: { messages: history }
    });

    cgHideTyping();

    if (error || data?.error) {
      cgAddBotMessage('⚠️ Errore di comunicazione con il bot. Riprova.');
      cgSetInputEnabled(true);
      return;
    }

    if (data.location_en && data.industry_en) {
      cgExtracted = cgExtracted || {};
      cgExtracted.location_en = data.location_en;
      cgExtracted.industry_en = data.industry_en;
    }

    // Parse count from user message when in confirm_count flow
    if (data.type === 'confirm_count' || data.type === 'ready') {
      const numMatch = text.match(/\d+/);
      if (numMatch) cgExtracted = { ...(cgExtracted||{}), count: parseInt(numMatch[0], 10) };
    }

    cgAddBotMessage(data.message_it || '...');
    cgPhase = 'chat';

    if (data.type === 'ready') {
      cgPhase = 'generating';
      cgSetInputEnabled(false);
      await cgStartGeneration();
      return;
    }

  } catch(e) {
    cgHideTyping();
    cgAddBotMessage('⚠️ Errore imprevisto. Riprova tra qualche secondo.');
  }

  cgSetInputEnabled(true);
}

async function cgStartGeneration() {
  if (!cgExtracted?.location_en || !cgExtracted?.industry_en || !cgExtracted?.count) {
    cgAddBotMessage('⚠️ Dati incompleti. Riprova dall\'inizio.');
    cgPhase = 'chat';
    cgSetInputEnabled(true);
    return;
  }

  cgAddBotMessage(`🔍 Avvio ricerca di **${cgExtracted.count} ${cgExtracted.industry_en}** in **${cgExtracted.location_en}**...\nQuesto può richiedere qualche minuto.`);

  try {
    const { data, error } = await db.functions.invoke('apify-run-actor', {
      body: {
        location_en: cgExtracted.location_en,
        industry_en: cgExtracted.industry_en,
        count: cgExtracted.count
      }
    });

    if (error || data?.error) {
      cgAddBotMessage(`⚠️ ${data?.error || 'Errore nell\'avvio della ricerca.'}`);
      cgPhase = 'chat';
      cgSetInputEnabled(true);
      return;
    }

    cgJobId = data.jobId;
    if (data.creditsRemaining !== undefined) {
      cgCredits = data.creditsRemaining;
      const lbl = document.getElementById('cgCreditsLabel');
      if (lbl) lbl.innerHTML = `💎 Crediti: <strong>${cgCredits}</strong>`;
      const cnt = document.getElementById('creditsCount');
      if (cnt) cnt.textContent = cgCredits;
    }

    cgAddBotMessage('✅ Ricerca avviata! Sto attendendo i risultati...');
    cgPollStatus();

  } catch(e) {
    cgAddBotMessage(`⚠️ Errore imprevisto nell'avvio: ${e.message}`);
    cgPhase = 'chat';
    cgSetInputEnabled(true);
  }
}

async function cgPollStatus() {
  if (!cgJobId) return;

  try {
    const { data, error } = await db.functions.invoke('apify-run-status', {
      body: { jobId: cgJobId }
    });

    if (error || data?.error) {
      cgAddBotMessage(`⚠️ ${data?.error || 'Errore nel controllo stato.'}`);
      cgPhase = 'chat';
      cgSetInputEnabled(true);
      return;
    }

    if (data.status === 'running') {
      cgPollTimer = setTimeout(cgPollStatus, 4000);
      return;
    }

    if (data.status === 'failed') {
      cgAddBotMessage(`❌ ${data.message || 'La ricerca è fallita. I crediti sono stati riaccreditati.'}`);
      cgPhase = 'chat';
      cgSetInputEnabled(true);
      await cgLoadCredits();
      const lbl = document.getElementById('cgCreditsLabel');
      if (lbl && cgCredits !== null) lbl.innerHTML = `💎 Crediti: <strong>${cgCredits}</strong>`;
      return;
    }

    if (data.status === 'succeeded') {
      cgContacts = data.contacts || [];
      cgPhase = 'results';
      cgAddBotMessage(`🎉 Trovati **${cgContacts.length} contatti**! Puoi visualizzarli qui sotto e importarli in piattaforma.`);
      cgRenderResults();
    }

  } catch(e) {
    cgPollTimer = setTimeout(cgPollStatus, 5000);
  }
}

function cgRenderResults() {
  const el = document.getElementById('cgResultsArea');
  if (!el || cgContacts.length === 0) return;

  const rows = cgContacts.map(c => {
    const nome = [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';
    const sito = c.website ? `<a href="${c.website}" target="_blank" rel="noopener" style="color:var(--primary-text)">${c.website.replace(/^https?:\/\//,'').slice(0,26)}</a>` : '—';
    const li   = c.linkedin ? `<a href="${c.linkedin}" target="_blank" rel="noopener" style="color:var(--primary-text)">LinkedIn</a>` : '—';
    return `<tr>
      <td title="${nome}">${nome}</td>
      <td title="${c.company||''}">${(c.company||'').slice(0,28)||'—'}</td>
      <td>${c.job_title||'—'}</td>
      <td>${c.email||'—'}</td>
      <td>${c.phone||'—'}</td>
      <td>${sito}</td>
      <td>${li}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="cg-results">
      <div class="cg-results-header">
        <span class="cg-results-title">📋 ${cgContacts.length} contatti trovati</span>
        <button class="btn btn-primary btn-sm" id="cgImportBtn" onclick="cgImportContacts(this)">
          ⬇️ Importa ${cgContacts.length} contatti in piattaforma
        </button>
      </div>
      <div style="overflow-x:auto;max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm)">
        <table class="cg-results-table">
          <thead><tr><th>Nome</th><th>Azienda</th><th>Ruolo</th><th>Email</th><th>Telefono</th><th>Sito</th><th>LinkedIn</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function cgImportContacts(btn) {
  if (!cgContacts.length) return;
  btn.disabled = true;
  btn.textContent = 'Importazione in corso...';

  try {
    const toInsert = cgContacts.map((c, i) => ({
      user_id:      currentUser.id,
      nome:         c.first_name || '',
      cognome:      c.last_name  || null,
      azienda:      c.company    || null,
      ruolo:        c.job_title  || null,
      email:        c.email      || null,
      telefono:     c.phone      || null,
      sito:         c.website    || null,
      linkedin:     c.linkedin   || null,
      via:          c.via        || null,
      citta:        c.citta      || null,
      stato:        c.stato      || null,
      stage:        'Lead',
      import_order: Date.now() + i,
      note:         c.industry   || null,
    }));

    const { error } = await db.from('contacts').insert(toInsert);
    if (error) throw new Error(error.message);

    if (cgJobId) {
      await db.from('contact_gen_jobs')
        .update({ contacts_imported: cgContacts.length })
        .eq('id', cgJobId);
    }

    await loadContacts();

    btn.textContent = `✅ ${cgContacts.length} contatti importati!`;
    btn.style.background = '#22c55e';
    cgAddBotMessage(`✅ **${cgContacts.length} contatti** importati con successo nella sezione Contatti!`);

  } catch(e) {
    btn.disabled = false;
    btn.textContent = `⬇️ Importa ${cgContacts.length} contatti in piattaforma`;
    cgAddBotMessage(`⚠️ Errore nell'importazione: ${e.message}`);
  }
}

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
function renderDashboard() {
  const today = new Date(); today.setHours(0,0,0,0);
  const totalOff = contacts.reduce((s,c) => s+(parseFloat(c.valore_offerta)||0), 0);
  const totalLTV = contacts.reduce((s,c) => s+(parseFloat(c.ltv)||0), 0);
  const nClienti = contacts.filter(c => c.stage==='Cliente').length;

  // Overdue actions
  const scadute = contacts
    .filter(c => c.data_azione && new Date(c.data_azione) < today)
    .sort((a,b) => new Date(b.data_azione)-new Date(a.data_azione));

  // Upcoming actions based on selected range
  const inN = new Date(today);
  if (dashDays > 0) inN.setDate(inN.getDate() + dashDays);
  const upcoming = contacts
    .filter(c => {
      if (!c.data_azione) return false;
      const d = new Date(c.data_azione);
      return d >= today && (dashDays === 0 || d <= inN);
    })
    .sort((a,b) => new Date(a.data_azione)-new Date(b.data_azione))
    .slice(0, 8);

  // Stage distribution — exclude contacts with no stage
  const withStage = contacts.filter(c => c.stage && c.stage.trim() !== '');
  const stageTotal = withStage.length;
  const stageRows = STAGES.map(s => {
    const n = withStage.filter(c => c.stage === s).length;
    const pct = stageTotal ? Math.round(n / stageTotal * 100) : 0;
    if (n === 0) return '';
    return `<div style="margin-bottom:11px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <span class="badge ${STAGE_CLASS[s]}">${s}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:var(--muted);font-weight:500">${n} lead${n!==1?'s':''}</span>
          <span style="font-size:12px;color:${STAGE_COLOR[s]};font-weight:700;min-width:32px;text-align:right">${pct}%</span>
        </div>
      </div>
      <div style="height:6px;background:var(--bg-hover);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${STAGE_COLOR[s]};border-radius:4px;transition:width .6s cubic-bezier(.4,0,.2,1);box-shadow:0 0 8px ${STAGE_COLOR[s]}55"></div>
      </div></div>`;
  }).join('');

  const dayOpts = [
    {v:7,l:'7 giorni'},{v:14,l:'14 giorni'},{v:30,l:'30 giorni'},{v:60,l:'60 giorni'},{v:0,l:'Tutti'}
  ].map(o=>`<option value="${o.v}"${dashDays===o.v?' selected':''}>${o.l}</option>`).join('');

  const mkActionRow = (c, cls='') => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)" onclick="openContactModal('${c.id}')" title="Apri contatto">
      <div class="avatar" style="background:${avatarColor(c)};width:30px;height:30px;font-size:11px;cursor:pointer">${initials(c)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer">${c.nome||''} ${c.cognome||''}</div>
        <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.prossima_azione||'—'}</div>
      </div>
      <div style="font-size:12px;color:${cls};font-weight:600;white-space:nowrap">${fmtDate(c.data_azione)}</div>
    </div>`;

  const upRows = upcoming.length
    ? upcoming.map(c => mkActionRow(c, 'var(--warning)')).join('')
    : `<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px 16px">
        <div style="font-size:24px;margin-bottom:8px">🎉</div>
        Nessuna azione nel periodo selezionato
       </div>`;

  const expRows = scadute.length
    ? scadute.slice(0,8).map(c => mkActionRow(c, 'var(--danger)')).join('')
    + (scadute.length > 8 ? `<div style="font-size:11.5px;color:var(--muted);text-align:center;padding:8px 0">+${scadute.length-8} altre azioni scadute</div>` : '')
    : `<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px 16px">
        <div style="font-size:24px;margin-bottom:8px">✅</div>
        Nessuna azione scaduta
       </div>`;

  document.getElementById('content').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card c-purple">
        <div class="stat-label">Totale Contatti</div>
        <div class="stat-value">${contacts.length.toLocaleString('it-IT')}</div>
        <div class="stat-sub">${stageTotal} con stage assegnato</div>
      </div>
      <div class="stat-card c-green">
        <div class="stat-label">Clienti Attivi</div>
        <div class="stat-value">${nClienti}</div>
        <div class="stat-sub">${stageTotal?Math.round(nClienti/stageTotal*100):0}% del pipeline</div>
      </div>
      <div class="stat-card c-orange">
        <div class="stat-label">Valore Pipeline</div>
        <div class="stat-value">€${fmtMoney(totalOff)}</div>
        <div class="stat-sub">offerte totali</div>
      </div>
      <div class="stat-card c-red" style="cursor:pointer" onclick="document.getElementById('dash-scadute').scrollIntoView({behavior:'smooth'})">
        <div class="stat-label">Azioni Scadute</div>
        <div class="stat-value">${scadute.length}</div>
        <div class="stat-sub">${scadute.length ? '⚠️ da aggiornare' : '✅ tutto ok'}</div>
      </div>
    </div>

    <div class="dash-main-grid">
      <!-- Stage Distribution -->
      <div class="table-card" style="padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-weight:700;font-size:14px">📊 Distribuzione Stage</div>
          ${stageTotal ? `<span style="font-size:11px;color:var(--muted);background:var(--bg-hover);padding:3px 8px;border-radius:20px;border:1px solid var(--border)">${stageTotal} lead${stageTotal!==1?'s':''} con stage</span>` : ''}
        </div>
        ${contacts.length === 0
          ? `<div style="color:var(--muted);font-size:13px;text-align:center;padding:32px">Nessun contatto</div>`
          : stageTotal === 0
          ? `<div style="color:var(--muted);font-size:13px;text-align:center;padding:32px">Nessun contatto con stage assegnato</div>`
          : `<div style="margin-top:14px">${stageRows}</div>`
        }
      </div>

      <!-- Actions column -->
      <div style="display:flex;flex-direction:column;gap:14px">
        <!-- Prossime Azioni -->
        <div class="table-card" style="padding:18px;flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-weight:700;font-size:14px">⚡ Prossime Azioni</div>
            <select class="filter-select" style="font-size:11.5px;padding:4px 8px;height:auto" onchange="dashDays=+this.value;renderDashboard()">
              ${dayOpts}
            </select>
          </div>
          <div style="max-height:220px;overflow-y:auto">${upRows}</div>
        </div>

        <!-- Azioni Scadute -->
        <div id="dash-scadute" class="table-card" style="padding:18px;flex:1;border-color:${scadute.length?'rgba(239,68,68,0.25)':'var(--border)'}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-weight:700;font-size:14px">🔴 Azioni Scadute</div>
            ${scadute.length ? `<span style="font-size:11px;font-weight:700;color:var(--danger);background:rgba(239,68,68,0.1);padding:3px 8px;border-radius:20px;border:1px solid rgba(239,68,68,0.2)">${scadute.length}</span>` : ''}
          </div>
          <div style="max-height:220px;overflow-y:auto">${expRows}</div>
        </div>
      </div>
    </div>

    <!-- Economic Summary -->
    <div class="table-card" style="padding:20px;margin-bottom:16px">
      <div style="font-weight:700;margin-bottom:16px;font-size:14px">💰 Riepilogo Economico</div>
      <div class="dash-eco-grid">
        <div style="padding:18px;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.15);border-radius:var(--radius-md);text-align:center">
          <div style="font-size:10px;color:var(--success);font-weight:700;margin-bottom:8px;letter-spacing:1px;text-transform:uppercase">Valore Totale Offerte</div>
          <div style="font-size:24px;font-weight:700;color:var(--success);letter-spacing:-0.04em">€${fmtMoney(totalOff)}</div>
        </div>
        <div style="padding:18px;background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.15);border-radius:var(--radius-md);text-align:center">
          <div style="font-size:10px;color:#60a5fa;font-weight:700;margin-bottom:8px;letter-spacing:1px;text-transform:uppercase">Life Time Value Totale</div>
          <div style="font-size:24px;font-weight:700;color:#60a5fa;letter-spacing:-0.04em">€${fmtMoney(totalLTV)}</div>
        </div>
        <div style="padding:18px;background:rgba(124,94,240,0.07);border:1px solid rgba(124,94,240,0.15);border-radius:var(--radius-md);text-align:center">
          <div style="font-size:10px;color:var(--primary-text);font-weight:700;margin-bottom:8px;letter-spacing:1px;text-transform:uppercase">LTV Medio / Cliente</div>
          <div style="font-size:24px;font-weight:700;color:var(--primary-text);letter-spacing:-0.04em">€${fmtMoney(nClienti?totalLTV/nClienti:0)}</div>
        </div>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────
// CONTACTS
// ─────────────────────────────────────────────
function renderContacts() {
  if (contactsViewMode === 'spreadsheet') { renderContactsSpreadsheet(); return; }

  // Filter by stage/priority/sort only — text filter is applied live via CSS
  const list = contacts
    .filter(c => {
      if (fStage && c.stage !== fStage) return false;
      if (fPrio && c.priorita !== fPrio) return false;
      return true;
    })
    .sort((a,b) => {
      let va=a[sortField], vb=b[sortField];
      if (va==null && vb==null) return 0;
      if (va==null) return 1; if (vb==null) return -1;
      va=va||''; vb=vb||'';
      if (!isNaN(parseFloat(va))&&!isNaN(parseFloat(vb))) { va=parseFloat(va)||0; vb=parseFloat(vb)||0; }
      const r = va<vb?-1:va>vb?1:0;
      return sortDir==='asc'?r:-r;
    });

  const today = new Date(); today.setHours(0,0,0,0);
  const in3 = new Date(today); in3.setDate(in3.getDate()+3);

  const rows = list.length ? list.map(c => {
    let dateHtml = '';
    if (c.data_azione) {
      const d = new Date(c.data_azione);
      let cls = d < today ? 'date-exp' : d <= in3 ? 'date-soon' : '';
      dateHtml = `<div class="${cls}" style="font-size:12px">${fmtDate(c.data_azione)}${cls==='date-exp'?' ⚠️':''}</div>`;
    }
    const links = [
      c.linkedin  ? `<a class="btn-icon btn-link" href="${c.linkedin}" target="_blank" onclick="event.stopPropagation()" title="LinkedIn" style="font-size:11px;font-weight:700">in</a>` : '',
      c.sito      ? `<a class="btn-icon btn-link" href="${c.sito}" target="_blank" onclick="event.stopPropagation()" title="Sito Web">🌐</a>` : '',
      c.email     ? `<a class="btn-icon btn-link" href="mailto:${c.email}" onclick="event.stopPropagation()" title="Email">✉️</a>` : '',
      c.telefono  ? `<a class="btn-icon btn-link" href="tel:${c.telefono}" onclick="event.stopPropagation()" title="Chiama ${c.telefono}">📞</a>` : '',
      (c.telefono && /^\+39\s*3/.test(c.telefono)) ? `<a class="btn-icon btn-link" href="https://wa.me/${c.telefono.replace(/[^\d]/g,'')}" target="_blank" onclick="event.stopPropagation()" title="WhatsApp ${c.telefono}" style="color:#25D366;font-size:15px">💬</a>` : '',
    ].join('');
    const searchVal = `${c.nome||''} ${c.cognome||''} ${c.azienda||''} ${c.email||''} ${c.ruolo||''}`.toLowerCase().replace(/"/g,'');
    return `<tr onclick="openContactModal('${c.id}')" data-search="${searchVal}">
      <td><div class="contact-cell">
        <div class="avatar" style="background:${avatarColor(c)}">${initials(c)}</div>
        <div><div class="contact-name">${c.nome||''} ${c.cognome||''}</div>
        <div class="contact-sub">${c.ruolo?c.ruolo+' @ ':''}${c.azienda||''}</div></div>
      </div></td>
      <td><span class="badge ${STAGE_CLASS[c.stage]||''}">${c.stage||'—'}</span></td>
      <td><span class="badge ${PRIO_CLASS[c.priorita]||''}">${c.priorita||'—'}</span></td>
      <td><div style="font-size:12.5px">${c.prossima_azione||'—'}</div>${dateHtml}</td>
      <td class="money">${c.valore_offerta?'€'+fmtMoney(c.valore_offerta):'<span style="color:var(--muted)">—</span>'}</td>
      <td class="money">${c.ltv?'€'+fmtMoney(c.ltv):'<span style="color:var(--muted)">—</span>'}</td>
      <td><div class="action-btns" onclick="event.stopPropagation()">
        ${links}
        <button class="btn-icon btn-edit" onclick="openContactModal('${c.id}')" title="Modifica">✏️</button>
        <button class="btn-icon btn-del" onclick="deleteContact('${c.id}')" title="Elimina">🗑️</button>
      </div></td>
    </tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty">
    <div class="ei">👥</div><h3>Nessun contatto trovato</h3><p>Aggiungi il tuo primo contatto</p>
  </div></td></tr>`;

  // Render shell only once; on subsequent calls only refresh the table body
  if (!document.getElementById('contacts-body')) {
    document.getElementById('content').innerHTML = `
      <div class="filter-bar">
        <input type="text" class="filter-input" placeholder="🔍 Cerca per nome, azienda, email..." value="${fText}"
          oninput="fText=this.value;filterContactsLive()">
        <select class="filter-select" onchange="fStage=this.value;renderContacts()">
          <option value="">Tutti gli stage</option>
          ${STAGES.map(s=>`<option value="${s}"${fStage===s?' selected':''}>${s}</option>`).join('')}
        </select>
        <select class="filter-select" onchange="fPrio=this.value;renderContacts()">
          <option value="">Tutte le priorità</option>
          ${PRIORITIES.map(p=>`<option value="${p}"${fPrio===p?' selected':''}>${p}</option>`).join('')}
        </select>
        <span id="contacts-count" style="font-size:12.5px;color:var(--muted);white-space:nowrap">${list.length} contatti</span>
        <div class="view-toggle">
          <button class="view-btn active" onclick="contactsViewMode='list';renderContacts()">☰ Lista</button>
          <button class="view-btn" onclick="contactsViewMode='spreadsheet';selectedContacts=new Set();renderContacts()">⊞ Tabella</button>
        </div>
      </div>
      <div id="contacts-body"></div>`;
    // Track mouse/touch globally (once only) to distinguish spurious blur from intentional
    if (!window._mouseIsDown) {
      window._mouseIsDown = false;
      document.addEventListener('mousedown',  () => { window._mouseIsDown = true; },  true);
      document.addEventListener('mouseup',    () => { setTimeout(() => { window._mouseIsDown = false; }, 0); }, true);
      document.addEventListener('touchstart', () => { window._mouseIsDown = true; },  true);
      document.addEventListener('touchend',   () => { setTimeout(() => { window._mouseIsDown = false; }, 0); }, true);
    }
    // Re-focus filter input on spurious blur (caused by reflow, not by user click)
    const _fi = document.querySelector('.filter-input');
    _fi.addEventListener('blur', function() {
      const self = this;
      requestAnimationFrame(() => {
        if (currentView === 'contacts' && !window._mouseIsDown &&
            (document.activeElement === document.body || !document.activeElement)) {
          self.focus();
        }
      });
    });
  }

  document.getElementById('contacts-body').innerHTML = `
    <div class="table-card">
      <table>
        <thead><tr>
          <th onclick="doSort('nome')">Contatto ${si('nome')}</th>
          <th onclick="doSort('stage')">Stage ${si('stage')}</th>
          <th onclick="doSort('priorita')">Priorità ${si('priorita')}</th>
          <th onclick="doSort('data_azione')">Prossima Azione ${si('data_azione')}</th>
          <th onclick="doSort('valore_offerta')">Offerta ${si('valore_offerta')}</th>
          <th onclick="doSort('ltv')">LTV ${si('ltv')}</th>
          <th>Link &amp; Azioni</th>
        </tr></thead>
        <tbody id="contacts-tbody">${rows}</tbody>
      </table>
    </div>`;
  filterContactsLive();
}

// Live text filter: show/hide rows with CSS — no DOM mutation, no focus loss
function filterContactsLive() {
  const q = fText.toLowerCase();
  let vis = 0;
  const rows = document.querySelectorAll('#contacts-tbody tr[data-search]');
  rows.forEach(r => {
    const show = !q || r.dataset.search.includes(q);
    r.style.display = show ? '' : 'none';
    if (show) vis++;
  });
  const c = document.getElementById('contacts-count');
  if (c) c.textContent = q ? `${vis} di ${rows.length} contatti` : `${rows.length} contatti`;
}

function getFiltered() {
  return contacts
    .filter(c => {
      const q = fText.toLowerCase();
      if (q && !`${c.nome} ${c.cognome} ${c.azienda} ${c.email} ${c.ruolo}`.toLowerCase().includes(q)) return false;
      if (fStage && c.stage !== fStage) return false;
      if (fPrio && c.priorita !== fPrio) return false;
      return true;
    })
    .sort((a,b) => {
      let va=a[sortField], vb=b[sortField];
      if (va==null && vb==null) return 0;
      if (va==null) return 1;
      if (vb==null) return -1;
      va=va||''; vb=vb||'';
      if (!isNaN(parseFloat(va))&&!isNaN(parseFloat(vb))) { va=parseFloat(va)||0; vb=parseFloat(vb)||0; }
      const r = va<vb?-1:va>vb?1:0;
      return sortDir==='asc'?r:-r;
    });
}

function doSort(f) {
  sortField===f ? sortDir=(sortDir==='asc'?'desc':'asc') : (sortField=f, sortDir='asc');
  contactsPage = 0;
  renderContacts();
}
function si(f) { return sortField!==f?'↕':sortDir==='asc'?'↑':'↓'; }

// ─────────────────────────────────────────────
// SPREADSHEET VIEW
// ─────────────────────────────────────────────
const SP_COLS = [
  {key:'nome',            label:'Nome',           type:'text'},
  {key:'cognome',         label:'Cognome',        type:'text'},
  {key:'azienda',         label:'Azienda',        type:'text'},
  {key:'ruolo',           label:'Ruolo',          type:'text'},
  {key:'email',           label:'Email',          type:'email'},
  {key:'telefono',        label:'Telefono',       type:'text'},
  {key:'linkedin',        label:'LinkedIn',       type:'text'},
  {key:'sito',            label:'Sito Web',       type:'text'},
  {key:'via',             label:'Via',            type:'text'},
  {key:'citta',           label:'Città',          type:'text'},
  {key:'provincia',       label:'Provincia',      type:'text'},
  {key:'stato',           label:'Stato',          type:'text'},
  {key:'stage',           label:'Stage',          type:'select', opts: null},
  {key:'priorita',        label:'Priorità',       type:'select', opts: null},
  {key:'prossima_azione', label:'Prossima Azione',type:'text'},
  {key:'data_azione',     label:'Data Azione',    type:'date'},
  {key:'valore_offerta',  label:'Offerta €',      type:'number'},
  {key:'ltv',             label:'LTV €',          type:'number'},
  {key:'note',            label:'Note',           type:'text'},
];

function renderContactsSpreadsheet() {
  const list = getFiltered();
  const totalPages = Math.max(1, Math.ceil(list.length / contactsPageSize));
  if (contactsPage >= totalPages) contactsPage = totalPages - 1;
  const pageList = list.slice(contactsPage * contactsPageSize, (contactsPage + 1) * contactsPageSize);
  const selAll = pageList.length > 0 && pageList.every(c => selectedContacts.has(c.id));

  const colDefs = SP_COLS.map(c => ({
    ...c,
    opts: c.key==='stage' ? STAGES : c.key==='priorita' ? PRIORITIES : null
  }));

  const headerCells = colDefs.map(c=>`<th>${c.label}</th>`).join('');

  const rows = pageList.length ? pageList.map(c => {
    const sel = selectedContacts.has(c.id);
    const cells = colDefs.map(col => {
      const val = c[col.key] != null ? String(c[col.key]) : '';
      if (col.opts) {
        const opts = `<option value=""></option>` + col.opts.map(o=>`<option value="${o}"${val===o?' selected':''}>${o}</option>`).join('');
        return `<td><select class="sp-select" data-id="${c.id}" data-field="${col.key}" onchange="spChange(this)">${opts}</select></td>`;
      }
      const escaped = val.replace(/"/g,'&quot;');
      if (col.key === 'telefono') {
        const btn = val ? `<a class="btn-icon btn-link" href="tel:${val}" title="Chiama ${val}" style="flex-shrink:0">📞</a>` : '';
        const wa = (val && /^\+39\s*3/.test(val)) ? `<a class="btn-icon btn-link" href="https://wa.me/${val.replace(/[^\d]/g,'')}" target="_blank" title="WhatsApp ${val}" style="flex-shrink:0;color:#25D366;font-size:15px">💬</a>` : '';
        return `<td><div style="display:flex;align-items:center;gap:4px"><input class="sp-input" type="${col.type}" data-id="${c.id}" data-field="${col.key}" value="${escaped}" onchange="spChange(this)">${btn}${wa}</div></td>`;
      }
      if (col.key === 'email') {
        const btn = val ? `<a class="btn-icon btn-link" href="mailto:${val}" title="Scrivi a ${val}" style="flex-shrink:0">✉️</a>` : '';
        return `<td><div style="display:flex;align-items:center;gap:4px"><input class="sp-input" type="${col.type}" data-id="${c.id}" data-field="${col.key}" value="${escaped}" onchange="spChange(this)">${btn}</div></td>`;
      }
      if (col.key === 'linkedin') {
        const btn = val ? `<a class="btn-icon btn-link" href="${val}" target="_blank" title="Apri LinkedIn" style="flex-shrink:0;font-size:11px;font-weight:700">in</a>` : '';
        return `<td><div style="display:flex;align-items:center;gap:4px"><input class="sp-input" type="${col.type}" data-id="${c.id}" data-field="${col.key}" value="${escaped}" onchange="spChange(this)">${btn}</div></td>`;
      }
      if (col.key === 'sito') {
        const btn = val ? `<a class="btn-icon btn-link" href="${val}" target="_blank" title="Apri sito web" style="flex-shrink:0">🌐</a>` : '';
        return `<td><div style="display:flex;align-items:center;gap:4px"><input class="sp-input" type="${col.type}" data-id="${c.id}" data-field="${col.key}" value="${escaped}" onchange="spChange(this)">${btn}</div></td>`;
      }
      return `<td><input class="sp-input" type="${col.type}" data-id="${c.id}" data-field="${col.key}" value="${escaped}" onchange="spChange(this)"></td>`;
    }).join('');
    return `<tr class="${sel?'sp-selected':''}">
      <td style="text-align:center;width:36px"><input type="checkbox" ${sel?'checked':''} onchange="spToggle('${c.id}',this.checked)"></td>
      ${cells}
      <td><div class="action-btns"><button class="btn-icon btn-edit" onclick="openContactModal('${c.id}')" title="Modifica">✏️</button><button class="btn-icon btn-del" onclick="deleteContact('${c.id}')" title="Elimina">🗑️</button></div></td>
    </tr>`;
  }).join('') : `<tr><td colspan="${colDefs.length+2}"><div class="empty"><div class="ei">👥</div><h3>Nessun contatto trovato</h3></div></td></tr>`;
  const pageSizeOptsSp = [100,200,500,1000].map(n=>`<option value="${n}"${contactsPageSize===n?' selected':''}>${n}</option>`).join('');
  const pageStartSp = list.length ? contactsPage * contactsPageSize + 1 : 0;
  const pageEndSp   = Math.min((contactsPage + 1) * contactsPageSize, list.length);

  const filteredIds = list.map(c=>c.id);
  const allFilteredSel = filteredIds.length > 0 && filteredIds.every(id => selectedContacts.has(id));
  const bulkBar = selectedContacts.size > 0 ? `
    <div class="bulk-bar">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span>${selectedContacts.size} contatt${selectedContacts.size===1?'o':'i'} selezionat${selectedContacts.size===1?'o':'i'}</span>
        ${!allFilteredSel ? `<button class="btn btn-secondary btn-sm" onclick="spSelectAllFiltered()" style="font-size:12px">Seleziona tutti i ${list.length} contatti</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="selectedContacts.clear();renderContacts()" style="font-size:12px">Deseleziona tutti</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select class="filter-select btn-sm" id="bulkFieldSel" onchange="bulkFieldChanged()" style="font-size:12px">
          <option value="">Cambia campo...</option>
          <optgroup label="Dati Personali">
            <option value="nome">Nome</option>
            <option value="cognome">Cognome</option>
            <option value="azienda">Azienda</option>
            <option value="ruolo">Ruolo</option>
            <option value="email">Email</option>
            <option value="telefono">Telefono</option>
            <option value="linkedin">LinkedIn</option>
            <option value="sito">Sito Web</option>
          </optgroup>
          <optgroup label="Stage &amp; Azioni">
            <option value="stage">Stage</option>
            <option value="priorita">Priorità</option>
            <option value="prossima_azione">Prossima Azione</option>
            <option value="data_azione">Data Azione</option>
          </optgroup>
          <optgroup label="Valori Economici">
            <option value="valore_offerta">Offerta €</option>
            <option value="valore_rinnovo">Rinnovo €</option>
            <option value="durata_mesi">Durata (mesi)</option>
            <option value="ltv">LTV €</option>
            <option value="data_chiusura">Data Chiusura</option>
            <option value="data_rinnovo">Data Rinnovo</option>
          </optgroup>
          <optgroup label="Note">
            <option value="note">Note</option>
          </optgroup>
        </select>
        <span id="bulkValCont"></span>
        <button class="btn btn-secondary btn-sm" onclick="bulkChangeField()" style="font-size:12px">✏️ Applica a selezionati</button>
        <button class="btn btn-sm" style="background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.25);font-size:12px" onclick="bulkDelete()">🗑️ Elimina selezionati</button>
      </div>
    </div>` : '';

  document.getElementById('content').innerHTML = `
    <div class="filter-bar">
      <input type="text" class="filter-input" placeholder="🔍 Cerca per nome, azienda, email..." value="${fText}"
        oninput="fText=this.value;contactsPage=0;renderContacts()">
      <select class="filter-select" onchange="fStage=this.value;contactsPage=0;renderContacts()">
        <option value="">Tutti gli stage</option>
        ${STAGES.map(s=>`<option value="${s}"${fStage===s?' selected':''}>${s}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="fPrio=this.value;contactsPage=0;renderContacts()">
        <option value="">Tutte le priorità</option>
        ${PRIORITIES.map(p=>`<option value="${p}"${fPrio===p?' selected':''}>${p}</option>`).join('')}
      </select>
      <select class="filter-select" onchange="contactsPageSize=+this.value;contactsPage=0;renderContacts()" title="Righe per pagina">
        ${pageSizeOptsSp}
      </select>
      <span style="font-size:12.5px;color:var(--muted);white-space:nowrap">${pageStartSp}–${pageEndSp} di ${list.length}</span>
      <div class="view-toggle">
        <button class="view-btn" onclick="contactsViewMode='list';selectedContacts=new Set();renderContacts()">☰ Lista</button>
        <button class="view-btn active" onclick="void 0">⊞ Tabella</button>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="openBulkRoleModal()" style="font-size:12px;white-space:nowrap">🔄 Sostituisci ruoli</button>
    </div>
    ${bulkBar}
    <div class="spreadsheet-wrap">
      <table class="spreadsheet-table">
        <thead><tr>
          <th style="width:36px"><input type="checkbox" ${selAll?'checked':''} title="Seleziona tutti"
            onchange="spToggleAll(this.checked,[${pageList.map(c=>`'${c.id}'`).join(',')}])"></th>
          ${headerCells}
          <th>Azioni</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${totalPages > 1 ? `<div class="pagination-bar">
      <button class="btn btn-secondary btn-sm" onclick="contactsPage=0;renderContacts()" ${contactsPage===0?'disabled':''}>«</button>
      <button class="btn btn-secondary btn-sm" onclick="contactsPage--;renderContacts()" ${contactsPage===0?'disabled':''}>‹ Prec</button>
      <span style="font-size:13px;color:var(--text-sec)">Pag. ${contactsPage+1} / ${totalPages}</span>
      <button class="btn btn-secondary btn-sm" onclick="contactsPage++;renderContacts()" ${contactsPage>=totalPages-1?'disabled':''}>Succ ›</button>
      <button class="btn btn-secondary btn-sm" onclick="contactsPage=${totalPages-1};renderContacts()" ${contactsPage>=totalPages-1?'disabled':''}>»</button>
    </div>` : ''}`;
}

async function spChange(el) {
  const id = el.dataset.id;
  const field = el.dataset.field;
  const value = el.value.trim() || null;
  const { error } = await db.from('contacts').update({[field]: value}).eq('id', id).eq('user_id', currentUser.id);
  if (error) { toast('Errore salvataggio: '+error.message, 'err'); return; }
  const c = contacts.find(x=>x.id===id);
  if (c) c[field] = value;
}

function spToggle(id, checked) {
  if (checked) selectedContacts.add(id); else selectedContacts.delete(id);
  renderContacts();
}

function spToggleAll(checked, ids) {
  if (checked) ids.forEach(id => selectedContacts.add(id)); else selectedContacts.clear();
  renderContacts();
}

async function bulkDelete() {
  if (!selectedContacts.size) return;
  if (!confirm(`Eliminare ${selectedContacts.size} contatti selezionati? Questa operazione non può essere annullata.`)) return;
  const ids = [...selectedContacts];
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error } = await db.from('contacts').delete().in('id', chunk).eq('user_id', currentUser.id);
    if (error) { toast('Errore eliminazione: '+error.message, 'err'); return; }
  }
  contacts = contacts.filter(c => !ids.includes(c.id));
  selectedContacts.clear();
  document.getElementById('sideCount').textContent = contacts.length;
  renderContacts();
  toast(`${ids.length} contatti eliminati`, 'ok');
}

function bulkFieldChanged() {
  const sel = document.getElementById('bulkFieldSel');
  const cont = document.getElementById('bulkValCont');
  if (!sel || !cont) return;
  const field = sel.value;
  if (!field) { cont.innerHTML = ''; return; }
  const SELECT_OPTS = { stage: STAGES, priorita: PRIORITIES, prossima_azione: NEXT_ACTIONS };
  const DATE_FIELDS = ['data_azione','data_chiusura','data_rinnovo'];
  const NUMBER_FIELDS = ['valore_offerta','valore_rinnovo','durata_mesi','ltv'];
  if (SELECT_OPTS[field]) {
    const opts = `<option value=""></option>` + SELECT_OPTS[field].map(o=>`<option value="${o}">${o}</option>`).join('');
    cont.innerHTML = `<select class="filter-select btn-sm" id="bulkValInput" style="font-size:12px">${opts}</select>`;
  } else if (DATE_FIELDS.includes(field)) {
    cont.innerHTML = `<input type="date" class="filter-select btn-sm" id="bulkValInput" style="font-size:12px">`;
  } else if (NUMBER_FIELDS.includes(field)) {
    cont.innerHTML = `<input type="number" class="filter-input btn-sm" id="bulkValInput" placeholder="Valore..." style="font-size:12px;width:140px;padding:4px 8px">`;
  } else {
    cont.innerHTML = `<input type="text" class="filter-input btn-sm" id="bulkValInput" placeholder="Valore..." style="font-size:12px;width:200px;padding:4px 8px">`;
  }
}

function spSelectAllFiltered() {
  getFiltered().forEach(c => selectedContacts.add(c.id));
  renderContacts();
}

async function bulkChangeField() {
  const sel = document.getElementById('bulkFieldSel');
  if (!sel || !sel.value) { toast('Seleziona un campo da modificare', 'err'); return; }
  const field = sel.value;
  const valEl = document.getElementById('bulkValInput');
  if (!valEl) { toast('Inserisci un valore per il campo selezionato', 'err'); return; }
  const value = valEl.value || null;
  const ids = [...selectedContacts];

  // Track contacts whose stage was NOT already "Call fissata" (to trigger popup)
  const prevNotCallFissata = field === 'stage' && value === 'Call fissata'
    ? contacts.filter(c => ids.includes(c.id) && c.stage !== 'Call fissata')
    : [];

  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error } = await db.from('contacts').update({[field]: value}).in('id', chunk).eq('user_id', currentUser.id);
    if (error) { toast('Errore: '+error.message, 'err'); return; }
    chunk.forEach(id => { const c=contacts.find(x=>x.id===id); if(c) c[field]=value; });
  }
  toast(`"${field}" aggiornato per ${ids.length} contatti`, 'ok');
  renderContacts();

  // Trigger popup for the first newly-assigned "Call fissata" contact
  if (prevNotCallFissata.length > 0) {
    const first = contacts.find(c => c.id === prevNotCallFissata[0].id);
    if (first) setTimeout(() => openCallFissataPopup(first), 350);
  }
}

function openBulkRoleModal() {
  const roles = [...new Set(contacts.map(c => c.ruolo).filter(Boolean))].sort();
  if (!roles.length) { toast('Nessun ruolo presente nei contatti', 'err'); return; }
  document.getElementById('bulkRoleOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'bulkRoleOverlay';
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <h2>Sostituisci ruoli in bulk</h2>
        <button class="modal-close" onclick="document.getElementById('bulkRoleOverlay').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-group" style="margin-bottom:16px">
          <label style="font-size:12px;font-weight:600;color:var(--text-sec);text-transform:uppercase;letter-spacing:.5px">Ruoli da sostituire:</label>
          <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;padding:4px 0">
            <label style="font-size:13px;display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="bulkRoleSelectAll" onchange="document.querySelectorAll('.bulk-role-cb').forEach(cb=>cb.checked=this.checked)">
              <span style="color:var(--text-sec);font-style:italic">Seleziona tutti</span>
            </label>
            ${roles.map(r => `
            <label style="font-size:13px;display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" class="bulk-role-cb" value="${r.replace(/"/g,'&quot;')}">
              <span style="color:var(--text)">${r}</span>
            </label>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label style="font-size:12px;font-weight:600;color:var(--text-sec);text-transform:uppercase;letter-spacing:.5px">Nuovo ruolo:</label>
          <input id="bulkRoleNewInput" type="text" class="filter-input" placeholder="Inserisci il nuovo ruolo..." style="margin-top:6px">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('bulkRoleOverlay').remove()">Annulla</button>
        <button class="btn btn-primary btn-sm" onclick="applyBulkRoleReplace()">Applica</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function applyBulkRoleReplace() {
  const checked = [...document.querySelectorAll('.bulk-role-cb:checked')].map(el => el.value);
  const newRole = document.getElementById('bulkRoleNewInput')?.value?.trim();
  if (!checked.length) { toast('Seleziona almeno un ruolo da sostituire', 'err'); return; }
  if (!newRole) { toast('Inserisci il nuovo ruolo', 'err'); return; }
  const ids = contacts.filter(c => checked.includes(c.ruolo)).map(c => c.id);
  if (!ids.length) { toast('Nessun contatto trovato per i ruoli selezionati', 'err'); return; }

  const applyBtn = document.querySelector('#bulkRoleOverlay .btn-primary');
  const cancelBtn = document.querySelector('#bulkRoleOverlay .btn-secondary');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '⏳ Applicando…'; }
  if (cancelBtn) cancelBtn.disabled = true;

  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error } = await db.from('contacts').update({ ruolo: newRole }).in('id', chunk).eq('user_id', currentUser.id);
    if (error) {
      toast('Errore: ' + error.message, 'err');
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'Applica'; }
      if (cancelBtn) cancelBtn.disabled = false;
      return;
    }
    chunk.forEach(id => { const c = contacts.find(x => x.id === id); if (c) c.ruolo = newRole; });
  }
  document.getElementById('bulkRoleOverlay')?.remove();
  renderContacts();
  toast(`${ids.length} contatt${ids.length === 1 ? 'o' : 'i'} aggiornati`, 'ok');
}

// ─────────────────────────────────────────────
// PIPELINE
// ─────────────────────────────────────────────
let _dragId = null;

function renderPipeline() {
  const content = document.getElementById('content');
  const isMobile = window.innerWidth <= 768;
  content.style.padding = isMobile ? '10px' : '14px 16px';
  content.style.overflow = isMobile ? 'auto' : 'hidden';
  content.style.display = 'flex';
  content.style.flexDirection = 'column';

  const totalLeads = contacts.length;
  const totalOff   = contacts.reduce((s,c)=>s+(parseFloat(c.valore_offerta)||0),0);
  const totalLTV   = contacts.reduce((s,c)=>s+(parseFloat(c.ltv)||0),0);
  const nClienti   = contacts.filter(c=>c.stage==='Cliente').length;
  const convRate   = totalLeads ? Math.round(nClienti/totalLeads*100) : 0;

  const summary = `<div class="pipeline-summary">
    <div class="ps-card"><div class="ps-label">Lead Totali</div><div class="ps-value">${totalLeads}</div></div>
    <div class="ps-card"><div class="ps-label">Valore Pipeline</div><div class="ps-value money">€${fmtMoney(totalOff)}</div></div>
    <div class="ps-card"><div class="ps-label">LTV Totale</div><div class="ps-value money">€${fmtMoney(totalLTV)}</div></div>
    <div class="ps-card"><div class="ps-label">Clienti / Conv.</div><div class="ps-value">${nClienti} <span style="font-size:13px;color:var(--text-sec);font-weight:500">(${convRate}%)</span></div></div>
  </div>`;

  const cols = STAGES.map(stage => {
    const items = contacts.filter(c=>c.stage===stage);
    const total = items.reduce((s,c)=>s+(parseFloat(c.valore_offerta)||0),0);
    const cards = items.map(c=>`
      <div class="pipe-card"
           draggable="true"
           data-id="${c.id}"
           ondragstart="pipeDragStart(event,'${c.id}')"
           ondragend="pipeDragEnd(event)"
           onclick="if(!window._pipeDragged) openContactModal('${c.id}')">
        <div class="pipe-card-top">
          <div class="pipe-card-av" style="background:${avatarColor(c)}">${initials(c)}</div>
          <div style="flex:1;min-width:0">
            <div class="pipe-card-name">${c.nome||''} ${c.cognome||''}</div>
            ${c.azienda?`<div class="pipe-card-co">${c.azienda}</div>`:''}
          </div>
          ${c.priorita?`<span class="badge ${PRIO_CLASS[c.priorita]}" style="font-size:9px;padding:2px 5px;flex-shrink:0;margin-left:2px">${c.priorita}</span>`:''}
        </div>
        ${(c.valore_offerta||c.data_azione)?`<div class="pipe-card-row">${c.valore_offerta?`<span class="pipe-card-val">€${fmtMoney(c.valore_offerta)}</span>`:'<span></span>'}${c.data_azione?`<span class="pipe-card-date">${fmtDate(c.data_azione)}</span>`:''}</div>`:''}
        ${c.prossima_azione?`<div class="pipe-card-action">→ ${c.prossima_azione}</div>`:''}
      </div>`).join('') || `<div class="pipe-empty">Nessun contatto</div>`;
    const col = STAGE_COLOR[stage];
    return `<div class="pipe-col"
                 data-stage="${stage}"
                 ondragover="pipeDragOver(event)"
                 ondragleave="pipeDragLeave(event)"
                 ondrop="pipeDrop(event,'${stage}')">
      <div class="pipe-header" style="background:${col}15;border-top:2px solid ${col}">
        <span style="color:${col}">${stage}</span>
        <span class="pipe-count" style="background:${col}25;color:${col}">${items.length}</span>
      </div>
      ${total?`<div class="pipe-total">€${fmtMoney(total)}</div>`:''}
      <div class="pipe-cards">${cards}</div>
    </div>`;
  }).join('');

  content.innerHTML = `<div class="pipeline-board">${summary}<div class="pipeline-wrap">${cols}</div></div>`;
}

function pipeDragStart(e, id) {
  window._pipeDragged = false;
  _dragId = id;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { const el = document.querySelector(`[data-id="${id}"]`); if(el) el.classList.add('dragging'); }, 0);
}

function pipeDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.pipe-col.drag-over').forEach(el => el.classList.remove('drag-over'));
  setTimeout(() => { window._pipeDragged = false; }, 60);
}

function pipeDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function pipeDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-over');
  }
}

async function pipeDrop(e, stage) {
  e.preventDefault();
  window._pipeDragged = true;
  e.currentTarget.classList.remove('drag-over');
  const id = _dragId;
  _dragId = null;
  if (!id) return;
  const contact = contacts.find(x => x.id === id);
  if (!contact || contact.stage === stage) return;
  const ok = await updateContactInDB(id, { stage });
  if (ok) {
    toast(`"${contact.nome||contact.cognome}" → ${stage} ✓`, 'ok');
    renderPipeline();
    if (stage === 'Call fissata') {
      setTimeout(() => openCallFissataPopup(contact), 350);
    }
  }
}

// ─────────────────────────────────────────────
// CONTACT MODAL
// ─────────────────────────────────────────────
function openContactModal(id=null) {
  editingId = id;
  document.getElementById('contactModal').classList.remove('hidden');
  if (id) {
    const c = contacts.find(x=>x.id===id);
    if (!c) return;
    document.getElementById('modalTitle').textContent = `Modifica: ${c.nome||''} ${c.cognome||''}`;
    FIELDS.forEach(f => { const el=document.getElementById('f_'+f); if(el) el.value=c[f]||''; });
  } else {
    document.getElementById('modalTitle').textContent = 'Nuovo Contatto';
    FIELDS.forEach(f => { const el=document.getElementById('f_'+f); if(el) el.value=''; });
    document.getElementById('f_stage').value = 'Cold call';
    document.getElementById('f_priorita').value = 'Media';
    document.getElementById('f_prossima_azione').value = 'Inviare Email';
  }
}

function closeContactModal() {
  document.getElementById('contactModal').classList.add('hidden');
  editingId = null;
}

function calcLTV() {
  const off  = parseFloat(document.getElementById('f_valore_offerta').value)||0;
  const rin  = parseFloat(document.getElementById('f_valore_rinnovo').value)||0;
  const mesi = parseFloat(document.getElementById('f_durata_mesi').value)||0;
  if (off||rin||mesi) document.getElementById('f_ltv').value = (off + rin*(mesi/12)).toFixed(2);
}

async function saveContact() {
  const nome    = document.getElementById('f_nome').value.trim();
  const cognome = document.getElementById('f_cognome').value.trim();
  if (!nome && !cognome) { toast('Inserisci almeno nome o cognome','err'); return; }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = '⏳ Salvataggio...';

  // Track previous stage to detect "Call fissata" transition
  const prevStage = editingId ? (contacts.find(c => c.id === editingId)?.stage || null) : null;
  const savedEditingId = editingId;

  const record = {};
  FIELDS.forEach(f => { const el=document.getElementById('f_'+f); if(el) record[f]=el.value.trim()||null; });

  let error;
  if (editingId) {
    ({ error } = await db.from('contacts').update(record).eq('id', editingId).eq('user_id', currentUser.id));
  } else {
    record.id = uid();
    record.user_id = currentUser.id;
    ({ error } = await db.from('contacts').insert(record));
  }

  btn.disabled = false; btn.textContent = '💾 Salva Contatto';

  if (error) { toast('Errore: '+error.message, 'err'); return; }
  await loadContacts();
  closeContactModal();
  toast(savedEditingId ? 'Contatto aggiornato ✓' : 'Contatto aggiunto ✓', 'ok');

  // Trigger "Call fissata" popup if stage changed to it
  if (record.stage === 'Call fissata' && prevStage !== 'Call fissata') {
    const savedContact = contacts.find(c => c.id === (savedEditingId || record.id));
    if (savedContact) setTimeout(() => openCallFissataPopup(savedContact), 350);
  }
}

// Helper: update contact fields in DB and in local array
async function updateContactInDB(id, fields) {
  const { error } = await db.from('contacts').update(fields).eq('id', id).eq('user_id', currentUser.id);
  if (error) { console.error('[updateContact] error:', error.message); return false; }
  const c = contacts.find(x => x.id === id);
  if (c) Object.assign(c, fields);
  return true;
}

async function deleteContact(id) {
  if (!confirm('Eliminare questo contatto?')) return;
  const { error } = await db.from('contacts').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) { toast('Errore: '+error.message, 'err'); return; }
  await loadContacts();
  toast('Contatto eliminato', 'ok');
}

// ─────────────────────────────────────────────
// IMPORT
// ─────────────────────────────────────────────
function openImport() {
  importBatch = null;
  document.getElementById('importModal').classList.remove('hidden');
  document.getElementById('importPreview').classList.add('hidden');
  document.getElementById('confirmImportBtn').classList.add('hidden');
  document.getElementById('fileInput').value = '';
  document.getElementById('dropZone').style.borderColor = 'var(--border)';
}
function closeImport() { document.getElementById('importModal').classList.add('hidden'); }

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').style.borderColor = 'var(--border)';
  const f = e.dataTransfer.files[0]; if(f) processFile(f);
}
function handleFileSelect(e) { const f=e.target.files[0]; if(f) processFile(f); }

function processFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext==='csv') {
    const r=new FileReader(); r.onload=e=>parseCSV(e.target.result); r.readAsText(file,'UTF-8');
  } else if (['xlsx','xls'].includes(ext)) {
    const r=new FileReader();
    r.onload=e=>{
      const wb=XLSX.read(e.target.result,{type:'binary'});
      processRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''}));
    };
    r.readAsBinaryString(file);
  } else { toast('Formato non supportato. Usa CSV o XLSX','err'); }
}

function parseCSV(text) {
  const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim());
  if (lines.length<2) { toast('File CSV vuoto','err'); return; }
  const headers = splitCSV(lines[0]).map(h=>h.trim().replace(/^"|"$/g,''));
  const rows = lines.slice(1).map(line=>{
    const vals=splitCSV(line); const obj={};
    headers.forEach((h,i)=>obj[h]=(vals[i]||'').trim().replace(/^"|"$/g,''));
    return obj;
  }).filter(r=>Object.values(r).some(v=>v));
  processRows(rows);
}

function splitCSV(line) {
  const res=[]; let cur='', inQ=false;
  for(const ch of line){if(ch==='"')inQ=!inQ;else if(ch===','&&!inQ){res.push(cur);cur='';}else cur+=ch;}
  res.push(cur); return res;
}

function processRows(rows) {
  if(!rows.length){toast('Nessun dato trovato','err');return;}
  importBatch = rows.map((row,i)=>{const c={id:uid(),user_id:currentUser.id,import_order:i};FIELDS.forEach(f=>c[f]=String(row[f]||'').trim()||null);return normalizeStage(c);});
  const prev=document.getElementById('importPreview');
  prev.classList.remove('hidden');
  prev.innerHTML=`<strong>✅ ${importBatch.length} contatti pronti per l'importazione</strong>
    <div style="font-size:12px;color:var(--muted);margin-top:4px">Clicca "Conferma" per salvare su Supabase.</div>`;
  document.getElementById('confirmImportBtn').classList.remove('hidden');
}

async function confirmImport() {
  if(!importBatch) return;
  const btn=document.getElementById('confirmImportBtn');
  btn.disabled=true;

  const CHUNK = 500;
  const total = importBatch.length;
  for (let i = 0; i < total; i += CHUNK) {
    btn.textContent = `⏳ ${Math.min(i+CHUNK,total)}/${total}...`;
    const { error } = await db.from('contacts').upsert(importBatch.slice(i, i+CHUNK), { onConflict: 'id', ignoreDuplicates: false });
    if (error) {
      btn.disabled=false; btn.textContent='✅ Conferma Importazione';
      toast('Errore importazione: '+error.message,'err');
      return;
    }
  }

  btn.disabled=false; btn.textContent='✅ Conferma Importazione';
  sortField = 'import_order'; sortDir = 'asc';
  await loadContacts();
  closeImport();
  navigate('contacts');
  toast(`Importati ${total} contatti ✓`,'ok');
  importBatch=null;
}

// ─────────────────────────────────────────────
// SAMPLE DOWNLOAD
// ─────────────────────────────────────────────
function downloadSample(fmt) {
  const s1={nome:'Mario',cognome:'Rossi',azienda:'Acme Srl',ruolo:'CEO',email:'mario.rossi@acme.com',
    telefono:'+39 333 1234567',linkedin:'https://linkedin.com/in/mario-rossi',sito:'https://acme.com',
    via:'Via Emilia Ponente, 106/A',citta:'Casalecchio di Reno',provincia:'Bologna',stato:'Italia',
    stage:'Email inviata',priorita:'Alta',prossima_azione:'Chiamare',data_azione:'2026-04-01',
    valore_offerta:'5000',valore_rinnovo:'1200',durata_mesi:'12',ltv:'6200',
    data_chiusura:'2026-05-01',data_rinnovo:'2027-05-01',note:'Interessato al piano Enterprise'};
  const s2={nome:'Laura',cognome:'Bianchi',azienda:'Beta SpA',ruolo:'Marketing Director',
    email:'laura.bianchi@beta.it',telefono:'+39 02 9876543',linkedin:'https://linkedin.com/in/laura-bianchi',
    sito:'https://beta.it',via:'Via Roma, 25',citta:'Milano',provincia:'Milano',stato:'Italia',
    stage:'Call fissata',priorita:'Media',prossima_azione:'Preparare preventivo',
    data_azione:'2026-03-25',valore_offerta:'8500',valore_rinnovo:'2400',durata_mesi:'24',ltv:'66100',
    data_chiusura:'',data_rinnovo:'',note:'Budget approvato. Vuole demo.'};

  if(fmt==='csv'){
    const hdr=FIELDS.join(',');
    const r=(s)=>FIELDS.map(f=>`"${(s[f]||'').replace(/"/g,'""')}"`).join(',');
    dlBlob(new Blob(['\ufeff'+hdr+'\n'+r(s1)+'\n'+r(s2)],{type:'text/csv;charset=utf-8'}),'crm_esempio.csv');
  } else {
    const ws=XLSX.utils.json_to_sheet([s1,s2],{header:FIELDS});
    ws['!cols']=FIELDS.map(f=>({wch:Math.max(f.length+2,15)}));
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Contatti');
    XLSX.writeFile(wb,'crm_esempio.xlsx');
  }
  toast('File di esempio scaricato','ok');
}

// ─────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────
function exportCSV() {
  if(!contacts.length){toast('Nessun contatto da esportare','err');return;}
  const hdr=FIELDS.join(',');
  const rows=contacts.map(c=>FIELDS.map(f=>`"${(c[f]||'').replace(/"/g,'""')}"`).join(','));
  dlBlob(new Blob(['\ufeff'+hdr+'\n'+rows.join('\n')],{type:'text/csv;charset=utf-8'}),
    `crm_export_${new Date().toISOString().slice(0,10)}.csv`);
  toast(`Esportati ${contacts.length} contatti`,'ok');
}

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2); }
function fmtDate(s) { if(!s)return''; const p=s.split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:s; }
function fmtMoney(v) { return (parseFloat(v)||0).toLocaleString('it-IT',{minimumFractionDigits:0,maximumFractionDigits:0}); }
function initials(c) { return ((c.nome||'?')[0]+((c.cognome||'')[0]||'')).toUpperCase(); }
const COLORS=['#7c5ef0','#5c3fd4','#ef4444','#f59e0b','#22c55e','#14b8a6','#ec4899','#3b82f6','#f97316','#8b5cf6'];
function avatarColor(c) { let h=0; for(const ch of (c.nome||'')+(c.cognome||'')) h=ch.charCodeAt(0)+((h<<5)-h); return COLORS[Math.abs(h)%COLORS.length]; }
function dlBlob(blob,name) { const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url); }

let toastTimer;
function toast(msg,type='ok') {
  const el=document.getElementById('toast');
  document.getElementById('toastIcon').textContent=type==='ok'?'✓':'✕';
  document.getElementById('toastMsg').textContent=msg;
  el.className=`toast ${type} show`;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),3200);
}

// ─────────────────────────────────────────────
// WEB PUSH — VAPID public key
// ─────────────────────────────────────────────
const VAPID_PUBLIC_KEY = 'BBwi6I6bgyPSxLqSqAi-Qc2BMdMmXwbIQBb5jD96t7ET2BRNd1-b93T_X4qOiDk-F5xjFsXhUT-QytS8OCPYvbM';

function _urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// Subscribe this device to Web Push and save the endpoint to Supabase
async function _subscribeToPush() {
  if (!('PushManager' in window)) return;
  if (!currentUser) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const j = sub.toJSON();
    // Upsert subscription in DB (endpoint is unique key)
    await db.from('push_subscriptions').upsert({
      user_id:  currentUser.id,
      endpoint: j.endpoint,
      p256dh:   j.keys.p256dh,
      auth:     j.keys.auth,
    }, { onConflict: 'endpoint' });
  } catch {}
}

// Unsubscribe this device from push
async function _unsubscribeFromPush() {
  if (!('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch {}
}

// Save a scheduled notification to push_queue so the server can deliver it even when the app is closed
async function _saveToPushQueue(n) {
  if (!currentUser) return;
  await db.from('push_queue').upsert({
    id:      n.id,
    user_id: currentUser.id,
    title:   n.title,
    body:    n.body,
    fire_at: new Date(n.fireAt).toISOString(),
    sent:    false,
  }, { onConflict: 'id', ignoreDuplicates: true });
}

// Ask the send-push edge function to deliver any overdue push notifications now
async function _flushPushQueue() {
  try {
    const { data: { session } } = await db.auth.getSession();
    const token = session?.access_token;
    const base = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : db.supabaseUrl;
    await fetch(`${base}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: '{}',
    });
  } catch {}
}

// ─────────────────────────────────────────────
// NOTIFICATION SYSTEM
// ─────────────────────────────────────────────
let _notifQueue = [];
let _notifShowing = false;
const _notifTimers = [];

function _notifKey() { return `crm_notifs_${currentUser?.id || 'anon'}`; }

function _loadNotifs() {
  try { return JSON.parse(localStorage.getItem(_notifKey()) || '[]'); }
  catch { return []; }
}

function _saveNotifs(notifs) {
  localStorage.setItem(_notifKey(), JSON.stringify(notifs));
}

function _fmtRelTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'adesso';
  if (diff < 3600000) return `${Math.floor(diff/60000)} min fa`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)} ore fa`;
  return `${Math.floor(diff/86400000)} giorni fa`;
}

function _fmtTime(date) {
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

// ── INIT (called on bootApp) ──────────────────
async function initNotifications() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('./sw.js').catch(() => {});
    // Listen for SW messages (e.g. resume sync after background sync event)
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'RESUME_EMAIL_SYNC') {
        const s = _getSyncState();
        if (s && s.running && !window._syncBatchTimer) _scheduleNextSyncBatch(500);
      }
    });
  }
  // On desktop/Android: auto-request permission if still default
  // On iOS Safari we CANNOT ask without a user gesture — the settings card handles that
  const isIOS = /iP(ad|hone|od)/.test(navigator.userAgent);
  if (!isIOS && 'Notification' in window && Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') await _subscribeToPush();
  } else if (Notification.permission === 'granted') {
    await _subscribeToPush();
  }
  await checkAndScheduleNotifications();
  updateNotifBadge();
  // Deliver any overdue push notifications immediately
  _flushPushQueue();
}

// ── CHECK & SCHEDULE ──────────────────────────
async function checkAndScheduleNotifications() {
  if (!currentUser) return;
  const now = Date.now();
  const stored = _loadNotifs();
  const storedIds = new Set(stored.map(n => n.id));
  const newNotifs = [];

  // ── Calendar events: notify 1 hour before start ──
  try {
    const in48h = new Date(now + 48 * 3600 * 1000).toISOString();
    const { data: events } = await db.from('calendar_events')
      .select('id, title, start_time')
      .eq('user_id', currentUser.id)
      .gte('start_time', new Date(now - 2 * 3600 * 1000).toISOString()) // include recent past
      .lte('start_time', in48h);

    for (const ev of (events || [])) {
      const startMs = new Date(ev.start_time).getTime();
      const fireAt = startMs - 3600 * 1000; // 1 hour before
      const id = `ev_${ev.id}`;
      if (!storedIds.has(id)) {
        const startDate = new Date(ev.start_time);
        newNotifs.push({
          id,
          type: 'event',
          title: 'Evento in calendario',
          body: `"${ev.title}" inizia alle ${_fmtTime(startDate)}`,
          fireAt,
          read: false,
          shown: false,
          createdAt: now,
          eventId: ev.id,
        });
      }
    }
  } catch (e) { /* calendar events unavailable */ }

  // ── Actions due tomorrow: notify at 23:00 today ──
  try {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    // Fire at 23:00 of the day before (i.e. today)
    const todayStr = new Date(now).toISOString().split('T')[0];
    const fireAt23 = new Date(todayStr + 'T23:00:00').getTime();

    const { data: acts } = await db.from('contacts')
      .select('id, nome, cognome, prossima_azione, data_azione')
      .eq('user_id', currentUser.id)
      .eq('data_azione', tomorrowStr)
      .not('prossima_azione', 'is', null);

    for (const c of (acts || [])) {
      const id = `act_${c.id}_${tomorrowStr}`;
      if (!storedIds.has(id)) {
        const name = [c.nome, c.cognome].filter(Boolean).join(' ') || 'Contatto';
        newNotifs.push({
          id,
          type: 'action',
          title: 'Azione in scadenza domani',
          body: `${c.prossima_azione} — ${name}`,
          fireAt: fireAt23,
          read: false,
          shown: false,
          createdAt: now,
          contactId: c.id,
        });
      }
    }
  } catch (e) { /* contacts unavailable */ }

  // ── Save new notifications to push_queue for server-side delivery ──
  for (const n of newNotifs) {
    _saveToPushQueue(n); // fire-and-forget
  }

  // ── Merge, clean (keep 7 days), save ──
  const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;
  const allNotifs = [...stored, ...newNotifs].filter(n => n.createdAt > sevenDaysAgo);
  _saveNotifs(allNotifs);

  // ── Process: fire immediately if overdue, or set timer ──
  // Clear existing timers from previous check
  _notifTimers.forEach(t => clearTimeout(t));
  _notifTimers.length = 0;

  for (const n of allNotifs) {
    if (n.shown) continue;
    if (n.fireAt <= now && n.fireAt > now - 3 * 3600 * 1000) {
      // Overdue within last 3 hours → show immediately
      _fireNotification(n.id);
    } else if (n.fireAt > now) {
      // Schedule for this session
      const delay = n.fireAt - now;
      const t = setTimeout(() => _fireNotification(n.id), delay);
      _notifTimers.push(t);
    }
  }
}

function _fireNotification(notifId) {
  const notifs = _loadNotifs();
  const n = notifs.find(x => x.id === notifId);
  if (!n || n.shown) return;
  n.shown = true;
  _saveNotifs(notifs);

  // Queue in-app banner
  _notifQueue.push({ ...n });
  if (!_notifShowing) _processNotifQueue();

  // Browser / OS notification
  if ('Notification' in window && Notification.permission === 'granted') {
    const opts = {
      body: n.body,
      icon: './astralpage_logo.svg',
      badge: './astralpage_logo.svg',
      tag: n.id,
      renotify: false,
    };
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready
        .then(reg => reg.showNotification(n.title, opts))
        .catch(() => new Notification(n.title, opts));
    } else {
      try { new Notification(n.title, opts); } catch {}
    }
  }

  updateNotifBadge();
  renderNotifSidebar();
}

// ── IN-APP BANNER QUEUE ───────────────────────
function _processNotifQueue() {
  if (_notifQueue.length === 0) { _notifShowing = false; return; }
  _notifShowing = true;
  _showInAppBanner(_notifQueue.shift());
}

function _showInAppBanner(n) {
  const wrap = document.getElementById('notifBannerWrap');
  if (!wrap) return;
  const icon = n.type === 'event' ? '📅' : '⏰';
  const div = document.createElement('div');
  div.className = 'notif-banner';
  div.innerHTML =
    `<div class="notif-banner-icon ${n.type}">${icon}</div>` +
    `<div class="notif-banner-content">` +
      `<div class="notif-banner-app">AstralPage CRM</div>` +
      `<div class="notif-banner-title">${n.title}</div>` +
      `<div class="notif-banner-body">${n.body}</div>` +
    `</div>` +
    `<div class="notif-banner-time">ora</div>`;
  div.onclick = () => _dismissBanner(div);
  wrap.appendChild(div);
  // Trigger slide-down animation
  requestAnimationFrame(() => requestAnimationFrame(() => div.classList.add('show')));
  // Auto-dismiss after 4.5 s
  setTimeout(() => _dismissBanner(div), 4500);
}

function _dismissBanner(div) {
  if (div._dismissed) return;
  div._dismissed = true;
  div.classList.remove('show');
  div.classList.add('hide');
  setTimeout(() => {
    div.remove();
    setTimeout(_processNotifQueue, 180); // small gap between banners
  }, 380);
}

// ── BELL BADGE ────────────────────────────────
function updateNotifBadge() {
  const notifs = _loadNotifs();
  const unread = notifs.filter(n => !n.read).length;
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ── SIDEBAR TOGGLE ────────────────────────────
function toggleNotifSidebar() {
  const sidebar = document.getElementById('notifSidebar');
  if (sidebar.classList.contains('open')) closeNotifSidebar();
  else openNotifSidebar();
}

function openNotifSidebar() {
  renderNotifSidebar();
  document.getElementById('notifSidebar').classList.add('open');
  document.getElementById('notifSidebarBackdrop').classList.add('open');
}

function closeNotifSidebar() {
  document.getElementById('notifSidebar').classList.remove('open');
  document.getElementById('notifSidebarBackdrop').classList.remove('open');
}

// ── SIDEBAR RENDER ────────────────────────────
function renderNotifSidebar() {
  const el = document.getElementById('notifList');
  if (!el) return;
  const notifs = _loadNotifs().sort((a, b) => b.createdAt - a.createdAt);

  if (notifs.length === 0) {
    el.innerHTML =
      `<div class="notif-empty">` +
        `<div class="notif-empty-icon">🔔</div>` +
        `<div class="notif-empty-text">Nessuna notifica<br>Le notifiche per eventi e azioni appariranno qui.</div>` +
      `</div>`;
    return;
  }

  el.innerHTML = notifs.map(n => {
    const icon = n.type === 'event' ? '📅' : n.type === 'sync' ? '🔄' : '⏰';
    const unreadClass = n.read ? '' : ' unread';
    const dot = n.read ? '' : `<div class="notif-item-dot"></div>`;
    return `<div class="notif-item${unreadClass}" onclick="markNotifRead('${n.id}')">` +
      `<div class="notif-item-icon ${n.type}">${icon}</div>` +
      `<div class="notif-item-content">` +
        `<div class="notif-item-title">${n.title}</div>` +
        `<div class="notif-item-body">${n.body}</div>` +
        `<div class="notif-item-time">${_fmtRelTime(n.createdAt)}</div>` +
      `</div>` +
      dot +
    `</div>`;
  }).join('');
}

// ── MARK READ ─────────────────────────────────
function markNotifRead(id) {
  const notifs = _loadNotifs();
  const n = notifs.find(x => x.id === id);
  if (n) { n.read = true; _saveNotifs(notifs); }
  updateNotifBadge();
  renderNotifSidebar();
}

function markAllNotifRead() {
  const notifs = _loadNotifs().map(n => ({ ...n, read: true }));
  _saveNotifs(notifs);
  updateNotifBadge();
  renderNotifSidebar();
}

// ─────────────────────────────────────────────
// SMTP SETTINGS
// ─────────────────────────────────────────────
let smtpSettings = null;

async function loadCampaigns() {
  if (!currentUser) return;
  const { data, error } = await db.from('campaigns')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (!error && data) {
    // If a campaign shows as 'running' in DB but no active campaignState, mark as interrupted
    campaignsList = data.map(c => {
      if (c.status === 'running' && !campaignState.active) {
        return { ...c, status: 'interrupted' };
      }
      return c;
    });
  }
}

async function loadSmtpSettings() {
  if (!currentUser) return;
  const { data, error } = await db.from('smtp_settings').select('*').eq('user_id', currentUser.id).maybeSingle();
  if (!error) smtpSettings = data || null;
}

function _normSetting(value) {
  return String(value || '').trim();
}

function getFooterMissingFields(source = {}) {
  const s = source || {};
  const missing = [];
  if (!_normSetting(s.footer_company_name)) missing.push('ragione sociale');
  if (!_normSetting(s.footer_address)) missing.push('indirizzo');
  if (!_normSetting(s.footer_vat_number)) missing.push('partita IVA');
  return missing;
}

function hasFooterContent(source = {}) {
  const s = source || {};
  return [
    s.footer_company_name,
    s.footer_address,
    s.footer_vat_number,
    s.footer_phone,
    s.footer_social_facebook_url,
    s.footer_social_instagram_url,
    s.footer_social_linkedin_url,
    s.footer_social_tiktok_url,
    s.footer_lia_url,
    s.footer_unsubscribe_url,
    s.footer_privacy_url,
    s.footer_logo_path
  ].some(v => _normSetting(v));
}

function getFooterLogoPublicUrl(path) {
  const cleanPath = _normSetting(path);
  if (!cleanPath) return '';
  const { data } = db.storage.from('email-assets').getPublicUrl(cleanPath);
  return data?.publicUrl || '';
}

async function persistSmtpSettingsPatch(patch) {
  if (!currentUser) return { data: null, error: new Error('Utente non autenticato') };
  const payload = { ...patch, updated_at: new Date().toISOString() };

  if (smtpSettings?.id) {
    const { data, error } = await db
      .from('smtp_settings')
      .update(payload)
      .eq('id', smtpSettings.id)
      .eq('user_id', currentUser.id)
      .select()
      .single();

    if (!error && data) smtpSettings = data;
    return { data, error };
  }

  const { data, error } = await db
    .from('smtp_settings')
    .insert({ ...payload, user_id: currentUser.id })
    .select()
    .single();

  if (!error && data) smtpSettings = data;
  return { data, error };
}

async function uploadFooterLogo(input) {
  const file = input?.files?.[0];
  if (!file || !currentUser) return;
  if (file.size > 2 * 1024 * 1024) {
    toast('Il logo non può superare 2MB', 'err');
    input.value = '';
    return;
  }

  const rawExt = (file.name.split('.').pop() || 'png').toLowerCase();
  const ext = rawExt.replace(/[^a-z0-9]/g, '') || 'png';
  const newPath = `${currentUser.id}/footer-logo.${ext}`;
  const oldPath = _normSetting(smtpSettings?.footer_logo_path);
  const storage = db.storage.from('email-assets');

  const { error: uploadErr } = await storage.upload(newPath, file, {
    upsert: true,
    contentType: file.type || undefined,
    cacheControl: '3600'
  });

  if (uploadErr) {
    toast('Errore upload logo: ' + uploadErr.message, 'err');
    input.value = '';
    return;
  }

  const { error } = await persistSmtpSettingsPatch({ footer_logo_path: newPath });
  if (error) {
    if (!oldPath || oldPath !== newPath) await storage.remove([newPath]).catch(() => {});
    toast('Errore salvataggio logo: ' + error.message, 'err');
    input.value = '';
    return;
  }

  if (oldPath && oldPath !== newPath) await storage.remove([oldPath]).catch(() => {});
  input.value = '';
  renderSettings();
  toast('Logo footer caricato ✓', 'ok');
}

async function removeFooterLogo() {
  const oldPath = _normSetting(smtpSettings?.footer_logo_path);
  if (!oldPath) return;
  await db.storage.from('email-assets').remove([oldPath]).catch(() => {});
  const { error } = await persistSmtpSettingsPatch({ footer_logo_path: null });
  if (error) {
    toast('Errore rimozione logo: ' + error.message, 'err');
    return;
  }
  renderSettings();
  toast('Logo footer rimosso', 'ok');
}

async function renderSettings() {
  await checkCalendarStatus();
  const s = smtpSettings || {};
  const footerMissing = getFooterMissingFields(s);
  const footerHasContent = hasFooterContent(s);
  const footerLogoUrl = getFooterLogoPublicUrl(s.footer_logo_path);
  const footerStatus = !footerHasContent
    ? {
        label: 'Footer non configurato',
        tone: 'rgba(255,255,255,0.04)',
        border: 'rgba(255,255,255,0.08)',
        color: 'var(--muted)'
      }
    : footerMissing.length
      ? {
          label: `Footer incompleto: manca ${footerMissing.join(', ')}`,
          tone: 'rgba(255,80,80,0.08)',
          border: 'rgba(255,80,80,0.22)',
          color: '#fca5a5'
        }
      : {
          label: 'Footer pronto per compose e campagne',
          tone: 'rgba(34,197,94,0.08)',
          border: 'rgba(34,197,94,0.22)',
          color: '#86efac'
        };

  // Determine current push state for the settings card
  const notifSupported = ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window);
  const notifPerm = notifSupported ? Notification.permission : 'unsupported';
  let pushSubscribed = false;
  if (notifPerm === 'granted' && notifSupported) {
    try {
      const reg = await navigator.serviceWorker.ready;
      pushSubscribed = !!(await reg.pushManager.getSubscription());
    } catch {}
  }
  const isIOS = /iP(ad|hone|od)/.test(navigator.userAgent);
  const isInStandaloneIOS = isIOS && window.matchMedia('(display-mode: standalone)').matches;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  // Android install card: shown only when the browser has an install prompt ready
  const androidInstallCard = (!isStandalone && _deferredInstallPrompt) ? `
      <div class="settings-card">
        <div class="settings-card-icon">📲</div>
        <h3>Installa App su Android</h3>
        <p>Aggiungi AstralPage CRM alla schermata Home per un accesso rapido e per ricevere notifiche push anche quando il browser è chiuso.</p>
        <div style="margin-top:14px">
          <button class="btn btn-primary btn-sm" onclick="installAndroidApp()">Installa app</button>
        </div>
      </div>` : '';

  // Build the notification card HTML
  let notifCardBody = '';
  if (!notifSupported) {
    notifCardBody = `<p style="color:var(--muted);font-size:13px;margin-top:10px">Il tuo browser non supporta le notifiche push.</p>`;
  } else if (isIOS && !isInStandaloneIOS) {
    notifCardBody = `
      <div style="margin-top:12px;padding:12px;border-radius:10px;background:rgba(255,200,0,0.08);border:1px solid rgba(255,200,0,0.2)">
        <p style="font-size:13px;color:var(--text-sec);margin:0 0 8px 0">Su iPhone/iPad devi prima aggiungere l'app alla Home Screen per ricevere notifiche push.</p>
        <p style="font-size:12px;color:var(--muted);margin:0">Tocca <strong style="color:var(--text)">Condividi</strong> → <strong style="color:var(--text)">Aggiungi a Home</strong>, poi riapri l'app dall'icona sulla home.</p>
      </div>`;
  } else if (notifPerm === 'denied') {
    notifCardBody = `
      <div style="margin-top:12px;padding:12px;border-radius:10px;background:rgba(255,80,80,0.08);border:1px solid rgba(255,80,80,0.2)">
        <p style="font-size:13px;color:var(--text-sec);margin:0 0 8px 0">Le notifiche sono bloccate nelle impostazioni del browser.</p>
        <p style="font-size:12px;color:var(--muted);margin:0">Apri le impostazioni del browser, cerca questo sito e abilita le Notifiche.</p>
      </div>`;
  } else if (notifPerm === 'granted' && pushSubscribed) {
    notifCardBody = `
      <div style="margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--success);font-weight:500">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--success);box-shadow:0 0 6px var(--success);display:inline-block"></span>
          Notifiche attive su questo dispositivo
        </span>
        <button class="btn btn-secondary btn-sm" onclick="disableNotifications()">Disattiva</button>
      </div>`;
  } else {
    notifCardBody = `
      <div style="margin-top:12px">
        <button class="btn btn-primary btn-sm" onclick="enableNotifications()">Attiva notifiche su questo dispositivo</button>
      </div>`;
  }
  document.getElementById('content').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:18px;max-width:760px">

      <div class="settings-card">
        <div class="settings-card-icon">FT</div>
        <h3>Footer Email</h3>
        <p>Firma HTML automatica usata nelle nuove email e nelle campagne. Le risposte restano senza footer.</p>
        <div style="margin:0 0 18px 0;padding:10px 12px;border-radius:10px;background:${footerStatus.tone};border:1px solid ${footerStatus.border};font-size:12px;color:${footerStatus.color}">
          ${footerStatus.label}
        </div>
        <div class="settings-form-col">
          <div class="form-group">
            <label>Logo</label>
            ${footerLogoUrl
              ? `<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:10px">
                  <div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,0.02)">
                    <img src="${escHtml(footerLogoUrl)}" alt="Logo footer" style="display:block;max-width:140px;max-height:54px;width:auto;height:auto">
                  </div>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="removeFooterLogo()">Rimuovi logo</button>
                </div>`
              : `<div style="margin-bottom:10px;padding:12px;border:1px dashed var(--border);border-radius:12px;color:var(--muted);font-size:12px">Nessun logo caricato</div>`
            }
            <input id="s_footer_logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onchange="uploadFooterLogo(this)">
            <small style="color:var(--muted);font-size:11px;margin-top:4px;display:block">Upload pubblico su Supabase Storage. Formati: PNG, JPG, SVG, WebP. Max 2MB.</small>
          </div>
          <div class="form-group">
            <label>Ragione sociale *</label>
            <input id="s_footer_company_name" type="text" placeholder="Astralpage S.R.L." value="${escHtml(s.footer_company_name||'')}">
          </div>
          <div class="form-group">
            <label>Indirizzo *</label>
            <input id="s_footer_address" type="text" placeholder="Via Massarenti, 480 - 40131 Bologna (BO)" value="${escHtml(s.footer_address||'')}">
          </div>
          <div class="form-group">
            <label>Partita IVA *</label>
            <input id="s_footer_vat_number" type="text" placeholder="03608431205" value="${escHtml(s.footer_vat_number||'')}">
          </div>
          <div class="form-group">
            <label>Email footer</label>
            <input type="text" value="${escHtml(s.user_email||'')}" disabled style="opacity:0.75;cursor:not-allowed">
            <small style="color:var(--muted);font-size:11px;margin-top:4px;display:block">Viene presa automaticamente dall'account email che invia.</small>
          </div>
          <div class="form-group">
            <label>Telefono</label>
            <input id="s_footer_phone" type="text" placeholder="+39 051 1234567" value="${escHtml(s.footer_phone||'')}">
          </div>
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;padding-top:4px">Social</div>
          <div class="form-group">
            <label>Facebook</label>
            <input id="s_footer_social_facebook_url" type="url" placeholder="https://facebook.com/..." value="${escHtml(s.footer_social_facebook_url||'')}">
          </div>
          <div class="form-group">
            <label>Instagram</label>
            <input id="s_footer_social_instagram_url" type="url" placeholder="https://instagram.com/..." value="${escHtml(s.footer_social_instagram_url||'')}">
          </div>
          <div class="form-group">
            <label>LinkedIn</label>
            <input id="s_footer_social_linkedin_url" type="url" placeholder="https://linkedin.com/company/..." value="${escHtml(s.footer_social_linkedin_url||'')}">
          </div>
          <div class="form-group">
            <label>TikTok</label>
            <input id="s_footer_social_tiktok_url" type="url" placeholder="https://tiktok.com/@..." value="${escHtml(s.footer_social_tiktok_url||'')}">
          </div>
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;padding-top:4px">Link legali</div>
          <div class="form-group">
            <label>Link LIA</label>
            <input id="s_footer_lia_url" type="url" placeholder="https://tuodominio.it/lia/" value="${escHtml(s.footer_lia_url||'')}">
          </div>
          <div class="form-group">
            <label>Link Disiscrizione</label>
            <input id="s_footer_unsubscribe_url" type="url" placeholder="https://tuodominio.it/unsubscribe" value="${escHtml(s.footer_unsubscribe_url||'')}">
          </div>
          <div class="form-group">
            <label>Link Privacy Policy</label>
            <input id="s_footer_privacy_url" type="url" placeholder="https://tuodominio.it/privacy-policy/" value="${escHtml(s.footer_privacy_url||'')}">
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-icon">👤</div>
        <h3>Profilo Mittente Campagne</h3>
        <p>Nome, cognome e ruolo usati dai placeholder nelle email generate per le campagne.</p>
        <div class="settings-form-col">
          <div class="form-group">
            <label>Nome</label>
            <input id="s_mittente_nome" type="text" placeholder="Mario" value="${escHtml(s.mittente_nome||'')}">
          </div>
          <div class="form-group">
            <label>Cognome</label>
            <input id="s_mittente_cognome" type="text" placeholder="Rossi" value="${escHtml(s.mittente_cognome||'')}">
          </div>
          <div class="form-group">
            <label>Ruolo</label>
            <input id="s_mittente_ruolo" type="text" placeholder="es. Responsabile Commerciale" value="${escHtml(s.mittente_ruolo||'')}">
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-icon">🔐</div>
        <h3>Credenziali Account Email</h3>
        <p>Email e password condivise tra SMTP e IMAP.</p>
        <div class="settings-form-col">
          <div class="form-group">
            <label>Email *</label>
            <input id="s_user_email" type="email" placeholder="noreply@tuaazienda.com" value="${escHtml(s.user_email||'')}">
          </div>
          <div class="form-group">
            <label>Password</label>
            <div class="pwd-wrap">
              <input id="s_password" type="password" placeholder="••••••••" value="${escHtml(s.password||'')}">
              <button type="button" class="pwd-toggle" id="pwdToggle" onclick="toggleSmtpPwd()">👁</button>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-icon">📤</div>
        <h3>SMTP — Invio Email</h3>
        <p>Server utilizzato per inviare email dal CRM.</p>
        <div class="settings-form-col">
          <div class="form-group">
            <label>Host SMTP</label>
            <input id="s_host" type="text" placeholder="es. gnld1014.siteground.eu" value="${escHtml(s.host||'')}">
          </div>
          <div class="form-group">
            <label>Porta SMTP</label>
            <input id="s_porta" type="number" placeholder="es. 587" value="${s.porta||''}">
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-icon">📥</div>
        <h3>IMAP — Ricezione Email</h3>
        <p>Server utilizzato per ricevere e leggere le email in entrata.</p>
        <div class="settings-form-col">
          <div class="form-group">
            <label>Host IMAP</label>
            <input id="s_imap_host" type="text" placeholder="es. imap.siteground.eu" value="${escHtml(s.imap_host||'')}">
          </div>
          <div class="form-group">
            <label>Porta IMAP</label>
            <input id="s_imap_porta" type="number" placeholder="es. 993" value="${s.imap_porta||''}">
          </div>
          <div class="form-group">
            <label>Cartella Posta Inviata</label>
            <input id="s_imap_sent_folder" type="text" placeholder="es. Sent, Sent Items, [Gmail]/Sent Mail" value="${escHtml(s.imap_sent_folder||'')}">
            <small style="color:var(--muted);font-size:11px;margin-top:4px;display:block">Gmail: <code>[Gmail]/Sent Mail</code> · Outlook: <code>Sent Items</code> · Standard: <code>Sent</code></small>
          </div>
        </div>
      </div>

      <div class="settings-footer" style="margin-top:0">
        <button class="btn btn-primary" onclick="saveSmtpSettings()">💾 Salva Impostazioni</button>
        ${s.updated_at ? `<span class="settings-last-save">Ultimo salvataggio: ${new Date(s.updated_at).toLocaleString('it-IT')}</span>` : ''}
      </div>

      ${androidInstallCard}

      <div class="settings-card">
        <div class="settings-card-icon">🔔</div>
        <h3>Notifiche Push</h3>
        <p>Ricevi notifiche su questo dispositivo per eventi del calendario e azioni in scadenza, anche quando l'app è chiusa.</p>
        ${notifCardBody}
      </div>

      <div class="settings-card">
        <div class="settings-card-icon">📅</div>
        <h3>Google Calendar</h3>
        <p>Collega il tuo Google Calendar per sincronizzare appuntamenti e creare inviti con Google Meet direttamente dal CRM.</p>
        <div style="margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          ${googleCalendarConnected
            ? `<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--success);font-weight:500">
                <span style="width:8px;height:8px;border-radius:50%;background:var(--success);box-shadow:0 0 6px var(--success);display:inline-block"></span>
                Collegato
               </span>
               <button class="btn btn-secondary btn-sm" onclick="disconnectGoogleCalendar()">Disconnetti</button>`
            : `<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);font-weight:500">
                <span style="width:8px;height:8px;border-radius:50%;background:var(--muted);display:inline-block"></span>
                Non collegato
               </span>
               <button class="btn btn-primary btn-sm" onclick="connectGoogleCalendar()">Collega Google Calendar</button>`
          }
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-icon">📆</div>
        <h3>Outlook Calendar</h3>
        <p>Collega il tuo Outlook Calendar (Microsoft 365) per sincronizzare appuntamenti e creare riunioni Teams direttamente dal CRM.</p>
        <div style="margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          ${outlookCalendarConnected
            ? `<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--success);font-weight:500">
                <span style="width:8px;height:8px;border-radius:50%;background:var(--success);box-shadow:0 0 6px var(--success);display:inline-block"></span>
                Collegato
               </span>
               <button class="btn btn-secondary btn-sm" onclick="disconnectOutlookCalendar()">Disconnetti</button>`
            : `<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);font-weight:500">
                <span style="width:8px;height:8px;border-radius:50%;background:var(--muted);display:inline-block"></span>
                Non collegato
               </span>
               <button class="btn btn-primary btn-sm" onclick="connectOutlookCalendar()">Collega Outlook Calendar</button>`
          }
        </div>
      </div>

    </div>
  `;
}

async function enableNotifications() {
  if (!('Notification' in window)) return;
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    await _subscribeToPush();
    toast('Notifiche attivate ✓', 'ok');
  } else {
    toast('Permesso notifiche negato', 'err');
  }
  renderSettings();
}

async function disableNotifications() {
  await _unsubscribeFromPush();
  toast('Notifiche disattivate', 'ok');
  renderSettings();
}

async function installAndroidApp() {
  if (!_deferredInstallPrompt) return;
  _deferredInstallPrompt.prompt();
  const { outcome } = await _deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    _deferredInstallPrompt = null;
    renderSettings();
  }
}

function toggleSmtpPwd() {
  const inp = document.getElementById('s_password');
  const btn = document.getElementById('pwdToggle');
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
}

async function saveSmtpSettings() {
  const user_email       = document.getElementById('s_user_email').value.trim();
  const password         = document.getElementById('s_password').value;
  const host             = document.getElementById('s_host').value.trim();
  const porta            = parseInt(document.getElementById('s_porta').value) || null;

  if (!user_email) { toast('Inserisci l\'email mittente', 'err'); return; }

  const imap_host        = document.getElementById('s_imap_host').value.trim();
  const imap_porta       = parseInt(document.getElementById('s_imap_porta').value) || null;
  const imap_sent_folder = document.getElementById('s_imap_sent_folder').value.trim() || 'Sent';
  const mittente_nome    = document.getElementById('s_mittente_nome').value.trim();
  const mittente_cognome = document.getElementById('s_mittente_cognome').value.trim();
  const mittente_ruolo   = document.getElementById('s_mittente_ruolo').value.trim();
  const footer_company_name = document.getElementById('s_footer_company_name').value.trim();
  const footer_address = document.getElementById('s_footer_address').value.trim();
  const footer_vat_number = document.getElementById('s_footer_vat_number').value.trim();
  const footer_phone = document.getElementById('s_footer_phone').value.trim();
  const footer_social_facebook_url = document.getElementById('s_footer_social_facebook_url').value.trim();
  const footer_social_instagram_url = document.getElementById('s_footer_social_instagram_url').value.trim();
  const footer_social_linkedin_url = document.getElementById('s_footer_social_linkedin_url').value.trim();
  const footer_social_tiktok_url = document.getElementById('s_footer_social_tiktok_url').value.trim();
  const footer_lia_url = document.getElementById('s_footer_lia_url').value.trim();
  const footer_unsubscribe_url = document.getElementById('s_footer_unsubscribe_url').value.trim();
  const footer_privacy_url = document.getElementById('s_footer_privacy_url').value.trim();

  const payload = {
    user_email,
    password,
    host,
    porta,
    imap_host,
    imap_porta,
    imap_sent_folder,
    mittente_nome,
    mittente_cognome,
    mittente_ruolo,
    footer_company_name,
    footer_address,
    footer_vat_number,
    footer_phone,
    footer_social_facebook_url,
    footer_social_instagram_url,
    footer_social_linkedin_url,
    footer_social_tiktok_url,
    footer_lia_url,
    footer_unsubscribe_url,
    footer_privacy_url,
    footer_logo_path: smtpSettings?.footer_logo_path || null
  };
  const { error } = await persistSmtpSettingsPatch(payload);

  if (error) { toast('Errore salvataggio: ' + error.message, 'err'); return; }
  renderSettings();
  toast('Impostazioni SMTP salvate ✓', 'ok');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─────────────────────────────────────────────
// EMAIL
// ─────────────────────────────────────────────
let emailState = { folder: 'INBOX', emails: [], selectedId: null, replyContext: null, page: 0 };

function isEmailConfigured() {
  return !!(smtpSettings && smtpSettings.host && smtpSettings.imap_host && smtpSettings.user_email);
}

async function renderEmail() {
  if (!isEmailConfigured()) {
    document.getElementById('content').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:420px;flex-direction:column;gap:20px;text-align:center">
        <div style="font-size:66px">📭</div>
        <h2 style="font-size:20px;font-weight:700">Email non configurata</h2>
        <p style="color:var(--muted);font-size:14px;max-width:400px;line-height:1.7">
          Per usare la sezione Email devi configurare i server <strong>SMTP</strong> (invio)
          e <strong>IMAP</strong> (ricezione) nelle impostazioni.
        </p>
        <button class="btn btn-primary" onclick="navigate('settings')" style="padding:11px 26px;font-size:14px">
          ⚙️ Configura SMTP &amp; IMAP
        </button>
      </div>`;
    return;
  }
  // Remove content padding for full-height Gmail layout
  const content = document.getElementById('content');
  const isMobile = window.innerWidth <= 768;
  content.style.padding = '0';
  content.style.overflow = isMobile ? 'auto' : 'hidden';
  _renderEmailShell();
  await fetchEmails();

  // Light incremental refresh every 90 seconds (only fetches newest 50, no full sync)
  // Runs globally — not stopped when leaving email view
  if (!window._emailRefreshInterval) {
    window._emailRefreshInterval = setInterval(async () => {
      // Skip if a full sync is running, or if on a virtual folder
      if (_getSyncState()?.running) return;
      if (['ARCHIVE', 'SPAM', 'TRASH', 'STARRED'].includes(emailState.folder)) return;
      try {
        await db.functions.invoke('imap-fetch', {
          body: { folder: emailState.folder, offset: 0, batch_size: 50 }
        });
        if (currentView === 'email') fetchEmails(false, true);
      } catch (_) {}
    }, 90000);
  }
}

function _renderEmailShell() {
  document.getElementById('content').innerHTML = `
    <div class="email-layout" id="emailLayout">
      <div class="email-folders">
        <div class="email-compose-btn" onclick="openComposeModal()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Scrivi
        </div>
        <div class="email-folders-label">Cartelle</div>
        <div class="email-folder-item active" id="efolder-INBOX" onclick="emailSwitchFolder('INBOX')">
          <span>📥</span><span style="flex:1">Posta in arrivo</span>
          <span class="email-unread-count hidden" id="ecount-INBOX">0</span>
        </div>
        <div class="email-folder-item" id="efolder-SENT" onclick="emailSwitchFolder('SENT')">
          <span>📤</span><span>Inviata</span>
        </div>
        <div class="email-folder-item" id="efolder-STARRED" onclick="emailSwitchFolder('STARRED')">
          <span>⭐</span><span>Speciali</span>
        </div>
        <div class="email-folder-item" id="efolder-ARCHIVE" onclick="emailSwitchFolder('ARCHIVE')">
          <span>🗃️</span><span>Archivio</span>
        </div>
        <div class="email-folder-item" id="efolder-SPAM" onclick="emailSwitchFolder('SPAM')">
          <span>⚠️</span><span>Spam</span>
        </div>
        <div class="email-folder-item" id="efolder-TRASH" onclick="emailSwitchFolder('TRASH')">
          <span>🗑️</span><span>Cestino</span>
        </div>
        <div class="email-folders-label" style="margin-top:8px">Azioni</div>
        <div class="email-folder-item" id="syncEmailBtn" onclick="startEmailSync(emailState.folder)">
          <span>🔄</span><span id="syncLabel">Sincronizza tutto</span>
        </div>
        <div class="email-folder-item" onclick="fetchEmails(true)">
          <span>⚡</span><span>Aggiorna recenti</span>
        </div>
        <div id="emailSyncSidebarProgress" class="email-sync-sidebar-progress hidden">
          <div class="email-sync-sidebar-label">
            <span id="sidebarSyncText">Sincronizzando...</span>
            <span id="sidebarSyncPct">0%</span>
          </div>
          <div class="email-sync-sidebar-bar">
            <div class="email-sync-sidebar-fill" id="sidebarSyncFill"></div>
          </div>
        </div>
      </div>
      <div class="email-list-panel">
        <div class="email-list-toolbar">
          <button class="email-toolbar-btn" title="Aggiorna" onclick="fetchEmails(true)" style="font-size:18px;font-weight:400">↻</button>
          <div id="emailPagination" class="email-list-pagination"></div>
        </div>
        <div class="email-list-scroll" id="emailListPanel">
          <div class="loading-wrap"><div class="spinner"></div></div>
        </div>
      </div>
      <div class="email-detail-panel" id="emailDetailPanel">
        <div class="email-no-select">
          <span style="font-size:52px">✉️</span>
          <span>Seleziona un'email da leggere</span>
        </div>
      </div>
      <button class="email-fab" onclick="openComposeModal()" title="Scrivi" aria-label="Nuovo messaggio">✏</button>
    </div>`;
}

async function fetchEmails(forceSync = false, silent = false) {
  const listPanel = document.getElementById('emailListPanel');
  if (!listPanel) return;
  if (!silent) listPanel.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';

  // Virtual folders (ARCHIVE, SPAM, TRASH, STARRED) don't have real IMAP counterparts
  const virtualFolders = ['ARCHIVE', 'SPAM', 'TRASH', 'STARRED'];
  const isVirtualFolder = virtualFolders.includes(emailState.folder);

  if (forceSync && !isVirtualFolder) {
    try {
      const { data: r, error: fnErr } = await db.functions.invoke('imap-fetch', {
        body: { folder: emailState.folder }
      });
      if (fnErr || r?.error) {
        if (!silent) toast('Errore sync IMAP: ' + (r?.error || fnErr.message), 'err');
      } else {
        if (!silent) toast(`Sincronizzate ${r?.count || 0} email ✓`, 'ok');
      }
    } catch (e) {
      if (!silent) toast('Edge function non raggiungibile: ' + e.message, 'err');
    }
  }

  let query = db
    .from('emails')
    .select('id, message_id, thread_id, from_name, from_email, to, subject, date, folder, read, starred, archived, spam, deleted_at, text_body')
    .eq('user_id', currentUser.id)
    .order('date', { ascending: false })
    .limit(500);

  // Apply folder-specific filters
  if (emailState.folder === 'STARRED') {
    query = query.eq('starred', true).is('deleted_at', null);
  } else if (emailState.folder === 'ARCHIVE') {
    query = query.eq('archived', true).is('deleted_at', null);
  } else if (emailState.folder === 'SPAM') {
    query = query.eq('spam', true).is('deleted_at', null);
  } else if (emailState.folder === 'TRASH') {
    query = query.not('deleted_at', 'is', null);
  } else {
    // Real IMAP folders: exclude archived, spam, and deleted
    query = query
      .eq('folder', emailState.folder)
      .eq('archived', false)
      .eq('spam', false)
      .is('deleted_at', null);
  }

  const { data, error } = await query;

  if (error) {
    listPanel.innerHTML = `<div class="empty"><div class="ei">⚠️</div><h3>Errore</h3><p>${escHtml(error.message)}</p><p style="font-size:12px;color:var(--muted);margin-top:8px">Assicurati che la tabella <code>emails</code> esista su Supabase.</p></div>`;
    return;
  }

  emailState.emails = data || [];
  emailState.page = 0;

  // When loading INBOX, update contacts to Alta if they sent us an email (they replied)
  if (emailState.folder === 'INBOX' && emailState.emails.length) {
    const inboxSenders = new Set(
      emailState.emails.map(e => (e.from_email || '').toLowerCase().trim()).filter(Boolean)
    );
    const toUpgrade = contacts.filter(c =>
      c.email && inboxSenders.has(c.email.toLowerCase().trim()) && c.priorita !== 'Alta'
    );
    for (const c of toUpgrade) {
      await updateContactInDB(c.id, { priorita: 'Alta' });
    }
  }

  _renderEmailList();
}

function _renderEmailList() {
  const panel = document.getElementById('emailListPanel');
  if (!panel) return;

  if (!emailState.emails.length) {
    panel.innerHTML = `<div class="empty" style="padding:48px 20px">
      <div class="ei" style="font-size:44px">📭</div>
      <h3>Nessuna email</h3>
      <p style="font-size:13px">Clicca "Sincronizza" per caricare le email dal server IMAP</p>
    </div>`;
    _renderEmailPagination();
    return;
  }

  const unread = emailState.emails.filter(e => !e.read).length;
  const cntEl = document.getElementById('ecount-INBOX');
  if (cntEl) { cntEl.textContent = unread; cntEl.classList.toggle('hidden', !unread); }

  const pageSize = 50;
  const page = emailState.page || 0;
  const start = page * pageSize;
  const pageEmails = emailState.emails.slice(start, start + pageSize);

  panel.innerHTML = pageEmails.map(e => {
    const from = escHtml(e.from_name || e.from_email || '—');
    const subj = escHtml(e.subject || '(Nessun oggetto)');
    const preview = escHtml((e.text_body || '').replace(/\s+/g, ' ').trim().slice(0, 100));
    const isActive = emailState.selectedId === e.id;
    const readClass = e.read ? 'read' : 'unread';
    return `<div class="email-list-item ${readClass}${isActive ? ' active' : ''}" onclick="openEmail('${e.id}')">
      <div class="email-item-check" onclick="event.stopPropagation()"><input type="checkbox"></div>
      <div class="email-item-star${e.starred ? ' starred' : ''}" onclick="event.stopPropagation();toggleEmailStar('${e.id}')" title="${e.starred ? 'Rimuovi stella' : 'Aggiungi stella'}">${e.starred ? '★' : '☆'}</div>
      <div class="email-item-from">${from}</div>
      <div class="email-item-body">
        <span class="email-item-subject">${subj}</span>
        <span class="email-item-sep">—</span>
        <span class="email-item-preview">${preview}</span>
      </div>
      <div class="email-item-date">${fmtEmailDate(e.date)}</div>
    </div>`;
  }).join('');

  _renderEmailPagination();
}

function _renderEmailPagination() {
  const pag = document.getElementById('emailPagination');
  if (!pag) return;
  const page = emailState.page || 0;
  const pageSize = 50;
  const total = emailState.emails.length;
  if (!total) { pag.innerHTML = ''; return; }
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  pag.innerHTML = `<span>${start}–${end} di ${total}</span>
    <button class="email-page-btn" title="Pagina precedente" onclick="emailChangePage(-1)" ${page === 0 ? 'disabled' : ''}>&#8249;</button>
    <button class="email-page-btn" title="Pagina successiva" onclick="emailChangePage(1)" ${end >= total ? 'disabled' : ''}>&#8250;</button>`;
}

function emailChangePage(delta) {
  const pageSize = 50;
  const maxPage = Math.floor((emailState.emails.length - 1) / pageSize);
  emailState.page = Math.max(0, Math.min((emailState.page || 0) + delta, maxPage));
  document.getElementById('emailListPanel').scrollTop = 0;
  _renderEmailList();
}

async function openEmail(id) {
  emailState.selectedId = id;
  document.getElementById('emailLayout')?.classList.add('email-detail-open');
  const found = emailState.emails.find(e => e.id === id);
  if (!found) return;

  // Optimistic read mark
  if (!found.read) {
    found.read = true;
    _renderEmailList();
    await db.from('emails').update({ read: true }).eq('id', id).eq('user_id', currentUser.id);
  } else {
    _renderEmailList();
  }

  const panel = document.getElementById('emailDetailPanel');
  if (panel) panel.innerHTML = '<div class="loading-wrap" style="height:200px"><div class="spinner"></div></div>';

  // Fetch full email (includes html_body)
  const { data: full } = await db.from('emails').select('*').eq('id', id).eq('user_id', currentUser.id).single();
  const email = full || found;

  // Fetch thread
  const threadId = email.thread_id || email.message_id;
  const { data: thread } = await db
    .from('emails')
    .select('*')
    .eq('user_id', currentUser.id)
    .or(`thread_id.eq.${threadId},message_id.eq.${threadId}`)
    .order('date', { ascending: true });

  const messages = (thread && thread.length) ? thread : [email];

  emailState.replyContext = {
    to: email.from_email || email.from_name || '',
    subject: email.subject || '',
    messageId: email.message_id || '',
    threadId: threadId || ''
  };

  _renderEmailDetail(messages);
}

function _renderEmailDetail(messages) {
  const panel = document.getElementById('emailDetailPanel');
  if (!panel) return;

  const subj = messages[messages.length - 1]?.subject || '';
  const rc = emailState.replyContext;

  const msgsHtml = messages.map((m, i) => {
    const isLast = i === messages.length - 1;
    const fromName = m.from_name || m.from_email || m.from || '—';
    const initChar = escHtml((fromName[0] || '?').toUpperCase());
    const snippet = escHtml((m.text_body || '').replace(/\s+/g, ' ').trim().slice(0, 80));
    const bodyContent = m.html_body
      ? `<iframe srcdoc="${escHtml(m.html_body)}" class="email-html-frame" onload="this.style.height=(this.contentDocument.body.scrollHeight+20)+'px'"></iframe>`
      : `<pre class="email-message-body">${escHtml(m.text_body || m.body || '(Corpo vuoto)')}</pre>`;
    const collapsedClass = isLast ? '' : ' collapsed';
    return `<div class="email-message${collapsedClass}" id="emsg-${m.id}">
      <div class="email-message-header" onclick="toggleEmailMessage('${m.id}')">
        <div class="email-message-avatar">${initChar}</div>
        <div class="email-message-meta">
          <div class="email-message-from">${escHtml(fromName)}</div>
          <div class="email-message-to-short">a: ${escHtml(m.to || 'me')}</div>
          <div class="email-message-snippet">${snippet}</div>
        </div>
        <div class="email-message-date">${fmtEmailDateFull(m.date)}</div>
        <div class="email-message-hdr-actions">
          <button class="email-toolbar-btn" title="Rispondi" onclick="event.stopPropagation()" style="font-size:14px">↩</button>
        </div>
      </div>
      <div class="email-message-content">${bodyContent}</div>
    </div>`;
  }).join('');

  const currentEmail = emailState.emails.find(e => e.id === emailState.selectedId);
  const isRead = currentEmail?.read !== false;
  panel.innerHTML = `
    <div class="email-detail-toolbar">
      <button class="email-back-btn" onclick="emailGoBack()" title="Indietro">&#8249;</button>
      <button class="email-toolbar-btn" title="Archivia" onclick="emailAction('archive')" style="font-size:14px">🗃️</button>
      <button class="email-toolbar-btn" title="Segnala spam" onclick="emailAction('spam')" style="font-size:14px">⚠️</button>
      <button class="email-toolbar-btn" title="Sposta nel cestino" onclick="emailAction('trash')" style="font-size:14px">🗑️</button>
      <div style="width:1px;height:22px;background:var(--border);margin:0 4px"></div>
      <button class="email-toolbar-btn" data-action="toggle-read" title="${isRead ? 'Segna come non letto' : 'Segna come letto'}" onclick="emailToggleRead()" style="font-size:14px">${isRead ? '✉️' : '📩'}</button>
    </div>
    <div class="email-thread-subject">${escHtml(subj || '(Nessun oggetto)')}</div>
    <div style="padding:0 0 8px">${msgsHtml}</div>
    <div class="email-reply-wrap">
      <div class="email-reply-box">
        <div class="email-reply-to-bar">
          <span class="email-reply-to-label">A:</span>
          <span>${escHtml(rc?.to || '')}</span>
        </div>
        <textarea class="email-reply-textarea" id="replyBody" placeholder="Scrivi una risposta..."></textarea>
        <div class="email-reply-footer">
          <span class="email-reply-from">Da: ${escHtml(smtpSettings?.user_email || '')}</span>
          <button class="btn btn-primary btn-sm" id="sendReplyBtn" onclick="sendReply()">Invia</button>
        </div>
      </div>
    </div>`;
}

function toggleEmailMessage(id) {
  const el = document.getElementById('emsg-' + id);
  if (el) el.classList.toggle('collapsed');
}

async function sendReply() {
  const rc = emailState.replyContext;
  if (!rc) { toast('Nessuna email selezionata', 'err'); return; }
  const body = document.getElementById('replyBody')?.value?.trim();
  if (!body) { toast('Scrivi il testo della risposta', 'err'); return; }

  const btn = document.getElementById('sendReplyBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Invio...'; }

  const replySubject = rc.subject.startsWith('Re:') ? rc.subject : 'Re: ' + rc.subject;
  try {
    const { error: fnErr } = await db.functions.invoke('smtp-send', {
      body: { to: rc.to, subject: replySubject, body, inReplyTo: rc.messageId, threadId: rc.threadId }
    });
    if (fnErr) {
      let msg = fnErr.message;
      try { const ctx = await fnErr.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch {}
      throw new Error(msg);
    }
    // Update contact priority to Media when user manually replies
    const replyToEmail = (rc.to || '').toLowerCase().trim();
    const replyContact = contacts.find(c => c.email && c.email.toLowerCase().trim() === replyToEmail);
    if (replyContact) await updateContactInDB(replyContact.id, { priorita: 'Media' });
    toast('Risposta inviata ✓', 'ok');
    document.getElementById('replyBody').value = '';
    if (emailState.selectedId) openEmail(emailState.selectedId);
  } catch (e) {
    toast('Errore invio: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✈️ Invia Risposta'; }
  }
}

// ─────────────────────────────────────────────
// EMAIL ACTIONS — compose, star, archive, spam, trash, mark read/unread
// ─────────────────────────────────────────────

function openComposeModal(prefillTo) {
  const overlay = document.getElementById('composeModal');
  if (!overlay) return;
  document.getElementById('composeTo').value = prefillTo || '';
  document.getElementById('composeSubject').value = '';
  document.getElementById('composeBody').value = '';
  const fromLabel = document.getElementById('composeFromLabel');
  if (fromLabel) fromLabel.textContent = 'Da: ' + (smtpSettings?.user_email || '');
  overlay.classList.add('open');
  setTimeout(() => document.getElementById('composeTo').focus(), 50);
}

function closeComposeModal() {
  const overlay = document.getElementById('composeModal');
  if (overlay) overlay.classList.remove('open');
}

async function sendCompose() {
  const to      = (document.getElementById('composeTo')?.value || '').trim();
  const subject = (document.getElementById('composeSubject')?.value || '').trim();
  const body    = (document.getElementById('composeBody')?.value || '').trim();
  if (!to)      { toast('Inserisci un destinatario', 'err'); return; }
  if (!subject) { toast('Inserisci un oggetto', 'err'); return; }
  if (!body)    { toast('Scrivi il testo del messaggio', 'err'); return; }

  const btn = document.getElementById('composeBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Invio...'; }

  try {
    const { error: fnErr } = await db.functions.invoke('smtp-send', {
      body: { to, subject, body, includeFooter: true }
    });
    if (fnErr) {
      let msg = fnErr.message;
      try { const ctx = await fnErr.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch {}
      throw new Error(msg);
    }
    toast('Email inviata ✓', 'ok');
    closeComposeModal();
    // Refresh SENT folder if currently visible
    if (emailState.folder === 'SENT') fetchEmails(false, true);
  } catch (e) {
    toast('Errore invio: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Invia'; }
  }
}

// Fire-and-forget IMAP action (best-effort, never blocks UI)
function _imapAction(emailId, action) {
  db.functions.invoke('imap-action', { body: { email_id: emailId, action } }).catch(() => {});
}

async function toggleEmailStar(id) {
  const email = emailState.emails.find(e => e.id === id);
  if (!email) return;
  email.starred = !email.starred;
  _renderEmailList();
  await db.from('emails').update({ starred: email.starred }).eq('id', id).eq('user_id', currentUser.id);
  _imapAction(id, email.starred ? 'star' : 'unstar');
}

async function emailToggleRead() {
  const id = emailState.selectedId;
  if (!id) return;
  const email = emailState.emails.find(e => e.id === id);
  if (!email) return;
  email.read = !email.read;
  _renderEmailList();
  // Re-render toolbar to reflect new read state
  const toolbar = document.querySelector('.email-detail-toolbar');
  if (toolbar) {
    const btn = toolbar.querySelector('[data-action="toggle-read"]');
    if (btn) btn.title = email.read ? 'Segna come non letto' : 'Segna come letto';
  }
  await db.from('emails').update({ read: email.read }).eq('id', id).eq('user_id', currentUser.id);
  _imapAction(id, email.read ? 'mark_read' : 'mark_unread');
}

async function emailAction(action) {
  const id = emailState.selectedId;
  if (!id) return;
  const email = emailState.emails.find(e => e.id === id);
  if (!email) return;

  const dbUpdate = {};
  if (action === 'archive') dbUpdate.archived = true;
  else if (action === 'spam') dbUpdate.spam = true;
  else if (action === 'trash') dbUpdate.deleted_at = new Date().toISOString();

  // Optimistic: remove from current list view (it no longer belongs to this folder)
  emailState.emails = emailState.emails.filter(e => e.id !== id);
  emailState.selectedId = null;
  _renderEmailList();
  const detailPanel = document.getElementById('emailDetailPanel');
  if (detailPanel) detailPanel.innerHTML = '<div class="email-no-select"><span style="font-size:52px">✉️</span><span>Seleziona un\'email da leggere</span></div>';

  await db.from('emails').update(dbUpdate).eq('id', id).eq('user_id', currentUser.id);
  _imapAction(id, action);

  const labels = { archive: 'Archiviata ✓', spam: 'Segnata come spam ✓', trash: 'Spostata nel cestino ✓' };
  toast(labels[action] || 'Fatto ✓', 'ok');
}

// ─────────────────────────────────────────────
// EMAIL SYNC ENGINE — persists across navigation, reload, re-login
// State is stored in localStorage so it survives page refresh.
// The sync loop runs as a global setTimeout (not tied to any view).
// A DB record in email_sync_jobs is created for each full sync so
// it can be resumed after logout/re-login.
// ─────────────────────────────────────────────

function _syncKey() { return currentUser ? `crm_esync_${currentUser.id}` : null; }

function _getSyncState() {
  const k = _syncKey();
  if (!k) return null;
  try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; }
}

function _saveSyncState(s) {
  const k = _syncKey();
  if (!k) return;
  if (s) localStorage.setItem(k, JSON.stringify(s));
  else localStorage.removeItem(k);
}

function _updateSyncUI() {
  const s = _getSyncState();
  const banner  = document.getElementById('emailSyncBanner');
  const fill    = document.getElementById('syncBannerFill');
  const pct     = document.getElementById('syncBannerPct');
  const text    = document.getElementById('syncBannerText');
  const icon    = document.getElementById('syncBannerIcon');
  const stopBtn = document.getElementById('syncStopBtn');

  // Sidebar elements (only present when in email view)
  const sidebarProg = document.getElementById('emailSyncSidebarProgress');
  const sidebarFill = document.getElementById('sidebarSyncFill');
  const sidebarPct  = document.getElementById('sidebarSyncPct');
  const sidebarText = document.getElementById('sidebarSyncText');
  const syncLabel   = document.getElementById('syncLabel');

  if (!s || !s.running) {
    if (banner) banner.classList.remove('visible');
    if (sidebarProg) sidebarProg.classList.add('hidden');
    if (syncLabel) syncLabel.textContent = 'Sincronizza tutto';
    return;
  }

  const pctVal = s.total > 0 ? Math.round((s.synced / s.total) * 100) : 0;
  const label = s.total > 0
    ? `Sync ${s.folder}: ${s.synced} / ${s.total} email (${pctVal}%)`
    : `Sync ${s.folder}: connessione...`;

  if (banner) banner.classList.add('visible');
  if (fill)    fill.style.width = pctVal + '%';
  if (pct)     pct.textContent  = pctVal + '%';
  if (text)    text.textContent = label;
  if (icon)    icon.className   = 'sync-banner-icon';
  if (stopBtn) stopBtn.style.display = '';

  if (sidebarProg) sidebarProg.classList.remove('hidden');
  if (sidebarFill) sidebarFill.style.width = pctVal + '%';
  if (sidebarPct)  sidebarPct.textContent  = pctVal + '%';
  if (sidebarText) sidebarText.textContent = `${s.synced}/${s.total} email`;
  if (syncLabel)   syncLabel.textContent   = '⏳ In corso...';
}

async function startEmailSync(folder) {
  folder = folder || emailState.folder || 'INBOX';
  // Cannot sync virtual folders — redirect to their underlying IMAP folder
  if (['ARCHIVE', 'SPAM', 'TRASH', 'STARRED'].includes(folder)) {
    toast('Seleziona Posta in arrivo o Inviata per sincronizzare', 'ok');
    return;
  }
  const existing = _getSyncState();
  if (existing && existing.running) {
    toast('Sincronizzazione già in corso', 'ok');
    return;
  }

  // Create a DB job so it can be resumed after re-login
  let jobId = null;
  try {
    const { data: job } = await db.from('email_sync_jobs').insert({
      user_id: currentUser.id,
      folder,
      status: 'running',
      total_messages: 0,
      synced_messages: 0,
    }).select('id').single();
    jobId = job?.id || null;
  } catch (_) {}

  _saveSyncState({ running: true, folder, total: 0, synced: 0, offset: 0, jobId, startedAt: Date.now() });
  _updateSyncUI();

  // Register background sync so browser can resume if connectivity drops
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      if (reg.sync) reg.sync.register('email-sync').catch(() => {});
    });
  }

  // Add notification
  _addSyncNotif('🔄 Sincronizzazione email avviata', `Cartella: ${folder}`);

  _scheduleNextSyncBatch(0);
}

function _scheduleNextSyncBatch(delayMs) {
  if (window._syncBatchTimer) clearTimeout(window._syncBatchTimer);
  window._syncBatchTimer = setTimeout(_runSyncBatch, delayMs);
}

async function _runSyncBatch() {
  const s = _getSyncState();
  if (!s || !s.running) return;

  try {
    const { data: r, error } = await db.functions.invoke('imap-fetch', {
      body: { folder: s.folder, offset: s.offset, batch_size: 50, job_id: s.jobId }
    });

    if (error || r?.error) {
      const detail = r?.detail;
      const extra = detail?.responseText ? ` — ${detail.responseText}` : '';
      throw new Error((r?.error || error.message) + extra);
    }

    const newSynced = s.synced + (r.count || 0);
    const newOffset = s.offset + (r.attempted ?? r.count ?? 0);
    const total     = r.total || s.total;
    const done      = r.done || newOffset >= total;

    if (done) {
      _saveSyncState(null); // clear state
      _updateSyncUI();
      // Mark banner as completed briefly then hide
      const banner = document.getElementById('emailSyncBanner');
      const icon   = document.getElementById('syncBannerIcon');
      const text   = document.getElementById('syncBannerText');
      const fill   = document.getElementById('syncBannerFill');
      const stop   = document.getElementById('syncStopBtn');
      if (banner) banner.classList.add('visible');
      if (icon)   { icon.textContent = '✅'; icon.className = 'sync-banner-icon done'; }
      if (text)   text.textContent = `Sincronizzazione completata: ${newSynced} email`;
      if (fill)   fill.style.width = '100%';
      if (stop)   stop.style.display = 'none';
      setTimeout(() => { if (banner) banner.classList.remove('visible'); }, 4000);

      _addSyncNotif('✅ Sincronizzazione completata', `${newSynced} email sincronizzate in ${s.folder}`);

      // Refresh email list if visible
      if (currentView === 'email') fetchEmails(false, true);
    } else {
      _saveSyncState({ ...s, total, synced: newSynced, offset: newOffset });
      _updateSyncUI();
      _scheduleNextSyncBatch(800); // small pause between batches
    }
  } catch (e) {
    const s2 = _getSyncState();
    _saveSyncState(null);
    _updateSyncUI();
    const banner = document.getElementById('emailSyncBanner');
    if (banner) banner.classList.remove('visible');
    toast('Errore sync email: ' + e.message, 'err');
    _addSyncNotif('⚠️ Errore sincronizzazione', e.message);
    // Mark DB job as error
    if (s2?.jobId) {
      db.from('email_sync_jobs').update({ status: 'error', error_msg: e.message }).eq('id', s2.jobId).then(() => {});
    }
  }
}

function stopEmailSync() {
  const s = _getSyncState();
  if (!s) return;
  if (window._syncBatchTimer) clearTimeout(window._syncBatchTimer);
  // Mark DB job as stopped
  if (s.jobId) {
    db.from('email_sync_jobs').update({ status: 'stopped', synced_messages: s.synced, total_messages: s.total })
      .eq('id', s.jobId).then(() => {});
  }
  _saveSyncState(null);
  _updateSyncUI();
  const banner = document.getElementById('emailSyncBanner');
  if (banner) banner.classList.remove('visible');
  toast('Sincronizzazione fermata', 'ok');
  _addSyncNotif('⏹ Sincronizzazione fermata', `${s.synced} email sincronizzate su ${s.total}`);
}

function _addSyncNotif(title, body) {
  const notifs = _loadNotifs();
  notifs.push({
    id: 'sync-' + Date.now(),
    type: 'sync',
    title,
    body,
    read: false,
    shown: true,
    createdAt: Date.now(),
    fireAt: Date.now(),
  });
  const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
  _saveNotifs(notifs.filter(n => n.createdAt > sevenDaysAgo));
  updateNotifBadge();
  renderNotifSidebar();
}

// Called at boot: resume any sync that was in progress before reload/logout
async function resumeEmailSyncIfPending() {
  const s = _getSyncState();
  if (!s || !s.running) return;
  // Validate the saved job still exists and is still running in DB
  if (s.jobId) {
    try {
      const { data: job } = await db.from('email_sync_jobs').select('status').eq('id', s.jobId).single();
      if (job && job.status !== 'running') {
        _saveSyncState(null); // job was externally stopped/completed
        return;
      }
    } catch (_) {}
  }
  toast('Ripresa sincronizzazione email...', 'ok');
  _updateSyncUI();
  _scheduleNextSyncBatch(2000);
}

// Legacy shim: kept so any old references still work
async function syncEmails() {
  await startEmailSync(emailState.folder);
}

function emailSwitchFolder(folder) {
  emailState.folder = folder;
  emailState.selectedId = null;
  emailState.replyContext = null;
  document.getElementById('emailLayout')?.classList.remove('email-detail-open');
  emailState.page = 0;
  document.querySelectorAll('.email-folder-item[id^="efolder-"]').forEach(el => el.classList.remove('active'));
  const el = document.getElementById('efolder-' + folder);
  if (el) el.classList.add('active');
  fetchEmails();
}

function emailGoBack() {
  emailState.selectedId = null;
  emailState.replyContext = null;
  document.getElementById('emailLayout')?.classList.remove('email-detail-open');
  const panel = document.getElementById('emailDetailPanel');
  if (panel) panel.innerHTML = `<div class="email-no-select"><span style="font-size:52px">✉️</span><span>Seleziona un'email da leggere</span></div>`;
  _renderEmailList();
}

function fmtEmailDate(d) {
  if (!d) return '';
  const date = new Date(d), today = new Date();
  if (date.toDateString() === today.toDateString())
    return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Ieri';
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}

function fmtEmailDateFull(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────
// CAMPAIGNS
// ─────────────────────────────────────────────
let campaignDraft = {};
let campaignState = {
  active: false, draft: {}, emailTemplate: '', emailSubject: '',
  targetContacts: [], sent: 0, total: 0, running: false, startedAt: null, failed: 0,
  dbId: null, lastIndex: -1, resumeFromIndex: 0, errorCode: null, errorDetail: null
};
let campaignsView = 'list'; // 'list' | 'form' | 'editor' | 'execution'
let campaignsList = [];
let campaignViewRecord = null; // null = show live campaignState, else = static DB record

// Groq is called server-side via the groq-generate edge function (see supabase/functions/groq-generate)

function renderCampaigns() {
  // Sub-view dispatch
  if (campaignsView === 'list') { renderCampaignsList(); return; }
  if (campaignsView === 'execution') { renderCampaignDashboard(); return; }

  const hasContacts = contacts.length > 0;
  const hasEmail    = isEmailConfigured();
  const content     = document.getElementById('content');

  if (!hasContacts || !hasEmail) {
    const cards = [];

    if (!hasContacts) {
      cards.push(`
        <div class="cw-blocked-card">
          <div class="cbc-icon">👥</div>
          <h4>Importa i tuoi leads</h4>
          <p>Per creare una campagna hai bisogno di almeno un contatto nel CRM con un ruolo assegnato.</p>
          <button class="btn btn-primary btn-sm" onclick="openImport()">📤 Importa Leads</button>
        </div>`);
    } else {
      cards.push(`
        <div class="cw-blocked-card">
          <div class="cbc-icon">👥</div>
          <h4>Leads importati</h4>
          <p>Hai ${contacts.length} contatto${contacts.length !== 1 ? 'i' : ''} nel CRM.</p>
          <span class="cbc-status-ok">Tutto ok</span>
        </div>`);
    }

    if (!hasEmail) {
      cards.push(`
        <div class="cw-blocked-card">
          <div class="cbc-icon">📧</div>
          <h4>Configura SMTP e IMAP</h4>
          <p>Per inviare le email della campagna devi prima configurare il server di posta in uscita (SMTP) e in entrata (IMAP).</p>
          <button class="btn btn-primary btn-sm" onclick="navigate('settings')">⚙️ Vai alle Impostazioni</button>
        </div>`);
    } else {
      cards.push(`
        <div class="cw-blocked-card">
          <div class="cbc-icon">📧</div>
          <h4>Email configurata</h4>
          <p>SMTP e IMAP sono configurati e pronti all'uso.</p>
          <span class="cbc-status-ok">Tutto ok</span>
        </div>`);
    }

    content.innerHTML = `
      <div class="cw-blocked">
        <button class="btn btn-secondary btn-sm" onclick="campaignsView='list';renderCampaigns()" style="margin-bottom:24px;align-self:flex-start">← Campagne</button>
        <div class="cw-blocked-icon">🔒</div>
        <div class="cw-blocked-title">Sezione non disponibile</div>
        <div class="cw-blocked-sub">Per accedere alle campagne email devi prima completare i seguenti passaggi:</div>
        <div class="cw-blocked-cards">${cards.join('')}</div>
      </div>`;
    return;
  }

  // Collect unique non-empty roles from contacts
  const ruoli = [...new Set(contacts.map(c => c.ruolo).filter(r => r && r.trim()))].sort();

  const ruoloOptions = ruoli.length
    ? ruoli.map(r => `<option value="${escHtml(r)}" ${campaignDraft.target_ruolo === r ? 'selected' : ''}>${escHtml(r)}</option>`).join('')
    : `<option value="">— nessun ruolo presente nei contatti —</option>`;

  const d = campaignDraft;

  // Filtra contatti per stage in base a contatto_tipo, poi estrai i ruoli disponibili
  let contactsFiltrati = contacts;
  if (d.contatto_tipo === 'Prima volta') {
    contactsFiltrati = contacts.filter(c => c.stage === 'Lead generico' || c.stage === 'Cold call');
  } else if (d.contatto_tipo === 'Seconda volta') {
    contactsFiltrati = contacts.filter(c => c.stage === 'Email inviata');
  }
  const ruoliFiltrati = [...new Set(contactsFiltrati.map(c => c.ruolo).filter(r => r && r.trim()))].sort();

  function radioGroup(name, options) {
    return options.map((opt, i) => `
      <div class="cw-opt">
        <input type="radio" name="${name}" id="${name}_${i}" value="${escHtml(opt)}" ${d[name] === opt ? 'checked' : ''} onchange="campaignDraft['${name}']=this.value">
        <label for="${name}_${i}">${escHtml(opt)}</label>
      </div>`).join('');
  }

  content.innerHTML = `
    <div class="cw-container">
      <div style="margin-bottom:20px">
        <button class="btn btn-secondary btn-sm" onclick="campaignsView='list';campaignDraft={};renderCampaigns()">← Campagne</button>
      </div>
      <div class="cw-header-block">
        <h2>✉️ Nuova Campagna Email</h2>
        <p>Rispondi a tutte le domande — l'AI utilizzerà queste informazioni per scrivere le email della campagna.</p>
      </div>

      <!-- Q1 -->
      <div class="cw-q-card">
        <div class="cw-q-num">Domanda 1 di 9</div>
        <div class="cw-q-title">Qual è l'obiettivo della tua campagna?</div>
        <div class="cw-q-sub">Scegli un solo obiettivo</div>
        <div class="cw-options">
          ${radioGroup('obiettivo', ['Acquisire nuovi clienti', 'Fare recruiting', 'Contattare una lista di tuoi già clienti'])}
        </div>
      </div>

      <!-- Q2 -->
      <div class="cw-q-card">
        <div class="cw-q-num">Domanda 2 di 9</div>
        <div class="cw-q-title">È la prima o la seconda volta che contatti queste persone via email?</div>
        <div class="cw-q-sub">Questa informazione serve per mostrarti solo i contatti appropriati per questa campagna</div>
        <div class="cw-options">
          <div class="cw-opt">
            <input type="radio" name="contatto_tipo" id="contatto_tipo_0" value="Prima volta" ${d.contatto_tipo === 'Prima volta' ? 'checked' : ''} onchange="campaignDraft['contatto_tipo']=this.value;renderCampaigns()">
            <label for="contatto_tipo_0">Prima volta</label>
          </div>
          <div class="cw-opt">
            <input type="radio" name="contatto_tipo" id="contatto_tipo_1" value="Seconda volta" ${d.contatto_tipo === 'Seconda volta' ? 'checked' : ''} onchange="campaignDraft['contatto_tipo']=this.value;renderCampaigns()">
            <label for="contatto_tipo_1">Seconda volta</label>
          </div>
        </div>
      </div>

      <!-- Q3 -->
      <div class="cw-q-card">
        <div class="cw-q-num">Domanda 3 di 9</div>
        <div class="cw-q-title">Quale target vuoi andare a colpire per questa campagna?</div>
        <div class="cw-q-sub">Seleziona uno o più ruoli dal tuo CRM — puoi sceglierli tutti, filtrare, o selezionare solo quelli che ti interessano${d.contatto_tipo ? ` <span style="color:var(--primary-text);font-weight:600">(filtrati per: ${escHtml(d.contatto_tipo === 'Prima volta' ? 'Lead generico / Cold call' : 'Email inviata')})</span>` : ''}</div>
        ${ruoliFiltrati.length ? `
        <div class="cw-target-selector">
          <div class="cw-target-toolbar">
            <input type="text" class="cw-target-search" placeholder="🔍 Filtra per ruolo..." oninput="filterCampaignRoles(this.value)">
            <button class="btn btn-secondary btn-sm" onclick="selectAllCampaignRoles(true)">Tutti</button>
            <button class="btn btn-secondary btn-sm" onclick="selectAllCampaignRoles(false)">Nessuno</button>
          </div>
          <div class="cw-target-list">
            ${ruoliFiltrati.map(r => `<label class="cw-target-item" data-role="${escHtml(r)}">
              <input type="checkbox" value="${escHtml(r)}" ${(campaignDraft.target_ruoli||[]).includes(r) ? 'checked' : ''} onchange="updateCampaignTargetRuoli()">
              <span class="cw-target-item-label">${escHtml(r)}</span>
            </label>`).join('')}
          </div>
          <div class="cw-target-count" id="cw_target_count">${(() => { const n=(campaignDraft.target_ruoli||[]).length; return n ? `${n} ruolo${n===1?'':'i'} selezionato${n===1?'':'i'}` : 'Nessun ruolo selezionato'; })()}</div>
        </div>` : `<div style="margin-top:8px;font-size:12px;color:var(--warning)">⚠️ Nessun contatto ha un ruolo assegnato. <span style="cursor:pointer;text-decoration:underline;color:var(--primary-text)" onclick="openContactModal()">Aggiungi contatti con ruolo</span> oppure <span style="cursor:pointer;text-decoration:underline;color:var(--primary-text)" onclick="openImport()">importa un file</span>.</div>`}
      </div>

      <!-- Q4 -->
      <div class="cw-q-card">
        <div class="cw-q-num">Domanda 4 di 9</div>
        <div class="cw-q-title">Seleziona il numero stimato dei dipendenti del tuo target ideale</div>
        <div class="cw-q-sub">Anche se non sai quanti sono fai una stima, serve all'AI per scrivere meglio le email</div>
        <div class="cw-options">
          ${radioGroup('dipendenti', ['0–10', '11–50', '51–100', '101–250', '251–500', '500+'])}
        </div>
      </div>

      <!-- Q5 -->
      <div class="cw-q-card">
        <div class="cw-q-num">Domanda 5 di 9</div>
        <div class="cw-q-title">Seleziona il fatturato annuo stimato del tuo target ideale</div>
        <div class="cw-q-sub">Anche se non sai quanto fattura all'anno fai una stima, serve all'AI per scrivere meglio le email</div>
        <div class="cw-options">
          ${radioGroup('fatturato', ['< 250k', '251k–500k', '501k–1M', '1M–5M', '5M+'])}
        </div>
      </div>

      <!-- Q6 -->
      <div class="cw-q-card">
        <div class="cw-q-num">Domanda 6 di 9</div>
        <div class="cw-q-title">Descrivi brevemente chi sei</div>
        <div class="cw-q-sub">Scrivi in una frase una tua presentazione personale</div>
        <textarea class="cw-textarea" rows="3" maxlength="280" id="cw_presentazione"
          placeholder="Es: Sono Mario Rossi, consulente di marketing digitale con 10 anni di esperienza nel settore retail..."
          oninput="campaignDraft.presentazione=this.value;updateCharCount('cw_presentazione','cw_char6',280)">${escHtml(d.presentazione||'')}</textarea>
        <div class="cw-char-hint" id="cw_char6">${(d.presentazione||'').length}/280 caratteri</div>
      </div>

      <!-- Q7 -->
      <div class="cw-q-card">
        <div class="cw-q-num">Domanda 7 di 9</div>
        <div class="cw-q-title">Descrivi dettagliatamente il prodotto o servizio che vuoi andare a promuovere</div>
        <div class="cw-q-sub">Scrivi un solo prodotto o servizio nel dettaglio, più sarai preciso e meglio l'AI scriverà le email.<br><strong style="color:var(--warning)">Attenzione: NON scrivere più di un prodotto</strong></div>
        <textarea class="cw-textarea" rows="5" id="cw_prodotto"
          placeholder="Descrivi nel dettaglio il tuo prodotto o servizio: cosa fa, come funziona, a chi è rivolto..."
          oninput="campaignDraft.prodotto=this.value">${escHtml(d.prodotto||'')}</textarea>
      </div>

      <!-- Q8 -->
      <div class="cw-q-card">
        <div class="cw-q-num">Domanda 8 di 9</div>
        <div class="cw-q-title">Descrivi dettagliatamente il punto di forza del tuo prodotto o servizio</div>
        <div class="cw-q-sub">Perché le persone dovrebbero scegliere proprio il tuo prodotto e non quello di qualcun altro?</div>
        <textarea class="cw-textarea" rows="5" id="cw_forza"
          placeholder="Es: A differenza dei competitor, il nostro servizio offre... Il risultato principale che ottengono i nostri clienti è..."
          oninput="campaignDraft.forza=this.value">${escHtml(d.forza||'')}</textarea>
      </div>

      <!-- Q9 -->
      <div class="cw-q-card">
        <div class="cw-q-num">Domanda 9 di 10</div>
        <div class="cw-q-title">Descrivi dettagliatamente la garanzia che vuoi offrire sul tuo prodotto o servizio</div>
        <div class="cw-q-sub">Con una garanzia chiara puoi convincere più facilmente le persone a fidarsi e acquistare da te, senza una garanzia rischi di non ricevere appuntamenti</div>
        <textarea class="cw-textarea" rows="5" id="cw_garanzia"
          placeholder="Es: Offriamo una garanzia soddisfatti o rimborsati entro 30 giorni. Se non ottieni risultati entro 60 giorni ti restituiamo..."
          oninput="campaignDraft.garanzia=this.value">${escHtml(d.garanzia||'')}</textarea>
      </div>

      <!-- Q10 -->
      <div class="cw-q-card">
        <div class="cw-q-num">Domanda 10 di 10</div>
        <div class="cw-q-title">Quanti contatti vuoi contattare?</div>
        <div class="cw-q-sub">Indica il numero massimo di destinatari. Se è superiore ai contatti disponibili, verranno selezionati tutti.</div>
        <input type="number" class="cw-input" id="cw_max_contatti" min="1"
          style="width:160px;padding:9px 12px;background:var(--bg-surface);border:1px solid var(--border-md);border-radius:var(--radius-sm);color:var(--text);font-size:15px;font-family:inherit;outline:none;"
          placeholder="Es: 50"
          value="${d.max_contatti||''}"
          oninput="campaignDraft.max_contatti=this.value?parseInt(this.value):null"
          onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor=''">
      </div>

      <div class="cw-footer">
        <button class="btn btn-primary" onclick="validateCampaignForm()" style="padding:11px 28px;font-size:14px">
          Continua →
        </button>
      </div>
    </div>`;
}

function updateCharCount(textareaId, counterId, max) {
  const ta = document.getElementById(textareaId);
  const el = document.getElementById(counterId);
  if (!ta || !el) return;
  const len = ta.value.length;
  el.textContent = `${len}/${max} caratteri`;
  el.classList.toggle('warn', len > max * 0.9);
}

function filterCampaignRoles(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.cw-target-item').forEach(el => {
    el.style.display = (!q || el.dataset.role.toLowerCase().includes(q)) ? '' : 'none';
  });
}

function selectAllCampaignRoles(all) {
  document.querySelectorAll('.cw-target-item').forEach(el => {
    if (el.style.display !== 'none') el.querySelector('input[type=checkbox]').checked = all;
  });
  updateCampaignTargetRuoli();
}

function updateCampaignTargetRuoli() {
  const selected = [...document.querySelectorAll('.cw-target-item input[type=checkbox]:checked')].map(cb => cb.value);
  campaignDraft.target_ruoli = selected;
  const countEl = document.getElementById('cw_target_count');
  if (countEl) {
    const n = selected.length;
    countEl.textContent = n ? `${n} ruolo${n===1?'':'i'} selezionato${n===1?'':'i'}` : 'Nessun ruolo selezionato';
  }
}

function validateCampaignForm() {
  const d = campaignDraft;
  const missing = [];
  if (!d.obiettivo)                    missing.push('Obiettivo della campagna (Dom. 1)');
  if (!d.contatto_tipo)                missing.push('Prima o seconda volta (Dom. 2)');
  if (!(d.target_ruoli||[]).length)    missing.push('Target / ruolo (Dom. 3)');
  if (!d.dipendenti)    missing.push('Numero dipendenti (Dom. 4)');
  if (!d.fatturato)     missing.push('Fatturato stimato (Dom. 5)');
  if (!(d.presentazione||'').trim()) missing.push('Chi sei (Dom. 6)');
  if (!(d.prodotto||'').trim())      missing.push('Prodotto / servizio (Dom. 7)');
  if (!(d.forza||'').trim())         missing.push('Punto di forza (Dom. 8)');
  if (!(d.garanzia||'').trim())      missing.push('Garanzia (Dom. 9)');

  if (missing.length) {
    toast('Compila tutti i campi obbligatori', 'err');
    // Highlight: scroll to first missing card
    const cards = document.querySelectorAll('.cw-q-card');
    const missingNums = missing.map(m => parseInt(m.match(/Dom\. (\d)/)?.[1])).filter(Boolean);
    if (missingNums.length && cards[missingNums[0]-1]) {
      cards[missingNums[0]-1].scrollIntoView({ behavior: 'smooth', block: 'center' });
      cards[missingNums[0]-1].style.borderColor = 'var(--danger)';
      setTimeout(() => { if(cards[missingNums[0]-1]) cards[missingNums[0]-1].style.borderColor = ''; }, 2000);
    }
    return;
  }

  // All good — generate email with AI
  generateEmailWithGroq();
}

// ── AI Email generation ──
async function generateEmailWithGroq() {
  const d = campaignDraft;
  const content = document.getElementById('content');

  content.innerHTML = `
    <div class="ce-generating">
      <div class="ce-generating-icon">🤖</div>
      <h3>L'AI sta scrivendo la tua email...</h3>
      <p>Sto elaborando le tue risposte e generando un'email personalizzata ad alto tasso di risposta.</p>
      <div class="spinner" style="margin-top:10px"></div>
    </div>`;

  try {
    const bodyPrompt = `Scrivi il corpo di una cold email B2B in italiano perfetto, senza errori grammaticali o ortografici.

CONTESTO:
- Obiettivo: ${d.obiettivo}
- Destinatario: ${(d.target_ruoli||[]).join(', ')} di aziende con ${d.dipendenti} dipendenti e fatturato ${d.fatturato}
- Mittente: ${d.presentazione}
- Prodotto/servizio: ${d.prodotto}
- Punto di forza unico: ${d.forza}
- Garanzia offerta: ${d.garanzia}

STRUTTURA (segui questo ordine esatto, senza titoli o numerazione):

[APERTURA] Rivolgiti a {{nome}} con una frase breve e incisiva che riconosce qualcosa di specifico e concreto sul suo ruolo ({{ruolo}}) in {{azienda}}. Deve sembrare scritta per lui, non copiata. Evita frasi come "Spero che tu stia bene", "La contatto perché", o qualsiasi formula di apertura generica.

[PRESENTAZIONE] In 1-2 frasi presenta chi scrive (basati su: ${d.presentazione}). Sii diretto, niente giri di parole.

[PROPOSTA] In 1-2 frasi spiega cosa offri e il vantaggio concreto che porta. Parla di risultati e benefici per il destinatario, non di caratteristiche del prodotto.

[GARANZIA] Una frase sulla garanzia. Deve ridurre il rischio percepito e dare sicurezza.

[CTA] Una domanda o invito chiaro e semplice per fissare una breve chiamata o appuntamento gratuito. Rendi facile dire sì.

[FIRMA]
Cordiali saluti,
{{mittente_nome}} {{mittente_cognome}}
{{mittente_ruolo}}

REGOLE OBBLIGATORIE:
- Usa ESATTAMENTE questi placeholder: {{nome}}, {{azienda}}, {{ruolo}}, {{mittente_nome}}, {{mittente_cognome}}, {{mittente_ruolo}}
- SOLO il corpo dell'email — nessun oggetto, nessun titolo, nessuna spiegazione
- Italiano impeccabile: niente errori di grammatica, ortografia o punteggiatura
- Tono: diretto, umano, professionale — mai commerciale o da newsletter
- Lunghezza: 120-160 parole
- Non inventare informazioni non fornite`;

    const subjectPrompt = `Crea l'oggetto di una cold email in italiano (massimo 7 parole, senza virgolette) per un ${(d.target_ruoli||[]).join('/')}. Obiettivo della email: ${d.obiettivo}. L'oggetto deve incuriosire, sembrare personale e rilevante, mai generico o pubblicitario. Rispondi solo con l'oggetto, nient'altro.`;

    const { data: groqData, error: groqErr } = await db.functions.invoke('groq-generate', {
      body: { bodyPrompt, subjectPrompt }
    });

    if (groqErr) throw new Error(groqErr.message || 'Errore edge function groq-generate');
    if (groqData?.error) throw new Error(groqData.error);

    campaignDraft.generatedEmail   = groqData.body;
    campaignDraft.generatedSubject = groqData.subject || `Opportunità per ${(d.target_ruoli||[]).join('/')||'il tuo team'}`;

    campaignsView = 'editor';
    renderCampaignEditor();
  } catch (e) {
    toast('Errore generazione email: ' + e.message, 'err');
    // Go back to the form
    campaignDraft.generatedEmail = undefined;
    renderCampaigns();
  }
}

// ── Campaign Editor ──
function renderCampaignEditor() {
  const d = campaignDraft;
  const content = document.getElementById('content');

  let targetContacts = contacts.filter(c => (d.target_ruoli||[]).includes(c.ruolo));
  if (d.contatto_tipo === 'Prima volta') {
    targetContacts = targetContacts.filter(c => c.stage === 'Lead generico' || c.stage === 'Cold call');
  } else if (d.contatto_tipo === 'Seconda volta') {
    targetContacts = targetContacts.filter(c => c.stage === 'Email inviata');
  }
  // Applica limite max_contatti (Q10)
  const maxContatti = d.max_contatti ? parseInt(d.max_contatti) : null;
  if (maxContatti && maxContatti > 0) {
    targetContacts = targetContacts.slice(0, maxContatti);
  }
  const contactsWithEmail = targetContacts.filter(c => c.email && c.email.trim()).length;

  const contactsHtml = targetContacts.length
    ? targetContacts.map(c => {
        const name        = [c.nome, c.cognome].filter(Boolean).join(' ') || c.email || 'Contatto';
        const hasEmail    = !!(c.email && c.email.trim());
        const isFollowup  = c.stage === 'Followup inviato';
        const isDisabled  = !hasEmail || isFollowup;
        const emailBadge  = hasEmail
          ? `<span class="ce-contact-email">${escHtml(c.email)}</span>`
          : `<span class="ce-no-email">⚠ no email</span>`;
        const followupBadge = isFollowup
          ? `<span class="ce-no-email" style="color:#2dd4bf">⛔ followup inviato</span>`
          : '';
        return `<label class="ce-contact-item"${isFollowup ? ' style="opacity:0.5"' : ''}>
          <input type="checkbox" ${!isDisabled ? 'checked' : 'disabled'} data-contact-id="${c.id}" onchange="updateCampaignSelectionCount()">
          <span class="ce-contact-name">${escHtml(name)}</span>
          ${emailBadge}${followupBadge}
        </label>`;
      }).join('')
    : `<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Nessun contatto per i ruoli selezionati</div>`;

  content.innerHTML = `
    <div class="ce-container">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;gap:12px">
        <div>
          <h2 style="font-size:20px;font-weight:700;letter-spacing:-0.04em">✉️ Editor Email Campagna</h2>
          <p style="font-size:13px;color:var(--text-sec);margin-top:3px">Revisiona l'email generata dall'AI e seleziona i destinatari</p>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="campaignDraft.generatedEmail=undefined;campaignDraft.generatedSubject=undefined;campaignsView='form';renderCampaigns()">← Torna alle domande</button>
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:11.5px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px">Oggetto Email</label>
        <input id="ce_subject" type="text"
          style="width:100%;padding:9px 12px;background:var(--bg-surface);border:1px solid var(--border-md);border-radius:var(--radius-sm);color:var(--text);font-size:13.5px;font-family:inherit;outline:none;transition:var(--transition);"
          value="${escHtml(d.generatedSubject||'')}" oninput="campaignDraft.generatedSubject=this.value"
          onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor=''">
      </div>

      <div class="ce-cols">
        <div class="ce-panel">
          <div class="ce-panel-header">
            <div style="flex:1;min-width:0">
              <div class="ce-panel-title">📝 Testo Email</div>
              <div class="ce-panel-sub">I placeholder <span style="color:var(--primary-text);font-family:monospace">{{nome}}</span> verranno sostituiti con i dati del contatto al momento dell'invio</div>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="generateEmailWithGroq()" style="flex-shrink:0;margin-left:8px">🔄 Rigenera</button>
          </div>
          <textarea class="ce-email-editor" id="ce_emailBody" oninput="campaignDraft.generatedEmail=this.value">${escHtml(d.generatedEmail||'')}</textarea>
          <div class="ce-email-footer">Placeholder: <span style="color:var(--primary-text);font-family:monospace">{{nome}} {{cognome}} {{azienda}} {{ruolo}} {{mittente_nome}} {{mittente_cognome}} {{mittente_ruolo}}</span></div>
        </div>

        <div class="ce-panel">
          <div class="ce-panel-header">
            <div style="flex:1;min-width:0">
              <div class="ce-panel-title">👥 Destinatari — <em style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml((d.target_ruoli||[]).join(', '))}</em></div>
              <div class="ce-panel-sub" id="ce_selCount">${contactsWithEmail} contatt${contactsWithEmail === 1 ? 'o' : 'i'} con email</div>
            </div>
            <div style="display:flex;gap:5px;flex-shrink:0;margin-left:8px">
              <button class="btn btn-secondary btn-sm" onclick="toggleAllCampaignContacts(true)">Tutti</button>
              <button class="btn btn-secondary btn-sm" onclick="toggleAllCampaignContacts(false)">Nessuno</button>
            </div>
          </div>
          <div class="ce-contact-list">${contactsHtml}</div>
        </div>
      </div>

      <div class="ce-footer">
        <div class="ce-counter" id="ce_launchInfo">Calcolo destinatari...</div>
        <button class="btn btn-primary" onclick="launchCampaign()" style="padding:10px 26px;font-size:14px" id="ce_launchBtn">🚀 Lancia Campagna</button>
      </div>
    </div>`;

  updateCampaignSelectionCount();
}

function updateCampaignSelectionCount() {
  const checked = document.querySelectorAll('.ce-contact-list input[type=checkbox]:checked');
  const count = checked.length;
  const info = document.getElementById('ce_launchInfo');
  const btn  = document.getElementById('ce_launchBtn');
  if (info) info.textContent = count > 0
    ? `${count} destinatar${count === 1 ? 'io' : 'i'} selezionat${count === 1 ? 'o' : 'i'} — 15s di pausa tra un'email e l'altra`
    : 'Seleziona almeno un destinatario per avviare la campagna';
  if (btn) btn.disabled = count === 0;
}

function toggleAllCampaignContacts(select) {
  document.querySelectorAll('.ce-contact-list input[type=checkbox]:not(:disabled)').forEach(cb => cb.checked = select);
  updateCampaignSelectionCount();
}

async function launchCampaign() {
  const emailBody    = document.getElementById('ce_emailBody')?.value?.trim();
  const emailSubject = document.getElementById('ce_subject')?.value?.trim();
  if (!emailBody)    { toast('Il testo dell\'email non può essere vuoto', 'err'); return; }
  if (!emailSubject) { toast('L\'oggetto non può essere vuoto', 'err'); return; }

  const selectedIds    = [...document.querySelectorAll('.ce-contact-list input[type=checkbox]:checked')].map(cb => cb.dataset.contactId);
  if (!selectedIds.length) { toast('Seleziona almeno un destinatario', 'err'); return; }

  const targetContacts = contacts.filter(c => selectedIds.includes(c.id));
  const startedAt = new Date().toISOString();

  campaignState = {
    active: true, draft: { ...campaignDraft },
    emailTemplate: emailBody, emailSubject,
    targetContacts, sent: 0, total: targetContacts.length,
    running: true, startedAt, failed: 0, dbId: null
  };

  // Save to DB
  const { data: newCamp } = await db.from('campaigns').insert({
    user_id: currentUser.id,
    status: 'running',
    draft: campaignState.draft,
    email_template: emailBody,
    email_subject: emailSubject,
    target_contacts: targetContacts,
    sent: 0,
    total: targetContacts.length,
    failed: 0,
    started_at: startedAt
  }).select().single();

  if (newCamp) {
    campaignState.dbId = newCamp.id;
    campaignsList.unshift(newCamp);
  }

  campaignViewRecord = null;
  campaignsView = 'execution';
  renderCampaignDashboard();
  runCampaignSend();
}

function diagnoseCampaignError(msg) {
  const m = (msg || '').toLowerCase();
  if (/535|534|530|username.*password|auth.*fail|invalid.*credential/.test(m))
    return { code: 'SMTP_AUTH', detail: 'Autenticazione SMTP fallita. Verifica username e password nelle impostazioni.' };
  if (/421|450|451|rate.limit|too many|message.*flood|daily.*limit|hourly.*limit|quota|4\.7\.|connection.*frequen/.test(m))
    return { code: 'SMTP_RATE_LIMIT', detail: 'Limite di invio SMTP raggiunto. Attendi qualche ora prima di riprendere.' };
  if (/econnrefused|etimedout|econnreset|timeout|network|socket|dns/.test(m))
    return { code: 'SMTP_NETWORK', detail: 'Errore di rete o timeout SMTP. Controlla la connessione e le impostazioni del server.' };
  if (/550|551|552|553|mailbox|user.*unknown|no.*such|does not exist/.test(m))
    return { code: 'SMTP_RECIPIENT', detail: 'La maggior parte dei destinatari risulta inesistente o bloccata (errore 55x).' };
  return { code: 'SMTP_UNKNOWN', detail: `Errore SMTP ripetuto: ${msg?.slice(0, 120) || 'sconosciuto'}` };
}

async function runCampaignSend() {
  const state         = campaignState;
  const senderNome    = smtpSettings?.mittente_nome    || '';
  const senderCognome = smtpSettings?.mittente_cognome || '';
  const senderRuolo   = smtpSettings?.mittente_ruolo   || '';

  function fillPlaceholders(text, c) {
    return (text || '')
      .replace(/\{\{nome\}\}/g,            c.nome    || '')
      .replace(/\{\{cognome\}\}/g,         c.cognome || '')
      .replace(/\{\{azienda\}\}/g,         c.azienda || '')
      .replace(/\{\{ruolo\}\}/g,           c.ruolo   || '')
      .replace(/\{\{mittente_nome\}\}/g,    senderNome)
      .replace(/\{\{mittente_cognome\}\}/g, senderCognome)
      .replace(/\{\{mittente_ruolo\}\}/g,   senderRuolo);
  }

  async function syncCampaignToDB(final = false, errorCode = null, errorDetail = null) {
    if (!campaignState.dbId) return;
    const upd = {
      sent: campaignState.sent,
      failed: campaignState.failed,
      last_index: campaignState.lastIndex
    };
    if (final) { upd.status = 'completed'; upd.completed_at = new Date().toISOString(); }
    if (errorCode) { upd.status = 'error'; upd.error_code = errorCode; upd.error_detail = errorDetail || null; }
    await db.from('campaigns').update(upd).eq('id', campaignState.dbId);
    const rec = campaignsList.find(c => c.id === campaignState.dbId);
    if (rec) Object.assign(rec, upd);
  }

  const CONSECUTIVE_ERROR_THRESHOLD = 10;
  let consecutiveErrors = 0;
  let lastErrorMsg = '';

  const startIndex = state.resumeFromIndex || 0;

  for (let i = startIndex; i < state.targetContacts.length; i++) {
    const c = state.targetContacts[i];
    const body    = fillPlaceholders(state.emailTemplate, c);
    const subject = fillPlaceholders(state.emailSubject, c);

    try {
      const { error: fnErr } = await db.functions.invoke('smtp-send', {
        body: { to: c.email, subject, body, includeFooter: true }
      });
      if (fnErr) {
        let msg = fnErr.message;
        try { const ctx = await fnErr.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch {}
        throw new Error(msg);
      }
      const newStage = c.stage === 'Email inviata' ? 'Followup inviato' : 'Email inviata';
      await updateContactInDB(c.id, { stage: newStage, priorita: 'Bassa' });
      consecutiveErrors = 0;
    } catch (e) {
      lastErrorMsg = e instanceof Error ? e.message : String(e);
      console.error('[campaign] failed to send to', c.email, lastErrorMsg);
      campaignState.failed++;
      consecutiveErrors++;
    }
    campaignState.sent++;
    campaignState.lastIndex = i;
    updateCampaignDashboard();

    // Diagnosi automatica: troppi errori consecutivi → sospendi campagna
    if (consecutiveErrors >= CONSECUTIVE_ERROR_THRESHOLD) {
      const { code, detail } = diagnoseCampaignError(lastErrorMsg);
      campaignState.running = false;
      campaignState.errorCode = code;
      campaignState.errorDetail = detail;
      await syncCampaignToDB(false, code, detail).catch(e => console.warn('[campaign] sync error', e));
      updateCampaignDashboard();
      toast(`Campagna sospesa: ${code}. ${detail}`, 'err');
      return;
    }

    // Persist progress to DB every 5 sends
    if (campaignState.sent % 5 === 0) await syncCampaignToDB().catch(e => console.warn('[campaign] sync error', e));

    // 15s delay between emails (skip after last)
    if (i < state.targetContacts.length - 1) {
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  campaignState.running = false;
  await syncCampaignToDB(true).catch(e => console.warn('[campaign] final sync error', e));
  updateCampaignDashboard();
  const ok = campaignState.sent - campaignState.failed;
  toast(`Campagna completata! ${ok} email inviate${campaignState.failed ? ', ' + campaignState.failed + ' errori' : ''} ✓`, 'ok');
}

function renderCampaignDashboard() {
  const s = campaignViewRecord ? {
    running: false,
    status: campaignViewRecord.status || 'completed',
    draft: campaignViewRecord.draft || {},
    emailSubject: campaignViewRecord.email_subject,
    sent: campaignViewRecord.sent,
    total: campaignViewRecord.total,
    failed: campaignViewRecord.failed,
    startedAt: campaignViewRecord.started_at,
    errorCode: campaignViewRecord.error_code || null,
    errorDetail: campaignViewRecord.error_detail || null,
    dbId: campaignViewRecord.id
  } : {
    ...campaignState,
    status: campaignState.running ? 'running' : (campaignState.errorCode ? 'error' : 'completed')
  };
  const pct = s.total > 0 ? Math.round((s.sent / s.total) * 100) : 0;

  document.getElementById('content').innerHTML = `
    <div class="cd-container" id="campaignDashboard">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="campaignsView='list';campaignViewRecord=null;renderCampaigns()">← Campagne</button>
        ${s.running
          ? `<button class="btn btn-secondary btn-sm" disabled style="opacity:0.4;cursor:not-allowed">＋ Nuova Campagna</button>`
          : `<button class="btn btn-primary btn-sm" onclick="startNewCampaign()">＋ Nuova Campagna</button>`}
      </div>

      <div class="cd-header">
        <div>
          <div class="cd-title">📊 Campagna Email</div>
          <div style="font-size:13px;color:var(--text-sec);margin-top:3px">${escHtml(s.draft?.obiettivo||'')} · Target: <strong style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml((s.draft?.target_ruoli||[]).join(', '))}</strong></div>
        </div>
      </div>

      <div class="cd-card">
        <div class="cd-card-title">
          Progresso Invio
          ${(() => {
            if (s.running) return `<span class="cd-status-badge cd-status-running" id="cdStatusBadge"><span class="cd-status-dot"></span><span id="cdStatusLabel">In corso</span></span>`;
            if (s.status === 'error') return `<span class="cd-status-badge" style="background:rgba(239,68,68,0.15);color:#f87171" id="cdStatusBadge"><span class="cd-status-dot" style="background:#f87171"></span><span id="cdStatusLabel">Errore SMTP</span></span>`;
            if (s.status === 'interrupted') return `<span class="cd-status-badge" style="background:rgba(245,158,11,0.15);color:#fbbf24" id="cdStatusBadge"><span class="cd-status-dot" style="background:#fbbf24"></span><span id="cdStatusLabel">Interrotta</span></span>`;
            return `<span class="cd-status-badge cd-status-done" id="cdStatusBadge"><span class="cd-status-dot"></span><span id="cdStatusLabel">Completata</span></span>`;
          })()}
        </div>
        <div class="cd-progress-row">
          <div class="cd-progress-bar">
            <div class="cd-progress-fill" id="cdProgressFill" style="width:${pct}%"></div>
          </div>
          <div class="cd-progress-pct" id="cdProgressPct">${pct}%</div>
        </div>
        <div style="font-size:12.5px;color:var(--text-sec);margin-top:4px" id="cdProgressLabel">
          ${s.sent} di ${s.total} email inviate${s.running && s.sent < s.total ? ' — prossima email tra ~15 secondi' : ''}
        </div>
        ${(s.errorCode || s.status === 'interrupted') && !s.running ? `
        <div style="margin-top:12px;padding:10px 14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;font-size:12.5px" id="cdErrorBox">
          ${s.errorCode
            ? `<div style="color:#f87171;font-weight:600;margin-bottom:3px">⚠ ${escHtml(s.errorCode)}</div><div style="color:var(--text-sec)">${escHtml(s.errorDetail||'')}</div>`
            : `<div style="color:#fbbf24;font-weight:600">⚠ Campagna interrotta</div><div style="color:var(--text-sec)">La sessione browser è stata chiusa prima del completamento.</div>`}
          ${s.sent < s.total ? `<button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="resumeCampaign('${escHtml(s.dbId||'')}')">▶ Riprendi da email ${(s.sent||0)+1}</button>` : ''}
        </div>` : ''}
      </div>

      <div class="cd-card">
        <div class="cd-card-title">Statistiche</div>
        <div class="cd-stat-row">
          <div class="cd-stat">
            <div class="cd-stat-val">${s.total}</div>
            <div class="cd-stat-lbl">Totale destinatari</div>
          </div>
          <div class="cd-stat">
            <div class="cd-stat-val" id="cdStatSent" style="color:var(--success)">${Math.max(0, s.sent - s.failed)}</div>
            <div class="cd-stat-lbl">Inviate con successo</div>
          </div>
          <div class="cd-stat">
            <div class="cd-stat-val" id="cdStatFailed" style="color:${s.failed > 0 ? 'var(--danger)' : 'var(--muted)'}">${s.failed}</div>
            <div class="cd-stat-lbl">Errori</div>
          </div>
        </div>
      </div>

      <div class="cd-card">
        <div class="cd-card-title">Dettagli</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 20px;font-size:13px;line-height:1.8">
          <div><span style="color:var(--muted)">Obiettivo:</span> ${escHtml(s.draft?.obiettivo||'—')}</div>
          <div><span style="color:var(--muted)">Target:</span> <span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml((s.draft?.target_ruoli||[]).join(', ')||'—')}</span></div>
          <div><span style="color:var(--muted)">Oggetto:</span> ${escHtml(s.emailSubject||'—')}</div>
          <div><span style="color:var(--muted)">Avviata:</span> ${s.startedAt ? new Date(s.startedAt).toLocaleString('it-IT') : '—'}</div>
        </div>
      </div>
    </div>`;
}

function updateCampaignDashboard() {
  // Only update DOM if showing the live execution view
  if (campaignsView !== 'execution' || campaignViewRecord !== null) return;
  const s   = campaignState;
  const pct = s.total > 0 ? Math.round((s.sent / s.total) * 100) : 0;

  // Keep in-memory list record in sync
  if (s.dbId) {
    const rec = campaignsList.find(c => c.id === s.dbId);
    if (rec) { rec.sent = s.sent; rec.failed = s.failed; rec.status = s.running ? 'running' : (s.errorCode ? 'error' : 'completed'); }
  }

  const el = (id) => document.getElementById(id);
  if (el('cdProgressFill'))  el('cdProgressFill').style.width = pct + '%';
  if (el('cdProgressPct'))   el('cdProgressPct').textContent  = pct + '%';
  if (el('cdProgressLabel')) el('cdProgressLabel').textContent =
    `${s.sent} di ${s.total} email inviate${s.running && s.sent < s.total ? ' — prossima email tra ~15 secondi' : ''}`;
  if (el('cdStatSent'))   el('cdStatSent').textContent   = Math.max(0, s.sent - s.failed);
  if (el('cdStatFailed')) el('cdStatFailed').textContent = s.failed;
  const badge = el('cdStatusBadge');
  if (badge) {
    if (s.running) {
      badge.className = 'cd-status-badge cd-status-running';
      badge.removeAttribute('style');
      if (el('cdStatusLabel')) el('cdStatusLabel').textContent = 'In corso';
    } else if (s.errorCode) {
      badge.className = 'cd-status-badge';
      badge.style.cssText = 'background:rgba(239,68,68,0.15);color:#f87171';
      if (el('cdStatusLabel')) el('cdStatusLabel').textContent = 'Errore SMTP';
    } else {
      badge.className = 'cd-status-badge cd-status-done';
      badge.removeAttribute('style');
      if (el('cdStatusLabel')) el('cdStatusLabel').textContent = 'Completata';
    }
  }
}

function startNewCampaign() {
  if (campaignState.running) {
    toast('Campagna in corso — attendi il completamento prima di crearne una nuova.', 'warn');
    return;
  }
  campaignDraft = {};
  campaignState = { active: false, draft: {}, emailTemplate: '', emailSubject: '', targetContacts: [], sent: 0, total: 0, running: false, startedAt: null, failed: 0, dbId: null, lastIndex: -1, resumeFromIndex: 0, errorCode: null, errorDetail: null };
  campaignsView = 'form';
  campaignViewRecord = null;
  renderCampaigns();
}

function viewCampaignFromList(id) {
  // If this is the currently running campaign, show live view
  if (campaignState.active && campaignState.dbId === id) {
    campaignViewRecord = null;
  } else {
    const rec = campaignsList.find(c => c.id === id);
    if (!rec) return;
    campaignViewRecord = rec;
  }
  campaignsView = 'execution';
  renderCampaigns();
}

async function resumeCampaign(id) {
  if (!id) return;
  if (campaignState.running) { toast('Una campagna è già in corso.', 'warn'); return; }
  const rec = campaignsList.find(c => c.id === id);
  if (!rec) { toast('Campagna non trovata.', 'err'); return; }

  const allContacts = rec.target_contacts || [];
  const lastIndex   = rec.last_index ?? -1;
  const remaining   = allContacts.length - (lastIndex + 1);
  if (remaining <= 0) { toast('Nessun contatto rimanente da inviare.', 'warn'); return; }

  campaignState = {
    active: true,
    draft: rec.draft || {},
    emailTemplate: rec.email_template || '',
    emailSubject: rec.email_subject || '',
    targetContacts: allContacts,
    sent: rec.sent || 0,
    total: rec.total || allContacts.length,
    running: true,
    startedAt: rec.started_at,
    failed: rec.failed || 0,
    dbId: id,
    lastIndex: lastIndex,
    resumeFromIndex: lastIndex + 1,
    errorCode: null,
    errorDetail: null
  };

  await db.from('campaigns').update({ status: 'running', error_code: null, error_detail: null }).eq('id', id);
  const listRec = campaignsList.find(c => c.id === id);
  if (listRec) Object.assign(listRec, { status: 'running', error_code: null, error_detail: null });

  campaignViewRecord = null;
  campaignsView = 'execution';
  renderCampaignDashboard();
  runCampaignSend();
}

function renderCampaignsList() {
  const content = document.getElementById('content');
  const hasRunning = campaignState.active && campaignState.running;

  if (!campaignsList.length && !hasRunning) {
    const hasContacts = contacts.length > 0;
    const hasEmail = isEmailConfigured();
    content.innerHTML = `
      <div class="cl-container">
        <div class="cl-empty">
          <div class="cl-empty-icon">✉️</div>
          <div class="cl-empty-title">Nessuna campagna ancora</div>
          <div class="cl-empty-sub">Crea la tua prima campagna email con l'AI: rispondi ad alcune domande e invieremo email personalizzate ai tuoi leads.</div>
          <button class="btn btn-primary" style="padding:12px 30px;font-size:14px;margin-top:6px" onclick="startNewCampaign()">＋ Crea Prima Campagna</button>
          ${(!hasContacts || !hasEmail) ? `<div style="font-size:12px;color:var(--warning);margin-top:2px">⚠️ Prima completa la configurazione (${!hasContacts?'importa contatti':''}${!hasContacts&&!hasEmail?' + ':''}${!hasEmail?'configura SMTP/IMAP':''})</div>` : ''}
        </div>
      </div>`;
    return;
  }

  let rows = '';

  // Running campaign always at top
  if (hasRunning) {
    const s = campaignState;
    const pct = s.total > 0 ? Math.round((s.sent / s.total) * 100) : 0;
    rows += `
      <div class="cl-item" onclick="viewCampaignFromList(${s.dbId ? `'${s.dbId}'` : 'null'})">
        <div class="cl-item-main">
          <div class="cl-item-title">${escHtml(s.draft?.obiettivo||'Campagna')}${(s.draft?.target_ruoli||[]).length ? ' — ' + escHtml((s.draft.target_ruoli).join(', ')) : ''}</div>
          <div class="cl-item-sub">Avviata ${s.startedAt ? new Date(s.startedAt).toLocaleString('it-IT',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : ''} · Oggetto: ${escHtml(s.emailSubject||'—')}</div>
          <div class="cl-progress-mini"><div class="cl-progress-mini-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="cl-item-stats">
          <div class="cl-stat"><div class="cl-stat-val" style="color:var(--success)">${s.sent - s.failed}</div><div class="cl-stat-lbl">Inviate</div></div>
          <div class="cl-stat"><div class="cl-stat-val">${s.total}</div><div class="cl-stat-lbl">Totale</div></div>
        </div>
        <span class="cl-status cl-status-running"><span class="cl-status-dot"></span>In corso</span>
      </div>`;
  }

  for (const camp of campaignsList) {
    if (camp.id === campaignState.dbId && hasRunning) continue;
    const draft = camp.draft || {};
    const pct = camp.total > 0 ? Math.round((camp.sent / camp.total) * 100) : 0;
    const ok = Math.max(0, camp.sent - camp.failed);
    const statusClass = camp.status === 'running' ? 'cl-status-running' : (camp.status === 'interrupted' || camp.status === 'error') ? 'cl-status-interrupted' : 'cl-status-done';
    const statusLabel = camp.status === 'running' ? 'In corso' : camp.status === 'interrupted' ? 'Interrotta' : camp.status === 'error' ? `Errore: ${camp.error_code||'SMTP'}` : 'Completata';
    const date = camp.started_at ? new Date(camp.started_at).toLocaleString('it-IT',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    rows += `
      <div class="cl-item" onclick="viewCampaignFromList('${escHtml(camp.id)}')">
        <div class="cl-item-main">
          <div class="cl-item-title">${escHtml(draft.obiettivo||'Campagna')}${(draft.target_ruoli||[]).length ? ' — ' + escHtml((draft.target_ruoli||[]).join(', ')) : ''}</div>
          <div class="cl-item-sub">${date ? `Avviata ${date} · ` : ''}Oggetto: ${escHtml(camp.email_subject||'—')}</div>
          <div class="cl-progress-mini"><div class="cl-progress-mini-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="cl-item-stats">
          <div class="cl-stat"><div class="cl-stat-val" style="color:var(--success)">${ok}</div><div class="cl-stat-lbl">Inviate</div></div>
          <div class="cl-stat"><div class="cl-stat-val">${camp.total}</div><div class="cl-stat-lbl">Totale</div></div>
        </div>
        <span class="cl-status ${statusClass}"><span class="cl-status-dot"></span>${statusLabel}</span>
      </div>`;
  }

  content.innerHTML = `
    <div class="cl-container">
      <div class="cl-header">
        <div class="cl-title">✉️ Campagne Email</div>
        <button class="btn btn-primary" onclick="startNewCampaign()">＋ Nuova Campagna</button>
      </div>
      <div class="cl-list">${rows}</div>
    </div>`;
}

// ─────────────────────────────────────────────
const HABIT_LIMITS = { daily: 30, weekly: 15 };

function habitCurrentMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function habitMonthStartIso(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function habitParseMonthStart(monthStart) {
  const parts = String(monthStart || habitCurrentMonthStart()).split('-').map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
}

function habitShiftMonth(monthStart, delta) {
  const date = habitParseMonthStart(monthStart);
  return habitMonthStartIso(new Date(date.getFullYear(), date.getMonth() + delta, 1));
}

function habitMonthMeta(monthStart) {
  const start = habitParseMonthStart(monthStart);
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const validWeeks = Math.ceil(daysInMonth / 7);
  const currentMonth = habitCurrentMonthStart();
  const relation = monthStart < currentMonth ? -1 : (monthStart > currentMonth ? 1 : 0);
  const today = new Date();
  const currentDay = relation === 0 ? today.getDate() : (relation < 0 ? daysInMonth : 0);
  const currentWeek = relation === 0 ? Math.min(validWeeks, Math.ceil(today.getDate() / 7)) : (relation < 0 ? validWeeks : 0);
  return { monthStart, start, daysInMonth, validWeeks, relation, currentDay, currentWeek };
}

function habitLimitForMode(mode) {
  return HABIT_LIMITS[mode] || 0;
}

function habitSlotCountForMode(mode, meta) {
  return mode === 'weekly' ? meta.validWeeks : meta.daysInMonth;
}

function habitGenerateUuid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function habitSlotNumber(key) {
  return parseInt(String(key || '').slice(1), 10) || 0;
}

function habitSortSlotKeys(slots) {
  return [...new Set((slots || []).map(String))].sort((a, b) => habitSlotNumber(a) - habitSlotNumber(b));
}

function habitNormalizeRow(row) {
  const mode = row?.mode === 'weekly' ? 'weekly' : 'daily';
  return {
    ...row,
    mode,
    archived: !!row?.archived,
    goal: Math.max(1, parseInt(row?.goal, 10) || 1),
    sort_order: Math.max(0, parseInt(row?.sort_order, 10) || 0),
    completion_slots: habitSortSlotKeys(Array.isArray(row?.completion_slots) ? row.completion_slots : [])
  };
}

function habitCloneRows() {
  return (habitState.rows || []).map(row => ({
    ...row,
    completion_slots: [...(row.completion_slots || [])]
  }));
}

function habitSortedRows(rows) {
  return [...(rows || [])].sort((a, b) =>
    (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
    String(a.name || '').localeCompare(String(b.name || ''), 'it', { sensitivity: 'base' })
  );
}

function habitReplaceRows(rows) {
  habitState.rows = habitSortedRows((rows || []).map(habitNormalizeRow));
}

function habitRowsForMode(mode, includeArchived = false) {
  return habitSortedRows(habitState.rows.filter(row => row.mode === mode && (includeArchived || !row.archived)));
}

function habitArchivedRowsForMode(mode) {
  return habitSortedRows(habitState.rows.filter(row => row.mode === mode && row.archived));
}

function habitGetRowById(id) {
  return habitState.rows.find(row => String(row.id) === String(id));
}

function habitNextSortOrder(mode, excludeId = null) {
  const rows = habitState.rows.filter(row => row.mode === mode && String(row.id) !== String(excludeId || ''));
  if (!rows.length) return 0;
  return Math.max(...rows.map(row => Number(row.sort_order) || 0)) + 1;
}

function habitSetPending(key, value) {
  if (value) habitState.pendingKeys.add(key);
  else habitState.pendingKeys.delete(key);
}

function habitIsPending(key) {
  return habitState.pendingKeys.has(key);
}

function habitBuildSlotDescriptors(mode, monthStart) {
  const meta = habitMonthMeta(monthStart);
  if (mode === 'weekly') {
    return Array.from({ length: meta.validWeeks }, (_, idx) => {
      const startDay = idx * 7 + 1;
      const endDay = Math.min(meta.daysInMonth, startDay + 6);
      return {
        key: `w${idx + 1}`,
        label: `W${idx + 1}`,
        sub: `${startDay}-${endDay}`,
        isCurrent: meta.relation === 0 && meta.currentWeek === idx + 1
      };
    });
  }
  const dayNames = ['Do', 'Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa'];
  return Array.from({ length: meta.daysInMonth }, (_, idx) => {
    const day = idx + 1;
    const date = new Date(meta.start.getFullYear(), meta.start.getMonth(), day);
    return {
      key: `d${day}`,
      label: String(day),
      sub: dayNames[date.getDay()],
      isCurrent: meta.relation === 0 && meta.currentDay === day
    };
  });
}

function habitGetCheckedSet(row, meta) {
  const validKeys = new Set(habitBuildSlotDescriptors(row.mode, meta.monthStart).map(slot => slot.key));
  return new Set((row.completion_slots || []).filter(key => validKeys.has(key)));
}

function habitCurrentStreakFromSet(checkedSet, prefix, maxIndex) {
  if (maxIndex <= 0) return 0;
  let streak = 0;
  for (let idx = maxIndex; idx >= 1; idx--) {
    if (!checkedSet.has(`${prefix}${idx}`)) break;
    streak++;
  }
  return streak;
}

function habitLongestStreakFromSet(checkedSet, prefix, maxIndex) {
  let best = 0;
  let streak = 0;
  for (let idx = 1; idx <= maxIndex; idx++) {
    if (checkedSet.has(`${prefix}${idx}`)) {
      streak++;
      best = Math.max(best, streak);
    } else {
      streak = 0;
    }
  }
  return best;
}

function habitRowAnalytics(row, meta) {
  const checkedSet = habitGetCheckedSet(row, meta);
  const maxSlots = habitSlotCountForMode(row.mode, meta);
  const completed = checkedSet.size;
  const rawPct = row.goal > 0 ? Math.round((completed / row.goal) * 100) : 0;
  const progressPct = Math.max(0, Math.min(rawPct, 100));
  const left = Math.max(0, row.goal - completed);
  const currentStreak = row.mode === 'weekly'
    ? habitCurrentStreakFromSet(checkedSet, 'w', meta.currentWeek)
    : habitCurrentStreakFromSet(checkedSet, 'd', meta.currentDay);
  const longestStreak = row.mode === 'weekly'
    ? habitLongestStreakFromSet(checkedSet, 'w', meta.validWeeks)
    : habitLongestStreakFromSet(checkedSet, 'd', meta.daysInMonth);
  return {
    completed,
    checkedSet,
    maxSlots,
    left,
    rawPct,
    progressPct,
    currentStreak,
    longestStreak,
    warning: row.goal > maxSlots
  };
}

function habitBoardAnalytics(rows, meta) {
  const items = rows.map(row => ({ row, ...habitRowAnalytics(row, meta) }));
  const itemMap = {};
  items.forEach(item => { itemMap[item.row.id] = item; });
  const totalChecked = items.reduce((sum, item) => sum + item.completed, 0);
  const totalPossible = items.reduce((sum, item) => sum + item.maxSlots, 0);
  const goalEarned = items.reduce((sum, item) => sum + Math.min(item.completed, item.row.goal), 0);
  const goalTotal = items.reduce((sum, item) => sum + item.row.goal, 0);
  const coveragePct = totalPossible ? Math.round((totalChecked / totalPossible) * 100) : 0;
  const goalPct = goalTotal ? Math.round((goalEarned / goalTotal) * 100) : 0;
  const goalReachedCount = items.filter(item => item.completed >= item.row.goal).length;
  const longestStreak = items.length ? Math.max(...items.map(item => item.longestStreak)) : 0;
  const topItems = [...items].sort((a, b) =>
    b.rawPct - a.rawPct ||
    b.completed - a.completed ||
    b.longestStreak - a.longestStreak ||
    String(a.row.name || '').localeCompare(String(b.row.name || ''), 'it', { sensitivity: 'base' })
  );
  const weekDescriptors = habitBuildSlotDescriptors('weekly', meta.monthStart);
  const weekBuckets = weekDescriptors.map(slot => {
    let checked = 0;
    let total = 0;
    if (habitState.mode === 'weekly') {
      total = items.length;
      items.forEach(item => {
        if (item.checkedSet.has(slot.key)) checked++;
      });
    } else {
      const weekNumber = habitSlotNumber(slot.key);
      const startDay = (weekNumber - 1) * 7 + 1;
      const endDay = Math.min(meta.daysInMonth, startDay + 6);
      items.forEach(item => {
        for (let day = startDay; day <= endDay; day++) {
          total++;
          if (item.checkedSet.has(`d${day}`)) checked++;
        }
      });
    }
    return {
      ...slot,
      checked,
      total,
      pct: total ? Math.round((checked / total) * 100) : 0
    };
  });
  return {
    items,
    itemMap,
    totalChecked,
    totalPossible,
    goalEarned,
    goalTotal,
    coveragePct,
    goalPct,
    goalReachedCount,
    longestStreak,
    topItems,
    weekBuckets
  };
}

function habitTopbarLabel() {
  const date = habitParseMonthStart(habitState.monthStart);
  return `${calMonthNames()[date.getMonth()]} ${date.getFullYear()}`;
}

function habitRerender() {
  if (currentView !== 'habits') return;
  syncHabitTopbar();
  const content = document.getElementById('content');
  if (content) content.innerHTML = buildHabitTrackerHTML();
}

function syncHabitTopbar() {
  if (currentView !== 'habits') return;
  const el = document.getElementById('topbarActions');
  if (!el) return;
  el.innerHTML = `
    <div class="cal-nav">
      <button class="cal-nav-btn" onclick="habitPrevMonth()">&lt;</button>
      <button class="cal-nav-btn" onclick="habitGoCurrentMonth()">Questo mese</button>
      <button class="cal-nav-btn" onclick="habitNextMonth()">&gt;</button>
    </div>
    <span class="cal-month-label" style="min-width:unset">${habitTopbarLabel()}</span>
    <div class="cal-view-switcher">
      <button class="cal-view-btn${habitState.mode === 'daily' ? ' active' : ''}" onclick="habitSwitchMode('daily')">Daily</button>
      <button class="cal-view-btn${habitState.mode === 'weekly' ? ' active' : ''}" onclick="habitSwitchMode('weekly')">Weekly</button>
    </div>
    <button class="btn btn-primary" onclick="openHabitModal()">+ Nuova Habit</button>
  `;
}

async function habitPrevMonth() {
  habitState.monthStart = habitShiftMonth(habitState.monthStart, -1);
  await renderHabitTracker();
}

async function habitNextMonth() {
  habitState.monthStart = habitShiftMonth(habitState.monthStart, 1);
  await renderHabitTracker();
}

async function habitGoCurrentMonth() {
  habitState.monthStart = habitCurrentMonthStart();
  await renderHabitTracker();
}

function habitSwitchMode(mode) {
  if (!HABIT_LIMITS[mode]) return;
  habitState.mode = mode;
  habitRerender();
}

async function habitFetchMonthRows(monthStart) {
  const { data, error } = await db.from('habit_month_entries')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('month_start', monthStart)
    .order('mode', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function habitCloneMonthFromPrevious(monthStart) {
  const { data, error } = await db.from('habit_month_entries')
    .select('*')
    .eq('user_id', currentUser.id)
    .lt('month_start', monthStart)
    .order('month_start', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  const previousRows = data || [];
  if (!previousRows.length) return [];
  const sourceMonth = previousRows[0].month_start;
  const sourceRows = habitSortedRows(previousRows.filter(row => row.month_start === sourceMonth && !row.archived).map(habitNormalizeRow));
  if (!sourceRows.length) return [];
  const payload = sourceRows.map(row => ({
    user_id: currentUser.id,
    habit_uid: row.habit_uid,
    month_start: monthStart,
    mode: row.mode,
    name: row.name,
    goal: row.goal,
    sort_order: row.sort_order,
    archived: false,
    completion_slots: []
  }));
  const { error: cloneError } = await db.from('habit_month_entries').upsert(payload, { onConflict: 'user_id,habit_uid,month_start' });
  if (cloneError) throw cloneError;
  return await habitFetchMonthRows(monthStart);
}

async function ensureHabitMonthLoaded(monthStart) {
  if (habitState.loadedMonth === monthStart && !habitState.loading) return habitState.rows;
  if (habitState.loading && habitState.loadingMonth === monthStart && habitState.loadPromise) return habitState.loadPromise;
  habitState.loading = true;
  habitState.loadingMonth = monthStart;
  const promise = (async () => {
    try {
      let rows = await habitFetchMonthRows(monthStart);
      if (!rows.length) rows = await habitCloneMonthFromPrevious(monthStart);
      habitReplaceRows(rows);
      habitState.loadedMonth = monthStart;
      return habitState.rows;
    } finally {
      if (habitState.loadingMonth === monthStart) {
        habitState.loading = false;
        habitState.loadPromise = null;
      }
    }
  })();
  habitState.loadPromise = promise;
  return promise;
}

async function renderHabitTracker() {
  const content = document.getElementById('content');
  if (!content) return;
  content.style.padding = window.innerWidth <= 768 ? '12px' : '20px 28px';
  content.style.overflow = 'auto';
  content.style.display = 'block';
  content.style.flexDirection = '';
  syncHabitTopbar();
  if (habitState.loadedMonth !== habitState.monthStart) {
    content.innerHTML = '<div class="loading-wrap"><div class="spinner"></div> Caricamento habit...</div>';
    try {
      await ensureHabitMonthLoaded(habitState.monthStart);
    } catch (error) {
      console.error('[habit] load error', error);
      if (currentView !== 'habits') return;
      content.innerHTML = `<div class="empty"><div class="ei">!</div><h3>Errore caricamento</h3><p>${escHtml(error.message || 'Impossibile leggere le habit')}</p></div>`;
      toast('Errore caricamento habit: ' + (error.message || 'sconosciuto'), 'err');
      return;
    }
  }
  if (currentView !== 'habits') return;
  content.innerHTML = buildHabitTrackerHTML();
}

function habitBuildStatsCards(analytics, meta) {
  const best = analytics.topItems[0];
  return `
    <div class="stats-grid">
      <div class="stat-card c-purple">
        <div class="stat-label">Habit attive</div>
        <div class="stat-value">${analytics.items.length}</div>
        <div class="stat-sub">Limite ${habitLimitForMode(habitState.mode)} · ${analytics.goalReachedCount} goal centrati</div>
      </div>
      <div class="stat-card c-green">
        <div class="stat-label">Slot completati</div>
        <div class="stat-value">${analytics.totalChecked}</div>
        <div class="stat-sub">${analytics.totalPossible ? `${analytics.coveragePct}% coverage · ${analytics.totalChecked}/${analytics.totalPossible}` : 'Nessun dato nel mese'}</div>
      </div>
      <div class="stat-card c-orange">
        <div class="stat-label">Goal attainment</div>
        <div class="stat-value">${analytics.goalPct}%</div>
        <div class="stat-sub">${analytics.goalTotal ? `${analytics.goalEarned}/${analytics.goalTotal} check utili` : `Mese da ${meta.daysInMonth} giorni`}</div>
      </div>
      <div class="stat-card c-red">
        <div class="stat-label">Longest streak</div>
        <div class="stat-value">${analytics.longestStreak}</div>
        <div class="stat-sub">${best ? `Top: ${escHtml(best.row.name)}` : 'Ancora nessuna streak'}</div>
      </div>
    </div>
  `;
}

function habitBuildTopHabitsPanel(analytics) {
  const items = analytics.topItems.slice(0, 5);
  const body = items.length ? items.map((item, idx) => `
    <div class="habit-list-item">
      <div class="habit-rank">${idx + 1}</div>
      <div class="habit-list-body">
        <div class="habit-list-title">${escHtml(item.row.name)}</div>
        <div class="habit-list-sub">${item.completed}/${item.row.goal} check · streak ${item.currentStreak}/${item.longestStreak}</div>
        <div class="habit-mini-progress"><div class="habit-mini-progress-fill" style="width:${item.progressPct}%"></div></div>
      </div>
      <div class="habit-list-pct">${item.rawPct}%</div>
    </div>
  `).join('') : `<div class="empty" style="padding:20px 12px"><h3>Nessuna habit attiva</h3><p style="font-size:12px">Aggiungi una habit per vedere ranking e progressi.</p></div>`;
  return `
    <div class="habit-card">
      <div class="habit-card-head">
        <div>
          <div class="habit-card-title">Top habits</div>
          <div class="habit-card-sub">Ordinamento per attainment nel mese</div>
        </div>
      </div>
      <div class="habit-card-body">
        <div class="habit-list">${body}</div>
      </div>
    </div>
  `;
}

function habitBuildWeekOverviewPanel(analytics) {
  const body = analytics.weekBuckets.length ? analytics.weekBuckets.map(bucket => `
    <div class="habit-week-row">
      <div><strong>${bucket.label}</strong><div style="font-size:10px;color:var(--muted);margin-top:2px">${escHtml(bucket.sub || '')}</div></div>
      <div class="habit-week-bar"><div class="habit-week-fill" style="width:${Math.max(0, Math.min(bucket.pct, 100))}%"></div></div>
      <div>${bucket.total ? `${bucket.checked}/${bucket.total}` : '0/0'}</div>
    </div>
  `).join('') : `<div class="empty" style="padding:20px 12px"><h3>Nessun bucket disponibile</h3></div>`;
  return `
    <div class="habit-card">
      <div class="habit-card-head">
        <div>
          <div class="habit-card-title">Weekly overview</div>
          <div class="habit-card-sub">${habitState.mode === 'daily' ? 'Aggregazione daily per bucket W1-W5' : 'Completamenti weekly per bucket'}</div>
        </div>
      </div>
      <div class="habit-card-body">
        <div class="habit-week-bars">${body}</div>
      </div>
    </div>
  `;
}

function habitBuildCellButton(row, slot, item, compact = false) {
  const cellKey = `cell:${row.id}:${slot.key}`;
  const rowKey = `row:${row.id}`;
  const active = item.checkedSet.has(slot.key);
  const pending = habitIsPending(cellKey);
  const disabled = habitIsPending(rowKey) || pending ? 'disabled' : '';
  if (compact) {
    return `<button class="habit-chip${active ? ' active' : ''}" ${disabled} onclick="toggleHabitSlot('${row.id}','${slot.key}')"><span class="habit-chip-label">${escHtml(slot.label)}</span><span class="habit-chip-sub">${escHtml(slot.sub || '')}</span></button>`;
  }
  return `<button class="habit-cell-btn${active ? ' is-active' : ''}${pending ? ' is-pending' : ''}" ${disabled} onclick="toggleHabitSlot('${row.id}','${slot.key}')">${active ? '&#10003;' : ''}</button>`;
}

function habitBuildDesktopRows(activeRows, slotDescriptors, analytics) {
  return activeRows.map((row, idx) => {
    const item = analytics.itemMap[row.id];
    const rowKey = `row:${row.id}`;
    const pendingRow = habitIsPending(rowKey);
    const warningBadge = item.warning ? `<span class="habit-badge warn">Goal &gt; ${item.maxSlots}</span>` : '';
    return `
      <tr>
        <td class="habit-sticky-col">
          <div class="habit-row-main">
            <div class="habit-row-fields">
              <input class="habit-name-input" value="${escHtml(row.name)}" ${pendingRow ? 'disabled' : ''} onchange="saveHabitField('${row.id}','name', this.value)" onkeydown="if(event.key==='Enter'){this.blur()}">
              <div class="habit-goal-wrap">
                <span class="habit-metric">Goal</span>
                <input class="habit-goal-input" type="number" min="1" max="${item.maxSlots}" value="${row.goal}" ${pendingRow ? 'disabled' : ''} onchange="saveHabitField('${row.id}','goal', this.value)" onkeydown="if(event.key==='Enter'){this.blur()}">
                <span class="habit-badge">${item.completed}/${row.goal}</span>
                <span class="habit-metric">Left ${item.left}</span>
                <span class="habit-metric">Streak ${item.currentStreak}/${item.longestStreak}</span>
                ${warningBadge}
              </div>
              <div class="habit-progress-row">
                <div class="habit-progress-bar"><div class="habit-progress-fill" style="width:${item.progressPct}%"></div></div>
                <span class="habit-progress-text">${item.rawPct}%</span>
              </div>
            </div>
            <div class="habit-row-actions">
              <button class="habit-mini-btn" title="Sposta su" onclick="moveHabitRow('${row.id}', -1)" ${idx === 0 || pendingRow ? 'disabled' : ''}>^</button>
              <button class="habit-mini-btn" title="Sposta giu" onclick="moveHabitRow('${row.id}', 1)" ${idx === activeRows.length - 1 || pendingRow ? 'disabled' : ''}>v</button>
              <button class="habit-mini-btn" title="Modifica" onclick="openHabitModal('${row.id}')" ${pendingRow ? 'disabled' : ''}>E</button>
              <button class="habit-mini-btn warn" title="Archivia" onclick="archiveHabitRow('${row.id}')" ${pendingRow ? 'disabled' : ''}>A</button>
            </div>
          </div>
        </td>
        ${slotDescriptors.map(slot => `<td class="habit-cell">${habitBuildCellButton(row, slot, item)}</td>`).join('')}
      </tr>
    `;
  }).join('');
}

function habitBuildMobileRows(activeRows, slotDescriptors, analytics) {
  return activeRows.map((row, idx) => {
    const item = analytics.itemMap[row.id];
    const rowKey = `row:${row.id}`;
    const pendingRow = habitIsPending(rowKey);
    return `
      <div class="habit-mobile-card">
        <div class="habit-mobile-top">
          <div style="flex:1;min-width:0">
            <input class="habit-mobile-name" value="${escHtml(row.name)}" ${pendingRow ? 'disabled' : ''} onchange="saveHabitField('${row.id}','name', this.value)" onkeydown="if(event.key==='Enter'){this.blur()}">
            <div class="habit-goal-wrap">
              <span class="habit-metric">Goal</span>
              <input class="habit-goal-input" type="number" min="1" max="${item.maxSlots}" value="${row.goal}" ${pendingRow ? 'disabled' : ''} onchange="saveHabitField('${row.id}','goal', this.value)" onkeydown="if(event.key==='Enter'){this.blur()}">
              <span class="habit-badge">${item.completed}/${row.goal}</span>
              <span class="habit-metric">Left ${item.left}</span>
            </div>
            <div class="habit-progress-row">
              <div class="habit-progress-bar"><div class="habit-progress-fill" style="width:${item.progressPct}%"></div></div>
              <span class="habit-progress-text">${item.rawPct}%</span>
            </div>
            <div class="habit-goal-wrap" style="margin-top:8px">
              <span class="habit-metric">Streak ${item.currentStreak}/${item.longestStreak}</span>
              ${item.warning ? `<span class="habit-badge warn">Goal &gt; ${item.maxSlots}</span>` : ''}
            </div>
          </div>
          <div class="habit-mobile-actions">
            <button class="habit-mini-btn" title="Sposta su" onclick="moveHabitRow('${row.id}', -1)" ${idx === 0 || pendingRow ? 'disabled' : ''}>^</button>
            <button class="habit-mini-btn" title="Sposta giu" onclick="moveHabitRow('${row.id}', 1)" ${idx === activeRows.length - 1 || pendingRow ? 'disabled' : ''}>v</button>
            <button class="habit-mini-btn" title="Modifica" onclick="openHabitModal('${row.id}')" ${pendingRow ? 'disabled' : ''}>E</button>
            <button class="habit-mini-btn warn" title="Archivia" onclick="archiveHabitRow('${row.id}')" ${pendingRow ? 'disabled' : ''}>A</button>
          </div>
        </div>
        <div class="habit-chip-row">
          ${slotDescriptors.map(slot => habitBuildCellButton(row, slot, item, true)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function habitBuildBoard(activeRows, archivedRows, meta, analytics) {
  const slotDescriptors = habitBuildSlotDescriptors(habitState.mode, habitState.monthStart);
  const title = habitState.mode === 'daily' ? 'Griglia giornaliera' : 'Griglia settimanale';
  const sub = habitState.mode === 'daily'
    ? `Uno slot per ognuno dei ${meta.daysInMonth} giorni del mese.`
    : `Bucket fissi W1-W${meta.validWeeks} con settimane disponibili nel mese.`;
  if (!activeRows.length) {
    return `
      <div class="habit-card">
        <div class="habit-grid-head">
          <div>
            <div class="habit-grid-title">${title}</div>
            <div class="habit-card-sub">${sub}</div>
          </div>
        </div>
        <div class="habit-card-body">
          <div class="empty" style="padding:44px 20px">
            <div class="ei">#</div>
            <h3>${archivedRows.length ? 'Tutte le habit di questo mese sono archiviate' : 'Nessuna habit in questo mese'}</h3>
            <p style="font-size:12px;color:var(--text-sec);margin-top:6px">${archivedRows.length ? 'Ripristina una habit archivata o crea un nuovo tracker per questo snapshot mensile.' : 'Il mese viene popolato clonando quello precedente quando esistono habit attive.'}</p>
            <div class="habit-empty-actions">
              <button class="btn btn-primary" onclick="openHabitModal()">+ Nuova Habit</button>
              ${archivedRows.length ? `<button class="btn btn-secondary" onclick="toggleHabitArchivedView()">${habitState.showArchived ? 'Nascondi archiviate' : `Mostra archiviate (${archivedRows.length})`}</button>` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }
  return `
    <div class="habit-card">
      <div class="habit-grid-head">
        <div>
          <div class="habit-grid-title">${title}</div>
          <div class="habit-card-sub">${sub}</div>
        </div>
        <div class="habit-grid-meta">
          <span class="habit-badge">${slotDescriptors.length} slot</span>
          <span class="habit-badge">${analytics.goalReachedCount} goal centrati</span>
        </div>
      </div>
      <div class="habit-grid-shell">
        <div class="habit-grid-scroll">
          <table class="habit-grid-table">
            <thead>
              <tr>
                <th class="habit-sticky-col">Habit</th>
                ${slotDescriptors.map(slot => `
                  <th class="habit-slot-head">
                    <div class="habit-slot-label"${slot.isCurrent ? ' style="color:var(--primary-text)"' : ''}>${escHtml(slot.label)}</div>
                    <div class="habit-slot-sub">${escHtml(slot.sub || '')}</div>
                  </th>
                `).join('')}
              </tr>
            </thead>
            <tbody>
              ${habitBuildDesktopRows(activeRows, slotDescriptors, analytics)}
            </tbody>
          </table>
        </div>
      </div>
      <div class="habit-mobile-list">
        ${habitBuildMobileRows(activeRows, slotDescriptors, analytics)}
      </div>
    </div>
  `;
}

function habitBuildArchivedSection(archivedRows, meta) {
  if (!archivedRows.length) return '';
  return `
    <div class="habit-card">
      <div class="habit-card-head">
        <div>
          <div class="habit-card-title">Archiviate</div>
          <div class="habit-card-sub">Soft archive sul mese selezionato</div>
        </div>
      </div>
      <div class="habit-card-body">
        <div class="habit-list">
          ${archivedRows.map(row => {
            const item = habitRowAnalytics(row, meta);
            const pending = habitIsPending(`row:${row.id}`);
            return `
              <div class="habit-list-item">
                <div class="habit-rank">AR</div>
                <div class="habit-list-body">
                  <div class="habit-list-title">${escHtml(row.name)}</div>
                  <div class="habit-list-sub">${row.mode === 'daily' ? 'Daily' : 'Weekly'} · goal ${row.goal} · ${item.completed}/${row.goal} check</div>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="restoreHabitRow('${row.id}')" ${pending ? 'disabled' : ''}>Ripristina</button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;
}

function buildHabitTrackerHTML() {
  const meta = habitMonthMeta(habitState.monthStart);
  const activeRows = habitRowsForMode(habitState.mode, false);
  const archivedRows = habitArchivedRowsForMode(habitState.mode);
  const analytics = habitBoardAnalytics(activeRows, meta);
  const invalidCount = analytics.items.filter(item => item.warning).length;
  return `
    <div class="habit-page">
      <div class="habit-toolbar-card">
        <div class="habit-toolbar-copy">
          <div class="habit-toolbar-title">${habitState.mode === 'daily' ? 'Daily habits' : 'Weekly habits'} · ${habitTopbarLabel()}</div>
          <div class="habit-toolbar-sub">Snapshot mensile congelato: modifiche, reorder e archiviazione restano nel mese selezionato. Se il mese e' vuoto, viene inizializzato copiando il precedente.</div>
        </div>
        <div class="habit-toolbar-meta">
          <span class="habit-limit-pill">${activeRows.length}/${habitLimitForMode(habitState.mode)} attive</span>
          <span class="habit-badge">${meta.daysInMonth} giorni · ${meta.validWeeks} week bucket</span>
          ${archivedRows.length ? `<button class="view-btn${habitState.showArchived ? ' active' : ''}" onclick="toggleHabitArchivedView()">${habitState.showArchived ? 'Nascondi archiviate' : `Archiviate (${archivedRows.length})`}</button>` : ''}
        </div>
      </div>
      ${invalidCount ? `<div class="habit-warning-banner">${invalidCount} habit hanno un goal superiore agli slot disponibili in questo mese. Riduci il goal per riallineare la snapshot corrente.</div>` : ''}
      ${habitBuildStatsCards(analytics, meta)}
      <div class="habit-insights">
        ${habitBuildTopHabitsPanel(analytics)}
        ${habitBuildWeekOverviewPanel(analytics)}
      </div>
      ${habitBuildBoard(activeRows, archivedRows, meta, analytics)}
      ${habitState.showArchived ? habitBuildArchivedSection(archivedRows, meta) : ''}
    </div>
  `;
}

function toggleHabitArchivedView() {
  habitState.showArchived = !habitState.showArchived;
  habitRerender();
}

function openHabitModal(id = null) {
  const row = id ? habitGetRowById(id) : null;
  habitState.modalEditingId = row ? row.id : null;
  document.getElementById('habitModalTitle').textContent = row ? 'Modifica Habit' : 'Nuova Habit';
  document.getElementById('habit_name').value = row?.name || '';
  document.getElementById('habit_mode').value = row?.mode || habitState.mode;
  document.getElementById('habit_goal').value = row?.goal || (habitState.mode === 'daily' ? 20 : Math.min(4, habitMonthMeta(habitState.monthStart).validWeeks));
  syncHabitModalHint();
  document.getElementById('habitModal').classList.remove('hidden');
}

function closeHabitModal() {
  document.getElementById('habitModal').classList.add('hidden');
  habitState.modalEditingId = null;
}

function syncHabitModalHint() {
  const mode = document.getElementById('habit_mode').value === 'weekly' ? 'weekly' : 'daily';
  const meta = habitMonthMeta(habitState.monthStart);
  const max = habitSlotCountForMode(mode, meta);
  const goalInput = document.getElementById('habit_goal');
  if (goalInput) goalInput.max = String(max);
  document.getElementById('habitModalHint').textContent = mode === 'daily'
    ? `Daily usa ${meta.daysInMonth} slot nel mese selezionato. Goal valido: 1-${max}.`
    : `Weekly usa bucket W1-W${meta.validWeeks}. Goal valido: 1-${max}.`;
}

function habitValidateDraft(name, mode, goal, editingRow = null) {
  if (!name) return 'Inserisci un nome per la habit';
  if (!Number.isInteger(goal) || goal < 1) return 'Il goal deve essere un numero intero positivo';
  const meta = habitMonthMeta(habitState.monthStart);
  const maxGoal = habitSlotCountForMode(mode, meta);
  const goalChanged = !editingRow || goal !== editingRow.goal || mode !== editingRow.mode;
  if (goalChanged && goal > maxGoal) return `Goal fuori range: massimo ${maxGoal} per ${mode === 'daily' ? 'daily' : 'weekly'} in questo mese`;
  const targetCount = habitRowsForMode(mode, false).filter(row => !editingRow || String(row.id) !== String(editingRow.id)).length;
  if (targetCount >= habitLimitForMode(mode)) return `Limite raggiunto: massimo ${habitLimitForMode(mode)} habit ${mode === 'daily' ? 'daily' : 'weekly'}`;
  return '';
}

async function saveHabitFromModal() {
  const name = document.getElementById('habit_name').value.trim();
  const mode = document.getElementById('habit_mode').value === 'weekly' ? 'weekly' : 'daily';
  const goal = parseInt(document.getElementById('habit_goal').value, 10);
  const editingRow = habitState.modalEditingId ? habitGetRowById(habitState.modalEditingId) : null;
  const validationError = habitValidateDraft(name, mode, goal, editingRow);
  if (validationError) { toast(validationError, 'err'); return; }
  const saveBtn = document.getElementById('habitSaveBtn');
  const prevText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Salvataggio...';
  if (editingRow) {
    const prevRows = habitCloneRows();
    const rowKey = `row:${editingRow.id}`;
    const modeChanged = editingRow.mode !== mode;
    if (modeChanged && editingRow.completion_slots.length && !confirm('Cambiare modalita azzera i completamenti del mese selezionato. Continuare?')) {
      saveBtn.disabled = false;
      saveBtn.textContent = prevText;
      return;
    }
    const patch = { name, goal, mode };
    if (modeChanged) {
      patch.completion_slots = [];
      patch.sort_order = habitNextSortOrder(mode, editingRow.id);
    }
    Object.assign(editingRow, patch);
    if (modeChanged) habitState.mode = mode;
    habitSetPending(rowKey, true);
    habitReplaceRows(habitState.rows);
    habitRerender();
    const { error } = await db.from('habit_month_entries')
      .update(patch)
      .eq('id', editingRow.id)
      .eq('user_id', currentUser.id);
    habitSetPending(rowKey, false);
    saveBtn.disabled = false;
    saveBtn.textContent = prevText;
    if (error) {
      habitReplaceRows(prevRows);
      habitRerender();
      toast('Errore aggiornamento habit: ' + error.message, 'err');
      return;
    }
    closeHabitModal();
    habitRerender();
    toast(modeChanged ? 'Habit aggiornata e spostata di vista' : 'Habit aggiornata', 'ok');
    return;
  }
  const payload = {
    user_id: currentUser.id,
    habit_uid: habitGenerateUuid(),
    month_start: habitState.monthStart,
    mode,
    name,
    goal,
    sort_order: habitNextSortOrder(mode),
    archived: false,
    completion_slots: []
  };
  const { data, error } = await db.from('habit_month_entries')
    .insert(payload)
    .select('*')
    .single();
  saveBtn.disabled = false;
  saveBtn.textContent = prevText;
  if (error) {
    toast('Errore creazione habit: ' + error.message, 'err');
    return;
  }
  if (mode !== habitState.mode) habitState.mode = mode;
  habitReplaceRows([...habitState.rows, habitNormalizeRow(data || payload)]);
  closeHabitModal();
  habitRerender();
  toast('Habit creata', 'ok');
}

async function saveHabitField(id, field, value) {
  const row = habitGetRowById(id);
  if (!row) return;
  const rowKey = `row:${id}`;
  if (habitIsPending(rowKey)) return;
  const prevRows = habitCloneRows();
  const patch = {};
  if (field === 'name') {
    const nextName = String(value || '').trim();
    if (!nextName) {
      toast('Il nome della habit non puo essere vuoto', 'err');
      habitRerender();
      return;
    }
    if (nextName === row.name) {
      habitRerender();
      return;
    }
    patch.name = nextName;
    row.name = nextName;
  } else if (field === 'goal') {
    const nextGoal = parseInt(value, 10);
    const maxGoal = habitSlotCountForMode(row.mode, habitMonthMeta(habitState.monthStart));
    if (!Number.isInteger(nextGoal) || nextGoal < 1) {
      toast('Il goal deve essere un numero intero positivo', 'err');
      habitRerender();
      return;
    }
    if (nextGoal > maxGoal) {
      toast(`Goal fuori range: massimo ${maxGoal} in questo mese`, 'err');
      habitRerender();
      return;
    }
    if (nextGoal === row.goal) {
      habitRerender();
      return;
    }
    patch.goal = nextGoal;
    row.goal = nextGoal;
  } else {
    return;
  }
  habitSetPending(rowKey, true);
  habitRerender();
  const { error } = await db.from('habit_month_entries')
    .update(patch)
    .eq('id', id)
    .eq('user_id', currentUser.id);
  habitSetPending(rowKey, false);
  if (error) {
    habitReplaceRows(prevRows);
    habitRerender();
    toast('Errore aggiornamento habit: ' + error.message, 'err');
    return;
  }
  habitRerender();
}

async function toggleHabitSlot(id, slotKey) {
  const row = habitGetRowById(id);
  if (!row) return;
  const cellKey = `cell:${id}:${slotKey}`;
  const rowKey = `row:${id}`;
  if (habitIsPending(cellKey) || habitIsPending(rowKey)) return;
  const prevRows = habitCloneRows();
  const nextSet = new Set(row.completion_slots || []);
  if (nextSet.has(slotKey)) nextSet.delete(slotKey);
  else nextSet.add(slotKey);
  row.completion_slots = habitSortSlotKeys([...nextSet]);
  habitSetPending(cellKey, true);
  habitRerender();
  const { error } = await db.from('habit_month_entries')
    .update({ completion_slots: row.completion_slots })
    .eq('id', id)
    .eq('user_id', currentUser.id);
  habitSetPending(cellKey, false);
  if (error) {
    habitReplaceRows(prevRows);
    habitRerender();
    toast('Errore salvataggio check: ' + error.message, 'err');
    return;
  }
  habitRerender();
}

async function moveHabitRow(id, direction) {
  const rows = habitRowsForMode(habitState.mode, false);
  const currentIndex = rows.findIndex(row => String(row.id) === String(id));
  const targetIndex = currentIndex + direction;
  if (currentIndex === -1 || targetIndex < 0 || targetIndex >= rows.length) return;
  const prevRows = habitCloneRows();
  const reordered = [...rows];
  const [moved] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  const changedRows = [];
  reordered.forEach((row, idx) => {
    const localRow = habitGetRowById(row.id);
    if (localRow && localRow.sort_order !== idx) {
      localRow.sort_order = idx;
      changedRows.push(localRow);
    }
  });
  if (!changedRows.length) return;
  changedRows.forEach(row => habitSetPending(`row:${row.id}`, true));
  habitReplaceRows(habitState.rows);
  habitRerender();
  const results = await Promise.all(changedRows.map(row =>
    db.from('habit_month_entries')
      .update({ sort_order: row.sort_order })
      .eq('id', row.id)
      .eq('user_id', currentUser.id)
  ));
  changedRows.forEach(row => habitSetPending(`row:${row.id}`, false));
  const failed = results.find(result => result.error);
  if (failed && failed.error) {
    habitReplaceRows(prevRows);
    habitRerender();
    toast('Errore reorder habit: ' + failed.error.message, 'err');
    return;
  }
  habitRerender();
}

async function archiveHabitRow(id) {
  const row = habitGetRowById(id);
  if (!row) return;
  if (!confirm('Archiviare questa habit dal mese selezionato in avanti?')) return;
  const prevRows = habitCloneRows();
  row.archived = true;
  habitSetPending(`row:${id}`, true);
  habitRerender();
  const { error } = await db.from('habit_month_entries')
    .update({ archived: true })
    .eq('user_id', currentUser.id)
    .eq('habit_uid', row.habit_uid)
    .gte('month_start', habitState.monthStart);
  habitSetPending(`row:${id}`, false);
  if (error) {
    habitReplaceRows(prevRows);
    habitRerender();
    toast('Errore archiviazione habit: ' + error.message, 'err');
    return;
  }
  habitRerender();
  toast('Habit archiviata', 'ok');
}

async function restoreHabitRow(id) {
  const row = habitGetRowById(id);
  if (!row) return;
  const activeCount = habitRowsForMode(row.mode, false).length;
  if (activeCount >= habitLimitForMode(row.mode)) {
    toast(`Limite raggiunto: massimo ${habitLimitForMode(row.mode)} habit ${row.mode === 'daily' ? 'daily' : 'weekly'}`, 'err');
    return;
  }
  const prevRows = habitCloneRows();
  row.archived = false;
  habitSetPending(`row:${id}`, true);
  habitRerender();
  const { error } = await db.from('habit_month_entries')
    .update({ archived: false })
    .eq('id', id)
    .eq('user_id', currentUser.id);
  habitSetPending(`row:${id}`, false);
  if (error) {
    habitReplaceRows(prevRows);
    habitRerender();
    toast('Errore ripristino habit: ' + error.message, 'err');
    return;
  }
  habitRerender();
  toast('Habit ripristinata', 'ok');
}

// CALENDAR (Google + Outlook)
// ─────────────────────────────────────────────

// Returns the edge function name for the active provider
function _calFn() {
  return calendarProvider === 'outlook' ? 'outlook-calendar' : 'google-calendar';
}

// Picks the right function based on the event's own IDs (handles mixed-provider scenarios)
function _calFnForEvent(ev) {
  if (ev?.outlook_event_id) return 'outlook-calendar';
  if (ev?.google_event_id) return 'google-calendar';
  return _calFn();
}

async function checkCalendarStatus() {
  try {
    const [gRes, oRes] = await Promise.all([
      db.functions.invoke('google-calendar', { body: { action: 'get_status' } }),
      db.functions.invoke('outlook-calendar', { body: { action: 'get_status' } })
    ]);
    googleCalendarConnected = !!(gRes.data && gRes.data.connected);
    outlookCalendarConnected = !!(oRes.data && oRes.data.connected);
  } catch {
    googleCalendarConnected = false;
    outlookCalendarConnected = false;
  }
  calendarProvider = googleCalendarConnected ? 'google' : (outlookCalendarConnected ? 'outlook' : null);
  calendarConnected = calendarProvider !== null;
  return calendarConnected;
}

function connectGoogleCalendar() {
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID') {
    toast('Configura prima il GOOGLE_CLIENT_ID nelle impostazioni del codice', 'err');
    return;
  }
  const redirectUri = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    access_type: 'offline',
    prompt: 'consent',
    state: 'calendar_auth'
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function connectOutlookCalendar() {
  if (!MICROSOFT_CLIENT_ID || MICROSOFT_CLIENT_ID === 'YOUR_MICROSOFT_CLIENT_ID') {
    toast('Configura prima il MICROSOFT_CLIENT_ID nelle impostazioni del codice', 'err');
    return;
  }
  const redirectUri = window.location.origin + window.location.pathname;
  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'Calendars.ReadWrite offline_access',
    state: 'outlook_calendar_auth'
  });
  window.location.href = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}

async function exchangeCalendarToken(code) {
  const redirectUri = window.location.origin + window.location.pathname;
  try {
    const { data, error } = await db.functions.invoke('google-calendar', {
      body: { action: 'exchange_token', code, redirect_uri: redirectUri }
    });
    if (error) {
      console.error('[Calendar] Supabase function error:', error);
      let detail = error.message;
      try {
        const body = await error.context?.json?.();
        if (body) { detail = body.error || body.message || detail; }
      } catch {}
      toast('Errore collegamento Google Calendar: ' + detail, 'err');
      return;
    }
    if (!data || !data.success) {
      toast('Errore collegamento Google Calendar: ' + (data?.error || 'risposta non valida'), 'err');
      return;
    }
    googleCalendarConnected = true;
    calendarProvider = 'google';
    calendarConnected = true;
    calEventsLoaded = false;
    if (currentUser) localStorage.removeItem(`cal_hide_popup_${currentUser.id}`);
    toast('Google Calendar collegato ✓', 'ok');
    if (currentView === 'calendario') renderCalendar();
    if (currentView === 'settings') renderSettings();
  } catch (e) {
    toast('Errore collegamento Google Calendar: ' + (e?.message || e), 'err');
  }
}

async function exchangeOutlookToken(code) {
  const redirectUri = window.location.origin + window.location.pathname;
  try {
    const { data, error } = await db.functions.invoke('outlook-calendar', {
      body: { action: 'exchange_token', code, redirect_uri: redirectUri }
    });
    if (error) {
      console.error('[Outlook Calendar] Supabase function error:', error);
      let detail = error.message;
      try {
        const body = await error.context?.json?.();
        if (body) { detail = body.error || body.message || detail; }
      } catch {}
      toast('Errore collegamento Outlook Calendar: ' + detail, 'err');
      return;
    }
    if (!data || !data.success) {
      toast('Errore collegamento Outlook Calendar: ' + (data?.error || 'risposta non valida'), 'err');
      return;
    }
    outlookCalendarConnected = true;
    if (!calendarProvider) calendarProvider = 'outlook';
    calendarConnected = true;
    calEventsLoaded = false;
    if (currentUser) localStorage.removeItem(`cal_hide_popup_${currentUser.id}`);
    toast('Outlook Calendar collegato ✓', 'ok');
    if (currentView === 'calendario') renderCalendar();
    if (currentView === 'settings') renderSettings();
  } catch (e) {
    toast('Errore collegamento Outlook Calendar: ' + (e?.message || e), 'err');
  }
}

async function disconnectGoogleCalendar() {
  if (!confirm('Disconnettere Google Calendar?')) return;
  await db.functions.invoke('google-calendar', { body: { action: 'disconnect' } });
  googleCalendarConnected = false;
  calendarProvider = outlookCalendarConnected ? 'outlook' : null;
  calendarConnected = calendarProvider !== null;
  calEventsLoaded = false;
  calendarEvents = [];
  toast('Google Calendar disconnesso', 'ok');
  if (currentView === 'calendario') renderCalendar();
  if (currentView === 'settings') renderSettings();
}

async function disconnectOutlookCalendar() {
  if (!confirm('Disconnettere Outlook Calendar?')) return;
  await db.functions.invoke('outlook-calendar', { body: { action: 'disconnect' } });
  outlookCalendarConnected = false;
  calendarProvider = googleCalendarConnected ? 'google' : null;
  calendarConnected = calendarProvider !== null;
  calEventsLoaded = false;
  calendarEvents = [];
  toast('Outlook Calendar disconnesso', 'ok');
  if (currentView === 'calendario') renderCalendar();
  if (currentView === 'settings') renderSettings();
}

async function loadCalendarEvents() {
  try {
    const { data, error } = await db.functions.invoke(_calFn(), { body: { action: 'get_events' } });
    if (!error && data && data.events) calendarEvents = data.events;
  } catch { /* silently fail */ }
}

// ── Calendar rendering ──────────────────────────────────

async function renderCalendar() {
  const content = document.getElementById('content');
  const isMobile = window.innerWidth <= 768;
  content.style.padding = isMobile ? '12px' : '20px 28px';
  content.style.overflow = isMobile ? 'auto' : 'hidden';
  content.style.display = 'flex';
  content.style.flexDirection = 'column';

  if (!calEventsLoaded) {
    // Show skeleton while loading
    content.innerHTML = buildCalendarSkeleton();
    await checkCalendarStatus();
    if (calendarConnected) await loadCalendarEvents();
    calEventsLoaded = true;
  }

  syncCalendarTopbar();
  content.innerHTML = buildCalendarPageHTML();

  // Auto-scroll week/day view to current time
  if (calView === 'week' || calView === 'day') {
    const body = content.querySelector('.cal-week-body');
    if (body) {
      const now = new Date();
      body.scrollTop = Math.max(0, (now.getHours() * 60 + now.getMinutes()) / 60 * 48 - 120);
    }
  }
}

function buildCalendarSkeleton() {
  const rows = Array.from({length:6}, () =>
    `<div class="cal-skeleton-row">${Array.from({length:7}, () => '<div class="cal-skeleton-cell"></div>').join('')}</div>`
  ).join('');
  return `<div style="display:flex;flex-direction:column;height:100%;gap:16px">
    <div style="height:32px;background:var(--bg-elevated);border-radius:6px;opacity:0.5;animation:shimmer 1.4s infinite"></div>
    <div class="cal-skeleton-wrap">${rows}</div>
  </div>`;
}

function getCalLabel() {
  const months = calMonthNames();
  const y = currentCalDate.getFullYear();
  const m = currentCalDate.getMonth();
  if (calView === 'month') return `${months[m]} ${y}`;
  if (calView === 'day') {
    const days = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
    return `${days[currentCalDate.getDay()]} ${currentCalDate.getDate()} ${months[m]} ${y}`;
  }
  // week
  const dow = (currentCalDate.getDay() + 6) % 7;
  const monday = new Date(currentCalDate);
  monday.setDate(currentCalDate.getDate() - dow);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  if (sameMonth) return `${monday.getDate()} – ${sunday.getDate()} ${months[monday.getMonth()]} ${monday.getFullYear()}`;
  return `${monday.getDate()} ${months[monday.getMonth()]} – ${sunday.getDate()} ${months[sunday.getMonth()]} ${y}`;
}

function syncCalendarTopbar() {
  if (currentView !== 'calendario') return;
  const el = document.getElementById('topbarActions');
  if (!el) return;
  el.innerHTML = `
    <div class="cal-nav">
      <button class="cal-nav-btn" onclick="calPrev()">‹</button>
      <button class="cal-nav-btn" onclick="calGoToday()">Oggi</button>
      <button class="cal-nav-btn" onclick="calNext()">›</button>
    </div>
    <span class="cal-month-label" style="min-width:unset">${getCalLabel()}</span>
    <div class="cal-view-switcher">
      <button class="cal-view-btn${calView==='day'?' active':''}" onclick="calSwitchView('day')">Giorno</button>
      <button class="cal-view-btn${calView==='week'?' active':''}" onclick="calSwitchView('week')">Settimana</button>
      <button class="cal-view-btn${calView==='month'?' active':''}" onclick="calSwitchView('month')">Mese</button>
    </div>
    <button class="cal-nav-btn" onclick="refreshCalendarEvents()" title="Aggiorna eventi" style="font-size:13px">↺</button>
    ${calendarConnected ? `<button class="btn btn-primary" onclick="openCreateEventModal()">＋ Crea Evento</button>` : ''}
  `;
}

async function refreshCalendarEvents() {
  calEventsLoaded = false;
  await renderCalendar();
}

function buildCalendarPageHTML() {
  const banner = calendarConnected ? '' : `
    <div class="cal-connect-banner">
      <div class="cal-connect-banner-icon">📅</div>
      <div class="cal-connect-banner-text">
        <strong>Collega il tuo Calendario</strong>
        Sincronizza i tuoi appuntamenti e creane di nuovi direttamente dal CRM.
      </div>
      <button class="btn btn-primary btn-sm" onclick="connectGoogleCalendar()">Google</button>
      <button class="btn btn-secondary btn-sm" onclick="connectOutlookCalendar()">Outlook</button>
    </div>`;

  let grid;
  if (calView === 'day') grid = buildDayGrid();
  else if (calView === 'week') grid = buildWeekGrid();
  else grid = buildMonthGrid();
  return `<div class="cal-wrap">${banner}${grid}</div>`;
}

function localDateISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function calMonthNames() {
  return ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
}

function buildMonthGrid() {
  const year = currentCalDate.getFullYear();
  const month = currentCalDate.getMonth();
  const today = new Date(); today.setHours(0,0,0,0);

  // Build the 6-row grid
  const firstDay = new Date(year, month, 1);
  let startDow = firstDay.getDay(); // 0=Sun
  // Convert to Mon-start: Mon=0 … Sun=6
  startDow = (startDow + 6) % 7;

  const cells = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, 1 - startDow + i);
    cells.push({ date: d, otherMonth: true });
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month, d), otherMonth: false });
  while (cells.length % 7 !== 0) {
    cells.push({ date: new Date(year, month + 1, cells.length - daysInMonth - startDow + 1), otherMonth: true });
  }

  const weekdays = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];

  const dayRows = cells.map(cell => {
    const iso = localDateISO(cell.date);
    const isToday = cell.date.getTime() === today.getTime();
    const dayEvents = calendarEvents.filter(ev => ev.start_time && localDateISO(new Date(ev.start_time)) === iso);
    const pills = dayEvents.slice(0,3).map(ev => {
      const evId = escHtml(String(ev.id || ev.google_event_id || ''));
      return `<div class="cal-event-pill" style="background:${ev.color||'#7c5ef0'}" title="${escHtml(ev.title)}" onclick="event.stopPropagation();openEventById('${evId}')">${escHtml(ev.title)}</div>`;
    }).join('');
    const more = dayEvents.length > 3 ? `<div class="cal-more" onclick="event.stopPropagation()" style="pointer-events:none">+${dayEvents.length-3} altri</div>` : '';
    return `<div class="cal-day${cell.otherMonth?' other-month':''}" onclick="openCreateEventModal('${iso}')">
      <div class="cal-day-num${isToday?' today-num':''}">${cell.date.getDate()}</div>
      ${pills}${more}
    </div>`;
  }).join('');

  const rowsHtml = `<div class="cal-days">${dayRows}</div>`;

  return `
    <div class="cal-grid">
      <div class="cal-weekdays">${weekdays.map(d=>`<div class="cal-weekday">${d}</div>`).join('')}</div>
      ${rowsHtml}
    </div>`;
}

function buildWeekGrid() {
  const today = new Date(); today.setHours(0,0,0,0);
  // Find Monday of current week
  const dow = (currentCalDate.getDay() + 6) % 7;
  const monday = new Date(currentCalDate);
  monday.setDate(currentCalDate.getDate() - dow);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }

  const weekdayNames = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
  const headers = days.map((d, i) => {
    const isToday = d.getTime() === today.getTime();
    return `<div class="cal-week-day-header${isToday?' today':''}">
      ${weekdayNames[i]}<br><strong style="font-size:16px">${d.getDate()}</strong>
    </div>`;
  }).join('');

  const hours = Array.from({length:24},(_,h) => h);
  const timeCol = hours.map(h => `<div class="cal-week-time">${String(h).padStart(2,'0')}:00</div>`).join('');

  const nowH = new Date().getHours() + new Date().getMinutes()/60;
  const nowTop = nowH * 48;
  const todayIso = localDateISO(new Date());

  const cols = days.map(d => {
    const iso = localDateISO(d);
    const dayEvents = calendarEvents.filter(ev => ev.start_time && localDateISO(new Date(ev.start_time)) === iso);
    const evHtml = dayEvents.map(ev => {
      const startH = ev.start_time ? new Date(ev.start_time).getHours() + new Date(ev.start_time).getMinutes()/60 : 9;
      const endH = ev.end_time ? new Date(ev.end_time).getHours() + new Date(ev.end_time).getMinutes()/60 : startH + 1;
      const top = startH * 48;
      const height = Math.max((endH - startH) * 48 - 2, 20);
      const evId = escHtml(String(ev.id || ev.google_event_id || ''));
      const startLabel = ev.start_time ? new Date(ev.start_time).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}) : '';
      return `<div class="cal-week-event" style="top:${top}px;height:${height}px;background:${ev.color||'#7c5ef0'}" title="${escHtml(ev.title)}" onclick="openEventById('${evId}')">
        <span style="font-size:10px;opacity:0.85">${startLabel}</span> ${escHtml(ev.title)}
      </div>`;
    }).join('');
    const nowLine = iso === todayIso ? `<div class="cal-now-line" style="top:${nowTop}px"></div>` : '';
    const hourLines = hours.map(() => `<div class="cal-week-hour-line"></div>`).join('');
    return `<div class="cal-week-col">${hourLines}${evHtml}${nowLine}</div>`;
  }).join('');

  return `
    <div class="cal-week-wrap">
      <div class="cal-week-header">
        <div style="border-right:1px solid var(--border)"></div>
        ${headers}
      </div>
      <div class="cal-week-body">
        <div class="cal-week-times">${timeCol}</div>
        <div class="cal-week-cols">${cols}</div>
      </div>
    </div>`;
}

function buildDayGrid() {
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(currentCalDate); d.setHours(0,0,0,0);
  const iso = localDateISO(d);
  const isToday = d.getTime() === today.getTime();

  const dayNames = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const months = calMonthNames();
  const numClass = isToday ? 'today' : '';

  const hours = Array.from({length:24}, (_,h) => h);
  const timeCol = hours.map(h => `<div class="cal-week-time">${String(h).padStart(2,'0')}:00</div>`).join('');

  const dayEvents = calendarEvents.filter(ev => ev.start_time && localDateISO(new Date(ev.start_time)) === iso);
  const nowH = new Date().getHours() + new Date().getMinutes()/60;
  const nowTop = nowH * 48;

  const evHtml = dayEvents.map(ev => {
    const startH = ev.start_time ? new Date(ev.start_time).getHours() + new Date(ev.start_time).getMinutes()/60 : 9;
    const endH = ev.end_time ? new Date(ev.end_time).getHours() + new Date(ev.end_time).getMinutes()/60 : startH + 1;
    const top = startH * 48;
    const height = Math.max((endH - startH) * 48 - 2, 20);
    const evId = escHtml(String(ev.id || ev.google_event_id || ''));
    const startLabel = ev.start_time ? new Date(ev.start_time).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}) : '';
    const endLabel = ev.end_time ? new Date(ev.end_time).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="cal-week-event" style="top:${top}px;height:${height}px;background:${ev.color||'#7c5ef0'};left:4px;right:4px" onclick="openEventById('${evId}')">
      <div style="font-size:10px;opacity:0.85">${startLabel} – ${endLabel}</div>
      <div style="font-weight:600">${escHtml(ev.title)}</div>
    </div>`;
  }).join('');

  const nowLine = isToday ? `<div class="cal-now-line" style="top:${nowTop}px"></div>` : '';
  const hourLines = hours.map(h => `<div class="cal-week-hour-line" onclick="openCreateEventModal('${iso}')" style="cursor:pointer"></div>`).join('');

  return `
    <div class="cal-week-wrap">
      <div class="cal-day-single-header">
        <div>
          <div class="cal-day-single-name">${dayNames[d.getDay()]}</div>
          <div class="cal-day-single-num ${numClass}">${d.getDate()}</div>
        </div>
        <div style="font-size:13px;color:var(--text-sec);margin-left:8px">${months[d.getMonth()]} ${d.getFullYear()}</div>
        ${dayEvents.length > 0 ? `<div style="margin-left:auto;font-size:12px;color:var(--muted)">${dayEvents.length} event${dayEvents.length===1?'o':'i'}</div>` : ''}
      </div>
      <div class="cal-week-body">
        <div class="cal-week-times">${timeCol}</div>
        <div class="cal-week-cols" style="grid-template-columns:1fr">
          <div class="cal-week-col">${hourLines}${evHtml}${nowLine}</div>
        </div>
      </div>
    </div>`;
}

function calPrev() {
  if (calView === 'month') currentCalDate = new Date(currentCalDate.getFullYear(), currentCalDate.getMonth() - 1, 1);
  else if (calView === 'day') currentCalDate = new Date(currentCalDate.getTime() - 86400000);
  else currentCalDate = new Date(currentCalDate.getTime() - 7 * 86400000);
  syncCalendarTopbar();
  _renderCalendarGrid();
}

function calNext() {
  if (calView === 'month') currentCalDate = new Date(currentCalDate.getFullYear(), currentCalDate.getMonth() + 1, 1);
  else if (calView === 'day') currentCalDate = new Date(currentCalDate.getTime() + 86400000);
  else currentCalDate = new Date(currentCalDate.getTime() + 7 * 86400000);
  syncCalendarTopbar();
  _renderCalendarGrid();
}

function calGoToday() {
  currentCalDate = new Date();
  syncCalendarTopbar();
  _renderCalendarGrid();
}

function calSwitchView(view) {
  calView = view;
  syncCalendarTopbar();
  _renderCalendarGrid();
}

// Re-render only the grid (no API call) — used for navigation and view switching
function _renderCalendarGrid() {
  const content = document.getElementById('content');
  if (!content) return;
  content.innerHTML = buildCalendarPageHTML();
  if (calView === 'week' || calView === 'day') {
    const body = content.querySelector('.cal-week-body');
    if (body) {
      const now = new Date();
      body.scrollTop = Math.max(0, (now.getHours() * 60 + now.getMinutes()) / 60 * 48 - 120);
    }
  }
}

// ── Calendar event modal ──────────────────────────────────

function selectCalColor(el) {
  document.querySelectorAll('.cal-color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  calSelectedColor = el.dataset.color;
}

function _setCalModalMode(isEdit) {
  document.getElementById('calEventModalTitle').textContent = isEdit ? 'Modifica Evento' : 'Nuovo Evento';
  document.getElementById('calSaveBtn').textContent = isEdit ? '💾 Salva Modifiche' : '📅 Crea Evento';
  const delBtn = document.getElementById('calDeleteBtn');
  if (delBtn) delBtn.classList.toggle('hidden', !isEdit);
}

function _setCalColor(color) {
  calSelectedColor = color || '#7c5ef0';
  document.querySelectorAll('.cal-color-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === calSelectedColor);
  });
}

function toggleCalAllDay(checked) {
  const startTime = document.getElementById('cal_start_time');
  const endTime = document.getElementById('cal_end_time');
  const sep = document.querySelector('.cal-dt-sep');
  startTime.style.display = checked ? 'none' : '';
  endTime.style.display = checked ? 'none' : '';
  if (sep) sep.style.display = checked ? 'none' : '';
}

function openCreateEventModal(dateStr) {
  calEditingEvent = null;
  const today = dateStr || new Date().toISOString().slice(0,10);
  document.getElementById('cal_title').value = '';
  document.getElementById('cal_start_date').value = today;
  document.getElementById('cal_start_time').value = '09:00';
  document.getElementById('cal_end_date').value = today;
  document.getElementById('cal_end_time').value = '10:00';
  document.getElementById('cal_guests').value = '';
  document.getElementById('cal_notes').value = '';
  document.getElementById('cal_all_day').checked = false;
  toggleCalAllDay(false);
  document.getElementById('calMeetRow').classList.add('hidden');
  _setCalColor('#7c5ef0');
  _setCalModalMode(false);
  document.getElementById('calEventModal').classList.remove('hidden');
}

function openCreateEventModalPrefilled(opts) {
  // opts: { title, dateStr, guests, notes }
  calEditingEvent = null;
  const today = opts.dateStr || new Date().toISOString().slice(0,10);
  document.getElementById('cal_title').value = opts.title || '';
  document.getElementById('cal_start_date').value = today;
  document.getElementById('cal_start_time').value = '09:00';
  document.getElementById('cal_end_date').value = today;
  document.getElementById('cal_end_time').value = '10:00';
  document.getElementById('cal_guests').value = opts.guests || '';
  document.getElementById('cal_notes').value = opts.notes || '';
  document.getElementById('cal_all_day').checked = false;
  toggleCalAllDay(false);
  document.getElementById('calMeetRow').classList.add('hidden');
  _setCalColor('#a88bf5');
  _setCalModalMode(false);
  document.getElementById('calEventModal').classList.remove('hidden');
}

function openEventById(id) {
  const ev = calendarEvents.find(e => String(e.id || e.google_event_id || '') === String(id));
  if (ev) openEventModal(ev);
}

function openEventModal(ev) {
  calEditingEvent = ev;

  const toDateVal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const toTimeVal = d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  // Detect all-day events (date-only ISO string: no 'T')
  const isAllDay = ev.start_time && !ev.start_time.includes('T');
  document.getElementById('cal_all_day').checked = isAllDay;
  toggleCalAllDay(isAllDay);

  let startDt, endDt;
  if (isAllDay) {
    startDt = new Date(ev.start_time + 'T00:00:00');
    endDt = ev.end_time ? new Date(ev.end_time + 'T00:00:00') : startDt;
  } else {
    startDt = ev.start_time ? new Date(ev.start_time) : new Date();
    endDt = ev.end_time ? new Date(ev.end_time) : new Date(startDt.getTime() + 3600000);
  }

  document.getElementById('cal_title').value = ev.title || '';
  document.getElementById('cal_start_date').value = toDateVal(startDt);
  document.getElementById('cal_start_time').value = toTimeVal(startDt);
  document.getElementById('cal_end_date').value = toDateVal(endDt);
  document.getElementById('cal_end_time').value = toTimeVal(endDt);
  document.getElementById('cal_guests').value = (ev.guests || []).join('\n');
  document.getElementById('cal_notes').value = ev.notes || '';

  // Show Google Meet link if available
  const meetRow = document.getElementById('calMeetRow');
  const meetLink = document.getElementById('calMeetLink');
  if (ev.meet_link) {
    meetLink.href = ev.meet_link;
    meetRow.classList.remove('hidden');
  } else {
    meetRow.classList.add('hidden');
  }

  _setCalColor(ev.color);
  _setCalModalMode(true);
  document.getElementById('calEventModal').classList.remove('hidden');
}

function closeCalEventModal() {
  calEditingEvent = null;
  document.getElementById('calEventModal').classList.add('hidden');
}

function _readCalModalFields() {
  const title = document.getElementById('cal_title').value.trim();
  const startDate = document.getElementById('cal_start_date').value;
  const startTime = document.getElementById('cal_start_time').value || '09:00';
  const endDate = document.getElementById('cal_end_date').value || startDate;
  const endTime = document.getElementById('cal_end_time').value || '10:00';
  const isAllDay = document.getElementById('cal_all_day').checked;
  const guestsRaw = document.getElementById('cal_guests').value;
  const guests = guestsRaw.split(/[\n,;]+/).map(e => e.trim()).filter(e => e.includes('@'));
  const notes = document.getElementById('cal_notes').value.trim() || null;
  // All-day events use date-only strings; timed events use ISO datetime
  const start_time = isAllDay ? startDate : `${startDate}T${startTime}:00`;
  const end_time = isAllDay ? endDate : `${endDate}T${endTime}:00`;
  return { title, startDate, start_time, end_time, guests, notes, isAllDay };
}

async function saveCalendarEvent() {
  if (calEditingEvent) { await updateCalendarEvent(); return; }

  const { title, startDate, start_time, end_time, guests, notes } = _readCalModalFields();
  if (!title) { toast('Inserisci un titolo per l\'evento', 'err'); return; }
  if (!startDate) { toast('Inserisci la data di inizio', 'err'); return; }

  const saveBtn = document.getElementById('calSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Creazione...'; }

  const { data, error } = await db.functions.invoke(_calFn(), {
    body: { action: 'create_event', title, start_time, end_time, guests, color: calSelectedColor, notes }
  });

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '📅 Crea Evento'; }

  if (error || (data && data.error)) {
    toast('Errore creazione evento: ' + (data?.error || error?.message || 'sconosciuto'), 'err');
    return;
  }

  // Update local cache immediately
  if (data?.event) calendarEvents.push(data.event);

  const syncError = data?.google_error || data?.outlook_error;
  if (syncError) {
    toast('Evento salvato, errore sync calendario: ' + syncError.slice(0, 100), 'err');
  } else {
    toast(data?.synced_to_google || data?.synced_to_outlook ? 'Evento creato e sincronizzato ✓' : 'Evento creato ✓', 'ok');
  }
  closeCalEventModal();
  _renderCalendarGrid();
}

async function updateCalendarEvent() {
  const { title, startDate, start_time, end_time, guests, notes } = _readCalModalFields();
  if (!title) { toast('Inserisci un titolo per l\'evento', 'err'); return; }
  if (!startDate) { toast('Inserisci la data di inizio', 'err'); return; }

  const saveBtn = document.getElementById('calSaveBtn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Salvataggio...'; }

  const ev = calEditingEvent;
  const evFn = _calFnForEvent(ev);
  const isOutlookEv = evFn === 'outlook-calendar';
  const body = {
    action: 'update_event',
    title, start_time, end_time, guests, color: calSelectedColor, notes,
    event_id: ev.id && !(isOutlookEv ? ev.outlook_event_id : ev.google_event_id) ? ev.id : undefined,
    ...(isOutlookEv
      ? { outlook_event_id: ev.outlook_event_id || undefined }
      : { google_event_id: ev.google_event_id || undefined }
    ),
  };

  const { data, error } = await db.functions.invoke(evFn, { body });

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Salva Modifiche'; }

  if (error || (data && data.error)) {
    toast('Errore aggiornamento: ' + (data?.error || error?.message || 'sconosciuto'), 'err');
    return;
  }

  // Update local cache
  const idx = calendarEvents.findIndex(e => (e.id && e.id === ev.id) || (e.google_event_id && e.google_event_id === ev.google_event_id));
  if (idx !== -1) {
    calendarEvents[idx] = { ...calendarEvents[idx], title, start_time, end_time, guests, color: calSelectedColor, notes };
  }

  const updateSyncErr = data?.google_error || data?.outlook_error;
  toast(updateSyncErr ? 'Salvato localmente (errore sync calendario)' : 'Evento aggiornato ✓', updateSyncErr ? 'err' : 'ok');
  closeCalEventModal();
  _renderCalendarGrid();
}

async function deleteCalendarEvent() {
  if (!calEditingEvent) return;
  if (!confirm('Eliminare questo evento?')) return;

  const delBtn = document.getElementById('calDeleteBtn');
  if (delBtn) { delBtn.disabled = true; delBtn.textContent = '⏳...'; }

  const ev = calEditingEvent;
  const evFn = _calFnForEvent(ev);
  const isOutlookEv = evFn === 'outlook-calendar';
  const body = {
    action: 'delete_event',
    event_id: ev.id && !(isOutlookEv ? ev.outlook_event_id : ev.google_event_id) ? ev.id : undefined,
    ...(isOutlookEv
      ? { outlook_event_id: ev.outlook_event_id || undefined }
      : { google_event_id: ev.google_event_id || undefined }
    ),
  };

  const { data, error } = await db.functions.invoke(evFn, { body });

  if (delBtn) { delBtn.disabled = false; delBtn.textContent = '🗑 Elimina'; }

  if (error || (data && data.error)) {
    toast('Errore eliminazione: ' + (data?.error || error?.message || 'sconosciuto'), 'err');
    return;
  }

  // Remove from local cache
  const evId = ev.id || ev.google_event_id;
  calendarEvents = calendarEvents.filter(e => (e.id || e.google_event_id) !== evId);

  toast('Evento eliminato ✓', 'ok');
  closeCalEventModal();
  _renderCalendarGrid();
}

// ── Call fissata popup ──────────────────────────────────

function openCallFissataPopup(contact) {
  if (!calendarConnected) {
    if (currentUser) {
      const hideKey = `cal_hide_popup_${currentUser.id}`;
      if (localStorage.getItem(hideKey) === '1') return;
    }
    showCallFissataPopupDisconnected(contact);
    return;
  }
  showCallFissataPopupConnected(contact);
}

function showCallFissataPopupDisconnected(contact) {
  const hideKey = currentUser ? `cal_hide_popup_${currentUser.id}` : null;
  const name = [contact.nome, contact.cognome].filter(Boolean).join(' ') || contact.email || 'questo contatto';
  document.getElementById('callFissataPopupInner').innerHTML = `
    <div class="cf-popup-header">
      <div>
        <div class="cf-popup-title">📅 Call fissata con ${escHtml(name)}</div>
        <div class="cf-popup-sub">Collega un calendario per schedulare automaticamente</div>
      </div>
      <button class="cf-popup-close" onclick="closeCallFissataPopup()">✕</button>
    </div>
    <div class="cf-not-connected">
      <div class="cf-not-connected-icon">🔗</div>
      <div class="cf-not-connected-title">Calendario non collegato</div>
      <div class="cf-not-connected-sub">Collega Google Calendar o Outlook per creare inviti automaticamente e sincronizzare i tuoi appuntamenti.</div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="connectGoogleCalendar()">Google Calendar</button>
        <button class="btn btn-secondary" onclick="connectOutlookCalendar()">Outlook Calendar</button>
      </div>
    </div>
    <div class="cf-popup-footer">
      ${hideKey ? `<label class="cf-no-show"><input type="checkbox" onchange="if(this.checked)localStorage.setItem('${hideKey}','1')"> Non mostrare più (finché Calendar non è collegato)</label>` : ''}
      <button class="btn btn-secondary" onclick="closeCallFissataPopup()">Chiudi</button>
    </div>`;
  document.getElementById('callFissataPopup').classList.remove('hidden');
}

function showCallFissataPopupConnected(contact) {
  const name = [contact.nome, contact.cognome].filter(Boolean).join(' ') || contact.email || 'Contatto';
  const email = contact.email || '';
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('callFissataPopupInner').innerHTML = `
    <div class="cf-popup-header">
      <div>
        <div class="cf-popup-title">📅 Schedula call con ${escHtml(name)}</div>
        <div class="cf-popup-sub">Crea un evento su Google Calendar per questa call</div>
      </div>
      <button class="cf-popup-close" onclick="closeCallFissataPopup()">✕</button>
    </div>
    <div class="cf-popup-body">
      <div class="form-group">
        <label>Titolo evento</label>
        <input id="cfp_title" type="text" value="Call con ${escHtml(name)}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group">
          <label>Data</label>
          <input id="cfp_date" type="date" value="${today}">
        </div>
        <div class="form-group">
          <label>Ora inizio</label>
          <input id="cfp_start_time" type="time" value="09:00">
        </div>
      </div>
      <div class="form-group">
        <label>Ora fine</label>
        <input id="cfp_end_time" type="time" value="10:00">
      </div>
      <div class="form-group">
        <label>Ospiti</label>
        <textarea id="cfp_guests" rows="2" style="resize:vertical">${escHtml(email)}</textarea>
      </div>
      <div class="form-group">
        <label>Note</label>
        <textarea id="cfp_notes" rows="2" style="resize:vertical"></textarea>
      </div>
    </div>
    <div class="cf-popup-footer">
      <button class="btn btn-secondary" onclick="closeCallFissataPopup()">Chiudi senza schedulare</button>
      <button class="btn btn-primary" onclick="scheduleCallFissata()">📅 Schedula Call</button>
    </div>`;
  document.getElementById('callFissataPopup').classList.remove('hidden');
}

function closeCallFissataPopup() {
  document.getElementById('callFissataPopup').classList.add('hidden');
}

async function scheduleCallFissata() {
  const title = document.getElementById('cfp_title')?.value.trim();
  const date  = document.getElementById('cfp_date')?.value;
  const startT = document.getElementById('cfp_start_time')?.value || '09:00';
  const endT   = document.getElementById('cfp_end_time')?.value || '10:00';
  const guestsRaw = document.getElementById('cfp_guests')?.value || '';
  const notes = document.getElementById('cfp_notes')?.value.trim() || null;

  if (!title || !date) { toast('Inserisci titolo e data', 'err'); return; }

  const guests = guestsRaw.split(/[\n,;]+/).map(e => e.trim()).filter(e => e.includes('@'));
  const start_time = `${date}T${startT}:00`;
  const end_time = `${date}T${endT}:00`;

  const btn = document.querySelector('#callFissataPopupInner .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }

  const { data, error } = await db.functions.invoke('google-calendar', {
    body: { action: 'create_event', title, start_time, end_time, guests, color: '#a88bf5', notes }
  });

  if (btn) { btn.disabled = false; btn.textContent = '📅 Schedula Call'; }

  if (error || (data && data.error)) {
    toast('Errore: ' + (data?.error || error?.message), 'err');
    return;
  }

  toast('Call schedulata su Google Calendar ✓', 'ok');
  closeCallFissataPopup();
}

// BOOT
init();
