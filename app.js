/* =======================================================
   TimeRoutine App v0.2 (2단계)
   app.js
======================================================= */

const STORAGE_KEY = "timeroutine_data_v1";
const CUSTOM_QUOTE_KEY = "timeroutine_custom_quotes";
const THEME_KEY = "timeroutine_theme";
const METAL_DARK_KEY = "timeroutine_metal_dark";


/* ===== Google Drive 자동 저장 설정 =====
   1) https://console.cloud.google.com 에서 프로젝트 생성
   2) API 및 서비스 > 라이브러리 > "Google Drive API" 사용 설정
   3) API 및 서비스 > 사용자 인증 정보 > OAuth 클라이언트 ID 만들기 (웹 애플리케이션)
   4) "승인된 자바스크립트 원본"에 이 앱이 열리는 주소를 추가
   5) 발급받은 클라이언트 ID를 아래에 붙여넣기
====================================== */

const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FILE_NAME = "timeroutine_app_backup.json";
const DRIVE_FILE_ID_KEY = "timeroutine_drive_file_id";
const DRIVE_CONNECTED_KEY = "timeroutine_drive_connected";
const DRIVE_LAST_SYNC_KEY = "timeroutine_drive_last_sync";
const BACKUP_VERSION = 2;

/* ============================= */
/* STATE                         */
/* ============================= */

let schedules = [];   // {id, date|null, repeatDays:[0-6], title, start:"HH:MM", end:"HH:MM", memo, color, tag, completed, photos:[], occurrences:{date:{completed,photos}}}
let ddays = [];        // {id, name, date:"YYYY-MM-DD", color}
let todos = [];        // {id, date:"YYYY-MM-DD", text, done}
let templates = [];    // {id, name, items:[{title,start,end,memo,color,tag}]}

let selectedDate = todayStr();   // 시간표 페이지에서 보고 있는 날짜
let calendarMonthDate = new Date();
let currentView = "rect";        // rect | list | circle | calendar
let scheduleSearchQuery = "";
let editingEventId = null;
let editingDdayId = null;
let editingEventTag = "";
let editingEventDays = [];

let completingContext = null;    // { scheduleId, dateStr }
let pendingPhoto = null;
let viewingPhotoContext = null;


let googleAccessToken = null;
let googleTokenExpiry = 0;
let googleTokenClient = null;
let googleManualConnect = false;
let driveSyncTimer = null;
let driveSyncInProgress = false;

const quotes = [
    "오늘의 작은 한 걸음이 내일의 큰 변화를 만듭니다.",
    "계획은 적는 순간 현실이 됩니다.",
    "시작이 가장 어려운 법입니다.",
    "포기하지 않는 사람이 결국 이깁니다.",
    "지금이 가장 젊은 순간입니다.",
    "하고 싶은 일은 미루지 마세요.",
    "매일 1%씩 성장하면 충분합니다.",
    "오늘을 후회 없이 살아보세요.",
    "시간을 계획하는 사람이 시간을 지배합니다.",
    "완벽한 하루보다 꾸준한 하루가 낫습니다."
];

const COLOR_PRESETS = {
    pastel: {
        name: "파스텔",
        colors: ["#A7C7E7", "#B5EAD7", "#FFDAC1", "#FFB7B2", "#E2CFEA", "#FFF1B6"]
    },
    apple: {
        name: "애플",
        colors: ["#0A84FF", "#30D158", "#FF9F0A", "#FF453A", "#BF5AF2", "#64D2FF"]
    },
    dark: {
        name: "다크",
        colors: ["#3E5C76", "#2E4034", "#5C4033", "#5C2E2E", "#3D2E5C", "#2E3D5C"]
    },
    vivid: {
        name: "비비드",
        colors: ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#AF52DE"]
    },
    mono: {
        name: "모노톤",
        colors: ["#4B5563", "#6B7280", "#9CA3AF", "#D1D5DB", "#374151", "#1F2937"]
    }
};

let currentEventPreset = "apple";
let selectedEventColor = COLOR_PRESETS.apple.colors[0];

/* ============================= */
/* UTIL                          */
/* ============================= */

function todayStr(d){
    const dt = d ? new Date(d) : new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function uid(){
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function minutesFromHHMM(hhmm){
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

function formatDateLabel(dateStr){
    const d = new Date(dateStr + "T00:00:00");
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return {
        main: `${d.getMonth() + 1}월 ${d.getDate()}일`,
        sub: `${days[d.getDay()]}요일`
    };
}

/* 해당 날짜가 포함된 주의 월요일 */
function getMondayOf(dateStr){
    const d = new Date(dateStr + "T00:00:00");
    const day = d.getDay(); // 0=일 .. 6=토
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    return d;
}

/* 해당 날짜가 포함된 주의 월~일 날짜 문자열 7개 */
function getWeekDates(dateStr){
    const monday = getMondayOf(dateStr);
    const days = [];
    for(let i = 0; i < 7; i++){
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push(todayStr(d));
    }
    return days;
}

function formatWeekRangeLabel(dateStr){
    const week = getWeekDates(dateStr);
    const start = new Date(week[0] + "T00:00:00");
    const end = new Date(week[6] + "T00:00:00");
    const sameMonth = start.getMonth() === end.getMonth();
    const startLabel = `${start.getMonth() + 1}월 ${start.getDate()}일`;
    const endLabel = sameMonth ? `${end.getDate()}일` : `${end.getMonth() + 1}월 ${end.getDate()}일`;
    return { main: `${startLabel} - ${endLabel}`, sub: "이번 주" };
}

function escapeHtml(str){
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message, opts = {}){
    const container = document.getElementById("toastContainer");
    if(!container) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<span>${opts.icon || "✅"}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(el);
    setTimeout(() => {
        el.style.transition = "opacity .3s ease";
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 300);
    }, 2600);
}

/* ============================= */
/* STORAGE                       */
/* ============================= */

function loadData(){
    try{
        const raw = localStorage.getItem(STORAGE_KEY);
        if(!raw) return;
        const parsed = JSON.parse(raw);
        schedules = parsed.schedules || [];
        ddays = parsed.ddays || [];
        todos = parsed.todos || [];
        templates = parsed.templates || [];

        // 이전 버전 데이터와의 호환을 위한 기본값 보정
        schedules.forEach(s => {
            if(s.tag === undefined) s.tag = "";
            if(s.repeatDays === undefined) s.repeatDays = [];
            if(s.completed === undefined) s.completed = false;
            if(s.photos === undefined) s.photos = [];
            if(s.occurrences === undefined) s.occurrences = {};
        });
    }catch(e){
        console.error("데이터 로드 실패", e);
    }
}

function saveData(){
    try{
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ schedules, ddays, todos, templates }));
    }catch(e){
        console.error("데이터 저장 실패", e);
    }
    scheduleDriveSync();
}

function loadCustomQuotes(){
    try{
        return JSON.parse(localStorage.getItem(CUSTOM_QUOTE_KEY)) || [];
    }catch(e){
        return [];
    }
}

function saveCustomQuotes(list){
    localStorage.setItem(CUSTOM_QUOTE_KEY, JSON.stringify(list));
}

/* ============================= */
/* DOM REFERENCES                */
/* ============================= */

const pages = document.querySelectorAll(".page");
const navButtons = document.querySelectorAll(".navButton");
const addButton = document.getElementById("addButton");

const themeButton = document.getElementById("themeButton");
const themeOptionButtons = document.querySelectorAll(".themeOption");
const metalDarkSettingItem = document.getElementById("metalDarkSettingItem");
const metalDarkToggle = document.getElementById("metalDarkToggle");

const todayDate = document.getElementById("todayDate");
const heroClock = document.getElementById("heroClock");
const heroSeconds = document.getElementById("heroSeconds");
const weatherEmoji = document.getElementById("weatherEmoji");
const weatherTemp = document.getElementById("weatherTemp");
const weatherDesc = document.getElementById("weatherDesc");
const weatherLoc = document.getElementById("weatherLoc");

const ddayHeaderButton = document.getElementById("ddayHeaderButton");
const ddayHeaderText = document.getElementById("ddayHeaderText");
const ddayListModal = document.getElementById("ddayListModal");
const ddayListWrap = document.getElementById("ddayListWrap");
const ddayListAddButton = document.getElementById("ddayListAddButton");
const ddayListCloseButton = document.getElementById("ddayListCloseButton");

const todayQuote = document.getElementById("todayQuote");
const addQuoteButton = document.getElementById("addQuoteButton");
const quoteModal = document.getElementById("quoteModal");
const quoteTextInput = document.getElementById("quoteTextInput");
const quoteAddSaveButton = document.getElementById("quoteAddSaveButton");
const quoteCloseButton = document.getElementById("quoteCloseButton");
const motivateButton = document.getElementById("motivateButton");

const viewTabs = document.querySelectorAll(".viewTab");
const rectView = document.getElementById("rectView");
const listView = document.getElementById("listView");
const rectTimetable = document.getElementById("rectTimetable");
const scheduleListWrap = document.getElementById("scheduleListWrap");
const scheduleDateLabel = document.getElementById("scheduleDateLabel");
const scheduleDaySub = document.getElementById("scheduleDaySub");
const prevDayButton = document.getElementById("prevDayButton");
const nextDayButton = document.getElementById("nextDayButton");
const gotoTodayButton = document.getElementById("gotoTodayButton");

const eventModal = document.getElementById("eventModal");
const eventModalTitle = document.getElementById("eventModalTitle");
const eventTitleInput = document.getElementById("eventTitleInput");
const eventStartInput = document.getElementById("eventStartInput");
const eventEndInput = document.getElementById("eventEndInput");
const eventMemoInput = document.getElementById("eventMemoInput");
const eventPresetRow = document.getElementById("eventPresetRow");
const eventColorRow = document.getElementById("eventColorRow");
const eventColorPicker = document.getElementById("eventColorPicker");
const eventColorHex = document.getElementById("eventColorHex");
const eventSaveButton = document.getElementById("eventSaveButton");
const eventCancelButton = document.getElementById("eventCancelButton");
const eventDeleteRow = document.getElementById("eventDeleteRow");
const eventDeleteButton = document.getElementById("eventDeleteButton");

const ddayModal = document.getElementById("ddayModal");
const ddayModalTitle = document.getElementById("ddayModalTitle");
const ddayNameInput = document.getElementById("ddayNameInput");
const ddayDateInput = document.getElementById("ddayDateInput");
const ddaySaveButton = document.getElementById("ddaySaveButton");
const ddayCancelButton = document.getElementById("ddayCancelButton");
const ddayDeleteRow = document.getElementById("ddayDeleteRow");
const ddayDeleteButton = document.getElementById("ddayDeleteButton");

const todoInput = document.getElementById("todoInput");
const todoList = document.getElementById("todoList");
const todoModal = document.getElementById("todoModal");
const todoModalInput = document.getElementById("todoModalInput");
const todoModalSaveButton = document.getElementById("todoModalSaveButton");
const todoModalCancelButton = document.getElementById("todoModalCancelButton");

const googleDriveButton = document.getElementById("googleDriveButton");
const googleDriveStatus = document.getElementById("googleDriveStatus");
const googleDriveTime = document.getElementById("googleDriveTime");
const exportButton = document.getElementById("exportButton");
const importButton = document.getElementById("importButton");
const importFile = document.getElementById("importFile");

const scheduleSearchInput = document.getElementById("scheduleSearchInput");
const searchAddButton = document.getElementById("searchAddButton");
const captureArea = document.getElementById("captureArea");

const circleView = document.getElementById("circleView");
const clockSvg = document.getElementById("clockSvg");

const calendarView = document.getElementById("calendarView");
const calendarMonthLabel = document.getElementById("calendarMonthLabel");
const calendarGrid = document.getElementById("calendarGrid");
const calPrevMonthButton = document.getElementById("calPrevMonthButton");
const calNextMonthButton = document.getElementById("calNextMonthButton");

const eventTagRow = document.getElementById("eventTagRow");
const eventWeekdayRow = document.getElementById("eventWeekdayRow");
const eventCompleteRow = document.getElementById("eventCompleteRow");
const eventCompleteButton = document.getElementById("eventCompleteButton");

const saveTemplateButton = document.getElementById("saveTemplateButton");
const templateChipRow = document.getElementById("templateChipRow");

const celebrateModal = document.getElementById("celebrateModal");
const celebrateTitle = document.getElementById("celebrateTitle");
const photoUploadArea = document.getElementById("photoUploadArea");
const photoInput = document.getElementById("photoInput");
const photoPlaceholder = document.getElementById("photoPlaceholder");
const photoPreview = document.getElementById("photoPreview");
const celebrateSaveButton = document.getElementById("celebrateSaveButton");
const celebrateSkipButton = document.getElementById("celebrateSkipButton");

const photoViewModal = document.getElementById("photoViewModal");
const photoViewImage = document.getElementById("photoViewImage");
const photoViewTitle = document.getElementById("photoViewTitle");
const closePhotoView = document.getElementById("closePhotoView");
const deletePhotoButton = document.getElementById("deletePhotoButton");

/* ============================= */
/* PAGE NAVIGATION                */
/* ============================= */

let currentPage = "homePage";

function goToPage(pageId){
    currentPage = pageId;
    pages.forEach(p => p.classList.toggle("active", p.id === pageId));
    navButtons.forEach(b => b.classList.toggle("active", b.dataset.page === pageId));
    window.scrollTo(0, 0);
    if(pageId === "schedulePage" && currentView === "rect"){
        renderRectTimetable();
    }
}

navButtons.forEach(btn => {
    btn.onclick = () => goToPage(btn.dataset.page);
});

addButton.onclick = () => {
    if(currentPage === "schedulePage"){
        openEventModal();
    }else if(currentPage === "homePage"){
        openDdayModal();
    }else if(currentPage === "todoPage"){
        openTodoModal();
    }else{
        goToPage("schedulePage");
        openEventModal();
    }
};

/* ============================= */
/* CLOCK / DATE                  */
/* ============================= */

function updateClock(){
    const now = new Date();
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    todayDate.textContent = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${days[now.getDay()]}요일`;
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    heroClock.firstChild.textContent = `${hh}:${mm}`;
    heroSeconds.textContent = ss;

    if(currentPage === "schedulePage" && currentView === "rect"){
        updateNowLine();
    }
}

setInterval(updateClock, 1000);

/* ============================= */
/* WEATHER (Open-Meteo)          */
/* ============================= */

const WEATHER_ICONS = {
    0: ["☀️", "맑음"], 1: ["🌤️", "대체로 맑음"], 2: ["⛅", "구름 조금"], 3: ["☁️", "흐림"],
    45: ["🌫️", "안개"], 48: ["🌫️", "안개"],
    51: ["🌦️", "이슬비"], 53: ["🌦️", "이슬비"], 55: ["🌦️", "이슬비"],
    61: ["🌧️", "비"], 63: ["🌧️", "비"], 65: ["🌧️", "강한 비"],
    71: ["🌨️", "눈"], 73: ["🌨️", "눈"], 75: ["❄️", "폭설"],
    80: ["🌦️", "소나기"], 81: ["🌦️", "소나기"], 82: ["⛈️", "강한 소나기"],
    95: ["⛈️", "뇌우"], 96: ["⛈️", "뇌우"], 99: ["⛈️", "뇌우"]
};

function loadWeather(){
    if(!navigator.geolocation){
        weatherDesc.textContent = "위치 정보를 사용할 수 없어요";
        return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        try{
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`);
            const data = await res.json();
            const code = data.current.weather_code;
            const icon = WEATHER_ICONS[code] || ["🌡️", "-"];
            weatherEmoji.textContent = icon[0];
            weatherTemp.textContent = `${Math.round(data.current.temperature_2m)}°`;
            weatherDesc.textContent = icon[1];
            try{
                const geoRes = await fetch(`https://api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}`);
                if(geoRes.ok){
                    const geoData = await geoRes.json();
                    if(geoData && geoData.name){
                        weatherLoc.textContent = geoData.name;
                    }
                }
            }catch(e){ /* 위치 이름은 선택 정보라 실패해도 무시 */ }
        }catch(e){
            weatherDesc.textContent = "날씨를 불러오지 못했어요";
        }
    }, () => {
        weatherDesc.textContent = "위치 권한이 필요해요";
    });
}

/* ============================= */
/* QUOTE                         */
/* ============================= */

function pickRandomQuote(){
    const custom = loadCustomQuotes();
    const pool = [...quotes, ...custom];
    const idx = Math.floor(Math.random() * pool.length);
    todayQuote.textContent = pool[idx];
}

addQuoteButton.onclick = () => {
    quoteTextInput.value = "";
    quoteModal.classList.add("show");
};

quoteCloseButton.onclick = () => quoteModal.classList.remove("show");

quoteAddSaveButton.onclick = () => {
    const text = quoteTextInput.value.trim();
    if(!text){
        showToast("문구를 입력해주세요.", { icon: "⚠️" });
        return;
    }
    const list = loadCustomQuotes();
    list.push(text);
    saveCustomQuotes(list);
    quoteModal.classList.remove("show");
    showToast("나만의 문구가 추가됐어요.");
    todayQuote.textContent = text;
};

motivateButton.onclick = () => {
    const keywords = ["study motivation", "workout motivation", "self improvement motivation playlist"];
    const q = keywords[Math.floor(Math.random() * keywords.length)];
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, "_blank");
};

/* ============================= */
/* COLOR PICKER (공용)            */
/* ============================= */

function renderColorRow(container, preset, selectedColor, onPick){
    container.innerHTML = "";
    COLOR_PRESETS[preset].colors.forEach(color => {
        const dot = document.createElement("button");
        dot.className = "colorDot" + (color === selectedColor ? " active" : "");
        dot.style.background = color;
        dot.onclick = () => onPick(color);
        container.appendChild(dot);
    });
}

function renderPresetRow(container, currentPreset, onPick){
    container.innerHTML = "";
    Object.keys(COLOR_PRESETS).forEach(key => {
        const chip = document.createElement("button");
        chip.className = "presetChip" + (key === currentPreset ? " active" : "");
        chip.textContent = COLOR_PRESETS[key].name;
        chip.onclick = () => onPick(key);
        container.appendChild(chip);
    });
}

/* ============================= */
/* D-DAY                          */
/* ============================= */

function ddayRemainText(dateStr){
    const target = new Date(dateStr + "T00:00:00");
    const today = new Date(todayStr() + "T00:00:00");
    const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
    if(diff === 0) return "D-DAY";
    if(diff > 0) return `D-${diff}`;
    return `D+${Math.abs(diff)}`;
}

function renderDdays(){
    // 헤더 버튼: 가장 가까운(지나지 않은) 디데이 하나만 짧게 표시
    const upcoming = [...ddays]
        .filter(d => d.date >= todayStr())
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    const nearest = upcoming[0] || [...ddays].sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    if(ddayHeaderText){
        ddayHeaderText.textContent = nearest ? `${nearest.name} ${ddayRemainText(nearest.date)}` : "디데이";
    }

    // 리스트 모달: 전체 디데이 목록 (테마 통일, 색상 없음)
    if(!ddayListWrap) return;
    ddayListWrap.innerHTML = "";
    if(ddays.length === 0){
        ddayListWrap.innerHTML = `<div class="ddayEmpty">아래 버튼으로 디데이를 추가해보세요.</div>`;
        return;
    }
    const sorted = [...ddays].sort((a, b) => new Date(a.date) - new Date(b.date));
    sorted.forEach(d => {
        const row = document.createElement("div");
        row.className = "ddayRow";
        row.innerHTML = `
            <div>
                <div class="ddayRowName">${escapeHtml(d.name)}</div>
                <div class="ddayRowDate">${d.date}</div>
            </div>
            <div class="ddayRowNum">${ddayRemainText(d.date)}</div>
        `;
        row.onclick = () => openDdayModal(d.id);
        ddayListWrap.appendChild(row);
    });
}

function openDdayModal(id){
    editingDdayId = id || null;
    if(id){
        const d = ddays.find(x => x.id === id);
        if(!d) return;
        ddayModalTitle.textContent = "디데이 수정";
        ddayNameInput.value = d.name;
        ddayDateInput.value = d.date;
        ddayDeleteRow.classList.remove("hidden");
    }else{
        ddayModalTitle.textContent = "새 디데이";
        ddayNameInput.value = "";
        ddayDateInput.value = todayStr();
        ddayDeleteRow.classList.add("hidden");
    }
    ddayListModal.classList.remove("show");
    ddayModal.classList.add("show");
}

ddayCancelButton.onclick = () => ddayModal.classList.remove("show");

ddaySaveButton.onclick = () => {
    const name = ddayNameInput.value.trim();
    const date = ddayDateInput.value;
    if(!name || !date){
        showToast("이름과 날짜를 입력해주세요.", { icon: "⚠️" });
        return;
    }
    if(editingDdayId){
        const d = ddays.find(x => x.id === editingDdayId);
        d.name = name; d.date = date;
    }else{
        ddays.push({ id: uid(), name, date });
    }
    saveData();
    renderDdays();
    ddayModal.classList.remove("show");
    showToast("디데이가 저장됐어요.");
};

ddayDeleteButton.onclick = () => {
    if(!editingDdayId) return;
    if(!confirm("이 디데이를 삭제할까요?")) return;
    ddays = ddays.filter(x => x.id !== editingDdayId);
    saveData();
    renderDdays();
    ddayModal.classList.remove("show");
    showToast("디데이가 삭제됐어요.");
};

if(ddayHeaderButton){
    ddayHeaderButton.onclick = () => {
        renderDdays();
        ddayListModal.classList.add("show");
    };
}

if(ddayListAddButton){
    ddayListAddButton.onclick = () => openDdayModal();
}

if(ddayListCloseButton){
    ddayListCloseButton.onclick = () => ddayListModal.classList.remove("show");
}

/* ============================= */
/* SCHEDULE (시간표) - 공통         */
/* ============================= */

function isRecurring(s){
    return Array.isArray(s.repeatDays) && s.repeatDays.length > 0;
}

function getOccState(s, dateStr){
    if(isRecurring(s)){
        const occ = (s.occurrences && s.occurrences[dateStr]) || {};
        return { completed: !!occ.completed, photos: occ.photos || [] };
    }
    return { completed: !!s.completed, photos: s.photos || [] };
}

function setOccState(s, dateStr, patch){
    if(isRecurring(s)){
        if(!s.occurrences) s.occurrences = {};
        const current = s.occurrences[dateStr] || { completed: false, photos: [] };
        s.occurrences[dateStr] = Object.assign({}, current, patch);
    }else{
        Object.assign(s, patch);
    }
    saveData();
}

/* 특정 날짜에 표시되어야 할 일정 (반복 일정 포함, 필터 적용 전) */
function schedulesForDate(dateStr){
    const weekday = new Date(dateStr + "T00:00:00").getDay();

    return schedules
        .filter(s => isRecurring(s) ? s.repeatDays.includes(weekday) : s.date === dateStr)
        .map(s => {
            const occ = getOccState(s, dateStr);
            return Object.assign({}, s, { _occDate: dateStr, _completed: occ.completed, _photos: occ.photos });
        })
        .sort((a, b) => minutesFromHHMM(a.start) - minutesFromHHMM(b.start));
}

/* 검색어 필터까지 적용된 목록 */
function visibleSchedulesForDate(dateStr){
    let list = schedulesForDate(dateStr);

    if(scheduleSearchQuery){
        const q = scheduleSearchQuery.toLowerCase();
        list = list.filter(s =>
            (s.title || "").toLowerCase().includes(q) ||
            (s.memo || "").toLowerCase().includes(q)
        );
    }

    return list;
}

function hasSchedulesOnDate(dateStr){
    return schedulesForDate(dateStr).length > 0;
}

function renderDateNav(){
    const label = currentView === "rect" ? formatWeekRangeLabel(selectedDate) : formatDateLabel(selectedDate);
    scheduleDateLabel.childNodes[0].textContent = label.main + " ";
    scheduleDaySub.textContent = label.sub;

    if(currentView === "rect"){
        const thisWeek = getWeekDates(selectedDate);
        gotoTodayButton.classList.toggle("hidden", thisWeek.includes(todayStr()));
    }else{
        gotoTodayButton.classList.toggle("hidden", selectedDate === todayStr());
    }
}

prevDayButton.onclick = () => { changeSelectedDate(-1); };
nextDayButton.onclick = () => { changeSelectedDate(1); };
gotoTodayButton.onclick = () => {
    selectedDate = todayStr();
    renderSchedulePage();
};

function changeSelectedDate(delta){
    const step = currentView === "rect" ? delta * 7 : delta;
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + step);
    selectedDate = todayStr(d);
    renderSchedulePage();
}

function renderSchedulePage(){

    const isCalendar = currentView === "calendar";

    document.getElementById("dateNavBar").classList.toggle("hidden", isCalendar);
    gotoTodayButton.classList.toggle("hidden", isCalendar || selectedDate === todayStr());
    captureArea.classList.toggle("hidden", isCalendar);
    calendarView.classList.toggle("hidden", !isCalendar);

    renderDateNav();

    if(currentView === "rect"){
        renderRectTimetable();
    }else if(currentView === "list"){
        renderListView();
    }else if(currentView === "circle"){
        renderCircleTimetable();
    }else if(currentView === "calendar"){
        renderCalendar();
    }

    renderTemplateChips();
}

viewTabs.forEach(tab => {
    tab.onclick = () => {
        currentView = tab.dataset.view;
        viewTabs.forEach(t => t.classList.toggle("active", t === tab));
        rectView.classList.toggle("hidden", currentView !== "rect");
        listView.classList.toggle("hidden", currentView !== "list");
        circleView.classList.toggle("hidden", currentView !== "circle");
        renderSchedulePage();
    };
});

/* ----- 검색 / 태그 필터 ----- */

if(scheduleSearchInput){
    scheduleSearchInput.addEventListener("input", () => {
        scheduleSearchQuery = scheduleSearchInput.value.trim();
        renderSchedulePage();
    });
}

if(searchAddButton){
    searchAddButton.onclick = () => openEventModal();
}

/* ============================= */
/* 사각형(세로) 시간표              */
/* ============================= */

const WEEK_DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

const DEFAULT_ROW_HEIGHT = 24;   // 시간당 고정 높이(px) - 화면에 맞춘 자동 조절 없이 항상 이 값 사용
const DEFAULT_RANGE_START_HOUR = 0;
const DEFAULT_RANGE_END_HOUR = 24;

let currentRowHeight = DEFAULT_ROW_HEIGHT;
let currentRangeStartHour = DEFAULT_RANGE_START_HOUR;
let currentRangeEndHour = DEFAULT_RANGE_END_HOUR;

function formatHourAmPm(h){
    const period = h < 12 ? "AM" : "PM";
    let hour12 = h % 12;
    if(hour12 === 0) hour12 = 12;
    return `${period} ${hour12}:00`;
}

/* 하루 24시간 전체를 항상 표시 */
function computeWeekHourRange(weekDates){
    return { startHour: 0, endHour: 24 };
}

function renderRectTimetable(){
    rectTimetable.innerHTML = "";

    const weekDates = getWeekDates(selectedDate);
    const today = todayStr();

    const { startHour, endHour } = computeWeekHourRange(weekDates);
    currentRangeStartHour = startHour;
    currentRangeEndHour = endHour;
    const hourCount = endHour - startHour;
    const rowHeight = DEFAULT_ROW_HEIGHT;
    currentRowHeight = rowHeight;
    const totalHeight = hourCount * rowHeight;

    const grid = document.createElement("div");
    grid.className = "weekGrid";
    grid.style.setProperty("--row-height", `${rowHeight}px`);

    // 좌상단 빈 칸 (명시적 위치 지정으로 요일이 밀리는 문제 방지)
    const corner = document.createElement("div");
    corner.className = "weekCorner";
    corner.style.gridColumn = "1";
    corner.style.gridRow = "1";
    grid.appendChild(corner);

    // 요일 헤더 7개
    weekDates.forEach((dateStr, i) => {
        const d = new Date(dateStr + "T00:00:00");
        const dow = d.getDay();
        const head = document.createElement("div");
        head.className = "weekDayHead"
            + (dateStr === today ? " today" : "")
            + (dow === 0 ? " sunday" : "")
            + (dow === 6 ? " saturday" : "");
        head.style.gridColumn = String(i + 2);
        head.style.gridRow = "1";
        head.innerHTML = `${WEEK_DAY_LABELS[dow]}<span class="weekDayNum">${d.getDate()}</span>`;
        grid.appendChild(head);
    });

    // 시간 라벨 거터
    const gutter = document.createElement("div");
    gutter.className = "weekHourGutter";
    gutter.style.gridColumn = "1";
    gutter.style.gridRow = "2";
    gutter.style.height = `${totalHeight}px`;
    for(let h = startHour; h < endHour; h++){
        const label = document.createElement("div");
        label.className = "weekHourLabel";
        label.style.top = `${(h - startHour) * rowHeight}px`;
        label.textContent = formatHourAmPm(h);
        gutter.appendChild(label);
    }
    grid.appendChild(gutter);

    // 요일별 컬럼 7개
    weekDates.forEach((dateStr, i) => {

        const col = document.createElement("div");
        col.className = "weekDayCol" + (dateStr === today ? " today" : "");
        col.dataset.date = dateStr;
        col.style.gridColumn = String(i + 2);
        col.style.gridRow = "2";
        col.style.height = `${totalHeight}px`;

        col.onclick = (e) => {
            if(e.target !== col) return;
            const rect = col.getBoundingClientRect();
            const y = e.clientY - rect.top;
            let startMin = startHour * 60 + Math.round(((y / rowHeight) * 60) / 30) * 30;
            startMin = Math.max(startHour * 60, Math.min(endHour * 60 - 30, startMin));
            const startLabel = `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`;
            openEventModal(null, startLabel, dateStr);
        };

        const daySchedules = visibleSchedulesForDate(dateStr);
        daySchedules.forEach(s => {
            const start = minutesFromHHMM(s.start);
            let end = minutesFromHHMM(s.end);
            if(end <= start) end = start + 30;
            const topPx = (start - startHour * 60) * (rowHeight / 60) + 11;
            const heightPx = Math.max((end - start) * (rowHeight / 60), 16);
            const block = document.createElement("div");
            block.className = "scheduleBlock" + (heightPx <= 24 ? " tiny" : "") + (s._completed ? " completed" : "");
            block.style.top = `${topPx}px`;
            block.style.height = `${heightPx}px`;
            block.style.setProperty("--block-color", s.color);
            const blockTitle = `${s._completed ? "✅ " : ""}${escapeHtml(s.title)}`;
            block.innerHTML = `
                <div class="sbTitle">${blockTitle}</div>
                <div class="sbTooltip">
                    <div class="sbTooltipTitle">${blockTitle}</div>
                    <div class="sbTooltipTime"><span class="sbTooltipDot" style="--dot-color:${s.color}"></span>${s.start}-${s.end}</div>
                </div>
            `;
            block.onclick = (ev) => {
                ev.stopPropagation();
                openEventModal(s.id, null, dateStr);
            };
            col.appendChild(block);
        });

        grid.appendChild(col);

    });

    rectTimetable.appendChild(grid);

    updateNowLine();
}

function updateNowLine(){
    if(currentView !== "rect") return;

    const grid = rectTimetable.querySelector(".weekGrid");
    if(!grid) return;

    grid.querySelectorAll(".weekNowLine").forEach(el => el.remove());

    const today = todayStr();
    const todayCol = grid.querySelector(`.weekDayCol[data-date="${today}"]`);
    if(!todayCol) return;

    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if(minutes < currentRangeStartHour * 60 || minutes > currentRangeEndHour * 60) return;

    const topPx = (minutes - currentRangeStartHour * 60) * (currentRowHeight / 60);

    const line = document.createElement("div");
    line.className = "weekNowLine";
    line.style.top = `${topPx}px`;
    todayCol.appendChild(line);
}

/* ============================= */
/* 리스트 보기                     */
/* ============================= */

function renderListView(){
    scheduleListWrap.innerHTML = "";
    const daySchedules = visibleSchedulesForDate(selectedDate);
    if(daySchedules.length === 0){
        scheduleListWrap.innerHTML = `<div class="scheduleEmpty">이 날의 일정이 없어요. + 버튼으로 추가해보세요.</div>`;
        return;
    }
    daySchedules.forEach(s => {
        const item = document.createElement("div");
        item.className = "scheduleListItem" + (s._completed ? " completed" : "");
        item.style.setProperty("--item-color", s.color);

        const thumb = s._photos && s._photos[0]
            ? `<img class="scheduleThumb" src="${s._photos[0]}" alt="기록 사진">`
            : "";

        item.innerHTML = `
            <div class="sliBar"></div>
            <div class="sliBody">
                <div class="sliTitle">${s._completed ? "✅ " : ""}${escapeHtml(s.title)}</div>
                <div class="sliTime">${s.start} - ${s.end}${isRecurring(s) ? " · 반복" : ""}</div>
                ${s.tag ? `<div class="sliMemo">#${escapeHtml(s.tag)}</div>` : ""}
                ${s.memo ? `<div class="sliMemo">${escapeHtml(s.memo)}</div>` : ""}
            </div>
            ${thumb}
            <button class="scheduleCheckBtn ${s._completed ? "done" : ""}">✓</button>
        `;

        item.querySelector(".sliBody").onclick = () => openEventModal(s.id, null, s._occDate);

        const thumbEl = item.querySelector(".scheduleThumb");
        if(thumbEl) thumbEl.onclick = (e) => { e.stopPropagation(); openPhotoView(s); };

        item.querySelector(".scheduleCheckBtn").onclick = (e) => {
            e.stopPropagation();
            handleCompleteToggle(s);
        };

        scheduleListWrap.appendChild(item);
    });
}

/* ============================= */
/* 일정 추가 / 수정 모달             */
/* ============================= */

function isValidHexColor(str){
    return /^#([0-9a-fA-F]{6})$/.test(str);
}

function setupEventColorPicker(){
    renderPresetRow(eventPresetRow, currentEventPreset, (key) => {
        currentEventPreset = key;
        selectedEventColor = COLOR_PRESETS[key].colors[0];
        setupEventColorPicker();
    });
    renderColorRow(eventColorRow, currentEventPreset, selectedEventColor, (c) => {
        selectedEventColor = c;
        setupEventColorPicker();
    });
    if(eventColorPicker) eventColorPicker.value = selectedEventColor;
    if(eventColorHex) eventColorHex.value = selectedEventColor.toUpperCase();
}

if(eventColorPicker){
    eventColorPicker.addEventListener("input", () => {
        selectedEventColor = eventColorPicker.value;
        eventColorHex.value = selectedEventColor.toUpperCase();
        renderPresetRow(eventPresetRow, currentEventPreset, (key) => {
            currentEventPreset = key;
            selectedEventColor = COLOR_PRESETS[key].colors[0];
            setupEventColorPicker();
        });
        renderColorRow(eventColorRow, currentEventPreset, selectedEventColor, (c) => {
            selectedEventColor = c;
            setupEventColorPicker();
        });
    });
}

if(eventColorHex){
    eventColorHex.addEventListener("change", () => {
        let value = eventColorHex.value.trim();
        if(value && value[0] !== "#") value = `#${value}`;
        if(isValidHexColor(value)){
            selectedEventColor = value;
            setupEventColorPicker();
        }else{
            showToast("올바른 색상 코드가 아니에요. 예: #4F8CFF", { icon: "⚠️" });
            eventColorHex.value = selectedEventColor.toUpperCase();
        }
    });
}

let editingEventOccDate = null;

function renderEventTagPicker(){
    eventTagRow.querySelectorAll("button").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tag === editingEventTag);
        btn.onclick = () => {
            editingEventTag = (editingEventTag === btn.dataset.tag) ? "" : btn.dataset.tag;
            renderEventTagPicker();
        };
    });
}

function renderEventWeekdayPicker(){
    eventWeekdayRow.querySelectorAll("button").forEach(btn => {
        const day = Number(btn.dataset.day);
        btn.classList.toggle("active", editingEventDays.includes(day));
        btn.onclick = () => {
            if(editingEventDays.includes(day)){
                editingEventDays = editingEventDays.filter(d => d !== day);
            }else{
                editingEventDays.push(day);
            }
            renderEventWeekdayPicker();
        };
    });
}

function openEventModal(id, prefillStart, occDate){
    editingEventId = id || null;
    editingEventOccDate = occDate || selectedDate;

    if(id){
        const s = schedules.find(x => x.id === id);
        if(!s) return;
        eventModalTitle.textContent = "일정 수정";
        eventTitleInput.value = s.title;
        eventStartInput.value = s.start;
        eventEndInput.value = s.end;
        eventMemoInput.value = s.memo || "";
        selectedEventColor = s.color;
        editingEventTag = s.tag || "";
        editingEventDays = s.repeatDays ? [...s.repeatDays] : [];
        eventDeleteRow.classList.remove("hidden");

        const alreadyDone = getOccState(s, editingEventOccDate).completed;
        eventCompleteRow.classList.toggle("hidden", alreadyDone);
    }else{
        eventModalTitle.textContent = "새 일정";
        eventTitleInput.value = "";
        eventStartInput.value = prefillStart || "09:00";
        const [h, m] = (prefillStart || "09:00").split(":").map(Number);
        const endH = (h + 1) % 24;
        eventEndInput.value = `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        eventMemoInput.value = "";
        selectedEventColor = COLOR_PRESETS[currentEventPreset].colors[0];
        editingEventTag = "";
        editingEventDays = [];
        eventDeleteRow.classList.add("hidden");
        eventCompleteRow.classList.add("hidden");
    }

    setupEventColorPicker();
    renderEventTagPicker();
    renderEventWeekdayPicker();
    eventModal.classList.add("show");
}

eventCancelButton.onclick = () => eventModal.classList.remove("show");

eventSaveButton.onclick = () => {
    const title = eventTitleInput.value.trim();
    const start = eventStartInput.value;
    const end = eventEndInput.value;
    const memo = eventMemoInput.value.trim();

    if(!title || !start || !end){
        showToast("제목과 시간을 입력해주세요.", { icon: "⚠️" });
        return;
    }
    if(minutesFromHHMM(end) <= minutesFromHHMM(start)){
        showToast("종료 시간은 시작 시간보다 늦어야 해요.", { icon: "⏰" });
        return;
    }

    if(editingEventId){
        const s = schedules.find(x => x.id === editingEventId);
        s.title = title; s.start = start; s.end = end; s.memo = memo; s.color = selectedEventColor;
        s.tag = editingEventTag;
        s.repeatDays = [...editingEventDays];
        if(s.repeatDays.length === 0 && !s.date) s.date = selectedDate;
    }else{
        const isRepeat = editingEventDays.length > 0;
        schedules.push({
            id: uid(),
            date: isRepeat ? null : (editingEventOccDate || selectedDate),
            repeatDays: isRepeat ? [...editingEventDays] : [],
            title, start, end, memo,
            color: selectedEventColor,
            tag: editingEventTag,
            completed: false,
            photos: [],
            occurrences: {}
        });
    }
    if(editingEventOccDate){
        selectedDate = editingEventOccDate;
    }

    saveData();
    renderSchedulePage();
    eventModal.classList.remove("show");
    showToast("일정이 저장됐어요.");
};

eventDeleteButton.onclick = () => {
    if(!editingEventId) return;
    if(!confirm("이 일정을 삭제할까요?")) return;
    schedules = schedules.filter(x => x.id !== editingEventId);
    saveData();
    renderSchedulePage();
    eventModal.classList.remove("show");
    showToast("일정이 삭제됐어요.");
};

eventCompleteButton.onclick = () => {
    if(!editingEventId) return;
    const s = schedules.find(x => x.id === editingEventId);
    if(!s) return;
    eventModal.classList.remove("show");
    handleCompleteToggle(Object.assign({}, s, { _occDate: editingEventOccDate }));
};

/* ============================= */
/* TODO (오늘의 할 일)              */
/* ============================= */

function todosForToday(){
    return todos.filter(t => t.date === todayStr());
}

function renderTodos(){
    const list = todosForToday();
    todoList.innerHTML = "";
    if(list.length === 0){
        todoList.innerHTML = `<div class="todoEmpty">오늘의 할 일을 추가해보세요.</div>`;
        return;
    }
    list.forEach(t => {
        const item = document.createElement("div");
        item.className = "todoItem" + (t.done ? " done" : "");
        item.innerHTML = `
            <button class="todoCheck">✓</button>
            <div class="todoText">${escapeHtml(t.text)}</div>
            <button class="todoDelete">✕</button>
        `;
        item.querySelector(".todoCheck").onclick = () => {
            t.done = !t.done;
            saveData();
            renderTodos();
        };
        item.querySelector(".todoDelete").onclick = () => {
            todos = todos.filter(x => x.id !== t.id);
            saveData();
            renderTodos();
        };
        todoList.appendChild(item);
    });
}

function addTodo(textOverride){
    const text = (textOverride !== undefined ? textOverride : todoInput.value).trim();
    if(!text) return;
    todos.push({ id: uid(), date: todayStr(), text, done: false });
    todoInput.value = "";
    saveData();
    renderTodos();
}

todoInput.addEventListener("keydown", (e) => {
    if(e.key === "Enter") addTodo();
});

function openTodoModal(){
    todoModalInput.value = "";
    todoModal.classList.add("show");
    setTimeout(() => todoModalInput.focus(), 150);
}

todoModalCancelButton.onclick = () => todoModal.classList.remove("show");

todoModalSaveButton.onclick = () => {
    const text = todoModalInput.value.trim();
    if(!text){
        showToast("할 일을 입력해주세요.", { icon: "⚠️" });
        return;
    }
    addTodo(text);
    todoModal.classList.remove("show");
    showToast("할 일이 추가됐어요.");
};

todoModalInput.addEventListener("keydown", (e) => {
    if(e.key === "Enter") todoModalSaveButton.click();
});

/* ============================= */
/* 완료 처리 + 사진 기록             */
/* ============================= */

function handleCompleteToggle(schedule){

    const dateStr = schedule._occDate || selectedDate;
    const occ = getOccState(schedule, dateStr);

    if(occ.completed){
        if(!confirm("완료를 취소할까요?")) return;
        const target = schedules.find(s => s.id === schedule.id);
        setOccState(target, dateStr, { completed: false });
        renderSchedulePage();
        return;
    }

    completingContext = { scheduleId: schedule.id, dateStr };
    pendingPhoto = null;

    celebrateTitle.textContent = `"${schedule.title}" 완료!`;
    photoPreview.classList.add("hidden");
    photoPlaceholder.classList.remove("hidden");
    photoInput.value = "";

    celebrateModal.classList.add("show");
}

function resizeImageFile(file, maxSize, quality){
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;
                if(width > height && width > maxSize){
                    height = Math.round(height * (maxSize / width));
                    width = maxSize;
                }else if(height > maxSize){
                    width = Math.round(width * (maxSize / height));
                    height = maxSize;
                }
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                canvas.getContext("2d").drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL("image/jpeg", quality));
            };
            img.onerror = reject;
            img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

if(photoInput){
    photoInput.addEventListener("change", async () => {
        const file = photoInput.files[0];
        if(!file) return;
        try{
            const dataUrl = await resizeImageFile(file, 1200, 0.75);
            pendingPhoto = dataUrl;
            photoPreview.src = dataUrl;
            photoPreview.classList.remove("hidden");
            photoPlaceholder.classList.add("hidden");
        }catch(e){
            showToast("사진을 처리하지 못했어요.", { icon: "⚠️" });
        }
    });
}

function finishComplete(){
    if(!completingContext) return;
    const { scheduleId, dateStr } = completingContext;
    const target = schedules.find(s => s.id === scheduleId);
    if(!target){ completingContext = null; return; }

    const occ = getOccState(target, dateStr);
    const photos = pendingPhoto ? [...occ.photos, pendingPhoto] : occ.photos;
    setOccState(target, dateStr, { completed: true, photos });

    completingContext = null;
    pendingPhoto = null;
    celebrateModal.classList.remove("show");
    renderSchedulePage();
    showToast("완료를 기록했어요! 🎉");
}

if(celebrateSaveButton) celebrateSaveButton.onclick = finishComplete;
if(celebrateSkipButton) celebrateSkipButton.onclick = () => { pendingPhoto = null; finishComplete(); };

function openPhotoView(schedule){
    const dateStr = schedule._occDate || selectedDate;
    const occ = getOccState(schedule, dateStr);
    if(!occ.photos || !occ.photos.length) return;

    viewingPhotoContext = { scheduleId: schedule.id, dateStr };
    photoViewImage.src = occ.photos[0];
    photoViewTitle.textContent = schedule.title;
    photoViewModal.classList.add("show");
}

if(closePhotoView) closePhotoView.onclick = () => photoViewModal.classList.remove("show");

if(deletePhotoButton){
    deletePhotoButton.onclick = () => {
        if(!viewingPhotoContext) return;
        if(!confirm("사진을 삭제할까요?")) return;
        const { scheduleId, dateStr } = viewingPhotoContext;
        const target = schedules.find(s => s.id === scheduleId);
        if(!target) return;
        const occ = getOccState(target, dateStr);
        setOccState(target, dateStr, { photos: occ.photos.slice(1) });
        photoViewModal.classList.remove("show");
        renderSchedulePage();
    };
}

/* ============================= */
/* 원형 시간표                     */
/* ============================= */

function polarToCartesian(cx, cy, r, angleDeg){
    const rad = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, rOuter, rInner, startDeg, endDeg){
    if(endDeg - startDeg >= 359.9) endDeg = startDeg + 359.9;
    const p1 = polarToCartesian(cx, cy, rOuter, endDeg);
    const p2 = polarToCartesian(cx, cy, rOuter, startDeg);
    const p3 = polarToCartesian(cx, cy, rInner, startDeg);
    const p4 = polarToCartesian(cx, cy, rInner, endDeg);
    const largeArc = (endDeg - startDeg) > 180 ? 1 : 0;
    return [
        `M ${p1.x} ${p1.y}`,
        `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${p2.x} ${p2.y}`,
        `L ${p3.x} ${p3.y}`,
        `A ${rInner} ${rInner} 0 ${largeArc} 1 ${p4.x} ${p4.y}`,
        "Z"
    ].join(" ");
}

function renderCircleTimetable(){
    if(!clockSvg) return;

    const cx = 170, cy = 170, rOuter = 158, rInner = 92;
    const list = visibleSchedulesForDate(selectedDate);

    let svg = `<circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="none" stroke="var(--track-bg)" stroke-width="66" id="clockBgRing"></circle>`;

    for(let h = 0; h < 24; h += 3){
        const angle = (h / 24) * 360;
        const p = polarToCartesian(cx, cy, rOuter + 16, angle);
        svg += `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="middle" class="clockLabel">${String(h).padStart(2,"0")}</text>`;
    }

    list.forEach(s => {
        const startAngle = (minutesFromHHMM(s.start) / 1440) * 360;
        const endAngle = (minutesFromHHMM(s.end) / 1440) * 360;
        const d = arcPath(cx, cy, rOuter, rInner, startAngle, endAngle);
        svg += `<path d="${d}" fill="${s.color}" class="clockArc" data-id="${s.id}" opacity="${s._completed ? 0.45 : 0.95}" stroke="var(--surface)" stroke-width="1.5"></path>`;
    });

    const label = formatDateLabel(selectedDate);
    svg += `<text x="${cx}" y="${cy-6}" text-anchor="middle" class="clockCenterLabel">${list.length}개 일정</text>`;
    svg += `<text x="${cx}" y="${cy+14}" text-anchor="middle" class="clockLabel">${selectedDate === todayStr() ? "오늘" : label.main}</text>`;

    clockSvg.innerHTML = svg;

    clockSvg.querySelectorAll(".clockArc").forEach(path => {
        path.onclick = (e) => {
            e.stopPropagation();
            openEventModal(path.dataset.id);
        };
    });

    const bgRing = document.getElementById("clockBgRing");
    if(bgRing){
        bgRing.onclick = (e) => {
            const rect = clockSvg.getBoundingClientRect();
            const scale = 340 / rect.width;
            const x = (e.clientX - rect.left) * scale - cx;
            const y = (e.clientY - rect.top) * scale - cy;
            let angle = Math.atan2(y, x) * 180 / Math.PI + 90;
            if(angle < 0) angle += 360;
            let startMin = Math.round(((angle / 360) * 1440) / 30) * 30;
            if(startMin >= 1440) startMin = 1410;
            const startLabel = `${String(Math.floor(startMin/60)).padStart(2,"0")}:${String(startMin%60).padStart(2,"0")}`;
            openEventModal(null, startLabel);
        };
    }
}

/* ============================= */
/* 달력 뷰                         */
/* ============================= */

if(calPrevMonthButton) calPrevMonthButton.onclick = () => {
    calendarMonthDate = new Date(calendarMonthDate.getFullYear(), calendarMonthDate.getMonth() - 1, 1);
    renderCalendar();
};

if(calNextMonthButton) calNextMonthButton.onclick = () => {
    calendarMonthDate = new Date(calendarMonthDate.getFullYear(), calendarMonthDate.getMonth() + 1, 1);
    renderCalendar();
};

function renderCalendar(){
    if(!calendarGrid) return;

    const year = calendarMonthDate.getFullYear();
    const month = calendarMonthDate.getMonth();
    calendarMonthLabel.textContent = `${year}년 ${month + 1}월`;

    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells = [];
    for(let i = 0; i < startOffset; i++){
        const d = daysInPrevMonth - startOffset + i + 1;
        cells.push({ day: d, dateObj: new Date(year, month - 1, d), otherMonth: true });
    }
    for(let d = 1; d <= daysInMonth; d++){
        cells.push({ day: d, dateObj: new Date(year, month, d), otherMonth: false });
    }
    while(cells.length % 7 !== 0 || cells.length < 42){
        const idx = cells.length - (startOffset + daysInMonth) + 1;
        cells.push({ day: idx, dateObj: new Date(year, month + 1, idx), otherMonth: true });
    }

    const todayS = todayStr();

    calendarGrid.innerHTML = cells.map(c => {
        const dStr = todayStr(c.dateObj);
        const list = hasSchedulesOnDate(dStr) ? schedulesForDate(dStr).slice(0, 3) : [];
        const dots = list.map(s => `<span class="calendarDot" style="background:${s.color}"></span>`).join("");
        const classes = [
            "calendarDay",
            c.otherMonth ? "otherMonth" : "",
            dStr === todayS ? "today" : "",
            dStr === selectedDate ? "selected" : ""
        ].filter(Boolean).join(" ");
        return `<div class="${classes}" data-date="${dStr}"><span>${c.day}</span><div class="calendarDots">${dots}</div></div>`;
    }).join("");

    calendarGrid.querySelectorAll(".calendarDay").forEach(el => {
        el.onclick = () => {
            selectedDate = el.dataset.date;
            currentView = "list";
            viewTabs.forEach(t => t.classList.toggle("active", t.dataset.view === "list"));
            rectView.classList.add("hidden");
            listView.classList.remove("hidden");
            circleView.classList.add("hidden");
            renderSchedulePage();
        };
    });
}

/* ============================= */
/* 일정 템플릿                     */
/* ============================= */

function renderTemplateChips(){
    if(!templateChipRow) return;

    if(!templates.length){
        templateChipRow.innerHTML = `<div class="templateEmpty">저장된 템플릿이 없어요. 원하는 하루를 만든 뒤 + 버튼으로 저장해보세요.</div>`;
        return;
    }

    templateChipRow.innerHTML = templates.map(t => `
        <div class="templateChip" data-id="${t.id}">
            <span data-apply="${t.id}">${escapeHtml(t.name)} (${t.items.length})</span>
            <span class="tplDelete" data-delete="${t.id}">✕</span>
        </div>
    `).join("");

    templateChipRow.querySelectorAll("[data-apply]").forEach(el => {
        el.onclick = () => applyTemplate(el.dataset.apply);
    });

    templateChipRow.querySelectorAll("[data-delete]").forEach(el => {
        el.onclick = (e) => {
            e.stopPropagation();
            templates = templates.filter(t => t.id !== el.dataset.delete);
            saveData();
            renderTemplateChips();
        };
    });
}

if(saveTemplateButton){
    saveTemplateButton.onclick = () => {
        const list = schedulesForDate(selectedDate);
        if(!list.length){
            showToast("저장할 일정이 없어요.", { icon: "🗓️" });
            return;
        }
        const name = prompt("템플릿 이름을 입력하세요.", "학교");
        if(!name) return;
        templates.push({
            id: uid(),
            name: name.trim(),
            items: list.map(s => ({ title: s.title, start: s.start, end: s.end, memo: s.memo, color: s.color, tag: s.tag }))
        });
        saveData();
        renderTemplateChips();
        showToast("템플릿으로 저장했어요.", { icon: "📑" });
    };
}

function applyTemplate(id){
    const tpl = templates.find(t => t.id === id);
    if(!tpl) return;
    if(!confirm(`"${tpl.name}" 템플릿을 ${formatDateLabel(selectedDate).main}에 적용할까요?`)) return;

    tpl.items.forEach(item => {
        schedules.push({
            id: uid(), date: selectedDate, repeatDays: [],
            title: item.title, start: item.start, end: item.end,
            memo: item.memo, color: item.color, tag: item.tag,
            completed: false, photos: [], occurrences: {}
        });
    });

    saveData();
    renderSchedulePage();
    showToast("템플릿이 적용됐어요.", { icon: "✅" });
}



/* ============================= */
/* 테마                            */
/* ============================= */

const THEMES = ["default", "dark", "apple", "glass"];

const THEME_ICONS = {
    default: "☀️",
    dark: "🌙",
    apple: "🪨",
    glass: "💧"
};

const THEME_META_COLORS = {
    default: "#F5F7FB",
    dark: "#0F172A",
    apple: "#2A2C2F",
    glass: "#DBE6FF"
};

function getStoredTheme(){
    const saved = localStorage.getItem(THEME_KEY);
    if(!THEMES.includes(saved)) return "default";
    return saved;
}

function getMetalDark(){
    const saved = localStorage.getItem(METAL_DARK_KEY);
    return saved === null ? true : saved === "true";
}

function setMetalDark(on){
    localStorage.setItem(METAL_DARK_KEY, on);
    document.body.classList.toggle("metalLight", !on);
    if(metalDarkToggle){
        metalDarkToggle.classList.toggle("on", on);
        metalDarkToggle.setAttribute("aria-checked", on);
    }
}

function setTheme(mode){
    if(!THEMES.includes(mode)) mode = "default";
    document.body.classList.remove("dark", "apple", "glass");
    if(mode !== "default") document.body.classList.add(mode);
    localStorage.setItem(THEME_KEY, mode);

    if(themeButton) themeButton.textContent = THEME_ICONS[mode];

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if(metaTheme) metaTheme.setAttribute("content", THEME_META_COLORS[mode]);

    themeOptionButtons.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.theme === mode);
    });

    if(metalDarkSettingItem){
        metalDarkSettingItem.classList.toggle("show", mode === "apple");
    }

    if(mode === "apple"){
        setMetalDark(getMetalDark());
    }else{
        document.body.classList.remove("metalLight");
    }
}

function applyTheme(){
    setTheme(getStoredTheme());
}

if(metalDarkToggle){
    metalDarkToggle.onclick = () => setMetalDark(!getMetalDark());
}

themeOptionButtons.forEach(btn => {
    btn.onclick = () => setTheme(btn.dataset.theme);
});

themeButton.onclick = () => {
    const current = getStoredTheme();
    const nextIndex = (THEMES.indexOf(current) + 1) % THEMES.length;
    setTheme(THEMES[nextIndex]);
};

/* ============================= */
/* 구글 드라이브 자동 저장           */
/* ============================= */

function buildBackupPayload(){
    return {
        version: BACKUP_VERSION,
        type: "full",
        exportedAt: Date.now(),
        schedules,
        ddays,
        todos,
        templates,
        customQuotes: loadCustomQuotes()
    };
}

function applyBackupPayload(data){
    schedules = data.schedules || [];
    ddays = data.ddays || [];
    todos = data.todos || [];
    templates = data.templates || [];
    if(Array.isArray(data.customQuotes)) saveCustomQuotes(data.customQuotes);
    saveData();
    renderAll();
}

function isDriveConnected(){
    return localStorage.getItem(DRIVE_CONNECTED_KEY) === "1";
}

function setDriveConnected(connected){
    if(connected){
        localStorage.setItem(DRIVE_CONNECTED_KEY, "1");
    }else{
        localStorage.removeItem(DRIVE_CONNECTED_KEY);
        localStorage.removeItem(DRIVE_FILE_ID_KEY);
        localStorage.removeItem(DRIVE_LAST_SYNC_KEY);
    }
    updateDriveUI();
}

function formatSyncTime(ts){
    const d = new Date(ts);
    const mo = d.getMonth() + 1;
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${mo}월 ${day}일 ${hh}:${mm} 저장됨`;
}

function updateDriveUI(syncOverride){
    if(!googleDriveStatus) return;
    googleDriveStatus.textContent = isDriveConnected() ? "연결됨" : "연결하기";
    if(!googleDriveTime) return;
    if(syncOverride !== undefined){
        googleDriveTime.textContent = syncOverride;
        return;
    }
    if(!isDriveConnected()){
        googleDriveTime.textContent = "";
        return;
    }
    const last = localStorage.getItem(DRIVE_LAST_SYNC_KEY);
    googleDriveTime.textContent = last ? formatSyncTime(Number(last)) : "동기화 대기 중";
}

function initGoogleAuth(){
    if(!window.google || !google.accounts || !google.accounts.oauth2) return;

    googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: async (response) => {
            if(response && response.access_token){
                googleAccessToken = response.access_token;
                googleTokenExpiry = Date.now() + (Number(response.expires_in || 3600) * 1000) - 60000;
                setDriveConnected(true);
                const manualConnect = googleManualConnect;
                const backupOk = await syncToDrive();
                if(manualConnect){
                    if(backupOk){
                        showToast("구글 드라이브 연결 및 백업이 완료됐어요.", { icon: "☁️" });
                    }else{
                        showToast("연결은 됐지만 백업 저장에 실패했어요. 잠시 후 다시 시도해주세요.", { icon: "⚠️" });
                    }
                }
            }else{
                updateDriveUI();
            }
            googleManualConnect = false;
        },
        error_callback: () => {
            googleManualConnect = false;
            updateDriveUI(isDriveConnected() ? "로그인 필요" : "");
        }
    });

    if(isDriveConnected()){
        try{
            googleTokenClient.requestAccessToken({ prompt: "" });
        }catch{ /* 자동 로그인 실패시 조용히 무시 */ }
    }
}

window.onGisLoad = initGoogleAuth;

if(window.google && google.accounts && google.accounts.oauth2){
    initGoogleAuth();
}

function connectGoogleDrive(){
    if(GOOGLE_CLIENT_ID.includes("YOUR_GOOGLE_CLIENT_ID")){
        alert("구글 드라이브 기능을 쓰려면 app.js의 GOOGLE_CLIENT_ID를 먼저 설정해야 합니다.");
        return;
    }
    if(!googleTokenClient){
        alert("구글 로그인 준비 중입니다. 잠시 후 다시 시도해주세요.");
        return;
    }
    googleManualConnect = true;
    googleTokenClient.requestAccessToken({ prompt: "consent" });
}

function disconnectGoogleDrive(){
    if(googleAccessToken && window.google && google.accounts){
        google.accounts.oauth2.revoke(googleAccessToken, () => {});
    }
    googleAccessToken = null;
    googleTokenExpiry = 0;
    setDriveConnected(false);
}

googleDriveButton.onclick = () => {
    if(isDriveConnected()){
        if(confirm("구글 드라이브 자동 저장을 해제할까요?")) disconnectGoogleDrive();
    }else{
        connectGoogleDrive();
    }
};

function scheduleDriveSync(){
    if(!isDriveConnected()) return;
    clearTimeout(driveSyncTimer);
    driveSyncTimer = setTimeout(syncToDrive, 2000);
}

async function ensureValidToken(){
    if(googleAccessToken && Date.now() < googleTokenExpiry) return true;
    if(!googleTokenClient) return false;
    return new Promise((resolve) => {
        const prevCallback = googleTokenClient.callback;
        googleTokenClient.callback = (response) => {
            googleTokenClient.callback = prevCallback;
            if(response && response.access_token){
                googleAccessToken = response.access_token;
                googleTokenExpiry = Date.now() + (Number(response.expires_in || 3600) * 1000) - 60000;
                resolve(true);
            }else{
                resolve(false);
            }
        };
        try{
            googleTokenClient.requestAccessToken({ prompt: "" });
        }catch{
            resolve(false);
        }
    });
}

async function findOrCreateDriveFile(){
    const existing = localStorage.getItem(DRIVE_FILE_ID_KEY);
    if(existing) return existing;

    const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${DRIVE_FILE_NAME}'&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${googleAccessToken}` } }
    );
    const searchData = await searchRes.json();
    if(searchData.files && searchData.files.length > 0){
        localStorage.setItem(DRIVE_FILE_ID_KEY, searchData.files[0].id);
        return searchData.files[0].id;
    }

    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${googleAccessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: DRIVE_FILE_NAME, parents: ["appDataFolder"] })
    });
    const createData = await createRes.json();
    if(createData.id){
        localStorage.setItem(DRIVE_FILE_ID_KEY, createData.id);
        return createData.id;
    }
    return null;
}

async function syncToDrive(){
    if(!isDriveConnected() || driveSyncInProgress) return false;
    driveSyncInProgress = true;
    updateDriveUI("저장 중...");
    try{
        const ok = await ensureValidToken();
        if(!ok){
            updateDriveUI("로그인 필요");
            driveSyncInProgress = false;
            return false;
        }
        const fileId = await findOrCreateDriveFile();
        if(!fileId){
            updateDriveUI("저장 실패");
            driveSyncInProgress = false;
            return false;
        }
        const payload = buildBackupPayload();
        await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${googleAccessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
        localStorage.setItem(DRIVE_LAST_SYNC_KEY, String(Date.now()));
        updateDriveUI();
        driveSyncInProgress = false;
        return true;
    }catch(e){
        console.error("드라이브 저장 실패", e);
        updateDriveUI("저장 실패");
        driveSyncInProgress = false;
        return false;
    }
}

/* ============================= */
/* 수동 백업 / 복원 (JSON)          */
/* ============================= */

exportButton.onclick = () => {
    const payload = buildBackupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timeroutine_backup_${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("백업 파일이 저장됐어요.");
};

importButton.onclick = () => importFile.click();

importFile.onchange = () => {
    const file = importFile.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try{
            const data = JSON.parse(reader.result);
            if(!confirm("가져오기를 하면 현재 데이터를 덮어씁니다. 계속할까요?")) return;
            applyBackupPayload(data);
            showToast("백업 파일을 불러왔어요.");
        }catch(e){
            showToast("올바른 백업 파일이 아니에요.", { icon: "⚠️" });
        }
    };
    reader.readAsText(file);
    importFile.value = "";
};

/* ============================= */
/* 초기화                          */
/* ============================= */

function renderAll(){
    renderDdays();
    renderSchedulePage();
    renderTodos();
}

function init(){
    loadData();
    applyTheme();
    updateClock();
    loadWeather();
    pickRandomQuote();
    renderAll();
    updateDriveUI();
}

document.addEventListener("DOMContentLoaded", init);
