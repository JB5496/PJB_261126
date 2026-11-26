/*
 * 공통 저장 함수 — docs/design.md 2·3절
 * 이 파일은 ① 통합·화면만 고치고, 저장 함수만 담는다.
 * 모든 페이지는 이 함수로만 저장소(localStorage·공유 저장소)를 쓴다. 다른 함수는 각 페이지 js에 둔다.
 */
var STORAGE_KEY = 'team2g_app';

/* 빈 모양: {"targetFriday":"","members":[],"attendance":[]} */
function emptyData() {
  return { targetFriday: '', members: [], attendance: [] };
}

/* 2절 키의 JSON 전체를 읽는다. 없거나 깨졌으면 빈 모양. */
function loadData() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { return emptyData(); }
    var d = JSON.parse(raw);
    if (!d || !Array.isArray(d.members) || !Array.isArray(d.attendance)) { return emptyData(); }
    return {
      targetFriday: typeof d.targetFriday === 'string' ? d.targetFriday : '',
      members: d.members,
      attendance: d.attendance
    };
  } catch (e) {
    return emptyData();
  }
}

/* JSON 전체를 2절 키에 통째로 저장한다. 성공하면 true, 저장소를 쓸 수 없으면 false. */
function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

/* 현재 JSON 전체를 team2g_backup.json 파일로 내려받는다. */
function exportJson() {
  var text = JSON.stringify(loadData(), null, 2);
  var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'team2g_backup.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

/*
 * 백업 또는 표본 파일을 읽어 2절 모양인지 확인한 뒤 saveData 한다.
 * Promise로 {ok, message}를 돌려준다. 모양이 틀리면 저장하지 않는다.
 */
function importJson(file) {
  return new Promise(function (resolve) {
    if (!file) {
      resolve({ ok: false, message: '파일을 선택하십시오.' });
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      resolve({ ok: false, message: '파일을 읽지 못했습니다. 다시 선택하십시오.' });
    };
    reader.onload = function () {
      var d;
      try {
        d = JSON.parse(String(reader.result).replace(/^﻿/, ''));
      } catch (e) {
        resolve({ ok: false, message: '이 웹앱의 백업·표본 파일인지 확인하십시오. (JSON 형식이 아닙니다) 기존 자료는 그대로입니다.' });
        return;
      }
      if (!d || !Array.isArray(d.members) || !Array.isArray(d.attendance)) {
        resolve({ ok: false, message: '이 웹앱의 백업·표본 파일인지 확인하십시오. (부서원 명단·근태 칸이 없습니다) 기존 자료는 그대로입니다.' });
        return;
      }
      var data = {
        targetFriday: typeof d.targetFriday === 'string' ? d.targetFriday : '',
        members: d.members,
        attendance: d.attendance
      };
      if (getShared()) {
        sharedImport(data).then(function (r) {
          resolve(r.ok
            ? { ok: true, message: '공유 저장소로 가져왔습니다. 부서원 ' + data.members.length + '명, 근태 ' + data.attendance.length + '건' }
            : { ok: false, message: r.message + ' 가져오지 않았습니다.' });
        });
        return;
      }
      if (!saveData(data)) {
        resolve({ ok: false, message: '이 브라우저에서는 저장할 수 없습니다.' });
        return;
      }
      resolve({ ok: true, message: '가져왔습니다. 부서원 ' + data.members.length + '명, 근태 ' + data.attendance.length + '건' });
    };
    reader.readAsText(file, 'utf-8');
  });
}

/* 2절 키를 지운다('비우기'). */
function clearData() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    /* 저장소를 쓸 수 없으면 지울 것도 없음 */
  }
}

/* ================================================================
 * 공유 저장소(Supabase) — docs/design.md 6절
 * 연결 정보(주소·웹앱 키·접근 코드)는 코드에 넣지 않고, 관리자가 자료관리 탭에서 넣거나
 * 직원용 링크(#join=...)로 받아 이 브라우저의 'team2g_shared' 키에만 둔다.
 * 연결돼 있으면 저장은 공유 저장소에 먼저 하고, 성공한 결과를 localStorage에 옮겨 둔다(화면은 계속 loadData로 읽음).
 * ================================================================ */
var SHARED_KEY = 'team2g_shared';
var SYNC_MS = 5000;
var lastVersion = null;

function getShared() {
  try {
    var c = JSON.parse(localStorage.getItem(SHARED_KEY) || 'null');
    return c && typeof c.url === 'string' && typeof c.key === 'string' && typeof c.code === 'string' ? c : null;
  } catch (e) { return null; }
}

function setShared(cfg) {
  try {
    localStorage.setItem(SHARED_KEY, JSON.stringify({ url: String(cfg.url).trim().replace(/\/+$/, ''), key: String(cfg.key).trim(), code: String(cfg.code) }));
    lastVersion = null;
    return true;
  } catch (e) { return false; }
}

function clearShared() {
  try { localStorage.removeItem(SHARED_KEY); } catch (e) { /* 없음 */ }
  lastVersion = null;
}

/* 직원용 링크: 시작 페이지 주소 + #join=(연결 정보). 링크를 연 기기는 연결 정보를 저장하고 주소창에서 지운다. */
function makeJoinLink(startPageUrl) {
  var c = getShared();
  if (!c) { return ''; }
  var raw = JSON.stringify({ u: c.url, k: c.key, c: c.code });
  return startPageUrl.split('#')[0] + '#join=' + btoa(unescape(encodeURIComponent(raw)));
}

(function acceptJoinLink() {
  try {
    var m = /[#&]join=([^&]+)/.exec(location.hash);
    if (!m) { return; }
    var o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    if (o && o.u && o.k && o.c) { setShared({ url: o.u, key: o.k, code: o.c }); }
    history.replaceState(null, '', location.pathname + location.search);
  } catch (e) { /* 깨진 링크는 무시 */ }
})();

function sharedMessage(text) {
  if (/ACCESS_DENIED/.test(text)) { return '접근 코드가 맞지 않습니다. 관리자에게 새 링크를 받으십시오.'; }
  if (/UNKNOWN_MEMBER/.test(text)) { return '명단에 없는 부서원입니다. 조직이 바뀌었을 수 있으니 화면을 새로 고치십시오.'; }
  if (/check constraint/.test(text)) { return '부재 유형 또는 부재 시간(0~8)이 맞지 않습니다.'; }
  return '공유 저장소 오류: ' + String(text).slice(0, 120);
}

/* 공유 저장소 함수 호출. Promise로 {ok, data, message}를 돌려준다. */
function sharedCall(fn, args) {
  var c = getShared();
  if (!c) { return Promise.resolve({ ok: false, message: '공유 저장소가 연결되지 않았습니다.' }); }
  return fetch(c.url + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { 'apikey': c.key, 'Authorization': 'Bearer ' + c.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ p_code: c.code }, args || {}))
  }).then(function (r) {
    return r.text().then(function (t) {
      var body = null;
      try { body = JSON.parse(t); } catch (e) { body = null; }
      if (!r.ok) { return { ok: false, message: sharedMessage(body && body.message ? body.message : t || ('HTTP ' + r.status)) }; }
      return { ok: true, data: body };
    });
  }, function () {
    return { ok: false, message: '공유 저장소 연결 안 됨 — 인터넷 연결을 확인하십시오. 이 기기에 저장된 마지막 자료를 보여 줍니다.' };
  });
}

/* 공유 저장소에서 받은 상태를 localStorage에 옮긴다. 바뀌었으면 true. */
function applyShared(d) {
  if (!d || !Array.isArray(d.members) || !Array.isArray(d.attendance)) { return false; }
  var changed = d.version !== lastVersion;
  lastVersion = d.version;
  if (changed) {
    saveData({ targetFriday: typeof d.targetFriday === 'string' ? d.targetFriday : '', members: d.members, attendance: d.attendance });
  }
  return changed;
}

function afterShared(r) {
  if (r.ok) { r.changed = applyShared(r.data); r.message = r.message || '공유 저장소에 저장했습니다.'; }
  return r;
}

/* 지금 상태 읽기 → localStorage. {ok, changed, message} */
function syncPull() {
  return sharedCall('app_pull').then(function (r) {
    if (r.ok) { r.changed = applyShared(r.data); r.message = '공유 저장소 연결됨'; }
    return r;
  });
}

/* 근태 한 건 저장. trainee는 true/false(바꿀 때) 또는 null */
function sharedSaveAttendance(rec, trainee) {
  return sharedCall('app_save_attendance', {
    p_id: rec.id, p_date: rec.date, p_type: rec.absentType, p_hours: rec.absentHours,
    p_trainee: typeof trainee === 'boolean' ? trainee : null
  }).then(afterShared);
}

/* 조직(대상 금요일·명단) 저장 */
function sharedSaveOrg(friday, members) {
  return sharedCall('app_save_org', { p_friday: friday, p_members: members }).then(afterShared);
}

/* 표본·백업·이 기기 자료를 공유 저장소에 올리기 */
function sharedImport(data) {
  return sharedCall('app_import', { p_data: data }).then(afterShared);
}

/*
 * 자동 새로 읽기: 연결돼 있으면 바로 한 번, 그 뒤 5초마다(화면이 보일 때만) 읽는다.
 * onUpdate({shared, ok, changed, message})를 부른다. 연결 정보가 없으면 {shared:false} 한 번.
 */
function startAutoSync(onUpdate) {
  function tick() {
    if (!getShared()) { onUpdate({ shared: false, ok: false, changed: false, message: '이 기기에만 저장 중(공유 저장소 연결 안 됨)' }); return; }
    if (document.hidden) { return; }
    syncPull().then(function (r) { r.shared = true; onUpdate(r); });
  }
  tick();
  setInterval(tick, SYNC_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { tick(); } });
}
