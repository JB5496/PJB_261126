/*
 * 기능 B — 충족 현황 페이지(board). ③ 기능 B 담당 파일.
 * 저장소는 common.js의 loadData로 읽기만 한다. 판정 규칙은 docs/design.md 2절과 prd/team_prd.md 3절.
 */
(function () {
  'use strict';

  var CONFIRM = '담당 검토 후 확정';
  var ABSENT_TYPES = ['휴가', '출장'];
  var ALL_TYPES = ['없음', '휴가', '출장'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function validRecord(a) {
    return ALL_TYPES.indexOf(a.absentType) >= 0 &&
      typeof a.absentHours === 'number' && isFinite(a.absentHours) &&
      a.absentHours >= 0 && a.absentHours <= 8;
  }

  /* 개인 달성: 휴가·출장 부재가 4시간 이상 */
  function isAchieved(a) {
    return ABSENT_TYPES.indexOf(a.absentType) >= 0 && a.absentHours >= 4;
  }

  /* 판정 계산 — 화면과 떨어진 순수 계산 */
  function evaluate(data) {
    var members = [];
    var seen = Object.create(null);
    data.members.forEach(function (m) {
      if (m && typeof m.id === 'string' && m.id !== '' && !seen[m.id]) {
        seen[m.id] = true;
        members.push({
          id: m.id, dept: typeof m.dept === 'string' && m.dept !== '' ? m.dept : '부서 없음', trainee: m.trainee === true,
          name: typeof m.name === 'string' ? m.name : '', position: typeof m.position === 'string' ? m.position : '',
          team: typeof m.team === 'string' ? m.team : ''
        });
      }
    });

    /* 대상 금요일 근태만 사번별로 모은다 */
    var byId = Object.create(null);
    var unknown = [];
    data.attendance.forEach(function (a) {
      if (!a || a.date !== data.targetFriday) { return; }
      if (!seen[a.id]) { unknown.push(a); return; }
      (byId[a.id] = byId[a.id] || []).push(a);
    });

    var people = [];
    var flags = [];
    var missing = [];
    members.forEach(function (m) {
      var recs = byId[m.id] || [];
      var p = { id: m.id, dept: m.dept, trainee: m.trainee, name: m.name, position: m.position, team: m.team, record: recs.length === 1 ? recs[0] : null, status: '' };
      if (m.trainee) {
        p.status = '평가 제외(교육대상자)';
      } else if (recs.length > 1) {
        p.status = '확인 필요';
        flags.push({ id: who(m), dept: m.dept, reason: '중복 입력 — 같은 금요일 근태가 ' + recs.length + '건' });
      } else if (recs.length === 0) {
        p.status = '미입력';
        missing.push(p);
      } else if (!validRecord(recs[0])) {
        p.status = '확인 필요';
        flags.push({ id: who(m), dept: m.dept, reason: '값 확인 필요 — 부재 유형 또는 부재 시간(0~8)이 맞지 않음' });
      } else {
        p.status = isAchieved(recs[0]) ? '달성' : '미달성';
      }
      people.push(p);
    });
    unknown.forEach(function (a) {
      flags.push({ id: String(a.id), dept: '-', reason: '명단에 없는 사번의 근태 — 판정에 넣지 않음' });
    });

    /* 부서별: 평가대상자 = 교육대상자 제외 인원(미입력·확인 필요 포함), 달성자 = 상태가 '달성' */
    var depts = [];
    var deptIndex = Object.create(null);
    people.forEach(function (p) {
      if (!(p.dept in deptIndex)) {
        deptIndex[p.dept] = depts.length;
        depts.push({ dept: p.dept, targets: 0, achieved: 0 });
      }
      var d = depts[deptIndex[p.dept]];
      if (!p.trainee) { d.targets += 1; }
      if (p.status === '달성') { d.achieved += 1; }
    });
    depts.forEach(function (d) {
      if (d.targets === 0) { d.result = '평가대상자 없음'; }
      else { d.result = (d.achieved * 2 >= d.targets) ? '충족' : '미충족'; }
    });

    return { people: people, depts: depts, missing: missing, flags: flags };
  }

  /* 목록에 쓰는 사람 표시: 이름이 있으면 '이름(사번)' */
  function who(p) {
    return p.name ? p.name + (p.position ? ' ' + p.position : '') + ' (' + p.id + ')' : p.id;
  }

  function pct(n, m) {
    return m === 0 ? '-' : (Math.round(n / m * 1000) / 10) + '%';
  }

  /* 상태 꼬리표 4색: 초록=달성·충족, 빨강=미달성·미충족, 노랑=확인 필요, 회색=미입력·평가 제외 */
  function badge(text) {
    var kind = (text === '충족' || text === '달성') ? 'ok'
      : (text === '미충족' || text === '미달성') ? 'bad'
      : (text === '확인 필요') ? 'warn' : 'gray';
    return '<span class="badge ' + kind + '">' + esc(text) + '</span>';
  }

  function render() {
    var data = loadData();
    var ready = data.members.length > 0 && data.targetFriday !== '';
    $('needData').hidden = ready;
    $('report').hidden = !ready;
    if (!ready) { return; }

    var r = evaluate(data);
    $('targetFriday').textContent = data.targetFriday;

    var h = '<thead><tr><th>부서</th><th class="num">평가대상자</th><th class="num">달성자</th><th class="num">달성 비율</th><th>판정</th></tr></thead><tbody>';
    r.depts.forEach(function (d) {
      var judged = d.result === '충족' || d.result === '미충족';
      h += '<tr><td>' + esc(d.dept) + '</td><td class="num">' + d.targets + '명</td><td class="num">' + d.achieved + '명</td><td class="num">' +
        pct(d.achieved, d.targets) + '</td><td>' + badge(d.result) +
        (judged ? '<span class="confirm">' + CONFIRM + '</span>' : '') + '</td></tr>';
    });
    $('deptTable').innerHTML = h + '</tbody>';

    $('missingCount').textContent = '(' + r.missing.length + '명)';
    $('missingList').innerHTML = r.missing.length === 0
      ? '<p class="empty">미입력자가 없습니다.</p>'
      : '<ul class="notice">' + r.missing.map(function (p) { return '<li>' + badge('미입력') + '<span>' + esc(who(p)) + ' · ' + (p.team ? esc(p.team) + ' · ' : '') + esc(p.dept) + '</span></li>'; }).join('') + '</ul>';

    $('flagCount').textContent = '(' + r.flags.length + '건)';
    $('flagList').innerHTML = r.flags.length === 0
      ? '<p class="empty">확인할 건이 없습니다.</p>'
      : '<ul class="notice">' + r.flags.map(function (f) {
          return '<li>' + badge('확인 필요') + '<span>' + esc(f.id) + ' · ' + esc(f.dept) + ' — ' + esc(f.reason) + '</span></li>';
        }).join('') + '</ul>';

    renderChart(r);
    renderPeople(r);
  }

  /* 요약 막대그래프 — 직접 그린 SVG(외부 라이브러리 없음). 50% 기준선은 점선 */
  function renderChart(r) {
    var html = '';
    r.depts.forEach(function (d) {
      html += '<div class="chart-row"><span class="name">' + esc(d.dept) + '</span>';
      if (d.targets === 0) {
        html += '<span class="none">평가대상자 없음</span><span class="pct">-</span><span>' + badge('평가대상자 없음').replace('평가대상자 없음', '판정 없음') + '</span></div>';
        return;
      }
      var w = Math.max(0, Math.min(100, d.achieved / d.targets * 100));
      html += '<svg viewBox="0 0 100 22" preserveAspectRatio="none" role="img" aria-label="' + esc(d.dept) + ' 달성 비율 ' + pct(d.achieved, d.targets) + '">' +
        '<rect x="0" y="3" width="100" height="16" rx="3" fill="#EEF0F3"/>' +
        '<rect x="0" y="3" width="' + w.toFixed(2) + '" height="16" rx="3" fill="#2F5BC1"/>' +
        '<line x1="50" y1="0" x2="50" y2="22" stroke="#1A1F2B" stroke-width="2" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>' +
        '</svg><span class="pct">' + pct(d.achieved, d.targets) + '</span><span>' + badge(d.result) + '</span></div>';
    });
    $('chart').innerHTML = html;
  }

  /* 걸러 보기: 보는 방법만 바꾼다(저장 자료·부서별 판정은 그대로) */
  var TODO = ['미달성', '미입력', '확인 필요'];
  var lastResult = null;

  function fillDeptFilter(r) {
    var sel = $('deptFilter');
    var keep = sel.value;
    sel.innerHTML = '';
    var all = document.createElement('option');
    all.value = ''; all.textContent = '전체';
    sel.appendChild(all);
    r.depts.forEach(function (d) {
      var o = document.createElement('option');
      o.value = d.dept; o.textContent = d.dept;
      sel.appendChild(o);
    });
    sel.value = keep;
    if (sel.value !== keep) { sel.value = ''; }
  }

  function renderPeople(r) {
    lastResult = r;
    fillDeptFilter(r);
    var dept = $('deptFilter').value;
    var todo = $('todoOnly').checked;
    var shown = r.people.filter(function (p) {
      return (dept === '' || p.dept === dept) && (!todo || TODO.indexOf(p.status) >= 0);
    });
    var named = r.people.some(function (p) { return p.name !== ''; });
    var cols = named
      ? [['name', '이름'], ['position', '직책'], ['team', '팀'], ['dept', '부서'], ['absent', '부재'], ['status', '결과']]
      : [['id', '사번'], ['dept', '부서'], ['absent', '부재'], ['status', '결과']];
    if (!cols.some(function (c) { return c[0] === sortKey; })) { sortKey = ''; }
    shown = sortPeople(shown);
    var t = '<thead><tr>' + cols.map(function (c) {
      var on = c[0] === sortKey;
      var mark = on ? (sortDir > 0 ? ' ▲' : ' ▼') : '';
      return '<th aria-sort="' + (on ? (sortDir > 0 ? 'ascending' : 'descending') : 'none') + '">' +
        '<button type="button" class="sort" data-key="' + c[0] + '">' + c[1] + mark + '</button></th>';
    }).join('') + '</tr></thead><tbody>';
    shown.forEach(function (p) {
      var absent = p.record ? esc(p.record.absentType) + ' ' + esc(p.record.absentHours) + '시간' : '-';
      t += '<tr>' + (named
        ? '<td>' + esc(p.name || p.id) + '</td><td>' + esc(p.position || '-') + '</td><td>' + esc(p.team || '-') + '</td>'
        : '<td>' + esc(p.id) + '</td>') +
        '<td>' + esc(p.dept) + '</td><td>' + absent + '</td><td>' + badge(p.status) + '</td></tr>';
    });
    $('personTable').innerHTML = t + '</tbody>';
    $('personTable').hidden = shown.length === 0;
    $('filterEmpty').hidden = shown.length !== 0;
    $('filterCount').textContent = (dept !== '' || todo) ? r.people.length + '명 중 ' + shown.length + '명 표시' : '';
  }

  /* 줄 눌러 정렬: 머리글을 누르면 오름차순, 다시 누르면 내림차순. 보는 순서만 바꾼다(저장 자료 그대로) */
  var sortKey = '';
  var sortDir = 1;
  var STATUS_ORDER = ['확인 필요', '미입력', '미달성', '달성', '평가 제외(교육대상자)'];

  function sortValue(p, key) {
    if (key === 'absent') { return p.record && typeof p.record.absentHours === 'number' ? p.record.absentHours : -1; }
    if (key === 'status') { return STATUS_ORDER.indexOf(p.status); }
    return String(p[key] || '');
  }

  function sortPeople(list) {
    if (!sortKey) { return list; }
    return list.map(function (p, i) { return { p: p, i: i }; }).sort(function (a, b) {
      var x = sortValue(a.p, sortKey), y = sortValue(b.p, sortKey), c;
      if (typeof x === 'number') { c = x - y; } else { c = x.localeCompare(y, 'ko', { numeric: true }); }
      return c !== 0 ? c * sortDir : a.i - b.i;
    }).map(function (o) { return o.p; });
  }

  $('personTable').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button.sort') : null;
    if (!b || !lastResult) { return; }
    var key = b.getAttribute('data-key');
    if (sortKey === key) { sortDir = -sortDir; } else { sortKey = key; sortDir = 1; }
    renderPeople(lastResult);
    var again = $('personTable').querySelector('button.sort[data-key="' + key + '"]');
    if (again) { again.focus(); }
  });

  $('deptFilter').addEventListener('change', function () { if (lastResult) { renderPeople(lastResult); } });
  $('todoOnly').addEventListener('change', function () { if (lastResult) { renderPeople(lastResult); } });

  /* 확인 목록 탭 */
  function selectTab(which) {
    var m = which === 'missing';
    $('tabMissing').setAttribute('aria-selected', m ? 'true' : 'false');
    $('tabFlags').setAttribute('aria-selected', m ? 'false' : 'true');
    $('missingList').hidden = !m;
    $('flagList').hidden = m;
  }
  $('tabMissing').addEventListener('click', function () { selectTab('missing'); });
  $('tabFlags').addEventListener('click', function () { selectTab('flags'); });

  /* 공유 저장소 상태 한 줄 */
  function showSync(s) {
    var el = document.getElementById('syncState');
    el.textContent = s.message || '';
    el.className = 'sync-state ' + (!s.shared ? 'local' : (s.ok ? 'ok' : 'warn'));
  }

  /* 다른 사람이 저장하면 5초 안에 다시 그린다 */
  startAutoSync(function (s) { showSync(s); if (s.changed) { render(); } });
  render();
})();
