// 나이스 페이지(모든 프레임)에서 동작하는 스크립트
// 1) 입력칸 연결(학습): 사용자가 클릭한 칸의 위치(CSS 선택자)를 저장한다.
// 2) 자동 입력: 팝업이 보낸 값을 저장된 칸에 채운다. 상신 버튼은 절대 누르지 않는다.
(() => {
  if (window.__nbLoaded) return;
  window.__nbLoaded = true;

  const IS_TOP = window === window.top;
  const FRAME_ID = location.origin + location.pathname;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();

  // ---------- 공통 도우미 ----------
  function isVisible(el) {
    if (!el || !el.getClientRects().length) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  function sameText(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return false;
    if (a === b) return true;
    // "09", "9", "9시", "09분" 같은 숫자는 같은 값으로 본다
    const na = a.replace(/(시|분)$/, ''), nb = b.replace(/(시|분)$/, '');
    return /^\d+$/.test(na) && /^\d+$/.test(nb) && Number(na) === Number(nb);
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  }

  function clickLike(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  // ---------- 선택자 만들기 ----------
  const isUnique = sel => { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  // 숫자로 시작하거나 긴 난수가 들어간 id는 접속할 때마다 바뀔 수 있어 쓰지 않는다
  const goodId = id => id && !/^\d/.test(id) && !/\d{6,}/.test(id);

  function selectorFor(el) {
    if (goodId(el.id) && isUnique('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    const name = el.getAttribute('name');
    if (name) {
      const s = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      if (isUnique(s)) return s;
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body) {
      if (goodId(cur.id)) {
        const s = ['#' + CSS.escape(cur.id), ...parts].join(' > ');
        if (isUnique(s)) return s;
      }
      let i = 1, sib = cur;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === cur.tagName) i++;
      parts.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${i})`);
      cur = cur.parentElement;
    }
    return ['body', ...parts].join(' > ');
  }

  // 화면에 보이는 칸 이름(표의 제목칸, label 등)을 찾아 연결 목록에 보여 준다
  function hintFor(el) {
    const pick = t => norm(t).slice(0, 30);
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && norm(lab.textContent)) return pick(lab.textContent);
    }
    for (const a of ['aria-label', 'title', 'placeholder']) {
      if (el.getAttribute(a)) return pick(el.getAttribute(a));
    }
    const cell = el.closest('td');
    if (cell) {
      let prev = cell.previousElementSibling;
      while (prev && !norm(prev.textContent)) prev = prev.previousElementSibling;
      if (prev) return pick(prev.textContent);
    }
    return pick(el.textContent) || el.tagName.toLowerCase();
  }

  function kindOf(el) {
    const tag = el.tagName;
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'text';
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (['checkbox', 'radio', 'button', 'submit'].includes(t)) return 'click';
      return el.readOnly ? 'click' : 'text'; // 읽기 전용 입력칸은 대개 드롭다운 표시용
    }
    if (el.isContentEditable) return 'text';
    return 'click'; // 나이스식 사용자 정의 드롭다운
  }

  // ---------- 1) 입력칸 연결(학습) ----------
  let pick = null;      // chrome.storage의 nbPick 사본
  let hoverBox = null;
  let panelHost = null;

  function isInPanel(e) {
    return panelHost && e.composedPath().includes(panelHost);
  }

  function ensureHoverBox() {
    if (hoverBox) return hoverBox;
    hoverBox = document.createElement('div');
    hoverBox.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:3px solid #f59e0b;' +
      'background:rgba(245,158,11,.15);border-radius:4px;transition:all .05s;display:none';
    document.documentElement.appendChild(hoverBox);
    return hoverBox;
  }

  function onHover(e) {
    if (!pick || isInPanel(e)) { if (hoverBox) hoverBox.style.display = 'none'; return; }
    const el = e.composedPath()[0];
    if (!(el instanceof Element)) return;
    const r = el.getBoundingClientRect();
    Object.assign(ensureHoverBox().style, {
      display: 'block', left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 'px', height: r.height + 'px'
    });
  }

  function block(e) {
    if (!pick || isInPanel(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  async function onPickClick(e) {
    if (!pick || isInPanel(e)) return;
    block(e);
    const el = e.composedPath()[0];
    if (!(el instanceof Element)) return;
    const { nbPick, nbMapping = {} } = await chrome.storage.local.get(['nbPick', 'nbMapping']);
    if (!nbPick || !nbPick.active) return;
    const key = nbPick.keys[nbPick.index];
    nbMapping[key] = { selector: selectorFor(el), kind: kindOf(el), hint: hintFor(el), frame: FRAME_ID };
    const next = nbPick.index + 1;
    const done = next >= nbPick.keys.length;
    await chrome.storage.local.set({
      nbMapping,
      nbPick: Object.assign({}, nbPick, { index: done ? nbPick.index : next, active: !done, finished: done })
    });
    flash(el);
  }

  function flash(el, color = '#22c55e', ms = 700) {
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;pointer-events:none;z-index:2147483646;border:3px solid ${color};` +
      `border-radius:4px;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width}px;height:${r.height}px`;
    document.documentElement.appendChild(box);
    setTimeout(() => box.remove(), ms);
  }

  const PICK_EVENTS = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick'];
  function setPickMode(on) {
    if (on && !window.__nbPicking) {
      window.addEventListener('mouseover', onHover, true);
      PICK_EVENTS.forEach(t => window.addEventListener(t, block, true));
      window.addEventListener('click', onPickClick, true);
      window.__nbPicking = true;
    } else if (!on && window.__nbPicking) {
      window.removeEventListener('mouseover', onHover, true);
      PICK_EVENTS.forEach(t => window.removeEventListener(t, block, true));
      window.removeEventListener('click', onPickClick, true);
      if (hoverBox) hoverBox.style.display = 'none';
      window.__nbPicking = false;
    }
  }

  // 맨 위 프레임에만 안내 패널을 띄운다(그림자 DOM으로 나이스 스타일과 분리)
  function renderPanel(state) {
    if (!IS_TOP) return;
    if (!state || (!state.active && !state.finished)) {
      if (panelHost) { panelHost.remove(); panelHost = null; }
      return;
    }
    if (!panelHost) {
      panelHost = document.createElement('div');
      panelHost.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
      panelHost.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(panelHost);
    }
    const root = panelHost.shadowRoot;
    const total = state.keys.length;
    const key = state.keys[state.index];
    const body = state.finished
      ? `<p class="big">연결이 끝났습니다.</p>
         <p>브라우저 오른쪽 위의 확장 프로그램 아이콘을 눌러 복무 내용을 입력해 보세요.</p>
         <div class="btns"><button data-act="close" class="main">닫기</button></div>`
      : `<p class="step">${state.index + 1} / ${total} 단계</p>
         <p class="big">「${state.labels[key]}」 칸을 클릭하세요</p>
         <p>${state.guides[key] || ''}</p>
         <p class="sub">화면에 이 칸이 없으면 '건너뛰기'를 누르세요.</p>
         <div class="btns">
           <button data-act="prev" ${state.index === 0 ? 'disabled' : ''}>이전</button>
           <button data-act="skip">건너뛰기</button>
           <button data-act="stop" class="main">끝내기</button>
         </div>`;
    root.innerHTML = `<style>
      .card{width:280px;font:14px/1.5 'Malgun Gothic',system-ui,sans-serif;background:#fff;color:#1e293b;
        border:2px solid #2563eb;border-radius:12px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,.25)}
      .title{font-weight:700;color:#2563eb;margin:0 0 6px}
      p{margin:4px 0}.big{font-size:16px;font-weight:700}.step{color:#64748b;font-size:12px}.sub{color:#64748b;font-size:12px}
      .btns{display:flex;gap:6px;margin-top:10px}
      button{flex:1;padding:7px 0;border:1px solid #cbd5e1;border-radius:8px;background:#f1f5f9;cursor:pointer;font:inherit}
      button.main{background:#2563eb;border-color:#2563eb;color:#fff}button:disabled{opacity:.4;cursor:default}
    </style><div class="card"><p class="title">나이스 복무 입력 도우미 · 칸 연결</p>${body}</div>`;
    root.querySelectorAll('button').forEach(b => b.addEventListener('click', () => panelAction(b.dataset.act)));
  }

  async function panelAction(act) {
    const { nbPick } = await chrome.storage.local.get('nbPick');
    if (!nbPick) return;
    if (act === 'close' || act === 'stop') return chrome.storage.local.set({ nbPick: { active: false } });
    let index = nbPick.index + (act === 'prev' ? -1 : 1);
    if (index < 0) index = 0;
    if (index >= nbPick.keys.length) {
      return chrome.storage.local.set({ nbPick: Object.assign({}, nbPick, { active: false, finished: true }) });
    }
    chrome.storage.local.set({ nbPick: Object.assign({}, nbPick, { index }) });
  }

  function applyPickState(state) {
    pick = state && state.active ? state : null;
    setPickMode(!!pick);
    renderPanel(state);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.nbPick) applyPickState(changes.nbPick.newValue);
  });
  chrome.storage.local.get('nbPick').then(({ nbPick }) => applyPickState(nbPick));

  // ---------- 2) 자동 입력 ----------
  async function fillText(el, value) {
    el.focus();
    fire(el, 'focus');
    if (el.isContentEditable) {
      el.textContent = value;
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    }
    ['input', 'keyup', 'change'].forEach(t => fire(el, t));
    el.blur();
    fire(el, 'blur');
    fire(el, 'focusout');
    const now = el.isContentEditable ? el.textContent : el.value;
    // 날짜·시각 칸은 화면에서 모양을 바꿀 수 있으니 숫자만 비교한다
    const digits = s => (s || '').replace(/\D/g, '');
    const ok = norm(now) === norm(value) || (digits(value) && digits(now) === digits(value));
    return ok ? { status: 'ok' } : { status: 'check', detail: `입력 후 칸의 값: "${now}"` };
  }

  function fillSelect(el, value) {
    const opts = [...el.options];
    let opt = opts.find(o => sameText(o.text, value) || sameText(o.value, value));
    if (!opt) {
      const partial = opts.filter(o => norm(o.text).includes(norm(value)));
      if (partial.length === 1) opt = partial[0];
    }
    if (!opt) return { status: 'fail', detail: `목록에 "${value}" 항목이 없습니다` };
    el.focus();
    el.value = opt.value;
    fire(el, 'input');
    fire(el, 'change');
    el.blur();
    return { status: 'ok' };
  }

  // 나이스식 드롭다운: 칸을 눌러 목록을 연 뒤, 같은 글자의 항목을 찾아 누른다
  function findVisibleOption(value, owner) {
    const found = [];
    for (const el of document.querySelectorAll('li,a,span,div,td,button,label,p')) {
      if (el === owner || el.contains(owner) || owner.contains(el)) continue;
      if (!sameText(el.textContent, value) || !isVisible(el)) continue;
      // 같은 글자를 가진 자식이 있으면 자식(더 안쪽 요소)을 고른다
      if ([...el.children].some(c => sameText(c.textContent, value))) continue;
      found.push(el);
    }
    return found;
  }

  async function fillClick(el, value, delay) {
    const shown = el.tagName === 'INPUT' ? el.value : el.textContent;
    if (sameText(shown, value)) return { status: 'ok', detail: '이미 선택되어 있음' };
    const before = new Set(findVisibleOption(value, el));
    clickLike(el);
    let opt = null;
    for (let i = 0; i < 4 && !opt; i++) {
      await sleep(delay);
      const now = findVisibleOption(value, el);
      opt = now.find(o => !before.has(o)) || now[now.length - 1] || null;
    }
    if (!opt) return { status: 'fail', detail: `목록을 열었지만 "${value}" 항목을 찾지 못했습니다` };
    opt.scrollIntoView({ block: 'nearest' });
    clickLike(opt);
    return { status: 'ok' };
  }

  // 팝업에서 chrome.scripting.executeScript로 부른다. 이 프레임에서 찾은 칸의 결과만 돌려준다.
  window.__nbFill = async (values, mapping, settings, opts = {}) => {
    const delay = Number(settings.delay) || 400;
    const keys = (opts.keys || Object.keys(mapping)).filter(k => mapping[k] && values[k]);
    // 복무구분을 바꾸면 아래 칸이 다시 그려질 수 있으니 가장 먼저 넣는다
    keys.sort((a, b) => (a === 'type' ? -1 : b === 'type' ? 1 : 0));
    const results = {};
    for (const key of keys) {
      const m = mapping[key];
      if (opts.strict && m.frame && m.frame !== FRAME_ID) continue;
      let el = null;
      try { el = document.querySelector(m.selector); } catch (e) { /* 잘못된 선택자 */ }
      if (!el) continue;
      try {
        el.scrollIntoView({ block: 'center' });
        const kind = el.tagName === 'SELECT' ? 'select' : m.kind;
        if (kind === 'select') results[key] = fillSelect(el, values[key]);
        else if (kind === 'click') results[key] = await fillClick(el, values[key], delay);
        else results[key] = await fillText(el, values[key]);
        flash(el, results[key].status === 'ok' ? '#22c55e' : '#ef4444', 1500);
      } catch (e) {
        results[key] = { status: 'fail', detail: String(e && e.message || e) };
      }
      await sleep(key === 'type' ? delay * 2 : delay);
    }
    return results;
  };

  // 연결된 칸이 이 프레임에 있는지 표시해 확인한다
  window.__nbHighlight = mapping => {
    const found = [];
    for (const [key, m] of Object.entries(mapping)) {
      let el = null;
      try { el = document.querySelector(m.selector); } catch (e) { /* 무시 */ }
      if (el && isVisible(el)) { flash(el, '#2563eb', 2500); found.push(key); }
    }
    return found;
  };
})();
