/*
 * 기능 A — 근태 입력 페이지(IN). ② 기능 A 담당 파일.
 * 저장소는 common.js의 loadData·saveData로만 쓰고, attendance 칸과 고른 부서원의 trainee(교육대상자) 표시만 바꾼다(docs/design.md 2절).
 * 사번을 고르면 이미 저장된 대상 금요일 근태를 입력 칸에 불러온다.
 */
(function () {
  'use strict';

  var TYPES = ['없음', '휴가', '출장'];

  function $(id) { return document.getElementById(id); }

  function showResult(text, kind) {
    var el = $('result');
    el.textContent = text;
    el.className = 'msg ' + kind;
    el.hidden = false;
  }

  function countForFriday(data) {
    return data.attendance.filter(function (a) { return a && a.date === data.targetFriday; }).length;
  }

  function render() {
    var data = loadData();
    var ready = data.members.length > 0 && data.targetFriday !== '';
    $('needData').hidden = ready;
    $('formCard').hidden = !ready;
    if (!ready) { return; }

    $('targetFriday').textContent = data.targetFriday;
    var sel = $('memberId');
    var keep = sel.value;
    sel.innerHTML = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = '사번을 선택하십시오';
    sel.appendChild(first);
    data.members.forEach(function (m) {
      if (!m || typeof m.id !== 'string') { return; }
      var o = document.createElement('option');
      o.value = m.id;
      o.textContent = memberLabel(m) + (m.trainee === true ? ' (교육대상자)' : '');
      sel.appendChild(o);
    });
    sel.value = keep;
    syncTraineeFrom(data);
    $('savedCount').textContent = '이번 금요일 저장된 근태 ' + countForFriday(data) + '건';
  }

  /* 사번 목록 표시: 이름이 있으면 '이름 직책 · 팀 · 부서 (사번)', 없으면 '사번 · 부서' */
  function memberLabel(m) {
    var dept = m.dept || '부서 없음';
    if (typeof m.name === 'string' && m.name !== '') {
      return m.name + (m.position ? ' ' + m.position : '') + ' · ' + (m.team ? m.team + ' · ' : '') + dept + ' (' + m.id + ')';
    }
    return m.id + ' · ' + dept;
  }

  /* 고른 사번에 이미 저장된 대상 금요일 근태가 있으면 입력 칸에 불러온다(없으면 기본값) */
  function loadExisting(data) {
    var id = $('memberId').value, rec = null;
    data.attendance.forEach(function (a) { if (a && a.id === id && a.date === data.targetFriday) { rec = a; } });
    if (rec && TYPES.indexOf(rec.absentType) >= 0) {
      $('absentType').value = rec.absentType;
      $('absentHours').value = String(rec.absentHours);
      $('existing').textContent = '저장된 입력을 불러왔습니다: ' + rec.absentType + ' ' + rec.absentHours + '시간';
    } else {
      $('absentType').value = '없음';
      $('absentHours').value = '0';
      $('existing').textContent = id ? '아직 저장된 입력이 없습니다.' : '';
    }
  }

  function syncTraineeFrom(data) {
    var id = $('memberId').value, t = false;
    data.members.forEach(function (m) { if (m && m.id === id && m.trainee === true) { t = true; } });
    $('isTrainee').checked = t;
  }

  /* 입력을 확인해 틀린 칸이 있으면 안내 문장을, 맞으면 null을 돌려준다. */
  function validate(id, type, hoursText) {
    if (!id) { return '사번을 선택하십시오.'; }
    if (TYPES.indexOf(type) < 0) { return '부재 유형을 선택하십시오.'; }
    if (hoursText.trim() === '') { return '부재 시간을 입력하십시오. (0~8 사이 숫자)'; }
    var h = Number(hoursText);
    if (!isFinite(h) || h < 0 || h > 8) { return '부재 시간은 0~8 사이 숫자로 입력하십시오.'; }
    if (type === '없음' && h !== 0) { return "부재 유형이 '없음'이면 부재 시간은 0이어야 합니다."; }
    return null;
  }

  function onSave() {
    var data = loadData();
    var id = $('memberId').value;
    var type = $('absentType').value;
    var hoursText = $('absentHours').value;

    var problem = validate(id, type, hoursText);
    if (problem) {
      showResult(problem + ' 저장되지 않았습니다.', 'error');
      return;
    }

    var record = { id: id, date: data.targetFriday, absentType: type, absentHours: Number(hoursText) };
    var found = -1;
    for (var i = 0; i < data.attendance.length; i++) {
      var a = data.attendance[i];
      if (a && a.id === id && a.date === data.targetFriday) { found = i; break; }
    }
    var updated = found >= 0;
    if (updated) { data.attendance[found] = record; } else { data.attendance.push(record); }
    var trainee = $('isTrainee').checked;
    data.members.forEach(function (m) { if (m && m.id === id) { m.trainee = trainee; } });
    var doneText = (updated ? '기존 입력이 수정되었습니다: ' : '저장되었습니다: ') + id + ' · ' + type + ' ' + record.absentHours + '시간' +
      (trainee ? ' · 교육대상자(평가 제외)' : '');

    /* 공유 저장소에 연결돼 있으면 거기에 먼저 저장한다. 실패하면 저장하지 않은 것으로 알린다(다시 누르면 됨). */
    if (getShared()) {
      $('saveBtn').disabled = true;
      showResult('저장하는 중입니다…', 'warn');
      sharedSaveAttendance(record, trainee).then(function (r) {
        $('saveBtn').disabled = false;
        if (!r.ok) { showResult(r.message + ' 저장되지 않았습니다.', 'error'); return; }
        showResult(doneText + ' (모두에게 반영됨)', 'ok');
        render();
        loadExisting(loadData());
      });
      return;
    }

    if (!saveData(data)) {
      showResult('이 브라우저에서는 저장할 수 없습니다.', 'error');
      return;
    }
    showResult(doneText, 'ok');
    render();
    loadExisting(loadData());
  }

  function onPick() {
    var data = loadData();
    syncTraineeFrom(data);
    loadExisting(data);
  }

  $('memberId').addEventListener('change', onPick);
  $('saveBtn').addEventListener('click', onSave);

  /* 공유 저장소 상태 한 줄 */
  function showSync(s) {
    var el = $('syncState');
    el.textContent = s.message || '';
    el.className = 'sync-state ' + (!s.shared ? 'local' : (s.ok ? 'ok' : 'warn'));
  }
  /* 다른 사람이 명단·근태를 바꾸면 목록과 건수만 다시 그린다(입력 중인 칸은 그대로) */
  startAutoSync(function (s) { showSync(s); if (s.changed) { render(); } });
  render();
})();
