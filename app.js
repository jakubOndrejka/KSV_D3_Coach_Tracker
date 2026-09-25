/* KSV D3 Coach Reliability & Culture Tracker */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $('#app');
  const nav = $('#bottomNav');
  const statusEl = $('#connectionStatus');
  const modalRoot = $('#modalRoot');
  const toastEl = $('#toast');

  const state = {
    data: null,
    tab: 'dashboard',
    selectedEventId: '',
    selectedPlayerId: '',
    playerWindow: 30,
    demo: false,
    busy: false,
    pendingParticipation: {},
    saveTimer: null,
    saveInFlight: false
  };

  const PENDING_PARTICIPATION_KEY = 'ksvTracker.pendingParticipation.v1';

  const OBS_PRESETS = [
    ['communication', 'Did not communicate an important availability change', false],
    ['setup', 'Did not help with setup', false],
    ['pack-up', 'Did not help pack up', false],
    ['phone', 'Phone use during practice', false],
    ['engagement', 'Disengaged while others were working', false],
    ['match involvement', 'Did not join huddle / stay ready', false],
    ['team behaviour', 'Blame or negative body language', false],
    ['respect', 'Disrespectful communication', false],
    ['duty', 'Missed assigned duty', false],
    ['responsibility', 'Good repair / took responsibility', true],
    ['duty', 'Covered a teammate\'s duty', true]
  ];

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[c]));
  }

  function now() { return new Date(); }
  function toDate(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  function isoLocalInput(v) {
    const d = toDate(v); if (!d) return '';
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
  }
  function fmtDate(v, opts = {}) {
    const d = toDate(v); if (!d) return '—';
    const { weekday, ...rest } = opts;
    return new Intl.DateTimeFormat(undefined, { weekday: weekday ? 'short' : undefined, day: '2-digit', month: 'short', ...rest }).format(d);
  }
  function fmtTime(v) {
    const d = toDate(v); if (!d) return '';
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
  }
  function daysUntil(v) {
    const d = toDate(v); if (!d) return Infinity;
    return (d.getTime() - Date.now()) / 86400000;
  }
  function isWithinPast(v, days) {
    const d = toDate(v); if (!d) return false;
    const age = (Date.now() - d.getTime()) / 86400000;
    return age >= 0 && age <= days;
  }
  function bool(v) { return v === true || v === 1 || ['true','1','yes','on'].includes(String(v).toLowerCase()); }
  function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

  function toast(message, tone = 'default') {
    toastEl.textContent = message;
    toastEl.dataset.tone = tone;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  function setBusy(on, label = '') {
    state.busy = on;
    document.body.classList.toggle('is-busy', on);
    if (on) statusEl.textContent = label || 'Working…';
    else if (state.demo) statusEl.textContent = 'Demo mode';
    else if (state.data) statusEl.textContent = 'Connected';
    else statusEl.textContent = window.ksvApi.getToken() ? 'Connected' : 'Locked';
    if (!on) updateSaveIndicator();
  }

  async function runBusy(label, fn) {
    if (state.busy) return;
    setBusy(true, label);
    try { return await fn(); }
    catch (err) {
      console.error(err);
      if (/session/i.test(err.message || '')) {
        window.ksvApi.clearToken();
        renderLogin(err.message);
      } else {
        toast(err.message || String(err), 'error');
      }
    } finally { setBusy(false); }
  }


  function loadPendingParticipation() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_PARTICIPATION_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }

  function persistPendingParticipation() {
    try {
      const keys = Object.keys(state.pendingParticipation || {});
      if (keys.length) localStorage.setItem(PENDING_PARTICIPATION_KEY, JSON.stringify(state.pendingParticipation));
      else localStorage.removeItem(PENDING_PARTICIPATION_KEY);
    } catch (_) {}
  }

  function participationQueueKey(update) {
    return `${String(update.event_id || '')}|${String(update.player_id || '')}`;
  }

  function stripClientFields(update) {
    const out = {};
    Object.keys(update || {}).forEach(k => { if (!k.startsWith('_')) out[k] = update[k]; });
    return out;
  }

  function applyPendingParticipationToState() {
    if (!state.data) return;
    Object.values(state.pendingParticipation || {}).forEach(entry => mergeLocalParticipation(stripClientFields(entry)));
  }

  function updateSaveIndicator() {
    if (state.busy || state.demo) return;
    const pending = Object.keys(state.pendingParticipation || {}).length;
    if (state.saveInFlight) statusEl.textContent = pending > 1 ? `Saving ${pending} changes…` : 'Saving…';
    else if (pending && !navigator.onLine) statusEl.textContent = `${pending} pending · offline`;
    else if (pending) statusEl.textContent = `${pending} pending save${pending === 1 ? '' : 's'}`;
    else if (state.data) statusEl.textContent = 'Connected';
  }

  function queueParticipationWrites(updates, options = {}) {
    const list = (updates || []).filter(u => u && u.event_id && u.player_id);
    if (!list.length) return;
    list.forEach(update => {
      const key = participationQueueKey(update);
      const prev = state.pendingParticipation[key] || {};
      state.pendingParticipation[key] = {
        ...prev,
        ...stripClientFields(update),
        _seq: `${Date.now()}_${Math.random().toString(36).slice(2)}`
      };
      mergeLocalParticipation(stripClientFields(update));
    });
    persistPendingParticipation();
    if (options.render !== false) {
      if (state.tab === 'session') renderSession();
      else render();
    }
    updateSaveIndicator();
    scheduleParticipationFlush(options.flushNow ? 0 : 650);
  }

  function scheduleParticipationFlush(delay = 650) {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => flushPendingParticipation(), delay);
  }

  async function flushPendingParticipation() {
    if (state.demo || state.saveInFlight || !navigator.onLine || !window.ksvApi.getToken()) {
      updateSaveIndicator();
      return;
    }
    const keys = Object.keys(state.pendingParticipation || {});
    if (!keys.length) { updateSaveIndicator(); return; }

    const snapshot = keys.map(key => ({ key, seq: state.pendingParticipation[key]._seq, data: stripClientFields(state.pendingParticipation[key]) }));
    state.saveInFlight = true;
    updateSaveIndicator();
    try {
      await window.ksvApi.call('batchUpdateParticipation', { updates: snapshot.map(x => x.data) });
      snapshot.forEach(item => {
        if (state.pendingParticipation[item.key]?._seq === item.seq) delete state.pendingParticipation[item.key];
      });
      persistPendingParticipation();
      if (Object.keys(state.pendingParticipation).length) scheduleParticipationFlush(250);
    } catch (err) {
      console.error(err);
      if (/session/i.test(err.message || '')) {
        window.ksvApi.clearToken();
        renderLogin('Your session expired. Unsaved attendance changes are kept locally and will retry after sign-in.');
      } else {
        toast('Could not reach the backend. Changes are kept locally and will retry.', 'warn');
      }
    } finally {
      state.saveInFlight = false;
      updateSaveIndicator();
    }
  }

  function showNav(show) { nav.hidden = !show; }

  function openModal(html, onReady) {
    modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal="1"><section class="modal-sheet" role="dialog" aria-modal="true">${html}</section></div>`;
    const backdrop = $('.modal-backdrop', modalRoot);
    backdrop.addEventListener('click', e => { if (e.target.dataset.closeModal) closeModal(); });
    $$('[data-close-modal]', modalRoot).forEach(el => el.addEventListener('click', e => { if (e.currentTarget !== backdrop) closeModal(); }));
    document.body.classList.add('modal-open');
    if (onReady) onReady($('.modal-sheet', modalRoot));
  }

  function closeModal() {
    modalRoot.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function typeLabel(type) {
    return ({ practice:'Practice', match:'Match', meeting:'Meeting', duty:'Secretary duty', other:'Other' })[type] || 'Other';
  }

  function statusLabel(status) {
    return ({
      attending:'YES', selected:'SELECTED', available:'AVAILABLE',
      declined:'NO', unavailable:'UNAVAILABLE', vacation:'VACATION',
      injured:'INJURED / SUPPORT', undecided:'UNDECIDED', unknown:'UNKNOWN'
    })[status] || String(status || 'UNKNOWN').toUpperCase();
  }

  function statusClass(status) {
    return ({
      attending:'ok', selected:'ok', available:'ok',
      declined:'muted', unavailable:'muted', vacation:'muted', injured:'muted',
      undecided:'warn', unknown:'muted'
    })[status] || 'muted';
  }

  function isExpectedStatus(status, eventType) {
    if (['attending','selected'].includes(String(status || ''))) return true;
    return eventType === 'match' && ['available','injured'].includes(String(status || ''));
  }

  function isRsvpIssue(status) {
    return ['undecided','unknown'].includes(String(status || 'unknown'));
  }

  function isExplicitlyNotExpected(status, eventType) {
    const s = String(status || 'unknown');
    if (['declined','unavailable','vacation'].includes(s)) return true;
    if (s === 'injured' && eventType !== 'match') return true;
    return false;
  }

  function isRelevantParticipation(p, event) {
    if (!event) return false;
    const type = event.type || event.manual_type || event.auto_type || 'other';
    if (type !== 'duty') return true;
    return isExpectedStatus(p?.holdsport_status_norm, type) ||
      ['present','no_show','absent'].includes(String(p?.actual_attendance || ''));
  }

  function playerById(id) { return state.data?.players.find(p => String(p.id) === String(id)); }
  function eventById(id) { return state.data?.events.find(e => String(e.id) === String(id)); }
  function partFor(eventId, playerId) {
    return state.data?.participation.find(p => String(p.event_id) === String(eventId) && String(p.player_id) === String(playerId)) || null;
  }
  function playerParts(playerId) { return state.data?.participation.filter(p => String(p.player_id) === String(playerId)) || []; }
  function eventParts(eventId) { return state.data?.participation.filter(p => String(p.event_id) === String(eventId)) || []; }
  function obsForPlayer(playerId) { return state.data?.observations.filter(o => String(o.player_id) === String(playerId)) || []; }
  function dutiesForPlayer(playerId) { return state.data?.duties.filter(d => String(d.player_id) === String(playerId)) || []; }
  function dutyTypesForEvent(eventId) { return state.data?.duty_types.filter(d => String(d.event_id) === String(eventId)) || []; }

  function sortedEvents() {
    return [...(state.data?.events || [])].sort((a,b) => (toDate(a.start_time)?.getTime() || 0) - (toDate(b.start_time)?.getTime() || 0));
  }

  function getNextEvent() {
    return sortedEvents().find(e => (toDate(e.start_time)?.getTime() || 0) >= Date.now() - 2 * 3600000) || null;
  }

  function ensureSelectedEvent() {
    if (state.selectedEventId && eventById(state.selectedEventId)) return;
    const next = getNextEvent();
    const events = sortedEvents();
    state.selectedEventId = next?.id || events[events.length - 1]?.id || '';
  }

  function metricForPlayer(playerId, days = 60) {
    const eventMap = new Map((state.data?.events || []).map(e => [String(e.id), e]));
    const relevantParts = playerParts(playerId).filter(p => {
      const e = eventMap.get(String(p.event_id));
      return e && isWithinPast(e.start_time, days) && isRelevantParticipation(p, e);
    });
    const attended = relevantParts.filter(p => p.actual_attendance === 'present');
    const late = attended.filter(p => num(p.arrival_minutes) > 0);
    const noShows = relevantParts.filter(p => p.actual_attendance === 'no_show');
    const absences = relevantParts.filter(p => ['no_show','absent'].includes(String(p.actual_attendance)));
    const duty = dutiesForPlayer(playerId).filter(d => {
      const e = eventMap.get(String(d.event_id)); return e && isWithinPast(e.start_time, days);
    });
    const missedDuty = duty.filter(d => d.status === 'missed');
    const openObs = obsForPlayer(playerId).filter(o => !bool(o.positive) && o.status !== 'resolved' && isWithinPast(o.created_at, days));
    const matchEvents = (state.data?.events || []).filter(e => (e.type || e.manual_type || e.auto_type) === 'match');
    const currentUndecided = matchEvents.filter(e => {
      const du = daysUntil(e.start_time);
      if (du < 0 || du > 7) return false;
      const p = partFor(e.id, playerId);
      return !p || (isRsvpIssue(p.holdsport_status_norm) && !bool(p.contacted_coach));
    });

    return {
      attended: attended.length,
      opportunities: relevantParts.length,
      late: late.length,
      noShows: noShows.length,
      absences: absences.length,
      duties: duty.length,
      missedDuty: missedDuty.length,
      openObs: openObs.length,
      undecided: currentUndecided.length
    };
  }

  function severityCell(value, alertAt = 2) {
    if (!value) return ['good', '·'];
    if (value >= alertAt) return ['alert', value >= 3 ? '3+' : String(value)];
    return ['warn', String(value)];
  }

  function buildAttention() {
    const items = [];
    const events = sortedEvents();

    events.filter(e => (e.type || e.manual_type || e.auto_type) === 'match' && daysUntil(e.start_time) >= 0 && daysUntil(e.start_time) <= 7)
      .forEach(e => {
        state.data.players.forEach(player => {
          const p = partFor(e.id, player.id);
          const status = p?.holdsport_status_norm || 'unknown';
          if (isRsvpIssue(status) && !bool(p?.contacted_coach)) {
            items.push({ tone:'warn', title:player.name, text:`${fmtDate(e.start_time)} match: still ${status}.`, eventId:e.id, playerId:player.id });
          }
        });
      });

    state.data.players.forEach(player => {
      const m = metricForPlayer(player.id, 30);
      if (m.late >= 2) items.push({ tone:'warn', title:player.name, text:`${m.late} late arrivals in the last 30 days.`, playerId:player.id });
      if (m.noShows >= 1) items.push({ tone:'alert', title:player.name, text:`${m.noShows} no-show${m.noShows > 1 ? 's' : ''} in the last 30 days.`, playerId:player.id });
      if (m.missedDuty >= 1) items.push({ tone:'warn', title:player.name, text:`${m.missedDuty} missed duty in the last 30 days.`, playerId:player.id });
      if (m.openObs >= 2) items.push({ tone:'alert', title:player.name, text:`${m.openObs} open culture/reliability observations.`, playerId:player.id });
    });

    (state.data.observations || []).filter(o => !bool(o.positive) && o.status !== 'resolved')
      .slice(-6).forEach(o => {
        const p = playerById(o.player_id);
        if (!p) return;
        items.push({ tone:'warn', title:p.name, text:`Open: ${o.behavior}`, playerId:p.id, eventId:o.event_id });
      });

    const seen = new Set();
    return items.filter(i => {
      const k = i.title + '|' + i.text;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0, 12);
  }

  function renderDashboard() {
    const next = getNextEvent();
    const attention = buildAttention();
    const lastSync = state.data.sync_log?.slice(-1)[0];

    const heatRows = state.data.players.map(player => {
      const m = metricForPlayer(player.id, 60);
      const rsvp = severityCell(m.undecided, 1);
      const attend = severityCell(m.noShows, 1);
      const late = severityCell(m.late, 2);
      const duty = severityCell(m.missedDuty, 1);
      const culture = severityCell(m.openObs, 2);
      return `<tr data-player-id="${esc(player.id)}" class="clickable-row">
        <th><span class="player-name">${esc(player.name)}</span>${player.position ? `<span class="subtle">${esc(player.position)}</span>` : ''}</th>
        ${heatCell(rsvp, `${m.undecided} current match RSVP issue(s)`)}
        ${heatCell(attend, `${m.noShows} no-show(s) / ${m.opportunities} tracked events`)}
        ${heatCell(late, `${m.late} late / ${m.attended} attended`)}
        ${heatCell(duty, `${m.missedDuty} missed duty / ${m.duties} duties`)}
        ${heatCell(culture, `${m.openObs} open observation(s)`)}
      </tr>`;
    }).join('');

    app.innerHTML = `
      <section class="page-heading">
        <div><p class="eyebrow">KSV D3 · 2026/27</p><h1>Coach dashboard</h1></div>
        <button class="icon-btn" id="refreshBtn" title="Refresh">↻</button>
      </section>

      ${next ? `<section class="hero-card ${esc(next.type || next.auto_type || 'other')}">
        <div><span class="pill">NEXT · ${esc(typeLabel(next.type || next.manual_type || next.auto_type))}</span>
        <h2>${esc(next.name)}</h2>
        <p>${esc(fmtDate(next.start_time, {weekday:true}))} · ${esc(fmtTime(next.start_time))}${next.place ? ` · ${esc(next.place)}` : ''}</p></div>
        <button class="primary" data-open-event="${esc(next.id)}">Open session</button>
      </section>` : `<section class="card empty"><h2>No events yet</h2><p>Sync Holdsport or add a manual event.</p></section>`}

      <section class="section-block">
        <div class="section-title"><div><h2>Needs attention</h2><p>Exceptions and unresolved patterns, not a player ranking.</p></div><span class="count-badge">${attention.length}</span></div>
        <div class="attention-list">
          ${attention.length ? attention.map(i => `<button class="attention-item ${i.tone}" data-att-player="${esc(i.playerId || '')}" data-att-event="${esc(i.eventId || '')}">
            <span class="attention-dot"></span><span><strong>${esc(i.title)}</strong><small>${esc(i.text)}</small></span><span>›</span>
          </button>`).join('') : `<div class="all-clear"><strong>No current flags.</strong><span>Nothing needs follow-up from the data currently recorded.</span></div>`}
        </div>
      </section>

      <section class="section-block">
        <div class="section-title"><div><h2>60-day pattern map</h2><p>Numbers are exception counts. Tap a player for context.</p></div></div>
        <div class="table-scroll"><table class="heatmap"><thead><tr><th>Player</th><th>RSVP</th><th>Attend</th><th>Late</th><th>Duty</th><th>Culture</th></tr></thead><tbody>${heatRows || `<tr><td colspan="6">No players yet.</td></tr>`}</tbody></table></div>
        <div class="legend"><span><i class="legend-dot good"></i>clear</span><span><i class="legend-dot warn"></i>watch</span><span><i class="legend-dot alert"></i>repeated/open</span></div>
      </section>

      <section class="section-block compact-meta">
        <span>${state.demo ? 'Demo data' : `Last sync: ${lastSync ? esc(fmtDate(lastSync.timestamp, {year:'numeric'})) + ' ' + esc(fmtTime(lastSync.timestamp)) : 'not yet'}`}</span>
        <span>Generated ${esc(fmtTime(state.data.generated_at))}</span>
      </section>`;

    $('#refreshBtn')?.addEventListener('click', () => state.demo ? render() : loadData());
    $$('[data-open-event]').forEach(b => b.addEventListener('click', () => { state.selectedEventId = b.dataset.openEvent; switchTab('session'); }));
    $$('.clickable-row').forEach(r => r.addEventListener('click', () => openPlayer(r.dataset.playerId)));
    $$('.attention-item').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.attEvent) { state.selectedEventId = b.dataset.attEvent; switchTab('session'); }
      else if (b.dataset.attPlayer) openPlayer(b.dataset.attPlayer);
    }));
  }

  function heatCell(tuple, title) {
    return `<td title="${esc(title)}"><span class="heat ${tuple[0]}">${esc(tuple[1])}</span></td>`;
  }

  function eventDutyCapacity(event) {
    const types = dutyTypesForEvent(event.id);
    const secretary = types.find(t => /secretary|sekret|table|score/i.test(String(t.duty_name || '')) && Number(t.max_participants) > 0);
    if (secretary) return Number(secretary.max_participants);
    const anyConfigured = types.find(t => Number(t.max_participants) > 0);
    if (anyConfigured) return Number(anyConfigured.max_participants);
    const eventCapacity = Number(event.max_attendees || 0);
    // Holdsport commonly uses 999 as an effectively-unlimited sentinel.
    if (eventCapacity > 0 && eventCapacity < 100) return eventCapacity;
    return 2;
  }

  function renderSession() {
    ensureSelectedEvent();
    const events = sortedEvents().filter(e => daysUntil(e.start_time) > -180 && daysUntil(e.start_time) < 400);
    const event = eventById(state.selectedEventId);
    if (!event) {
      app.innerHTML = `<section class="page-heading"><div><p class="eyebrow">SESSION MODE</p><h1>No event selected</h1></div></section><button class="primary" id="manualEventBtn">Add manual event</button>`;
      $('#manualEventBtn')?.addEventListener('click', openManualEventModal);
      return;
    }

    const players = [...state.data.players].sort((a,b) => a.name.localeCompare(b.name));
    const parts = eventParts(event.id);
    const eventType = event.type || event.manual_type || event.auto_type || 'other';
    const assignedPlayerIds = new Set((state.data.duties || []).filter(d => String(d.event_id) === String(event.id)).map(d => String(d.player_id)));
    const displayPlayers = eventType === 'duty'
      ? players.filter(player => {
          const p = partFor(event.id, player.id) || {};
          return assignedPlayerIds.has(String(player.id)) || ['attending','selected','available'].includes(String(p.holdsport_status_norm || ''));
        })
      : players;
    const expectedCount = parts.filter(p => isExpectedStatus(p.holdsport_status_norm, eventType)).length;
    const attendingCount = parts.filter(p => p.holdsport_status_norm === 'attending').length;
    const availableCount = parts.filter(p => p.holdsport_status_norm === 'available').length;
    const selectedCount = parts.filter(p => p.holdsport_status_norm === 'selected').length;
    const vacationCount = parts.filter(p => p.holdsport_status_norm === 'vacation').length;
    const declinedCount = parts.filter(p => ['declined','unavailable'].includes(String(p.holdsport_status_norm))).length;
    const injuredCount = parts.filter(p => p.holdsport_status_norm === 'injured').length;
    const undecidedCount = eventType === 'duty' ? 0 : parts.filter(p => isRsvpIssue(p.holdsport_status_norm)).length;
    const actualPresent = parts.filter(p => p.actual_attendance === 'present').length;
    const dutyCapacity = eventType === 'duty' ? eventDutyCapacity(event) : 0;
    const dutySignedUp = displayPlayers.length;
    const matchLimit = Number(state.data.configuration?.match_roster_limit || 14);

    app.innerHTML = `
      <section class="page-heading"><div><p class="eyebrow">SESSION MODE</p><h1>${esc(typeLabel(event.type || event.manual_type || event.auto_type))}</h1></div><button class="icon-btn" id="manualEventBtn" title="Add manual event">＋</button></section>
      <section class="event-picker-wrap"><select id="eventPicker" class="event-picker">${events.map(e => `<option value="${esc(e.id)}" ${e.id === event.id ? 'selected' : ''}>${esc(fmtDate(e.start_time))} · ${esc(e.name)}</option>`).join('')}</select></section>
      <section class="event-head card">
        <div><span class="pill">${esc(typeLabel(event.type || event.manual_type || event.auto_type))}</span><h2>${esc(event.name)}</h2><p>${esc(fmtDate(event.start_time,{weekday:true}))} · ${esc(fmtTime(event.start_time))}${event.place ? ` · ${esc(event.place)}` : ''}</p></div>
        <div class="mini-stats">
          ${eventType === 'duty'
            ? `<span><b>${dutySignedUp} / ${dutyCapacity}</b> signed up</span>`
            : `<span><b>${expectedCount}</b> expected</span><span><b>${undecidedCount}</b> unresolved</span>`}
          ${eventType === 'match' ? (selectedCount
            ? `<span><b>${selectedCount} / ${matchLimit}</b> selected</span>`
            : `<span><b>${attendingCount}</b> YES <small>· roster limit ${matchLimit}</small></span>`) : ''}
          ${availableCount ? `<span><b>${availableCount}</b> available/support</span>` : ''}
          ${injuredCount ? `<span><b>${injuredCount}</b> injured/support</span>` : ''}
          ${declinedCount ? `<span><b>${declinedCount}</b> no/unavailable</span>` : ''}
          ${vacationCount ? `<span><b>${vacationCount}</b> vacation</span>` : ''}
          <span><b>${actualPresent}</b> marked present</span>
        </div>
        <div class="button-row"><button class="primary" id="markExpectedBtn">✓ Mark all expected present</button><button class="ghost" id="eventTypeBtn">Type: ${esc(typeLabel(eventType))}</button></div>
      </section>

      ${eventType === 'duty' && dutySignedUp < dutyCapacity
        ? `<section class="notice warn"><strong>${dutyCapacity - dutySignedUp} secretary slot${dutyCapacity - dutySignedUp === 1 ? '' : 's'} still open in Holdsport.</strong> Players who are not signed up are not treated as absent or unreliable.</section>`
        : ''}
      ${eventType === 'duty' && !displayPlayers.length
        ? `<section class="empty-state card"><strong>No one is signed up yet.</strong><p>This duty needs ${dutyCapacity} people. The rest of the roster is not expected to attend this event.</p></section>`
        : `<section class="roster-list">
            ${displayPlayers.map(player => renderRosterRow(event, player)).join('')}
          </section>`}
      ${renderDuties(event.id)}
    `;

    $('#eventPicker').addEventListener('change', e => { state.selectedEventId = e.target.value; renderSession(); });
    $('#manualEventBtn').addEventListener('click', openManualEventModal);
    $('#markExpectedBtn').addEventListener('click', () => bulkPresent(event.id));
    $('#eventTypeBtn').addEventListener('click', () => openEventTypeModal(event));
    $$('[data-quick]', app).forEach(btn => btn.addEventListener('click', () => quickAttendance(btn.dataset.player, event.id, btn.dataset.quick)));
    $$('[data-more-player]', app).forEach(btn => btn.addEventListener('click', () => openParticipationModal(event.id, btn.dataset.morePlayer)));
    $$('[data-duty-status]', app).forEach(btn => btn.addEventListener('click', () => updateDuty(btn.dataset.duty, btn.dataset.dutyStatus)));
  }

  function renderRosterRow(event, player) {
    const p = partFor(event.id, player.id) || {};
    const eventType = event.type || event.manual_type || event.auto_type || 'other';
    const holdStatus = p.holdsport_status_norm || 'unknown';
    const actual = p.actual_attendance || '';
    const arrival = num(p.arrival_minutes);
    const notExpected = isExplicitlyNotExpected(holdStatus, eventType);
    let actualLabel = isRsvpIssue(holdStatus) ? 'RSVP unresolved' : 'Not marked';
    let actualClass = isRsvpIssue(holdStatus) ? 'warn' : 'muted';
    if (notExpected && !actual) { actualLabel = 'Not expected'; actualClass = 'muted'; }
    if (actual === 'present') { actualLabel = arrival > 0 ? `Present · +${arrival}m` : 'Present · on time'; actualClass = arrival > 0 ? 'warn' : 'ok'; }
    if (actual === 'no_show') { actualLabel = 'No-show'; actualClass = 'alert'; }
    if (actual === 'absent_excused') { actualLabel = 'Excused absence'; actualClass = 'muted'; }
    if (actual === 'absent') { actualLabel = 'Absent'; actualClass = 'warn'; }

    const standardActions = `<div class="quick-grid">
        <button data-quick="present" data-player="${esc(player.id)}" class="quick ${actual === 'present' && arrival === 0 ? 'active' : ''}">✓</button>
        <button data-quick="5" data-player="${esc(player.id)}" class="quick ${actual === 'present' && arrival === 5 ? 'active warn' : ''}">+5</button>
        <button data-quick="10" data-player="${esc(player.id)}" class="quick ${actual === 'present' && arrival === 10 ? 'active warn' : ''}">+10</button>
        <button data-quick="15" data-player="${esc(player.id)}" class="quick ${actual === 'present' && arrival === 15 ? 'active warn' : ''}">+15</button>
        <button data-quick="no_show" data-player="${esc(player.id)}" class="quick danger ${actual === 'no_show' ? 'active' : ''}">No show</button>
        <button data-more-player="${esc(player.id)}" class="quick more">•••</button>
      </div>`;
    const notExpectedActions = `<div class="not-expected-actions"><span>No action needed</span><button data-quick="present" data-player="${esc(player.id)}" class="small">Present anyway</button><button data-more-player="${esc(player.id)}" class="small">•••</button></div>`;

    return `<article class="roster-row ${notExpected && !actual ? 'not-expected' : ''}">
      <button class="roster-identity" data-more-player="${esc(player.id)}"><span class="avatar">${esc(initials(player.name))}</span><span><strong>${esc(player.name)}</strong><small><span class="status-text ${statusClass(holdStatus)}">Holdsport ${esc(statusLabel(holdStatus))}</span> · <span class="status-text ${actualClass}">${esc(actualLabel)}</span></small></span></button>
      ${notExpected && !actual ? notExpectedActions : standardActions}
    </article>`;
  }

  function renderDuties(eventId) {
    const assignments = (state.data.duties || []).filter(d => String(d.event_id) === String(eventId));
    const types = dutyTypesForEvent(eventId);
    if (!assignments.length && !types.length) return '';

    const assignmentKey = d => String(d.holdsport_task_id || d.duty_name || '');
    const knownKeys = new Set(types.map(t => String(t.holdsport_task_id || t.duty_name || '')));
    const groups = [];

    types.forEach(t => {
      const key = String(t.holdsport_task_id || t.duty_name || '');
      groups.push({
        name: t.duty_name || 'Duty',
        max: Number(t.max_participants || 0),
        assigned: assignments.filter(d => assignmentKey(d) === key)
      });
    });

    assignments.filter(d => !knownKeys.has(assignmentKey(d))).forEach(d => {
      let g = groups.find(x => x.name === d.duty_name && !x.max);
      if (!g) { g = { name:d.duty_name || 'Duty', max:0, assigned:[] }; groups.push(g); }
      g.assigned.push(d);
    });

    return `<section class="section-block"><div class="section-title"><div><h2>Duties</h2><p>Only assigned players are accountable. Unfilled slots are shown separately.</p></div></div><div class="duty-list">${groups.map(g => {
      const count = g.assigned.length;
      const coverage = g.max ? `${count}/${g.max} signed up` : `${count} assigned`;
      const vacancy = g.max && count < g.max ? `<small class="status-text warn">${g.max-count} slot${g.max-count===1?'':'s'} still open</small>` : '';
      const rows = g.assigned.length ? g.assigned.map(d => {
        const p = playerById(d.player_id);
        return `<div class="duty-row"><span><strong>${esc(g.name)}</strong><small>${esc(p?.name || 'Unknown player')} · ${esc(d.status)}</small></span><span class="button-row tight"><button class="small ${d.status==='done'?'active':''}" data-duty="${esc(d.id)}" data-duty-status="done">Done</button><button class="small ${d.status==='covered'?'active':''}" data-duty="${esc(d.id)}" data-duty-status="covered">Covered</button><button class="small danger ${d.status==='missed'?'active':''}" data-duty="${esc(d.id)}" data-duty-status="missed">Missed</button></span></div>`;
      }).join('') : `<div class="duty-row"><span><strong>${esc(g.name)}</strong><small>No one signed up yet.</small></span></div>`;
      return `<div class="card duty-group"><div class="section-title"><div><h3>${esc(g.name)}</h3><p>${esc(coverage)}</p>${vacancy}</div></div>${rows}</div>`;
    }).join('')}</div></section>`;
  }

  async function quickAttendance(playerId, eventId, quick) {
    const data = { event_id:eventId, player_id:playerId };
    if (quick === 'present') Object.assign(data, { actual_attendance:'present', arrival_minutes:0, ready_at_start:true });
    else if (quick === 'no_show') Object.assign(data, { actual_attendance:'no_show', ready_at_start:false });
    else Object.assign(data, { actual_attendance:'present', arrival_minutes:Number(quick), ready_at_start:false });
    await saveParticipation(data);
  }

  async function saveParticipation(data) {
    if (state.demo) {
      mergeLocalParticipation(data);
      render();
      toast('Demo: saved locally for this session.');
      return;
    }
    // Optimistic save: update the UI immediately, then batch/debounce the Sheet write.
    queueParticipationWrites([data]);
  }

  function mergeLocalParticipation(update) {
    let p = state.data.participation.find(x => String(x.event_id) === String(update.event_id) && String(x.player_id) === String(update.player_id));
    if (!p) { p = { id:update.id || `local_${update.event_id}_${update.player_id}`, event_id:update.event_id, player_id:update.player_id }; state.data.participation.push(p); }
    Object.assign(p, update);
  }

  async function bulkPresent(eventId) {
    const event = eventById(eventId);
    if (!event) return;
    const eventType = event.type || event.manual_type || event.auto_type || 'other';
    const updates = [];
    state.data.players.forEach(pl => {
      const p = partFor(eventId, pl.id) || {};
      if (!isExpectedStatus(p.holdsport_status_norm, eventType)) return;
      if (p.actual_attendance) return;
      updates.push({ event_id:eventId, player_id:pl.id, actual_attendance:'present', arrival_minutes:0, ready_at_start:true });
    });
    if (!updates.length) { toast('All expected players are already marked.'); return; }

    if (state.demo) {
      updates.forEach(mergeLocalParticipation);
      renderSession();
      toast(`${updates.length} player${updates.length===1?'':'s'} marked present.`);
      return;
    }

    // Instant local update + one batched backend request instead of N separate requests.
    queueParticipationWrites(updates, { render:false, flushNow:true });
    renderSession();
    toast(`${updates.length} expected player${updates.length===1?'':'s'} marked present.`);
  }

  function openParticipationModal(eventId, playerId) {
    const event = eventById(eventId);
    const player = playerById(playerId);
    const p = partFor(eventId, playerId) || {};
    openModal(`
      <div class="modal-handle"></div>
      <div class="modal-header"><div><p class="eyebrow">${esc(event?.name || '')}</p><h2>${esc(player?.name || '')}</h2></div><button class="icon-btn" data-close-modal="1">×</button></div>
      <form id="partForm" class="form-grid">
        <label>Actual attendance<select name="actual_attendance"><option value="">Not marked</option><option value="present">Present</option><option value="absent_excused">Excused absence</option><option value="absent">Absent</option><option value="no_show">No-show</option></select></label>
        <label>Minutes late<input type="number" min="0" max="180" name="arrival_minutes" value="${esc(p.arrival_minutes || 0)}"></label>
        <label class="check-row"><input type="checkbox" name="ready_at_start" ${bool(p.ready_at_start)?'checked':''}> Ready at agreed start</label>
        <label>Context<select name="context_category"><option value="">—</option><option>excused/personal</option><option>health</option><option>work/study</option><option>emergency</option><option>forgot</option><option>unknown</option></select></label>
        <label class="check-row"><input type="checkbox" name="contacted_coach" ${bool(p.contacted_coach)?'checked':''}> Contacted coach about uncertainty/change</label>
        <label>Expected answer date<input type="date" name="expected_answer_date" value="${esc(String(p.expected_answer_date || '').slice(0,10))}"></label>
        <label class="span-2">Short factual note<textarea name="manual_note" maxlength="600" placeholder="Observable fact/context, not a personality label.">${esc(p.manual_note || '')}</textarea></label>
        <div class="button-row span-2"><button class="primary" type="submit">Save</button><button class="secondary" type="button" id="obsBtn">Add culture / reliability observation</button></div>
      </form>`, root => {
        const form = $('#partForm', root);
        form.actual_attendance.value = p.actual_attendance || '';
        form.context_category.value = p.context_category || '';
        form.addEventListener('submit', async e => {
          e.preventDefault();
          const fd = new FormData(form);
          closeModal();
          await saveParticipation({
            event_id:eventId,
            player_id:playerId,
            actual_attendance:fd.get('actual_attendance'),
            arrival_minutes:Number(fd.get('arrival_minutes') || 0),
            ready_at_start:form.ready_at_start.checked,
            context_category:fd.get('context_category'),
            contacted_coach:form.contacted_coach.checked,
            expected_answer_date:fd.get('expected_answer_date'),
            manual_note:fd.get('manual_note')
          });
        });
        $('#obsBtn', root).addEventListener('click', () => { closeModal(); openObservationModal(playerId, eventId); });
      });
  }

  function openObservationModal(playerId, eventId = '') {
    const player = playerById(playerId);
    openModal(`
      <div class="modal-handle"></div><div class="modal-header"><div><p class="eyebrow">OBSERVATION</p><h2>${esc(player?.name || '')}</h2></div><button class="icon-btn" data-close-modal="1">×</button></div>
      <div class="preset-grid">${OBS_PRESETS.map((p,i) => `<button type="button" class="preset ${p[2]?'positive':''}" data-preset="${i}">${p[2]?'✓ ':''}${esc(p[1])}</button>`).join('')}</div>
      <form id="obsForm" class="form-grid">
        <label>Category<select name="category"><option>communication</option><option>setup</option><option>pack-up</option><option>phone</option><option>engagement</option><option>match involvement</option><option>team behaviour</option><option>respect</option><option>duty</option><option>responsibility</option><option>other</option></select></label>
        <label>Significance<select name="severity"><option value="info">Info</option><option value="concern" selected>Concern</option><option value="major">Major</option></select></label>
        <label class="span-2">Observable behaviour<input name="behavior" maxlength="140" required placeholder="What happened?"></label>
        <label class="span-2">Context / note<textarea name="note" maxlength="600" placeholder="Keep it factual and brief."></textarea></label>
        <label class="check-row span-2"><input type="checkbox" name="positive"> Positive / repaired behaviour</label>
        <button class="primary span-2" type="submit">Save observation</button>
      </form>`, root => {
        const form = $('#obsForm', root);
        $$('[data-preset]', root).forEach(btn => btn.addEventListener('click', () => {
          const p = OBS_PRESETS[Number(btn.dataset.preset)];
          form.category.value = p[0]; form.behavior.value = p[1]; form.positive.checked = p[2];
          form.severity.value = p[2] ? 'info' : 'concern';
        }));
        form.addEventListener('submit', async e => {
          e.preventDefault();
          const fd = new FormData(form);
          const payload = {
            player_id:playerId, event_id:eventId, category:fd.get('category'), behavior:fd.get('behavior'),
            severity:fd.get('severity'), note:fd.get('note'), positive:form.positive.checked
          };
          closeModal();
          if (state.demo) { state.data.observations.push({id:'demo_obs_'+Date.now(),created_at:new Date().toISOString(),status:payload.positive?'resolved':'open',...payload}); render(); toast('Demo observation saved.'); return; }
          await runBusy('Saving observation…', async () => {
            const row = await window.ksvApi.call('addObservation', payload);
            state.data.observations.push(row); render(); toast('Observation saved.');
          });
        });
      });
  }

  async function updateDuty(id, status) {
    const d=state.data.duties.find(x=>x.id===id);
    if (!d) return;
    const previous=d.status;
    d.status=status;
    renderSession();
    if (state.demo) return;
    statusEl.textContent='Saving duty…';
    try {
      await window.ksvApi.call('updateDuty', { duty_id:id, status });
      updateSaveIndicator();
    } catch (err) {
      d.status=previous;
      renderSession();
      updateSaveIndicator();
      toast(err.message || 'Duty could not be saved.', 'error');
    }
  }

  function openEventTypeModal(event) {
    openModal(`<div class="modal-handle"></div><div class="modal-header"><h2>Event type</h2><button class="icon-btn" data-close-modal="1">×</button></div><div class="stack">${['practice','match','meeting','duty','other'].map(t => `<button class="option-btn ${(event.type||event.manual_type||event.auto_type)===t?'selected':''}" data-type="${t}">${typeLabel(t)}</button>`).join('')}</div>`, root => {
      $$('[data-type]', root).forEach(btn => btn.addEventListener('click', async () => {
        const type=btn.dataset.type; closeModal();
        if (state.demo) { event.manual_type=type; event.type=type; renderSession(); return; }
        await runBusy('Saving type…', async () => { await window.ksvApi.call('setEventType',{event_id:event.id,type}); event.manual_type=type; event.type=type; renderSession(); });
      }));
    });
  }

  function openManualEventModal() {
    const defaultStart = new Date(Date.now()+3600000);
    openModal(`<div class="modal-handle"></div><div class="modal-header"><div><p class="eyebrow">MANUAL EVENT</p><h2>Add event</h2></div><button class="icon-btn" data-close-modal="1">×</button></div><form id="eventForm" class="form-grid">
      <label class="span-2">Name<input name="name" required placeholder="Team meeting"></label>
      <label>Type<select name="type"><option value="practice">Practice</option><option value="match">Match</option><option value="meeting" selected>Meeting</option><option value="duty">Secretary duty</option><option value="other">Other</option></select></label>
      <label>Start<input type="datetime-local" name="start_time" required value="${esc(isoLocalInput(defaultStart))}"></label>
      <label class="span-2">Place<input name="place" placeholder="Optional"></label>
      <button class="primary span-2" type="submit">Add event</button>
    </form>`, root => {
      $('#eventForm', root).addEventListener('submit', async e => {
        e.preventDefault(); const fd=new FormData(e.currentTarget);
        const payload={name:fd.get('name'),type:fd.get('type'),start_time:new Date(fd.get('start_time')).toISOString(),place:fd.get('place')};
        closeModal();
        if(state.demo){const row={id:'manual_'+Date.now(),source:'manual',manual_type:payload.type,auto_type:payload.type,...payload}; state.data.events.push(row); state.selectedEventId=row.id; renderSession(); return;}
        await runBusy('Adding event…', async()=>{const row=await window.ksvApi.call('createManualEvent',payload); row.type=row.manual_type||row.auto_type; state.data.events.push(row); state.selectedEventId=row.id; renderSession(); toast('Event added.');});
      });
    });
  }

  function renderPlayers() {
    if (state.selectedPlayerId && playerById(state.selectedPlayerId)) { renderPlayerDetail(state.selectedPlayerId); return; }
    app.innerHTML = `<section class="page-heading"><div><p class="eyebrow">ROSTER</p><h1>Players</h1></div></section><section class="player-grid">${[...state.data.players].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>{
      const m=metricForPlayer(p.id,60);
      return `<button class="player-card" data-player-card="${esc(p.id)}"><span class="avatar large">${esc(initials(p.name))}</span><span class="grow"><strong>${esc(p.name)}</strong><small>${esc(p.position||'Position not set')}</small><span class="mini-tags"><i>${m.attended}/${m.opportunities} attended</i>${m.late?`<i class="warn">${m.late} late</i>`:''}${m.openObs?`<i class="alert">${m.openObs} open</i>`:''}</span></span><span>›</span></button>`;
    }).join('')}</section>`;
    $$('[data-player-card]').forEach(b=>b.addEventListener('click',()=>openPlayer(b.dataset.playerCard)));
  }

  function openPlayer(id) { state.selectedPlayerId=id; state.tab='players'; updateNav(); renderPlayerDetail(id); window.scrollTo({top:0,behavior:'smooth'}); }

  function renderPlayerDetail(playerId) {
    const player=playerById(playerId); if(!player){state.selectedPlayerId='';renderPlayers();return;}
    const days=state.playerWindow;
    const metrics=metricForPlayer(playerId, days===9999?5000:days);
    const eventMap=new Map(state.data.events.map(e=>[String(e.id),e]));
    const partTimeline=playerParts(playerId).map(p=>({kind:'participation',date:eventMap.get(String(p.event_id))?.start_time||'',event:eventMap.get(String(p.event_id)),data:p}))
      .filter(x=>isRelevantParticipation(x.data,x.event))
      .filter(x=>days===9999||isWithinPast(x.date,days));
    const obsTimeline=obsForPlayer(playerId).map(o=>({kind:'observation',date:o.created_at,data:o})).filter(x=>days===9999||isWithinPast(x.date,days));
    const dutyTimeline=dutiesForPlayer(playerId).map(d=>({kind:'duty',date:eventMap.get(String(d.event_id))?.start_time||'',event:eventMap.get(String(d.event_id)),data:d})).filter(x=>days===9999||isWithinPast(x.date,days));
    const timeline=[...partTimeline,...obsTimeline,...dutyTimeline].filter(x=>x.date).sort((a,b)=>(toDate(b.date)?.getTime()||0)-(toDate(a.date)?.getTime()||0));
    const recentDots=partTimeline.sort((a,b)=>(toDate(a.date)?.getTime()||0)-(toDate(b.date)?.getTime()||0)).slice(-14);

    app.innerHTML=`
      <section class="page-heading"><button class="icon-btn" id="backPlayers">←</button><div class="grow"><p class="eyebrow">PLAYER</p><h1>${esc(player.name)}</h1><p>${esc(player.position||'Position not set')}</p></div><button class="secondary small" id="editPlayer">Edit</button></section>
      <section class="stats-grid">
        <div class="stat-card"><b>${metrics.attended}<small> / ${metrics.opportunities}</small></b><span>attendance marks</span></div>
        <div class="stat-card"><b>${metrics.late}</b><span>late arrivals</span></div>
        <div class="stat-card"><b>${metrics.noShows}</b><span>no-shows</span></div>
        <div class="stat-card"><b>${metrics.openObs}</b><span>open observations</span></div>
      </section>
      <section class="card"><div class="section-title"><div><h2>Recent sessions</h2><p>Sequence, not a score.</p></div></div><div class="dot-timeline">${recentDots.length?recentDots.map(x=>dotForParticipation(x.data,x.event)).join(''):'<span class="subtle">No recorded sessions yet.</span>'}</div></section>
      <div class="segmented" id="windowTabs"><button data-window="30" ${days===30?'class="active"':''}>30 days</button><button data-window="60" ${days===60?'class="active"':''}>60 days</button><button data-window="9999" ${days===9999?'class="active"':''}>Season</button></div>
      <section class="section-block"><div class="section-title"><div><h2>Timeline</h2><p>Facts, context, follow-up and repair.</p></div><button class="secondary small" id="addObsPlayer">+ Observation</button></div><div class="timeline">${timeline.length?timeline.map(renderTimelineItem).join(''):'<div class="empty-inline">Nothing recorded in this period.</div>'}</div></section>`;

    $('#backPlayers').addEventListener('click',()=>{state.selectedPlayerId='';renderPlayers();});
    $('#addObsPlayer').addEventListener('click',()=>openObservationModal(playerId,''));
    $('#editPlayer').addEventListener('click',()=>openPlayerEditModal(player));
    $$('[data-window]').forEach(b=>b.addEventListener('click',()=>{state.playerWindow=Number(b.dataset.window);renderPlayerDetail(playerId);}));
    $$('[data-resolve-obs]').forEach(b=>b.addEventListener('click',()=>openResolveObservationModal(b.dataset.resolveObs)));
  }

  function dotForParticipation(p,event){
    let cls='neutral',title=`${event?.name||'Event'}: not marked`;
    if(p.actual_attendance==='present'&&num(p.arrival_minutes)===0){cls='good';title=`${event?.name||'Event'}: present on time`;}
    else if(p.actual_attendance==='present'){cls='warn';title=`${event?.name||'Event'}: +${num(p.arrival_minutes)} min`;}
    else if(p.actual_attendance==='no_show'){cls='alert';title=`${event?.name||'Event'}: no-show`;}
    else if(['absent','absent_excused'].includes(p.actual_attendance)){cls='muted';title=`${event?.name||'Event'}: ${p.actual_attendance.replace('_',' ')}`;}
    return `<span class="timeline-dot ${cls}" title="${esc(title)}"></span>`;
  }

  function renderTimelineItem(item){
    if(item.kind==='participation'){
      const p=item.data; const e=item.event; let text='No actual attendance mark'; let tone='neutral';
      if(p.actual_attendance==='present'){text=num(p.arrival_minutes)>0?`Present · +${num(p.arrival_minutes)} min late`:'Present · on time';tone=num(p.arrival_minutes)>0?'warn':'good';}
      if(p.actual_attendance==='no_show'){text='No-show';tone='alert';}
      if(p.actual_attendance==='absent_excused'){text='Excused absence';tone='muted';}
      if(p.actual_attendance==='absent'){text='Absent';tone='warn';}
      return `<div class="timeline-item"><span class="timeline-marker ${tone}"></span><div><strong>${esc(fmtDate(item.date))} · ${esc(e?.name||'Event')}</strong><small>${esc(text)} · Holdsport ${esc(statusLabel(p.holdsport_status_norm||'unknown'))}</small>${p.manual_note?`<p>${esc(p.manual_note)}</p>`:''}</div></div>`;
    }
    if(item.kind==='observation'){
      const o=item.data; const positive=bool(o.positive); return `<div class="timeline-item"><span class="timeline-marker ${positive?'good':o.status==='resolved'?'muted':'warn'}"></span><div><strong>${esc(fmtDate(o.created_at))} · ${esc(o.category)}</strong><small>${esc(o.behavior)}${o.status==='resolved'?' · resolved':' · open'}</small>${o.note?`<p>${esc(o.note)}</p>`:''}${!positive&&o.status!=='resolved'?`<button class="text-btn" data-resolve-obs="${esc(o.id)}">Add follow-up / resolve</button>`:''}</div></div>`;
    }
    const d=item.data; return `<div class="timeline-item"><span class="timeline-marker ${d.status==='missed'?'warn':d.status==='done'||d.status==='covered'?'good':'neutral'}"></span><div><strong>${esc(fmtDate(item.date))} · Duty</strong><small>${esc(d.duty_name)} · ${esc(d.status)}</small></div></div>`;
  }

  function openResolveObservationModal(obsId){
    const obs=state.data.observations.find(o=>String(o.id)===String(obsId)); if(!obs)return;
    const player=playerById(obs.player_id);
    openModal(`<div class="modal-handle"></div><div class="modal-header"><div><p class="eyebrow">OWN → REPAIR → RESET</p><h2>${esc(player?.name||'Follow-up')}</h2></div><button class="icon-btn" data-close-modal="1">×</button></div><p class="callout">${esc(obs.behavior)}</p><form id="resolveForm" class="form-grid"><label>Conversation date<input type="date" name="conversation_date" value="${new Date().toISOString().slice(0,10)}"></label><label>Status<select name="status"><option value="resolved">Resolved / repaired</option><option value="open">Keep open</option></select></label><label class="span-2">Agreed action<textarea name="agreed_action" maxlength="600" placeholder="What should happen next?"></textarea></label><label class="span-2">Note<textarea name="note" maxlength="600" placeholder="Optional factual context"></textarea></label><button class="primary span-2" type="submit">Save follow-up</button></form>`,root=>{
      $('#resolveForm',root).addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);const resolve=fd.get('status')==='resolved';const payload={observation_id:obs.id,player_id:obs.player_id,conversation_date:fd.get('conversation_date'),agreed_action:fd.get('agreed_action'),status:fd.get('status'),note:fd.get('note'),resolve_observation:resolve};closeModal();
        if(state.demo){state.data.followups.push({id:'fu_'+Date.now(),created_at:new Date().toISOString(),...payload});if(resolve){obs.status='resolved';obs.resolved_at=new Date().toISOString();obs.resolution_note=payload.agreed_action;}renderPlayerDetail(obs.player_id);return;}
        await runBusy('Saving follow-up…',async()=>{const row=await window.ksvApi.call('addFollowup',payload);state.data.followups.push(row);if(resolve){obs.status='resolved';obs.resolved_at=new Date().toISOString();obs.resolution_note=payload.agreed_action;}renderPlayerDetail(obs.player_id);toast('Follow-up saved.');});
      });
    });
  }

  function openPlayerEditModal(player){
    openModal(`<div class="modal-handle"></div><div class="modal-header"><h2>${esc(player.name)}</h2><button class="icon-btn" data-close-modal="1">×</button></div><form id="playerEdit" class="form-grid"><label class="span-2">Position<input name="position" value="${esc(player.position||'')}" placeholder="OH, MB, S, OPP, L"></label><label class="check-row span-2"><input type="checkbox" name="active" ${bool(player.active)||player.active===''?'checked':''}> Active player</label><button class="primary span-2" type="submit">Save</button></form>`,root=>{
      $('#playerEdit',root).addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);const payload={player_id:player.id,position:fd.get('position'),active:e.currentTarget.active.checked};closeModal();if(state.demo){Object.assign(player,payload);renderPlayerDetail(player.id);return;}await runBusy('Saving player…',async()=>{const u=await window.ksvApi.call('setPlayerMeta',payload);Object.assign(player,u);renderPlayerDetail(player.id);toast('Player updated.');});});
    });
  }

  function renderSettings(){
    const c=state.data.configuration||{};
    app.innerHTML=`<section class="page-heading"><div><p class="eyebrow">SETTINGS</p><h1>Connections</h1></div></section>
      <section class="settings-card"><div><strong>Backend</strong><small>${state.demo?'Demo only':esc(window.ksvApi.getBackendUrl())}</small></div><span class="status-pill ${state.demo?'warn':'ok'}">${state.demo?'DEMO':'CONNECTED'}</span></section>
      <section class="settings-card"><div><strong>Holdsport credentials</strong><small>${c.holdsport_credentials?'Stored server-side':'Not configured in Script Properties'}</small></div><span class="status-pill ${c.holdsport_credentials?'ok':'warn'}">${c.holdsport_credentials?'READY':'SETUP'}</span></section>
      <section class="settings-card"><div><strong>Holdsport team</strong><small>${c.holdsport_team_id?`Team ID ${esc(c.holdsport_team_id)}`:'No team selected'}</small></div><span class="status-pill ${c.holdsport_team_id?'ok':'warn'}">${c.holdsport_team_id?'READY':'SETUP'}</span></section>
      <section class="card"><h2>Data controls</h2><div class="stack"><button class="primary" id="syncBtn" ${state.demo?'disabled':''}>↻ Sync Holdsport now</button><button class="secondary" id="discoverBtn" ${state.demo?'disabled':''}>Discover Holdsport teams</button><button class="secondary" id="manualEventSettings">+ Add manual event</button></div></section>
      <section class="card"><h2>Team rules</h2><p class="subtle">Season start: ${esc(c.season_start||'2026-09-07')}</p><p class="subtle">Match playing-roster limit: ${esc(c.match_roster_limit||14)}</p></section>
      <section class="card"><h2>Privacy & interpretation</h2><p>Use observable facts and broad context categories. The dashboard highlights patterns; it does not calculate a player score or make lineup decisions.</p></section>
      <section class="card danger-zone"><h2>Session</h2><div class="stack"><button class="secondary" id="signOutBtn">${state.demo?'Exit demo':'Sign out'}</button><button class="ghost" id="changeBackendBtn" ${state.demo?'disabled':''}>Change backend URL</button></div></section>`;
    $('#syncBtn')?.addEventListener('click',syncNow);
    $('#discoverBtn')?.addEventListener('click',discoverTeams);
    $('#manualEventSettings').addEventListener('click',openManualEventModal);
    $('#signOutBtn').addEventListener('click',()=>{if(state.demo){state.demo=false;state.data=null;boot();return;}window.ksvApi.clearToken();state.data=null;renderLogin();});
    $('#changeBackendBtn')?.addEventListener('click',()=>{window.ksvApi.clearBackendUrl();state.data=null;renderSetup();});
  }

  async function syncNow(){
    await runBusy('Syncing Holdsport…',async()=>{const data=await window.ksvApi.call('sync',{});state.data=normalizeData(data);applyPendingParticipationToState();render();toast('Holdsport synced.');});
  }

  async function discoverTeams(){
    await runBusy('Finding teams…',async()=>{
      const teams=await window.ksvApi.call('discoverTeams',{});
      openModal(`<div class="modal-handle"></div><div class="modal-header"><div><p class="eyebrow">HOLDSPORT</p><h2>Select team</h2></div><button class="icon-btn" data-close-modal="1">×</button></div><div class="stack">${teams.length?teams.map(t=>`<button class="option-btn" data-team="${esc(t.id)}"><strong>${esc(t.name)}</strong><small>ID ${esc(t.id)} · role ${esc(t.role)}</small></button>`).join(''):'<p>No teams returned. Check credentials.</p>'}</div>`,root=>{
        $$('[data-team]',root).forEach(b=>b.addEventListener('click',async()=>{const id=b.dataset.team;closeModal();await runBusy('Selecting team…',async()=>{await window.ksvApi.call('setTeamId',{team_id:id});const data=await window.ksvApi.call('sync',{});state.data=normalizeData(data);applyPendingParticipationToState();render();toast('Team selected and synced.');});}));
      });
    });
  }

  function switchTab(tab){ state.tab=tab; if(tab!=='players')state.selectedPlayerId=''; updateNav(); render(); window.scrollTo({top:0,behavior:'smooth'}); }
  function updateNav(){ $$('[data-tab]',nav).forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab)); }
  function render(){ if(!state.data)return; statusEl.textContent=state.demo?'Demo mode':'Connected'; updateSaveIndicator(); showNav(true); updateNav(); if(state.tab==='dashboard')renderDashboard(); else if(state.tab==='session')renderSession(); else if(state.tab==='players')renderPlayers(); else renderSettings(); }

  function normalizeData(data){
    data.players=data.players||[];data.events=data.events||[];data.participation=data.participation||[];data.rsvp_history=data.rsvp_history||[];data.observations=data.observations||[];data.followups=data.followups||[];data.duties=data.duties||[];data.duty_types=data.duty_types||[];data.sync_log=data.sync_log||[];
    data.events.forEach(e=>{e.type=e.manual_type||e.type||e.auto_type||'other';});
    return data;
  }

  async function loadData(options={}){
    if(state.demo){render();return;}
    const work = async()=>{
      const data=await window.ksvApi.call('bootstrap',{});
      state.data=normalizeData(data);
      applyPendingParticipationToState();
      if(!options.keepTab)state.tab=state.tab||'dashboard';
      render();
      if(Object.keys(state.pendingParticipation||{}).length) scheduleParticipationFlush(120);
      return data;
    };
    if(state.busy) return work();
    return runBusy(options.silent?'Refreshing…':'Loading…',work);
  }

  function renderSetup(){
    showNav(false); statusEl.textContent='Setup';
    app.innerHTML=`<section class="onboarding"><div class="brand-mark big">D3</div><p class="eyebrow">KSV COACH TRACKER</p><h1>Connect your private backend</h1><p>The GitHub page contains no Holdsport password and no player database. Paste your Google Apps Script Web App URL after completing the backend setup.</p><form id="backendForm" class="onboard-form"><label>Apps Script Web App URL<input type="url" name="url" required placeholder="https://script.google.com/macros/s/.../exec"></label><button class="primary" type="submit">Save backend URL</button></form><button class="ghost" id="demoBtn">Preview with demo data</button><details><summary>Haven't set up the backend yet?</summary><p>Open <strong>SETUP.md</strong> from the downloaded project. It takes one Google Sheet, one Apps Script deployment and three Script Properties.</p></details></section>`;
    $('#backendForm').addEventListener('submit',e=>{e.preventDefault();try{window.ksvApi.setBackendUrl(new FormData(e.currentTarget).get('url'));renderLogin();}catch(err){toast(err.message,'error');}});
    $('#demoBtn').addEventListener('click',()=>{state.demo=true;state.data=makeDemoData();state.tab='dashboard';render();});
  }

  function renderLogin(message=''){
    showNav(false); statusEl.textContent='Locked';
    app.innerHTML=`<section class="onboarding"><div class="brand-mark big">D3</div><p class="eyebrow">KSV COACH TRACKER</p><h1>Coach sign-in</h1><p>Your password is checked by the private Apps Script backend. It is never stored in the GitHub repository.</p>${message?`<div class="error-box">${esc(message)}</div>`:''}<form id="loginForm" class="onboard-form"><label>App password<input type="password" name="password" autocomplete="current-password" required autofocus></label><button class="primary" type="submit">Open tracker</button></form><button class="ghost" id="backSetup">Change backend URL</button></section>`;
    $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const pwd=new FormData(e.currentTarget).get('password');await runBusy('Signing in…',async()=>{await window.ksvApi.login(pwd);await loadData({silent:true});});});
    $('#backSetup').addEventListener('click',()=>{window.ksvApi.clearBackendUrl();renderSetup();});
  }

  async function boot(){
    state.demo=false;state.data=null;
    state.pendingParticipation=loadPendingParticipation();
    if(!window.ksvApi.getBackendUrl()){renderSetup();return;}
    if(!window.ksvApi.getToken()){renderLogin();return;}
    await loadData();
  }

  function initials(name){return String(name||'?').split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();}

  function makeDemoData(){
    const base=Date.now();
    const players=['Alex M.','Bo K.','Caro L.','Dana S.','Elin R.','Fran T.','Gia N.','Hanna V.'].map((name,i)=>({id:'dp'+i,name,position:['S','OH','MB','OPP','L','OH','MB','S'][i],include_in_tracker:true,active:true}));
    const events=[];
    for(let i=-8;i<=4;i++){
      const type=i%3===0?'match':'practice';
      const d=new Date(base+i*3*86400000); d.setHours(type==='match'?14:19,30,0,0);
      events.push({id:'de'+i,name:type==='match'?`League match ${i+9}`:`Training ${i+9}`,type,auto_type:type,start_time:d.toISOString(),place:'KSV Hall',source:'demo'});
    }
    const participation=[];
    events.forEach((e,ei)=>players.forEach((p,pi)=>{
      let hs=e.type==='match'&&ei>=8&&pi%5===0?'undecided':'attending';
      const row={id:`dpart_${ei}_${pi}`,event_id:e.id,player_id:p.id,holdsport_status_norm:hs,holdsport_status:hs};
      if(daysUntil(e.start_time)<0){row.actual_attendance='present';row.arrival_minutes=0;row.ready_at_start=true;}
      if(ei===6&&pi===1){row.arrival_minutes=7;row.ready_at_start=false;}
      if(ei===7&&pi===1){row.arrival_minutes=11;row.ready_at_start=false;}
      if(ei===5&&pi===3){row.actual_attendance='no_show';row.ready_at_start=false;}
      participation.push(row);
    }));
    const observations=[{id:'do1',player_id:'dp1',event_id:'de-1',created_at:new Date(base-5*86400000).toISOString(),category:'communication',behavior:'Availability change was not communicated',severity:'concern',positive:false,note:'',status:'open'},{id:'do2',player_id:'dp4',event_id:'de-2',created_at:new Date(base-9*86400000).toISOString(),category:'responsibility',behavior:'Good repair / took responsibility',severity:'info',positive:true,note:'',status:'resolved'}];
    const duties=[{id:'dd1',event_id:'de-2',player_id:'dp2',duty_name:'Table / secretary',status:'done',source:'demo'},{id:'dd2',event_id:'de-1',player_id:'dp5',duty_name:'Ball throwing',status:'missed',source:'demo'}];
    return normalizeData({generated_at:new Date().toISOString(),configuration:{holdsport_credentials:true,holdsport_team_id:'DEMO',season_start:'2026-09-07'},players,events,participation,rsvp_history:[],observations,followups:[],duties,sync_log:[]});
  }

  nav.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)switchTab(b.dataset.tab);});
  window.addEventListener('online',()=>{toast('Back online. Pending changes will sync.');flushPendingParticipation();});
  window.addEventListener('offline',()=>{updateSaveIndicator();toast('Offline. Attendance changes will be kept locally and synced later.','warn');});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushPendingParticipation();});

  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
  boot();
})();
