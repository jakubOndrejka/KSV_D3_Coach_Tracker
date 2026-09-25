/**
 * KSV D3 Coach Reliability & Culture Tracker
 * Google Apps Script backend
 * Generated 2026-09-25
 *
 * SECURITY MODEL
 * - Deploy this script as a Web App executing as you, accessible to Anyone.
 * - The public endpoint is protected by an application password stored in Script Properties.
 * - Holdsport credentials are stored only in Script Properties and are never returned to the browser.
 * - The GitHub Pages frontend talks to this backend through an iframe/form bridge, avoiding CORS issues.
 */

const KSV = {
  VERSION: '1.0.1',
  DEFAULT_SEASON_START: '2026-08-01',
  SESSION_HOURS: 12,
  DEFAULT_LOOKBACK_DAYS: 21,
  DEFAULT_LOOKAHEAD_DAYS: 60,
  DEFAULT_TIMEZONE: 'Europe/Copenhagen',
  SHEETS: {
    Players: [
      'id', 'holdsport_user_id', 'name', 'role', 'role_name', 'position',
      'include_in_tracker', 'active', 'created_at', 'updated_at'
    ],
    Events: [
      'id', 'holdsport_activity_id', 'name', 'auto_type', 'manual_type',
      'start_time', 'end_time', 'meeting_time', 'place', 'source',
      'raw_status', 'synced_at'
    ],
    Participation: [
      'id', 'event_id', 'player_id', 'holdsport_status', 'holdsport_status_norm',
      'holdsport_updated_at', 'actual_attendance', 'arrival_minutes',
      'ready_at_start', 'context_category', 'contacted_coach',
      'expected_answer_date', 'manual_note', 'updated_at'
    ],
    RsvpHistory: [
      'id', 'event_id', 'player_id', 'status', 'status_norm',
      'changed_at', 'observed_at', 'source'
    ],
    Observations: [
      'id', 'player_id', 'event_id', 'created_at', 'category', 'behavior',
      'severity', 'positive', 'note', 'status', 'resolved_at', 'resolution_note'
    ],
    Followups: [
      'id', 'observation_id', 'player_id', 'created_at', 'conversation_date',
      'agreed_action', 'status', 'note'
    ],
    Duties: [
      'id', 'event_id', 'player_id', 'duty_name', 'holdsport_task_id',
      'status', 'source', 'updated_at'
    ],
    SyncLog: ['id', 'timestamp', 'action', 'ok', 'message']
  }
};

/** Run this ONCE from the Apps Script editor after pasting the code. */
function initializeProject() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Open a Google Sheet first, then Extensions → Apps Script and run initializeProject() from the bound script.');
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('SESSION_SECRET')) {
    props.setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid());
  }

  Object.keys(KSV.SHEETS).forEach(name => ensureSheet_(ss, name, KSV.SHEETS[name]));

  const existingTriggers = ScriptApp.getProjectTriggers();
  const hasSyncTrigger = existingTriggers.some(t => t.getHandlerFunction() === 'scheduledSync');
  if (!hasSyncTrigger) {
    ScriptApp.newTrigger('scheduledSync').timeBased().everyHours(1).create();
  }

  SpreadsheetApp.flush();
  Logger.log('KSV tracker initialized. Spreadsheet ID: ' + ss.getId());
  Logger.log('Now add APP_PASSWORD, HOLDSPORT_USERNAME and HOLDSPORT_PASSWORD in Project Settings → Script Properties.');
}

/** Hourly trigger. Safe to leave running even before Holdsport is fully configured. */
function scheduledSync() {
  try {
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('HOLDSPORT_USERNAME') || !props.getProperty('HOLDSPORT_PASSWORD') || !props.getProperty('HOLDSPORT_TEAM_ID')) {
      return;
    }
    syncHoldsport_();
  } catch (err) {
    logSync_('scheduledSync', false, err && err.message ? err.message : String(err));
  }
}

/** Optional manual run from Apps Script editor for troubleshooting. */
function syncHoldsportNow() {
  return syncHoldsport_();
}

function doGet() {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8"><title>KSV Tracker Backend</title></head>' +
    '<body style="font-family:system-ui;background:#111;color:#fff;padding:32px">' +
    '<h2>KSV D3 Tracker backend is running</h2>' +
    '<p>Version ' + KSV.VERSION + '</p>' +
    '<p>Use the GitHub Pages frontend to access the tracker.</p></body></html>'
  );
}

function doPost(e) {
  const requestId = (e && e.parameter && e.parameter.request_id) ? String(e.parameter.request_id) : '';
  const bridgeKey = (e && e.parameter && e.parameter.bridge_key) ? String(e.parameter.bridge_key) : '';
  try {
    const raw = (e && e.parameter && e.parameter.payload) ? e.parameter.payload : '{}';
    const req = JSON.parse(raw);
    const action = String(req.action || '');
    const data = req.data || {};

    let result;
    if (action === 'health') {
      result = { version: KSV.VERSION, configured: configurationState_() };
    } else if (action === 'login') {
      result = login_(String(data.password || ''));
    } else {
      requireSession_(String(req.token || ''));
      result = dispatchAuthenticated_(action, data);
    }

    return bridgeResponse_(requestId, bridgeKey, { ok: true, result: result, version: KSV.VERSION });
  } catch (err) {
    return bridgeResponse_(requestId, bridgeKey, {
      ok: false,
      error: err && err.message ? err.message : String(err),
      version: KSV.VERSION
    });
  }
}

function dispatchAuthenticated_(action, data) {
  switch (action) {
    case 'bootstrap': return bootstrap_();
    case 'sync':
      syncHoldsport_();
      return bootstrap_();
    case 'discoverTeams': return discoverTeams_();
    case 'setTeamId': return setTeamId_(data);
    case 'bulkPresent': return bulkPresent_(data);
    case 'updateParticipation': return updateParticipation_(data);
    case 'addObservation': return addObservation_(data);
    case 'resolveObservation': return resolveObservation_(data);
    case 'addFollowup': return addFollowup_(data);
    case 'updateDuty': return updateDuty_(data);
    case 'setEventType': return setEventType_(data);
    case 'createManualEvent': return createManualEvent_(data);
    case 'setPlayerMeta': return setPlayerMeta_(data);
    default: throw new Error('Unknown action: ' + action);
  }
}

function login_(password) {
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty('APP_PASSWORD');
  if (!expected) {
    throw new Error('APP_PASSWORD is not configured in Apps Script → Project Settings → Script Properties.');
  }
  if (!constantTimeEqual_(password, expected)) {
    Utilities.sleep(350);
    throw new Error('Incorrect app password.');
  }
  return {
    token: createSessionToken_(),
    expires_hours: KSV.SESSION_HOURS,
    configuration: configurationState_()
  };
}

function configurationState_() {
  const props = PropertiesService.getScriptProperties();
  return {
    spreadsheet: !!props.getProperty('SPREADSHEET_ID'),
    app_password: !!props.getProperty('APP_PASSWORD'),
    holdsport_credentials: !!(props.getProperty('HOLDSPORT_USERNAME') && props.getProperty('HOLDSPORT_PASSWORD')),
    holdsport_team_id: props.getProperty('HOLDSPORT_TEAM_ID') || '',
    season_start: props.getProperty('SEASON_START') || KSV.DEFAULT_SEASON_START
  };
}

function bootstrap_() {
  const seasonStart = PropertiesService.getScriptProperties().getProperty('SEASON_START') || KSV.DEFAULT_SEASON_START;
  const players = readObjects_('Players').filter(r => bool_(r.include_in_tracker) && boolDefaultTrue_(r.active));
  const playerIds = new Set(players.map(p => String(p.id)));
  const events = readObjects_('Events').filter(e => !e.start_time || String(e.start_time) >= seasonStart);
  const eventIds = new Set(events.map(e => String(e.id)));

  const participation = readObjects_('Participation').filter(r => eventIds.has(String(r.event_id)) && playerIds.has(String(r.player_id)));
  const rsvpHistory = readObjects_('RsvpHistory').filter(r => eventIds.has(String(r.event_id)) && playerIds.has(String(r.player_id)));
  const observations = readObjects_('Observations').filter(r => playerIds.has(String(r.player_id)));
  const followups = readObjects_('Followups').filter(r => playerIds.has(String(r.player_id)));
  const duties = readObjects_('Duties').filter(r => eventIds.has(String(r.event_id)) && playerIds.has(String(r.player_id)));
  const syncLog = readObjects_('SyncLog').slice(-10);

  events.forEach(e => {
    e.type = e.manual_type || e.auto_type || 'other';
  });

  return {
    generated_at: nowIso_(),
    configuration: configurationState_(),
    players: players,
    events: events,
    participation: participation,
    rsvp_history: rsvpHistory,
    observations: observations,
    followups: followups,
    duties: duties,
    sync_log: syncLog
  };
}

function discoverTeams_() {
  const teams = holdsportFetch_('/v1/teams');
  if (!Array.isArray(teams)) throw new Error('Unexpected Holdsport teams response.');
  return teams.map(t => ({ id: t.id, name: t.name, role: t.role }));
}

function setTeamId_(data) {
  const id = String(data.team_id || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('Invalid Holdsport team ID.');
  PropertiesService.getScriptProperties().setProperty('HOLDSPORT_TEAM_ID', id);
  return { team_id: id };
}

function syncHoldsport_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const teamId = props.getProperty('HOLDSPORT_TEAM_ID');
    if (!teamId) throw new Error('HOLDSPORT_TEAM_ID is not configured. Use Settings → Discover teams in the web app.');

    const members = holdsportFetch_('/v1/teams/' + encodeURIComponent(teamId) + '/members');
    if (!Array.isArray(members)) throw new Error('Unexpected Holdsport members response.');

    const existingPlayers = indexBy_(readObjects_('Players'), 'id');
    const playerRows = members.map(m => {
      const id = 'p_' + String(m.id);
      const old = existingPlayers[id] || {};
      return {
        id: id,
        holdsport_user_id: String(m.id),
        name: String(m.name || '').trim(),
        role: m.role,
        role_name: roleName_(m.role),
        include_in_tracker: old.include_in_tracker !== '' && old.include_in_tracker !== undefined
          ? old.include_in_tracker
          : defaultIncludeForRole_(m.role),
        active: old.active !== '' && old.active !== undefined ? old.active : true,
        created_at: old.created_at || nowIso_(),
        updated_at: nowIso_()
      };
    });
    upsertMany_('Players', playerRows);

    const lookback = numberProperty_('SYNC_LOOKBACK_DAYS', KSV.DEFAULT_LOOKBACK_DAYS);
    const lookahead = numberProperty_('SYNC_LOOKAHEAD_DAYS', KSV.DEFAULT_LOOKAHEAD_DAYS);
    const tz = Session.getScriptTimeZone() || KSV.DEFAULT_TIMEZONE;
    const fromDate = new Date(Date.now() - lookback * 86400000);
    const endDate = new Date(Date.now() + lookahead * 86400000);
    const dateParam = Utilities.formatDate(fromDate, tz, 'yyyy-MM-dd');

    let activities = [];
    for (let page = 1; page <= 10; page++) {
      const arr = holdsportFetch_(
        '/v1/teams/' + encodeURIComponent(teamId) + '/activities?date=' + encodeURIComponent(dateParam) + '&page=' + page + '&per_page=50'
      );
      if (!Array.isArray(arr) || arr.length === 0) break;
      activities = activities.concat(arr);
      if (arr.length < 50) break;
    }

    activities = activities.filter(a => {
      const d = parseDateSafe_(a.starttime);
      return d && d <= endDate;
    });

    const existingEvents = indexBy_(readObjects_('Events'), 'id');
    const eventRows = activities.map(a => {
      const id = 'e_' + String(a.id);
      const old = existingEvents[id] || {};
      return {
        id: id,
        holdsport_activity_id: String(a.id),
        name: String(a.name || 'Untitled activity'),
        auto_type: classifyEventType_(a.name),
        start_time: a.starttime || '',
        end_time: a.endtime || '',
        meeting_time: a.pickup_time || old.meeting_time || '',
        place: a.place || '',
        source: 'holdsport',
        raw_status: a.status || '',
        synced_at: nowIso_()
      };
    });
    upsertMany_('Events', eventRows);

    const allPlayers = readObjects_('Players');
    const byHoldsportId = {};
    allPlayers.forEach(p => { byHoldsportId[String(p.holdsport_user_id)] = p; });
    const existingParticipation = indexBy_(readObjects_('Participation'), 'id');
    const existingDuties = indexBy_(readObjects_('Duties'), 'id');

    const participationRows = [];
    const historyRows = [];
    const dutyRows = [];

    activities.forEach(activity => {
      const eventId = 'e_' + String(activity.id);
      let activityUsers = Array.isArray(activity.activities_users) && activity.activities_users.length
        ? activity.activities_users
        : null;
      if (!activityUsers) {
        try {
          activityUsers = holdsportFetch_('/v1/activities/' + encodeURIComponent(activity.id) + '/activities_users');
        } catch (err) {
          activityUsers = [];
        }
      }
      if (!Array.isArray(activityUsers)) activityUsers = [];

      const noRsvp = Array.isArray(activity.no_rsvp) ? activity.no_rsvp : [];
      const userMap = {};
      activityUsers.forEach(u => { if (u && u.user_id !== undefined) userMap[String(u.user_id)] = u; });
      const noRsvpMap = {};
      noRsvp.forEach(u => { if (u && u.id !== undefined) noRsvpMap[String(u.id)] = u; });

      allPlayers.forEach(player => {
        const uid = String(player.holdsport_user_id);
        const partId = 'part_' + String(activity.id) + '_' + uid;
        const old = existingParticipation[partId] || {};
        const explicit = userMap[uid];
        const undecided = noRsvpMap[uid];

        const row = {
          id: partId,
          event_id: eventId,
          player_id: player.id,
          updated_at: nowIso_()
        };

        let newStatusRaw = null;
        let newStatusNorm = null;
        let newStatusUpdatedAt = '';

        if (explicit) {
          newStatusRaw = String(explicit.status || 'attending');
          newStatusNorm = normalizeHoldsportStatus_(newStatusRaw);
          newStatusUpdatedAt = explicit.updated_at || '';
        } else if (undecided) {
          newStatusRaw = 'no_rsvp';
          newStatusNorm = 'undecided';
          newStatusUpdatedAt = '';
        } else if (!old.holdsport_status) {
          newStatusRaw = 'not_seen';
          newStatusNorm = 'unknown';
        }

        if (newStatusRaw !== null) {
          row.holdsport_status = newStatusRaw;
          row.holdsport_status_norm = newStatusNorm;
          row.holdsport_updated_at = newStatusUpdatedAt;

          const changed = String(old.holdsport_status || '') !== String(newStatusRaw) ||
            String(old.holdsport_updated_at || '') !== String(newStatusUpdatedAt || '');
          if (changed) {
            historyRows.push({
              id: 'rsvp_' + Utilities.getUuid(),
              event_id: eventId,
              player_id: player.id,
              status: newStatusRaw,
              status_norm: newStatusNorm,
              changed_at: newStatusUpdatedAt || nowIso_(),
              observed_at: nowIso_(),
              source: 'holdsport'
            });
          }
        }
        participationRows.push(row);
      });

      try {
        const tasks = holdsportFetch_('/v1/activities/' + encodeURIComponent(activity.id) + '/activity_tasks');
        if (Array.isArray(tasks)) {
          tasks.forEach(task => {
            const assignments = Array.isArray(task.activity_tasks) ? task.activity_tasks : [];
            assignments.forEach(a => {
              const player = byHoldsportId[String(a.user_id)];
              if (!player) return;
              const dutyId = 'duty_' + String(activity.id) + '_' + String(task.id) + '_' + String(a.user_id);
              const oldDuty = existingDuties[dutyId] || {};
              dutyRows.push({
                id: dutyId,
                event_id: eventId,
                player_id: player.id,
                duty_name: String(task.name || 'Duty'),
                holdsport_task_id: String(task.id),
                status: oldDuty.status || 'assigned',
                source: 'holdsport',
                updated_at: nowIso_()
              });
            });
          });
        }
      } catch (err) {
        // Duties are useful but non-critical. Keep sync running if this endpoint differs for a team/account.
      }
    });

    upsertMany_('Participation', participationRows);
    if (historyRows.length) appendObjects_('RsvpHistory', historyRows);
    if (dutyRows.length) upsertMany_('Duties', dutyRows);

    const message = 'Synced ' + members.length + ' members and ' + activities.length + ' activities.';
    logSync_('holdsport', true, message);
    return { ok: true, message: message, members: members.length, activities: activities.length };
  } catch (err) {
    logSync_('holdsport', false, err && err.message ? err.message : String(err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function bulkPresent_(data) {
  const eventId = requireId_(data.event_id, 'event_id');
  const mode = String(data.mode || 'expected');
  const players = readObjects_('Players').filter(p => bool_(p.include_in_tracker) && boolDefaultTrue_(p.active));
  const existing = indexBy_(readObjects_('Participation'), 'id');
  const event = readObjects_('Events').find(e => String(e.id) === eventId);
  if (!event) throw new Error('Event not found.');

  const rows = [];
  players.forEach(player => {
    const id = event.source === 'holdsport'
      ? 'part_' + String(event.holdsport_activity_id) + '_' + String(player.holdsport_user_id)
      : 'part_' + eventId + '_' + player.id;
    const old = existing[id] || {};
    const expected = String(old.holdsport_status_norm || '') === 'attending';
    if (mode === 'expected' && !expected) return;
    if (old.actual_attendance) return;
    rows.push({
      id: id,
      event_id: eventId,
      player_id: player.id,
      actual_attendance: 'present',
      arrival_minutes: 0,
      ready_at_start: true,
      updated_at: nowIso_()
    });
  });
  upsertMany_('Participation', rows);
  return { updated: rows.length };
}

function updateParticipation_(data) {
  const eventId = requireId_(data.event_id, 'event_id');
  const playerId = requireId_(data.player_id, 'player_id');
  const existingRows = readObjects_('Participation');
  let row = existingRows.find(r => String(r.event_id) === eventId && String(r.player_id) === playerId);

  if (!row) {
    const event = readObjects_('Events').find(e => String(e.id) === eventId);
    const player = readObjects_('Players').find(p => String(p.id) === playerId);
    if (!event || !player) throw new Error('Event or player not found.');
    const id = event.source === 'holdsport'
      ? 'part_' + String(event.holdsport_activity_id) + '_' + String(player.holdsport_user_id)
      : 'part_' + eventId + '_' + playerId;
    row = { id: id, event_id: eventId, player_id: playerId };
  }

  const allowed = [
    'actual_attendance', 'arrival_minutes', 'ready_at_start', 'context_category',
    'contacted_coach', 'expected_answer_date', 'manual_note'
  ];
  const update = { id: row.id, event_id: eventId, player_id: playerId, updated_at: nowIso_() };
  allowed.forEach(k => {
    if (Object.prototype.hasOwnProperty.call(data, k)) update[k] = sanitizeCell_(data[k]);
  });
  upsertMany_('Participation', [update]);
  return update;
}

function addObservation_(data) {
  const playerId = requireId_(data.player_id, 'player_id');
  const eventId = data.event_id ? String(data.event_id) : '';
  const positive = bool_(data.positive);
  const row = {
    id: 'obs_' + Utilities.getUuid(),
    player_id: playerId,
    event_id: eventId,
    created_at: nowIso_(),
    category: sanitizeShort_(data.category || 'other', 60),
    behavior: sanitizeShort_(data.behavior || 'Observation', 140),
    severity: sanitizeShort_(data.severity || (positive ? 'info' : 'concern'), 20),
    positive: positive,
    note: sanitizeShort_(data.note || '', 600),
    status: positive ? 'resolved' : 'open',
    resolved_at: positive ? nowIso_() : '',
    resolution_note: ''
  };
  appendObjects_('Observations', [row]);
  return row;
}

function resolveObservation_(data) {
  const id = requireId_(data.observation_id, 'observation_id');
  const rows = readObjects_('Observations');
  const old = rows.find(r => String(r.id) === id);
  if (!old) throw new Error('Observation not found.');
  const status = String(data.status || 'resolved');
  upsertMany_('Observations', [{
    id: id,
    status: status,
    resolved_at: status === 'resolved' ? nowIso_() : '',
    resolution_note: sanitizeShort_(data.resolution_note || '', 600)
  }]);
  return { id: id, status: status };
}

function addFollowup_(data) {
  const playerId = requireId_(data.player_id, 'player_id');
  const observationId = data.observation_id ? String(data.observation_id) : '';
  const row = {
    id: 'fu_' + Utilities.getUuid(),
    observation_id: observationId,
    player_id: playerId,
    created_at: nowIso_(),
    conversation_date: sanitizeShort_(data.conversation_date || nowIso_().slice(0, 10), 30),
    agreed_action: sanitizeShort_(data.agreed_action || '', 600),
    status: sanitizeShort_(data.status || 'open', 30),
    note: sanitizeShort_(data.note || '', 600)
  };
  appendObjects_('Followups', [row]);
  if (observationId && data.resolve_observation) {
    resolveObservation_({ observation_id: observationId, status: 'resolved', resolution_note: row.agreed_action || row.note });
  }
  return row;
}

function updateDuty_(data) {
  const id = requireId_(data.duty_id, 'duty_id');
  const status = String(data.status || 'assigned');
  if (!['assigned', 'done', 'missed', 'covered', 'excused'].includes(status)) {
    throw new Error('Invalid duty status.');
  }
  upsertMany_('Duties', [{ id: id, status: status, updated_at: nowIso_() }]);
  return { id: id, status: status };
}

function setEventType_(data) {
  const id = requireId_(data.event_id, 'event_id');
  const type = String(data.type || 'other');
  if (!['practice', 'match', 'meeting', 'other'].includes(type)) throw new Error('Invalid event type.');
  upsertMany_('Events', [{ id: id, manual_type: type }]);
  return { id: id, type: type };
}

function createManualEvent_(data) {
  const name = sanitizeShort_(data.name || '', 160);
  if (!name) throw new Error('Event name is required.');
  const type = String(data.type || 'other');
  if (!['practice', 'match', 'meeting', 'other'].includes(type)) throw new Error('Invalid event type.');
  const start = sanitizeShort_(data.start_time || '', 60);
  if (!start) throw new Error('Event start time is required.');
  const id = 'manual_' + Utilities.getUuid();
  const row = {
    id: id,
    holdsport_activity_id: '',
    name: name,
    auto_type: type,
    manual_type: type,
    start_time: start,
    end_time: sanitizeShort_(data.end_time || '', 60),
    meeting_time: sanitizeShort_(data.meeting_time || '', 60),
    place: sanitizeShort_(data.place || '', 160),
    source: 'manual',
    raw_status: '',
    synced_at: nowIso_()
  };
  appendObjects_('Events', [row]);
  return row;
}

function setPlayerMeta_(data) {
  const id = requireId_(data.player_id, 'player_id');
  const update = { id: id, updated_at: nowIso_() };
  if (Object.prototype.hasOwnProperty.call(data, 'position')) update.position = sanitizeShort_(data.position || '', 40);
  if (Object.prototype.hasOwnProperty.call(data, 'include_in_tracker')) update.include_in_tracker = bool_(data.include_in_tracker);
  if (Object.prototype.hasOwnProperty.call(data, 'active')) update.active = bool_(data.active);
  upsertMany_('Players', [update]);
  return update;
}

function holdsportFetch_(path) {
  const props = PropertiesService.getScriptProperties();
  const username = props.getProperty('HOLDSPORT_USERNAME');
  const password = props.getProperty('HOLDSPORT_PASSWORD');
  if (!username || !password) {
    throw new Error('Holdsport credentials are not configured in Script Properties.');
  }
  const url = 'https://api.holdsport.dk' + path;
  const auth = Utilities.base64Encode(username + ':' + password, Utilities.Charset.UTF_8);
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Accept': 'application/json'
    },
    muteHttpExceptions: true,
    followRedirects: true
  });
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Holdsport API ' + code + ' for ' + path + ': ' + text.slice(0, 300));
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error('Holdsport returned invalid JSON for ' + path + '.');
  }
}

function classifyEventType_(name) {
  const s = normalizeText_(name || '');
  if (/\b(kamp|match|cup|turnering|tournament|friendly|scrimmage)\b/.test(s)) return 'match';
  if (/\b(traening|training|practice|trening)\b/.test(s)) return 'practice';
  if (/\b(mode|meeting|team meeting|holdmode)\b/.test(s)) return 'meeting';
  return 'other';
}

function normalizeHoldsportStatus_(status) {
  const s = normalizeText_(status || '').trim();
  if (!s || s === 'not_seen') return 'unknown';
  if (s === 'no_rsvp' || /ej tilkendegivet|undecided|not responded|no response|unknown/.test(s)) return 'undecided';
  if (/afmeldt|frameldt|unregistered|not attending|declined|cannot attend/.test(s)) return 'declined';
  if (/tilmeldt|attending|joined|registered|yes|deltager/.test(s)) return 'attending';
  return 'unknown';
}

function roleName_(role) {
  const map = { 1: 'player', 2: 'coach', 3: 'assistant coach', 4: 'injured', 5: 'inactive', 6: 'team leader' };
  return map[Number(role)] || 'unknown';
}

function defaultIncludeForRole_(role) {
  return [1, 4, 6].includes(Number(role));
}

function bridgeResponse_(requestId, bridgeKey, payload) {
  const encoded = Utilities.base64EncodeWebSafe(JSON.stringify(payload), Utilities.Charset.UTF_8);
  const rid = JSON.stringify(String(requestId || ''));
  const bkey = JSON.stringify(String(bridgeKey || ''));
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
    '(function(){' +
    'function send(message){' +
      'try{if(window.top&&window.top!==window)window.top.postMessage(message,"*");}catch(_e){}' +
      'try{if(window.parent&&window.parent!==window)window.parent.postMessage(message,"*");}catch(_e){}' +
    '}' +
    'try{' +
      'var s=' + JSON.stringify(encoded) + ';s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";' +
      'var bin=atob(s),bytes=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);' +
      'var json=new TextDecoder("utf-8").decode(bytes);' +
      'send({__ksvBridge:true,requestId:' + rid + ',bridgeKey:' + bkey + ',payload:JSON.parse(json)});' +
    '}catch(e){' +
      'send({__ksvBridge:true,requestId:' + rid + ',bridgeKey:' + bkey + ',payload:{ok:false,error:String(e)}});' +
    '}' +
    '})();' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function createSessionToken_() {
  const payload = {
    v: 1,
    exp: Date.now() + KSV.SESSION_HOURS * 3600000,
    nonce: Utilities.getUuid()
  };
  const body = base64UrlString_(JSON.stringify(payload));
  const sig = sign_(body);
  return body + '.' + sig;
}

function requireSession_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('Session expired. Please sign in again.');
  if (!constantTimeEqual_(sign_(parts[0]), parts[1])) throw new Error('Invalid session. Please sign in again.');
  let payload;
  try {
    payload = JSON.parse(fromBase64UrlString_(parts[0]));
  } catch (err) {
    throw new Error('Invalid session. Please sign in again.');
  }
  if (!payload.exp || Date.now() > Number(payload.exp)) throw new Error('Session expired. Please sign in again.');
  return payload;
}

function sign_(text) {
  const secret = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
  if (!secret) throw new Error('SESSION_SECRET missing. Run initializeProject() once.');
  const bytes = Utilities.computeHmacSha256Signature(text, secret);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function base64UrlString_(text) {
  return Utilities.base64EncodeWebSafe(text, Utilities.Charset.UTF_8).replace(/=+$/g, '');
}

function fromBase64UrlString_(text) {
  let s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bytes = Utilities.base64Decode(s);
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

function constantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  let mismatch = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(i % Math.max(1, b.length)) || 0);
  }
  return mismatch === 0;
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID missing. Run initializeProject() once from the bound Apps Script project.');
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  } else {
    const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
    const mismatch = headers.some((h, i) => String(current[i] || '') !== h);
    if (mismatch) {
      throw new Error('Sheet "' + name + '" has unexpected headers. Expected: ' + headers.join(', '));
    }
  }
  return sheet;
}

function readObjects_(name) {
  const ss = getSpreadsheet_();
  const headers = KSV.SHEETS[name];
  const sheet = ensureSheet_(ss, name, headers);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      const v = row[i];
      obj[h] = v instanceof Date ? v.toISOString() : v;
    });
    return obj;
  }).filter(o => String(o.id || '').trim() !== '');
}

function upsertMany_(name, items) {
  if (!items || !items.length) return;
  const ss = getSpreadsheet_();
  const headers = KSV.SHEETS[name];
  const sheet = ensureSheet_(ss, name, headers);
  const rows = readObjects_(name);
  const map = {};
  const order = [];
  rows.forEach(r => {
    const id = String(r.id || '');
    if (!id) return;
    map[id] = r;
    order.push(id);
  });

  items.forEach(item => {
    const id = String(item.id || '');
    if (!id) throw new Error('Cannot upsert into ' + name + ' without id.');
    if (!map[id]) {
      map[id] = { id: id };
      order.push(id);
    }
    Object.keys(item).forEach(k => {
      if (headers.includes(k)) map[id][k] = sanitizeCell_(item[k]);
    });
  });

  const output = order.map(id => headers.map(h => map[id][h] === undefined ? '' : map[id][h]));
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  if (output.length) sheet.getRange(2, 1, output.length, headers.length).setValues(output);
}

function appendObjects_(name, items) {
  if (!items || !items.length) return;
  const ss = getSpreadsheet_();
  const headers = KSV.SHEETS[name];
  const sheet = ensureSheet_(ss, name, headers);
  const values = items.map(item => headers.map(h => item[h] === undefined ? '' : sanitizeCell_(item[h])));
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function indexBy_(rows, key) {
  const out = {};
  rows.forEach(r => { out[String(r[key])] = r; });
  return out;
}

function logSync_(action, ok, message) {
  try {
    appendObjects_('SyncLog', [{
      id: 'log_' + Utilities.getUuid(),
      timestamp: nowIso_(),
      action: action,
      ok: !!ok,
      message: sanitizeShort_(message || '', 700)
    }]);
  } catch (ignored) {}
}

function requireId_(value, name) {
  const s = String(value || '').trim();
  if (!s) throw new Error(name + ' is required.');
  if (s.length > 180) throw new Error(name + ' is invalid.');
  return s;
}

function sanitizeCell_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const s = String(value);
  // Prevent accidental spreadsheet formula execution from user-entered text.
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s.slice(0, 2000);
}

function sanitizeShort_(value, max) {
  const s = String(value === null || value === undefined ? '' : value).trim();
  const clipped = s.slice(0, max || 300);
  return /^[=+\-@]/.test(clipped) ? "'" + clipped : clipped;
}

function bool_(value) {
  if (value === true || value === 1) return true;
  const s = String(value || '').toLowerCase().trim();
  return ['true', '1', 'yes', 'y', 'on'].includes(s);
}

function boolDefaultTrue_(value) {
  if (value === '' || value === null || value === undefined) return true;
  return bool_(value);
}

function numberProperty_(key, fallback) {
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeText_(value) {
  let s = String(value || '').toLowerCase();
  try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (ignored) {}
  return s;
}

function parseDateSafe_(value) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function nowIso_() {
  return new Date().toISOString();
}
