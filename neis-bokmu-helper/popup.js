// 팝업 화면: 복무 내용을 입력받아 나이스 탭에 채우고, 칸 연결·설정을 관리한다
const $ = id => document.getElementById(id);
const FORM_KEYS = ['type', 'startDate', 'startTime', 'endDate', 'endTime', 'reason', 'place', 'contact'];
const NEIS_URL = /^https:\/\/([^/]+\.)?neis\.go\.kr\//;
const STATUS_TEXT = { ok: '입력됨', check: '확인 필요', fail: '실패', notfound: '칸을 못 찾음', skip: '값 없음 · 건너뜀', nomap: '연결 안 됨' };

let settings = Object.assign({}, NB_DEFAULT_SETTINGS);
let mapping = {};
let presets = [];
let neisTab = null;

const labelOf = key => (NB_BASE_FIELDS.find(f => f.key === key) || {}).label || key;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- 나이스 탭 찾기 ----------
async function findNeisTab() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active && NEIS_URL.test(active.url || '')) return active;
  const tabs = await chrome.tabs.query({ url: 'https://*.neis.go.kr/*' });
  return tabs[0] || null;
}

async function ensureInjected(tabId) {
  // 확장 프로그램을 설치하기 전에 열어 둔 나이스 탭에도 스크립트를 넣는다(중복 실행은 스크립트가 막음)
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['fields.js', 'content.js'] });
  } catch (e) { /* 권한 밖의 프레임은 무시 */ }
}

function showTabStatus() {
  const el = $('tabStatus');
  if (neisTab) {
    el.textContent = `연결됨: ${neisTab.title || '나이스'}`;
    el.className = 'status ok';
  } else {
    el.textContent = '열린 나이스 화면이 없습니다. 나이스에 로그인한 뒤 다시 열어 주세요.';
    el.className = 'status bad';
  }
  $('fillBtn').disabled = $('pickBtn').disabled = $('highlightBtn').disabled = !neisTab;
}

// ---------- 화면 그리기 ----------
function readForm() {
  const f = {};
  FORM_KEYS.forEach(k => { f[k] = $(k).value.trim(); });
  return f;
}

function writeForm(f) {
  FORM_KEYS.forEach(k => { $(k).value = (f && f[k]) || ''; });
}

function renderPresets() {
  const sel = $('presetSelect');
  sel.innerHTML = '<option value="">자주 쓰는 복무 불러오기</option>' +
    presets.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('');
}

function renderMapping() {
  const list = $('mappingList');
  list.innerHTML = nbActiveFields(settings).map(f => {
    const m = mapping[f.key];
    return `<li><span class="name">${f.label}</span>` + (m
      ? `<span class="where" title="${esc(m.selector)}">✔ ${esc(m.hint)}</span><button data-del="${f.key}">지우기</button>`
      : '<span class="where muted">연결 안 됨</span>') + '</li>';
  }).join('');
  list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    delete mapping[b.dataset.del];
    await chrome.storage.local.set({ nbMapping: mapping });
    renderMapping();
  }));
}

function renderSettings() {
  $('dateFormat').value = settings.dateFormat;
  $('timeMode').value = settings.timeMode;
  $('delay').value = settings.delay;
}

function renderResult(results) {
  $('result').innerHTML = Object.entries(results).map(([key, r]) => {
    const cls = r.status === 'ok' ? 'ok' : r.status === 'check' || r.status === 'skip' ? 'check' : 'fail';
    const cls2 = r.status === 'skip' ? 'muted' : cls;
    return `<li><span class="name">${labelOf(key)}</span><span class="${cls2}">${STATUS_TEXT[r.status] || r.status}` +
      `${r.detail ? ' · ' + esc(r.detail) : ''}</span></li>`;
  }).join('');
}

// ---------- 자동 입력 ----------
async function runFill(values, strict, keys) {
  const res = await chrome.scripting.executeScript({
    target: { tabId: neisTab.id, allFrames: true },
    func: (v, m, s, o) => (window.__nbFill ? window.__nbFill(v, m, s, o) : {}),
    args: [values, mapping, settings, { strict, keys }]
  });
  const merged = {};
  for (const frame of res) Object.assign(merged, frame.result || {});
  return merged;
}

async function fill() {
  const form = readForm();
  if (!form.type && !form.startDate) {
    renderResult({ type: { status: 'fail', detail: '복무구분이나 시작일을 먼저 입력해 주세요' } });
    return;
  }
  const btn = $('fillBtn');
  btn.disabled = true;
  btn.textContent = '입력하는 중…';
  try {
    await ensureInjected(neisTab.id);
    const values = nbBuildValues(form, settings);
    const fields = nbActiveFields(settings).map(f => f.key);
    // 1차: 칸을 연결했던 그 화면(프레임)에서만 찾는다
    let results = await runFill(values, true, null);
    // 2차: 못 찾은 칸은 다른 프레임에서도 찾아본다(나이스 주소가 바뀐 경우 대비)
    const missing = fields.filter(k => mapping[k] && values[k] && !results[k]);
    if (missing.length) Object.assign(results, await runFill(values, false, missing));

    const ordered = {};
    for (const k of fields) {
      if (!mapping[k]) { if (values[k]) ordered[k] = { status: 'nomap' }; continue; }
      ordered[k] = results[k] || (values[k] ? { status: 'notfound', detail: '복무 신청 화면이 열려 있는지 확인하세요' } : { status: 'skip' });
    }
    renderResult(ordered);
  } catch (e) {
    renderResult({ type: { status: 'fail', detail: String(e.message || e) } });
  } finally {
    btn.disabled = false;
    btn.textContent = '나이스에 입력하기';
  }
}

// ---------- 칸 연결 ----------
async function startPick() {
  const fields = nbActiveFields(settings);
  const labels = {}, guides = {};
  fields.forEach(f => { labels[f.key] = f.label; guides[f.key] = f.guide; });
  await ensureInjected(neisTab.id);
  await chrome.storage.local.set({
    nbPick: { active: true, finished: false, index: 0, keys: fields.map(f => f.key), labels, guides }
  });
  await chrome.tabs.update(neisTab.id, { active: true });
  window.close();
}

async function highlight() {
  await ensureInjected(neisTab.id);
  const res = await chrome.scripting.executeScript({
    target: { tabId: neisTab.id, allFrames: true },
    func: m => (window.__nbHighlight ? window.__nbHighlight(m) : []),
    args: [mapping]
  });
  const found = new Set(res.flatMap(r => r.result || []));
  const total = Object.keys(mapping).length;
  alert(total ? `연결된 ${total}칸 중 ${found.size}칸을 지금 화면에서 찾았습니다(파란 테두리).` : '연결된 칸이 없습니다.');
}

// ---------- 내보내기 · 가져오기 ----------
function exportMapping() {
  const data = { app: 'neis-bokmu-helper', version: 1, settings, mapping };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = '나이스_복무_칸연결.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importMapping(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'neis-bokmu-helper' || !data.mapping) throw new Error('이 프로그램에서 만든 파일이 아닙니다');
    mapping = data.mapping;
    settings = Object.assign({}, NB_DEFAULT_SETTINGS, data.settings);
    await chrome.storage.local.set({ nbMapping: mapping, nbSettings: settings });
    renderSettings();
    renderMapping();
    alert('연결 정보를 가져왔습니다.');
  } catch (e) {
    alert('가져오기 실패: ' + e.message);
  }
}

// ---------- 시작 ----------
async function init() {
  $('typeList').innerHTML = NB_TYPES.map(t => `<option value="${t}">`).join('');
  const st = await chrome.storage.local.get(['nbSettings', 'nbMapping', 'nbPresets', 'nbDraft']);
  settings = Object.assign({}, NB_DEFAULT_SETTINGS, st.nbSettings);
  mapping = st.nbMapping || {};
  presets = st.nbPresets || [];
  writeForm(st.nbDraft);
  renderPresets();
  renderSettings();
  renderMapping();

  neisTab = await findNeisTab();
  showTabStatus();
  // 처음 쓰는 경우 연결 탭부터 보여 준다
  if (!Object.keys(mapping).length) switchTab('setup');

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  FORM_KEYS.forEach(k => $(k).addEventListener('input', () => chrome.storage.local.set({ nbDraft: readForm() })));

  $('fillBtn').addEventListener('click', fill);
  $('pickBtn').addEventListener('click', startPick);
  $('highlightBtn').addEventListener('click', highlight);
  $('clearMapping').addEventListener('click', async () => {
    if (!confirm('연결된 칸 정보를 모두 지울까요?')) return;
    mapping = {};
    await chrome.storage.local.set({ nbMapping: mapping });
    renderMapping();
  });

  ['dateFormat', 'timeMode', 'delay'].forEach(k => $(k).addEventListener('change', async () => {
    settings[k] = k === 'delay' ? Math.min(3000, Math.max(100, Number($(k).value) || 400)) : $(k).value;
    await chrome.storage.local.set({ nbSettings: settings });
    renderMapping();
  }));

  $('presetSelect').addEventListener('change', () => {
    const p = presets[$('presetSelect').value];
    if (!p) return;
    // 날짜는 그날그날 다르므로 기존 입력값을 유지한다
    const cur = readForm();
    writeForm(Object.assign({}, p.data, { startDate: cur.startDate, endDate: cur.endDate }));
    chrome.storage.local.set({ nbDraft: readForm() });
  });
  $('presetSave').addEventListener('click', async () => {
    const form = readForm();
    const name = prompt('저장할 이름을 적어 주세요 (예: 수요일 협의회 출장)', form.type || '');
    if (!name) return;
    const data = Object.assign({}, form);
    delete data.startDate;
    delete data.endDate;
    const i = presets.findIndex(p => p.name === name);
    if (i >= 0) presets[i] = { name, data }; else presets.push({ name, data });
    await chrome.storage.local.set({ nbPresets: presets });
    renderPresets();
  });
  $('presetDelete').addEventListener('click', async () => {
    const i = $('presetSelect').value;
    if (i === '' || !confirm(`"${presets[i].name}"을(를) 지울까요?`)) return;
    presets.splice(i, 1);
    await chrome.storage.local.set({ nbPresets: presets });
    renderPresets();
  });

  $('exportBtn').addEventListener('click', exportMapping);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => e.target.files[0] && importMapping(e.target.files[0]));
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

init();
