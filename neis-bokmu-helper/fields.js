// 팝업과 콘텐츠 스크립트가 함께 쓰는 공통 정의
// (content script에서는 같은 격리 환경을 공유하므로 var로 선언해 중복 로드에도 안전하게 둔다)
var NB_BASE_FIELDS = [
  { key: 'type', label: '복무구분', guide: '연가·조퇴·외출·출장 등을 고르는 칸' },
  { key: 'startDate', label: '시작일', guide: '기간의 시작 날짜 칸' },
  { key: 'startHour', label: '시작 시', guide: '시작 시각의 "시" 칸', time: 'split' },
  { key: 'startMin', label: '시작 분', guide: '시작 시각의 "분" 칸', time: 'split' },
  { key: 'startTime', label: '시작 시각', guide: '시작 시각 칸(시:분이 한 칸)', time: 'single' },
  { key: 'endDate', label: '종료일', guide: '기간의 종료 날짜 칸' },
  { key: 'endHour', label: '종료 시', guide: '종료 시각의 "시" 칸', time: 'split' },
  { key: 'endMin', label: '종료 분', guide: '종료 시각의 "분" 칸', time: 'split' },
  { key: 'endTime', label: '종료 시각', guide: '종료 시각 칸(시:분이 한 칸)', time: 'single' },
  { key: 'reason', label: '사유', guide: '복무 사유(내용) 칸' },
  { key: 'place', label: '행선지', guide: '행선지(장소) 칸' },
  { key: 'contact', label: '비상연락처', guide: '비상연락처 칸' }
];

var NB_TYPES = ['연가', '병가', '공가', '특별휴가', '출장', '외출', '조퇴', '지참', '41조 연수'];

var NB_DEFAULT_SETTINGS = {
  dateFormat: 'YYYY-MM-DD', // 'YYYY-MM-DD' | 'YYYYMMDD' | 'YYYY.MM.DD'
  timeMode: 'split',        // 'split'(시/분 따로) | 'HH:MM' | 'HHMM'
  delay: 400                // 칸 사이 대기 시간(ms). 화면이 느리면 늘린다.
};

// 시각 입력 방식에 맞는 필드 목록
function nbActiveFields(settings) {
  const mode = (settings && settings.timeMode) || 'split';
  return NB_BASE_FIELDS.filter(f => !f.time || (mode === 'split' ? f.time === 'split' : f.time === 'single'));
}

// 팝업의 입력값(날짜 YYYY-MM-DD, 시각 HH:MM)을 나이스 칸에 넣을 값으로 바꾼다
function nbBuildValues(form, settings) {
  const s = Object.assign({}, NB_DEFAULT_SETTINGS, settings);
  const fmtDate = d => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    if (s.dateFormat === 'YYYYMMDD') return y + m + day;
    if (s.dateFormat === 'YYYY.MM.DD') return `${y}.${m}.${day}`;
    return `${y}-${m}-${day}`;
  };
  const v = {
    type: form.type || '',
    startDate: fmtDate(form.startDate),
    endDate: fmtDate(form.endDate || form.startDate),
    reason: form.reason || '',
    place: form.place || '',
    contact: form.contact || ''
  };
  for (const side of ['start', 'end']) {
    const t = form[side + 'Time'];
    if (!t) continue;
    const [h, m] = t.split(':');
    if (s.timeMode === 'split') {
      v[side + 'Hour'] = h;
      v[side + 'Min'] = m;
    } else {
      v[side + 'Time'] = s.timeMode === 'HHMM' ? h + m : `${h}:${m}`;
    }
  }
  return v;
}
