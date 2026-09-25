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
  VERSION: '1.0.5',
  DEFAULT_SEASON_START: '2026-09-07',
  SESSION_HOURS: 12,
  DEFAULT_LOOKBACK_DAYS: 21,
  DEFAULT_LOOKAHEAD_DAYS: 60,
  DEFAULT_TIMEZONE: 'Europe/Copenhagen',
  DEFAULT_MATCH_ROSTER_LIMIT: 14,
  SHEETS: {
    Players: [
      'id', 'holdsport_user_id', 'name', 'role', 'role_name', 'position',
      'include_in_tracker', 'active', 'created_at', 'updated_at'
    ],
    Events: [
      'id', 'holdsport_activity_id', 'name', 'auto_type', 'manual_type',
      'start_time', 'end_time', 'meeting_time', 'place', 'source',
      'raw_status', 'synced_at', 'holdsport_event_type',
      'holdsport_event_type_id', 'registration_type', 'max_attendees'
    ],
    Participation: [
      'id', 'event_id', 'player_id', 'holdsport_status', 'holdsport_status_norm',
      'holdsport_updated_at', 'actual_attendance', 'arrival_minutes',
      'ready_at_start', 'context_category', 'contacted_coach',
      'expected_answer_date', 'manual_note', 'updated_at', 'holdsport_status_code'
    ],
    RsvpHistory: [
      'id', 'event_id', 'player_id', 'status', 'status_norm',
      'changed_at', 'observed_at', 'source', 'status_code'
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
    DutyTypes: [
      'id', 'event_id', 'duty_name', 'holdsport_task_id',
      'max_participants', 'enable_attend', 'assigned_count',
      'source', 'updated_at'
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
  if (!props.getProperty('MATCH_ROSTER_LIMIT')) {
    props.setProperty('MATCH_ROSTER_LIMIT', String(KSV.DEFAULT_MATCH_ROSTER_LIMIT));
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
    case 'batchUpdateParticipation': return batchUpdateParticipation_(data);
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
    season_start: props.getProperty('SEASON_START') || KSV.DEFAULT_SEASON_START,
    match_roster_limit: numberProperty_('MATCH_ROSTER_LIMIT', KSV.DEFAULT_MATCH_ROSTER_LIMIT)
  };
}

function bootstrap_() {
  const seasonStart = PropertiesService.getScriptProperties().getProperty('SEASON_START') || KSV.DEFAULT_SEASON_START;
  const players = readObjects_('Players').filter(r => bool_(r.include_in_tracker) && boolDefaultTrue_(r.active));
  const playerIds = new Set(players.map(p => String(p.id)));
  const seasonStartDate = parseHoldsportDate_(seasonStart + 'T00:00:00');
  const events = readObjects_('Events').filter(e => {
    if (!e.start_time) return true;
    const d = parseHoldsportDate_(e.start_time);
    // If a legacy/raw value cannot be parsed, keep it visible rather than silently hiding it.
    return !d || !seasonStartDate || d.getTime() >= seasonStartDate.getTime();
  });
  const eventIds = new Set(events.map(e => String(e.id)));

  const participation = readObjects_('Participation').filter(r => eventIds.has(String(r.event_id)) && playerIds.has(String(r.player_id)));
  const rsvpHistory = readObjects_('RsvpHistory').filter(r => eventIds.has(String(r.event_id)) && playerIds.has(String(r.player_id)));
  const observations = readObjects_('Observations').filter(r => playerIds.has(String(r.player_id)));
  const followups = readObjects_('Followups').filter(r => playerIds.has(String(r.player_id)));
  const duties = readObjects_('Duties').filter(r => eventIds.has(String(r.event_id)) && playerIds.has(String(r.player_id)));
  const dutyTypes = readObjects_('DutyTypes').filter(r => eventIds.has(String(r.event_id)));
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
    duty_types: dutyTypes,
    sync_log: syncLog
  };
}

function discoverTeams_() {
  const raw = holdsportFetch_('/v1/teams');
  const teams = holdsportArray_(raw, ['teams', 'data', 'items']);
  if (!teams) throw new Error('Unexpected Holdsport teams response. Top-level keys: ' + responseKeys_(raw));
  return teams.map(t => ({
    id: firstDefined_(t.id, t.team_id, t.team && t.team.id),
    name: String(firstDefined_(t.name, t.team_name, t.team && t.team.name, 'Unnamed team')),
    role: firstDefined_(t.role, t.team_role, t.membership && t.membership.role, '')
  })).filter(t => t.id !== undefined && t.id !== null && String(t.id) !== '');
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

    const rawMembers = holdsportFetch_('/v1/teams/' + encodeURIComponent(teamId) + '/members');
    const members = holdsportArray_(rawMembers, ['members', 'team_members', 'users', 'data', 'items']);
    if (!members) throw new Error('Unexpected Holdsport members response. Top-level keys: ' + responseKeys_(rawMembers));

    const existingPlayers = indexBy_(readObjects_('Players'), 'id');
    const playerRows = [];
    members.forEach(m => {
      const memberId = holdsportMemberId_(m);
      if (memberId === '') return;
      const id = 'p_' + memberId;
      const old = existingPlayers[id] || {};
      const parsedName = holdsportMemberName_(m);
      playerRows.push({
        id: id,
        holdsport_user_id: memberId,
        name: parsedName || old.name || ('Holdsport member ' + memberId),
        role: firstDefined_(m.role, m.team_role, m.membership && m.membership.role, ''),
        role_name: roleName_(firstDefined_(m.role, m.team_role, m.membership && m.membership.role, '')),
        // Holdsport's documented `role` is team role (player/coach), not volleyball position.
        // If the club exposes a custom field such as Position/Spillerposition, import it once;
        // otherwise preserve the coach-entered position already stored in the tracker.
        position: old.position || extractHoldsportPosition_(m) || '',
        include_in_tracker: old.include_in_tracker !== '' && old.include_in_tracker !== undefined
          ? old.include_in_tracker
          : defaultIncludeForRole_(firstDefined_(m.role, m.team_role, m.membership && m.membership.role, 1)),
        active: old.active !== '' && old.active !== undefined ? old.active : true,
        created_at: old.created_at || nowIso_(),
        updated_at: nowIso_()
      });
    });
    upsertMany_('Players', playerRows);

    // Always sync from the season start, not from a rolling lookback window.
    // This guarantees that historical practices/matches remain available for season statistics.
    const seasonStartRaw = String(props.getProperty('SEASON_START') || KSV.DEFAULT_SEASON_START).trim();
    const seasonStartDate = parseHoldsportDate_(seasonStartRaw + (/^\d{4}-\d{2}-\d{2}$/.test(seasonStartRaw) ? 'T00:00:00' : ''));
    const tz = Session.getScriptTimeZone() || KSV.DEFAULT_TIMEZONE;
    const dateParam = seasonStartDate
      ? Utilities.formatDate(seasonStartDate, tz, 'yyyy-MM-dd')
      : KSV.DEFAULT_SEASON_START;

    // Fetch the full season robustly. Do not assume that the API will return exactly
    // the requested page size; some APIs cap page size silently. Continue until an
    // empty page or a page with no new activity IDs is returned.
    const activityFetch = fetchAllHoldsportActivities_(teamId, dateParam, 50, 40);
    const activities = activityFetch.activities;
    const activitySchema = activityFetch.schema;

    // Keep activities even if a date is malformed. We normalize known Holdsport date formats
    // for the browser, but never silently drop an activity solely because a date parser failed.
    const unparseableActivities = activities.filter(a => !parseHoldsportDate_(holdsportActivityStart_(a))).length;

    const existingEvents = indexBy_(readObjects_('Events'), 'id');
    const eventRows = [];
    activities.forEach(a => {
      const activityId = holdsportActivityId_(a);
      if (activityId === '') return;
      const id = 'e_' + activityId;
      const old = existingEvents[id] || {};
      const activityName = String(firstDefined_(a.name, a.title, a.activity_name, 'Untitled activity'));
      const hsEventType = holdsportEventTypeText_(a);
      eventRows.push({
        id: id,
        holdsport_activity_id: activityId,
        name: activityName,
        auto_type: classifyEventType_(activityName, hsEventType),
        start_time: normalizeHoldsportDateForStorage_(holdsportActivityStart_(a)),
        end_time: normalizeHoldsportDateForStorage_(firstDefined_(a.endtime, a.end_time, a.ends_at, a.end_at, '')),
        meeting_time: normalizeHoldsportDateForStorage_(firstDefined_(a.pickup_time, a.meeting_time, old.meeting_time, '')) || String(old.meeting_time || ''),
        place: String(firstDefined_(a.place, a.location, a.venue, '')),
        source: 'holdsport',
        raw_status: String(firstDefined_(a.status, a.rsvp_status, '')),
        synced_at: nowIso_(),
        holdsport_event_type: hsEventType,
        holdsport_event_type_id: String(firstDefined_(a.event_type_id, a.event_type && a.event_type.id, '')),
        registration_type: holdsportRegistrationTypeText_(a),
        max_attendees: numericOrBlank_(firstDefined_(a.max_attendees, a.max_participants, a.capacity, ''))
      });
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
    const dutyTypeRows = [];

    activities.forEach(activity => {
      const activityId = holdsportActivityId_(activity);
      if (activityId === '') return;
      const eventId = 'e_' + activityId;

      let activityUsers = holdsportArray_(activity.activities_users, ['activities_users', 'users', 'data', 'items']);
      if (!activityUsers || !activityUsers.length) {
        try {
          const rawUsers = holdsportFetch_('/v1/activities/' + encodeURIComponent(activityId) + '/activities_users');
          activityUsers = holdsportArray_(rawUsers, ['activities_users', 'users', 'data', 'items']) || [];
        } catch (err) {
          activityUsers = [];
        }
      }

      const noRsvp = holdsportArray_(firstDefined_(activity.no_rsvp, activity.no_response, activity.no_responses, []), ['no_rsvp', 'users', 'data', 'items']) || [];
      const userMap = {};
      activityUsers.forEach(u => {
        const uid = holdsportActivityUserId_(u);
        if (uid !== '') userMap[uid] = u;
      });
      const noRsvpMap = {};
      noRsvp.forEach(u => {
        const uid = holdsportMemberId_(u);
        if (uid !== '') noRsvpMap[uid] = u;
      });

      allPlayers.forEach(player => {
        const uid = String(player.holdsport_user_id);
        const partId = 'part_' + activityId + '_' + uid;
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
        let newStatusCode = '';

        if (explicit) {
          newStatusRaw = holdsportActivityUserStatus_(explicit, holdsportRegistrationTypeText_(activity));
          newStatusNorm = normalizeHoldsportStatus_(newStatusRaw);
          newStatusUpdatedAt = String(firstDefined_(explicit.updated_at, explicit.changed_at, explicit.modified_at, ''));
          newStatusCode = String(firstDefined_(explicit.status_code, explicit.rsvp_status_code, explicit.code, ''));
        } else if (undecided) {
          newStatusRaw = String(firstDefined_(undecided.status, undecided.rsvp_status, 'no_rsvp'));
          newStatusNorm = normalizeHoldsportStatus_(newStatusRaw || 'no_rsvp');
          if (newStatusNorm === 'unknown') newStatusNorm = 'undecided';
          newStatusCode = String(firstDefined_(undecided.status_code, undecided.rsvp_status_code, undecided.code, ''));
        } else if (!old.holdsport_status) {
          newStatusRaw = 'not_seen';
          newStatusNorm = Number(player.role) === 4 ? 'injured' : 'unknown';
        }

        if (newStatusRaw !== null) {
          row.holdsport_status = newStatusRaw;
          row.holdsport_status_norm = newStatusNorm;
          row.holdsport_updated_at = newStatusUpdatedAt;
          row.holdsport_status_code = newStatusCode;

          const changed = String(old.holdsport_status || '') !== String(newStatusRaw) ||
            String(old.holdsport_updated_at || '') !== String(newStatusUpdatedAt || '') ||
            String(old.holdsport_status_code || '') !== String(newStatusCode || '');
          if (changed) {
            historyRows.push({
              id: 'rsvp_' + Utilities.getUuid(),
              event_id: eventId,
              player_id: player.id,
              status: newStatusRaw,
              status_norm: newStatusNorm,
              changed_at: newStatusUpdatedAt || nowIso_(),
              observed_at: nowIso_(),
              source: 'holdsport',
              status_code: newStatusCode
            });
          }
        }
        participationRows.push(row);
      });

      try {
        const rawTasks = holdsportFetch_('/v1/activities/' + encodeURIComponent(activityId) + '/activity_tasks');
        const tasks = holdsportArray_(rawTasks, ['activity_tasks', 'tasks', 'data', 'items']) || [];
        tasks.forEach(task => {
          const assignments = holdsportArray_(firstDefined_(task.activity_tasks, task.assignments, task.users, []), ['activity_tasks', 'assignments', 'users', 'data', 'items']) || [];
          const taskId = String(firstDefined_(task.id, task.task_type_id, task.task_id, 'task'));
          const dutyName = String(firstDefined_(task.name, task.title, 'Duty'));
          dutyTypeRows.push({
            id: 'dtype_' + activityId + '_' + taskId,
            event_id: eventId,
            duty_name: dutyName,
            holdsport_task_id: taskId,
            max_participants: numericOrBlank_(firstDefined_(task.max_participants, task.max_attendees, task.capacity, '')),
            enable_attend: boolDefaultTrue_(firstDefined_(task.enable_attend, true)),
            assigned_count: assignments.length,
            source: 'holdsport',
            updated_at: nowIso_()
          });

          assignments.forEach(a => {
            const uid = String(firstDefined_(a.user_id, a.member_id, a.user && a.user.id, ''));
            const player = byHoldsportId[uid];
            if (!player) return;
            const dutyId = 'duty_' + activityId + '_' + taskId + '_' + uid;
            const oldDuty = existingDuties[dutyId] || {};
            dutyRows.push({
              id: dutyId,
              event_id: eventId,
              player_id: player.id,
              duty_name: dutyName,
              holdsport_task_id: taskId,
              status: oldDuty.status || 'assigned',
              source: 'holdsport',
              updated_at: nowIso_()
            });
          });
        });
      } catch (err) {
        // Duties are useful but non-critical. Keep sync running if this endpoint differs for a team/account.
      }
    });

    upsertMany_('Participation', participationRows);
    if (historyRows.length) appendObjects_('RsvpHistory', historyRows);
    if (dutyRows.length) upsertMany_('Duties', dutyRows);
    if (dutyTypeRows.length) upsertMany_('DutyTypes', dutyTypeRows);

    let message = 'Synced ' + playerRows.length + ' members and ' + eventRows.length + ' activities from ' + dateParam + ' across ' + activityFetch.pages_fetched + ' page(s).';
    if (unparseableActivities) message += ' ' + unparseableActivities + ' activity date(s) could not be normalized and were kept with their raw value.';
    if (!eventRows.length && activitySchema) message += ' Activities response keys: ' + activitySchema + '.';
    if (!eventRows.length) message += ' Holdsport returned no usable activities from ' + dateParam + ' onward.';
    logSync_('holdsport', true, message);
    return { ok: true, message: message, members: playerRows.length, activities: eventRows.length };
  } catch (err) {
    logSync_('holdsport', false, err && err.message ? err.message : String(err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Safe diagnostic: run manually in Apps Script if a live Holdsport account still
 * does not import correctly. It logs only counts and field names, not names,
 * emails, phone numbers or credentials.
 */
function debugHoldsportSchema() {
  const props = PropertiesService.getScriptProperties();
  const teamId = props.getProperty('HOLDSPORT_TEAM_ID');
  if (!teamId) throw new Error('HOLDSPORT_TEAM_ID is not configured.');
  const rawMembers = holdsportFetch_('/v1/teams/' + encodeURIComponent(teamId) + '/members');
  const members = holdsportArray_(rawMembers, ['members', 'team_members', 'users', 'data', 'items']) || [];
  const tz = Session.getScriptTimeZone() || KSV.DEFAULT_TIMEZONE;
  const seasonStartRaw = String(props.getProperty('SEASON_START') || KSV.DEFAULT_SEASON_START).trim();
  const seasonStartDate = parseHoldsportDate_(seasonStartRaw + (/^\d{4}-\d{2}-\d{2}$/.test(seasonStartRaw) ? 'T00:00:00' : ''));
  const dateParam = seasonStartDate ? Utilities.formatDate(seasonStartDate, tz, 'yyyy-MM-dd') : KSV.DEFAULT_SEASON_START;
  const rawActivities = holdsportFetch_('/v1/teams/' + encodeURIComponent(teamId) + '/activities?date=' + encodeURIComponent(dateParam) + '&page=1&per_page=5');
  const activities = holdsportArray_(rawActivities, ['activities', 'data', 'items', 'results']) || [];
  const fullFetch = fetchAllHoldsportActivities_(teamId, dateParam, 50, 40);
  const dateValues = fullFetch.activities.map(a => parseHoldsportDate_(holdsportActivityStart_(a))).filter(Boolean).sort((a,b) => a.getTime() - b.getTime());
  const diagnostic = {
    version: KSV.VERSION,
    sync_from_date: dateParam,
    match_roster_limit: numberProperty_('MATCH_ROSTER_LIMIT', KSV.DEFAULT_MATCH_ROSTER_LIMIT),
    member_count: members.length,
    member_top_level: responseKeys_(rawMembers),
    first_member_keys: members.length ? Object.keys(members[0]).sort() : [],
    first_member_nested_user_keys: members.length && members[0].user && typeof members[0].user === 'object' ? Object.keys(members[0].user).sort() : [],
    activity_count_first_page: activities.length,
    activity_top_level: responseKeys_(rawActivities),
    activity_pagination: {
      pages_fetched: fullFetch.pages_fetched,
      total_unique_activities: fullFetch.activities.length,
      last_page_size: fullFetch.last_page_size,
      stopped_on_duplicate_page: fullFetch.stopped_on_duplicate_page,
      first_activity_date: dateValues.length ? dateValues[0].toISOString() : '',
      last_activity_date: dateValues.length ? dateValues[dateValues.length - 1].toISOString() : '',
      response_schema_if_unexpected: fullFetch.schema || ''
    },
    first_activity_keys: activities.length ? Object.keys(activities[0]).sort() : [],
    activity_start_samples: activities.slice(0, 5).map(a => ({
      raw_type: typeof holdsportActivityStart_(a),
      raw: String(holdsportActivityStart_(a) || '').slice(0, 80),
      normalized: normalizeHoldsportDateForStorage_(holdsportActivityStart_(a)),
      parsed_ok: !!parseHoldsportDate_(holdsportActivityStart_(a))
    })),
    activity_event_type_samples: activities.slice(0, 5).map(a => ({
      event_type: holdsportEventTypeText_(a),
      event_type_id: String(firstDefined_(a.event_type_id, a.event_type && a.event_type.id, '')),
      registration_type: holdsportRegistrationTypeText_(a),
      max_attendees: numericOrBlank_(firstDefined_(a.max_attendees, a.max_participants, a.capacity, '')),
      auto_type: classifyEventType_(String(firstDefined_(a.name, a.title, '')), holdsportEventTypeText_(a))
    })),
    activity_user_status_samples: diagnosticActivityStatuses_(activities),
    fetched_activity_user_status_samples: diagnosticFetchedActivityStatuses_(activities),
    no_rsvp_samples: diagnosticNoRsvp_(activities),
    activity_task_samples: diagnosticActivityTasks_(activities),
    first_member_club_fields_shape: members.length ? describeShape_(members[0].club_fields, 0) : null,
    first_member_position_guess: members.length ? extractHoldsportPosition_(members[0]) : ''
  };
  Logger.log(JSON.stringify(diagnostic, null, 2));
  return diagnostic;
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
    const expected = isExpectedAttendanceStatus_(old.holdsport_status_norm, event.manual_type || event.auto_type || 'other');
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

function batchUpdateParticipation_(data) {
  const updates = Array.isArray(data && data.updates) ? data.updates : [];
  if (!updates.length) return { updated: 0, rows: [] };
  if (updates.length > 120) throw new Error('Too many participation updates in one request.');

  const events = indexBy_(readObjects_('Events'), 'id');
  const players = indexBy_(readObjects_('Players'), 'id');
  const existingRows = readObjects_('Participation');
  const byPair = {};
  existingRows.forEach(r => { byPair[String(r.event_id) + '|' + String(r.player_id)] = r; });

  const allowed = [
    'actual_attendance', 'arrival_minutes', 'ready_at_start', 'context_category',
    'contacted_coach', 'expected_answer_date', 'manual_note'
  ];
  const rows = [];

  updates.forEach(item => {
    const eventId = requireId_(item.event_id, 'event_id');
    const playerId = requireId_(item.player_id, 'player_id');
    const event = events[eventId];
    const player = players[playerId];
    if (!event || !player) throw new Error('Event or player not found for a queued attendance update.');

    const old = byPair[eventId + '|' + playerId] || {};
    const id = old.id || (event.source === 'holdsport'
      ? 'part_' + String(event.holdsport_activity_id) + '_' + String(player.holdsport_user_id)
      : 'part_' + eventId + '_' + playerId);
    const row = { id: id, event_id: eventId, player_id: playerId, updated_at: nowIso_() };
    allowed.forEach(k => {
      if (Object.prototype.hasOwnProperty.call(item, k)) row[k] = sanitizeCell_(item[k]);
    });
    rows.push(row);
  });

  upsertMany_('Participation', rows);
  return { updated: rows.length, rows: rows };
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
  if (!['practice', 'match', 'meeting', 'duty', 'other'].includes(type)) throw new Error('Invalid event type.');
  upsertMany_('Events', [{ id: id, manual_type: type }]);
  return { id: id, type: type };
}

function createManualEvent_(data) {
  const name = sanitizeShort_(data.name || '', 160);
  if (!name) throw new Error('Event name is required.');
  const type = String(data.type || 'other');
  if (!['practice', 'match', 'meeting', 'duty', 'other'].includes(type)) throw new Error('Invalid event type.');
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

function holdsportArray_(value, candidateKeys) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const keys = candidateKeys || [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (Array.isArray(value[key])) return value[key];
    if (value[key] && typeof value[key] === 'object') {
      const nested = holdsportArray_(value[key], keys);
      if (nested) return nested;
    }
  }
  // Common generic wrappers not always documented by legacy APIs.
  const generic = ['data', 'result', 'results', 'response'];
  for (let i = 0; i < generic.length; i++) {
    const key = generic[i];
    if (Array.isArray(value[key])) return value[key];
    if (value[key] && typeof value[key] === 'object') {
      const nested = holdsportArray_(value[key], candidateKeys);
      if (nested) return nested;
    }
  }
  return null;
}

function firstDefined_() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (v !== undefined && v !== null && String(v) !== '') return v;
  }
  return '';
}

function responseKeys_(value) {
  if (Array.isArray(value)) return '[array]';
  if (!value || typeof value !== 'object') return '[' + typeof value + ']';
  return Object.keys(value).sort().join(', ') || '[empty object]';
}

function holdsportMemberId_(m) {
  if (!m || typeof m !== 'object') return '';
  return String(firstDefined_(m.id, m.user_id, m.member_id, m.profile_id, m.user && m.user.id, m.profile && m.profile.id, ''));
}

function holdsportMemberName_(m) {
  if (!m || typeof m !== 'object') return '';
  const direct = firstDefined_(m.name, m.full_name, m.display_name);
  if (direct) return String(direct).trim();
  const first = firstDefined_(m.firstname, m.first_name, m.user && firstDefined_(m.user.firstname, m.user.first_name), m.profile && firstDefined_(m.profile.firstname, m.profile.first_name));
  const last = firstDefined_(m.lastname, m.last_name, m.user && firstDefined_(m.user.lastname, m.user.last_name), m.profile && firstDefined_(m.profile.lastname, m.profile.last_name));
  const combined = (String(first || '') + ' ' + String(last || '')).trim();
  if (combined) return combined;
  return String(firstDefined_(m.user && firstDefined_(m.user.name, m.user.full_name, m.user.display_name), m.profile && firstDefined_(m.profile.name, m.profile.full_name, m.profile.display_name), '')).trim();
}

function extractHoldsportPosition_(m) {
  if (!m || typeof m !== 'object') return '';

  const direct = firstDefined_(m.position, m.player_position, m.volleyball_position, m.sport_position);
  if (direct) return canonicalVolleyballPosition_(direct);

  const fields = m.club_fields;
  const labelRe = /(^|[^a-z])(position|player\s*position|volleyball\s*position|spillerposition|spiller\s*position|pos)([^a-z]|$)/i;

  function simpleValue(v) {
    if (v === null || v === undefined) return '';
    if (['string', 'number'].includes(typeof v)) return String(v).trim();
    return '';
  }

  function walk(node, depth) {
    if (depth > 5 || node === null || node === undefined) return '';
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const hit = walk(node[i], depth + 1);
        if (hit) return hit;
      }
      return '';
    }
    if (typeof node !== 'object') return '';

    const label = String(firstDefined_(node.label, node.name, node.title, node.key, node.field_name, node.club_field_name, '')).trim();
    if (label && labelRe.test(label)) {
      const candidate = firstDefined_(node.value, node.answer, node.content, node.text, node.field_value, node.club_field_value, '');
      const val = simpleValue(candidate);
      if (val) return val;
    }

    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (labelRe.test(k)) {
        const val = simpleValue(node[k]);
        if (val) return val;
      }
    }
    for (let i = 0; i < keys.length; i++) {
      const hit = walk(node[keys[i]], depth + 1);
      if (hit) return hit;
    }
    return '';
  }

  return canonicalVolleyballPosition_(walk(fields, 0));
}

function canonicalVolleyballPosition_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const s = normalizeText_(raw);
  if (/^(s|setter|haever|haeveren)$/.test(s)) return 'S';
  if (/^(l|libero)$/.test(s)) return 'L';
  if (/^(mb|middle|middle blocker|center|centre|midt|midter)$/.test(s)) return 'MB';
  if (/^(opp|opposite|diagonal|diagonalspiller)$/.test(s)) return 'OPP';
  if (/^(oh|outside|outside hitter|wing|wing spiker|kant|kantspiller)$/.test(s)) return 'OH';
  return raw.slice(0, 40);
}

function describeShape_(value, depth) {
  if (depth > 3) return '[max-depth]';
  if (value === null) return null;
  if (Array.isArray(value)) return value.length ? ['array', describeShape_(value[0], depth + 1)] : ['array'];
  if (typeof value !== 'object') return typeof value;
  const out = {};
  Object.keys(value).slice(0, 20).forEach(k => { out[k] = describeShape_(value[k], depth + 1); });
  return out;
}

function holdsportActivityId_(a) {
  if (!a || typeof a !== 'object') return '';
  return String(firstDefined_(a.id, a.activity_id, a.activity && a.activity.id, ''));
}

function holdsportActivityStart_(a) {
  if (!a || typeof a !== 'object') return '';
  return String(firstDefined_(a.starttime, a.start_time, a.starts_at, a.start_at, a.datetime, a.date_time, ''));
}

function holdsportActivityUserId_(u) {
  if (!u || typeof u !== 'object') return '';
  return String(firstDefined_(u.user_id, u.member_id, u.profile_id, u.user && u.user.id, u.profile && u.profile.id, ''));
}

function fetchAllHoldsportActivities_(teamId, dateParam, perPage, maxPages) {
  const pageSize = Number(perPage) || 50;
  const limit = Number(maxPages) || 40;
  const activities = [];
  const seen = {};
  let pagesFetched = 0;
  let schema = '';
  let stoppedOnDuplicatePage = false;
  let lastPageSize = 0;

  for (let page = 1; page <= limit; page++) {
    const raw = holdsportFetch_(
      '/v1/teams/' + encodeURIComponent(teamId) + '/activities?date=' + encodeURIComponent(dateParam) +
      '&page=' + page + '&per_page=' + pageSize
    );
    const arr = holdsportArray_(raw, ['activities', 'data', 'items', 'results']);
    if (!arr) {
      schema = responseKeys_(raw);
      break;
    }
    lastPageSize = arr.length;
    if (!arr.length) break;
    pagesFetched++;

    let newOnPage = 0;
    arr.forEach((a, index) => {
      const id = holdsportActivityId_(a);
      const fallback = [
        String(firstDefined_(a && a.name, a && a.title, '')),
        String(holdsportActivityStart_(a) || ''),
        String(index)
      ].join('|');
      const key = id ? 'id:' + id : 'fallback:' + fallback;
      if (seen[key]) return;
      seen[key] = true;
      activities.push(a);
      newOnPage++;
    });

    // If the API ignores page= and returns the same page repeatedly, stop safely.
    if (newOnPage === 0) {
      stoppedOnDuplicatePage = true;
      break;
    }
  }

  return {
    activities: activities,
    pages_fetched: pagesFetched,
    last_page_size: lastPageSize,
    stopped_on_duplicate_page: stoppedOnDuplicatePage,
    schema: schema
  };
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

function classifyEventType_(name, eventType) {
  const s = normalizeText_([eventType || '', name || ''].join(' '));
  if (/sekretaer|sekretær|sekretariat|secretary|table duty|official duty|dommerbord|scorekeeper|scorer duty|duty shift/.test(s)) return 'duty';
  if (/\b(kamp|match|cup|turnering|tournament|friendly|scrimmage|competition)\b/.test(s)) return 'match';
  if (/\b(traening|training|practice|trening)\b/.test(s)) return 'practice';
  if (/\b(mode|meeting|team meeting|holdmode)\b/.test(s)) return 'meeting';
  return 'other';
}

function normalizeHoldsportStatus_(status) {
  const s = normalizeText_(status || '').trim();
  if (!s || s === 'not_seen') return 'unknown';

  if (/^(1|true)$/.test(s)) return 'attending';
  if (s === 'no_rsvp' || /ej tilkendegivet|undecided|not responded|no response|not stated|ikke svaret|mangler svar|unknown/.test(s)) return 'undecided';
  if (/ferie|vacation|holiday|on leave/.test(s)) return 'vacation';
  if (/skadet|injured|injury/.test(s)) return 'injured';
  if (/til radighed|available|availability|reserve|standby/.test(s) && !/ikke til radighed|not available|unavailable/.test(s)) return 'available';
  if (/udvalgt|selected|picked|chosen/.test(s)) return 'selected';
  if (/ikke til radighed|not available|unavailable/.test(s)) return 'unavailable';
  if (/afmeldt|frameldt|unregistered|not attending|declined|cannot attend|cannot come|no$/.test(s)) return 'declined';
  if (/tilmeldt|attending|joined|registered|yes|deltager|kommer/.test(s)) return 'attending';
  return 'unknown';
}

function isExpectedAttendanceStatus_(status, eventType) {
  const s = String(status || '');
  if (s === 'attending' || s === 'selected') return true;
  if (eventType === 'match' && (s === 'available' || s === 'injured')) return true;
  return false;
}


function holdsportActivityUserStatus_(u, registrationType) {
  if (!u || typeof u !== 'object') return 'unknown';

  const direct = firstDefined_(
    u.status, u.rsvp_status, u.registration_status, u.attendance_status,
    u.availability_status, u.selection_status, u.state, ''
  );
  if (direct !== '') return String(direct);

  const reg = normalizeText_(registrationType || '');
  const joined = firstDefined_(u.joined_status, u.joined, '');
  const picked = firstDefined_(u.picked, u.selected, u.is_selected, '');

  // Holdsport's "Til rådighed" / available-selection registration can expose
  // only joined_status + picked instead of a textual status.
  if (/available|til radighed|pick_out|selection|udvaelg/.test(reg) && joined !== '') {
    const j = Number(joined);
    const p = Number(picked);
    if (Number.isFinite(j) && j === 1) {
      if (Number.isFinite(p) && p === 1) return 'selected';
      return 'available';
    }
    if (Number.isFinite(j) && j === 0) return 'declined';
  }

  if (joined !== '') {
    const n = Number(joined);
    if (Number.isFinite(n)) {
      if (n === 1) return 'attending';
      if (n === 0) return 'declined';
    }
    return String(joined);
  }
  return 'unknown';
}

function holdsportEventTypeText_(a) {
  if (!a || typeof a !== 'object') return '';
  const v = firstDefined_(a.event_type, a.activity_type, a.type, '');
  if (v && typeof v === 'object') {
    return String(firstDefined_(v.name, v.title, v.label, v.slug, v.code, ''));
  }
  return String(v || '');
}

function holdsportRegistrationTypeText_(a) {
  if (!a || typeof a !== 'object') return '';
  const v = firstDefined_(a.registration_type, a.signup_type, a.selection_type, '');
  if (v && typeof v === 'object') {
    return String(firstDefined_(v.name, v.title, v.label, v.slug, v.code, v.id, ''));
  }
  return String(v || '');
}

function numericOrBlank_(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : '';
}

function diagnosticActivityStatuses_(activities) {
  const out = [];
  const seen = {};
  (activities || []).slice(0, 5).forEach(activity => {
    const users = holdsportArray_(activity.activities_users, ['activities_users', 'users', 'data', 'items']) || [];
    users.forEach(u => {
      const raw = holdsportActivityUserStatus_(u, holdsportRegistrationTypeText_(activity));
      const code = String(firstDefined_(u.status_code, u.rsvp_status_code, u.code, ''));
      const key = String(raw) + '|' + code;
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        raw_status: String(raw).slice(0, 80),
        status_code: code.slice(0, 80),
        normalized: normalizeHoldsportStatus_(raw),
        registration_type: holdsportRegistrationTypeText_(activity),
        keys: Object.keys(u || {}).sort()
      });
    });
  });
  return out.slice(0, 30);
}

function diagnosticFetchedActivityStatuses_(activities) {
  const out = [];
  const seen = {};
  (activities || []).slice(0, 5).forEach(activity => {
    const activityId = holdsportActivityId_(activity);
    if (!activityId) return;
    try {
      const raw = holdsportFetch_('/v1/activities/' + encodeURIComponent(activityId) + '/activities_users');
      const users = holdsportArray_(raw, ['activities_users', 'users', 'data', 'items']) || [];
      users.forEach(u => {
        const rawStatus = holdsportActivityUserStatus_(u, holdsportRegistrationTypeText_(activity));
        const code = String(firstDefined_(u.status_code, u.rsvp_status_code, u.code, ''));
        const key = String(rawStatus) + '|' + code;
        if (seen[key]) return;
        seen[key] = true;
        out.push({
          raw_status: String(rawStatus).slice(0, 80),
          status_code: code.slice(0, 80),
          normalized: normalizeHoldsportStatus_(rawStatus),
          registration_type: holdsportRegistrationTypeText_(activity),
          keys: Object.keys(u || {}).sort()
        });
      });
    } catch (err) {
      out.push({ endpoint_error: String(err && err.message ? err.message : err).slice(0, 180) });
    }
  });
  return out.slice(0, 30);
}

function diagnosticNoRsvp_(activities) {
  const out = [];
  (activities || []).slice(0, 5).forEach(activity => {
    const noRsvp = holdsportArray_(firstDefined_(activity.no_rsvp, activity.no_response, activity.no_responses, []), ['no_rsvp', 'users', 'data', 'items']) || [];
    const pairs = [];
    const seen = {};
    noRsvp.forEach(u => {
      const status = String(firstDefined_(u && u.status, u && u.rsvp_status, 'no_rsvp'));
      const code = String(firstDefined_(u && u.status_code, u && u.rsvp_status_code, u && u.code, ''));
      const key = status + '|' + code;
      if (seen[key]) return;
      seen[key] = true;
      pairs.push({
        raw_status: status.slice(0, 80),
        status_code: code.slice(0, 80),
        normalized: normalizeHoldsportStatus_(status),
        keys: Object.keys(u || {}).sort()
      });
    });
    out.push({
      activity_event_type: holdsportEventTypeText_(activity),
      registration_type: holdsportRegistrationTypeText_(activity),
      no_rsvp_count: noRsvp.length,
      unique_status_pairs: pairs.slice(0, 10)
    });
  });
  return out;
}

function diagnosticActivityTasks_(activities) {
  const out = [];
  (activities || []).slice(0, 5).forEach(activity => {
    const activityId = holdsportActivityId_(activity);
    if (!activityId) return;
    try {
      const raw = holdsportFetch_('/v1/activities/' + encodeURIComponent(activityId) + '/activity_tasks');
      const tasks = holdsportArray_(raw, ['activity_tasks', 'tasks', 'data', 'items']) || [];
      out.push({
        activity_event_type: holdsportEventTypeText_(activity),
        task_count: tasks.length,
        tasks: tasks.slice(0, 10).map(task => {
          const assignments = holdsportArray_(firstDefined_(task.activity_tasks, task.assignments, task.users, []), ['activity_tasks', 'assignments', 'users', 'data', 'items']) || [];
          return {
            task_name: String(firstDefined_(task.name, task.title, 'Duty')).slice(0, 100),
            max_participants: numericOrBlank_(firstDefined_(task.max_participants, task.max_attendees, task.capacity, '')),
            assigned_count: assignments.length,
            task_keys: Object.keys(task || {}).sort(),
            assignment_keys: assignments.length ? Object.keys(assignments[0] || {}).sort() : []
          };
        })
      });
    } catch (err) {
      out.push({
        activity_event_type: holdsportEventTypeText_(activity),
        endpoint_error: String(err && err.message ? err.message : err).slice(0, 180)
      });
    }
  });
  return out;
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
    const lastCol = Math.max(1, sheet.getLastColumn());
    const current = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || ''));
    let incompatible = false;
    for (let i = 0; i < current.length; i++) {
      if (!current[i]) continue;
      if (i >= headers.length || current[i] !== headers[i]) {
        incompatible = true;
        break;
      }
    }
    if (incompatible) {
      throw new Error('Sheet "' + name + '" has unexpected headers. Expected: ' + headers.join(', '));
    }
    if (lastCol < headers.length || headers.some((h, i) => current[i] !== h)) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
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
  if (raw === null || raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeText_(value) {
  let s = String(value || '').toLowerCase();
  try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (ignored) {}
  return s;
}

function parseHoldsportDate_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 100000000000 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Unix timestamps supplied as strings.
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    const d = new Date(raw.length <= 10 ? n * 1000 : n);
    return isNaN(d.getTime()) ? null : d;
  }

  // Official Holdsport format is ISO 8601, e.g. 2026-09-25T19:30:00+02:00.
  let d = new Date(raw);
  if (!isNaN(d.getTime())) return d;

  // Be defensive about common API/locale variants.
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
    return isNaN(d.getTime()) ? null : d;
  }

  m = raw.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function normalizeHoldsportDateForStorage_(value) {
  if (value === null || value === undefined || value === '') return '';
  const d = parseHoldsportDate_(value);
  return d ? d.toISOString() : String(value).trim();
}

function parseDateSafe_(value) {
  return parseHoldsportDate_(value);
}

function nowIso_() {
  return new Date().toISOString();
}
