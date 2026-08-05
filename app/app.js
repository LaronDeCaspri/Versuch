// ==============================================================
// Elektro-Lern-App – Hauptlogik
// ==============================================================

const { LEVELS, LESSONS } = window.APP_DATA;

// -------- State --------
const STORAGE_KEY = "elektro_learn_state_v1";

const defaultState = {
  level: null,             // gewählte Schwierigkeitsstufe (Key aus LEVELS)
  xp: 0,
  hearts: 5,
  maxHearts: 5,
  streak: 0,
  lastActive: null,        // ISO-Datum
  completedLessons: {},    // { lessonId: true }
  currentLesson: null,     // id
  currentIndex: 0,
  lessonCorrect: 0,
  lessonTotal: 0,
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultState, ...JSON.parse(raw) };
  } catch (e) { /* leer */ }
  return { ...defaultState };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

function resetState() {
  state = { ...defaultState };
  saveState();
}

// -------- Streak / Herzen-Regeneration --------
function updateStreakAndHearts() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastActive !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (state.lastActive === yesterday) {
      // Streak fortgesetzt – wird beim ersten korrekten Antwort erhöht
    } else if (state.lastActive) {
      state.streak = 0; // Streak verloren
    }
    // Herzen regenerieren sich täglich auf max
    state.hearts = state.maxHearts;
    saveState();
  }
}

function markActiveToday() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastActive !== today) {
    state.streak += 1;
    state.lastActive = today;
  }
  saveState();
}

// -------- Rendering-Helfer --------
const app = document.getElementById("app");
const topbar = document.getElementById("topbar-stats");

function level() { return Math.floor(state.xp / 100) + 1; }
function xpInLevel() { return state.xp % 100; }

function renderTopbar() {
  if (!state.level) {
    topbar.innerHTML = "";
    return;
  }
  topbar.innerHTML = `
    <span class="stat level" title="Level"><span class="stat-icon">🎓</span>Lvl ${level()}</span>
    <span class="stat streak" title="Streak in Tagen"><span class="stat-icon">🔥</span>${state.streak}</span>
    <span class="stat xp" title="Erfahrungspunkte"><span class="stat-icon">⭐</span>${state.xp} XP</span>
    <span class="stat hearts" title="Verbleibende Herzen"><span class="stat-icon">❤</span>${state.hearts}/${state.maxHearts}</span>
    <button class="btn btn-ghost btn-small" onclick="goHome()">Menü</button>
  `;
}

function render(html) {
  app.innerHTML = html;
  renderTopbar();
}

// ==============================================================
// SCREEN: Onboarding / Level-Auswahl
// ==============================================================
function renderOnboarding() {
  const cards = Object.entries(LEVELS).map(([key, l]) => `
    <div class="level-card" onclick="chooseLevel('${key}')">
      <span class="emoji">${levelEmoji(key)}</span>
      <div class="name" style="color:${l.color}">${l.name}</div>
      <div class="desc">${levelDesc(key)}</div>
    </div>
  `).join("");

  render(`
    <div class="screen">
      <h1>Welcome to ElectroLingo ⚡</h1>
      <p class="subtitle">Lerne die englischen Fachbegriffe der Elektrotechnik spielerisch. Wähle dein Sprachlevel – du kannst es jederzeit wechseln.</p>
      <div class="level-grid">${cards}</div>
    </div>
  `);
}

function levelEmoji(key) {
  return { beginner: "🌱", intermediate: "🔧", advanced: "🛠️", expert: "🏆" }[key] || "⚡";
}
function levelDesc(key) {
  return {
    beginner:     "Grundwortschatz zum Einstieg",
    intermediate: "Bauteile & einfache Sätze",
    advanced:     "Installation, AC/DC & Fehler",
    expert:       "Prüfungsvokabular & Fachjargon",
  }[key] || "";
}

function chooseLevel(key) {
  state.level = key;
  saveState();
  goHome();
}

// ==============================================================
// SCREEN: Home / Lernpfad
// ==============================================================
function goHome() {
  updateStreakAndHearts();
  if (!state.level) { renderOnboarding(); return; }
  renderHome();
}

function renderHome() {
  const availableLessons = LESSONS.filter(l => l.levels.includes(state.level));
  const themen = ["Basics", "Components", "Circuits", "Installation", "Measurement"];

  const sections = themen.map(thema => {
    const lessons = availableLessons.filter(l => l.thema === thema);
    if (lessons.length === 0) return "";

    let previousDone = true;
    const nodes = lessons.map((lesson, idx) => {
      const done = !!state.completedLessons[lesson.id];
      const unlocked = previousDone || done;
      const cls = done ? "done" : (unlocked ? "" : "locked");
      const onClick = unlocked ? `startLesson('${lesson.id}')` : "showLockedInfo()";
      previousDone = done;
      return `
        <div class="lesson-node-wrapper">
          <div class="lesson-node ${cls}" onclick="${onClick}">${lesson.icon}</div>
          <div class="lesson-title">${lesson.titel}</div>
        </div>
      `;
    }).join("");

    return `
      <section class="thema-section" data-thema="${thema}">
        <div class="thema-header">
          <span>${themaEmoji(thema)}</span>
          <span>${thema}</span>
        </div>
        <div class="lesson-path">${nodes}</div>
      </section>
    `;
  }).join("");

  const lvlInfo = LEVELS[state.level];
  render(`
    <div class="screen">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:12px;">
        <div>
          <h1>Dein Lernpfad</h1>
          <p class="subtitle" style="margin-bottom:0">Aktuelles Level: <strong style="color:${lvlInfo.color}">${lvlInfo.name}</strong></p>
        </div>
        <button class="btn btn-ghost btn-small" onclick="changeLevel()">Level ändern</button>
      </div>
      <div style="margin: 16px 0 24px;">
        <div class="progress-bar" title="XP im aktuellen Level"><div class="progress-fill" style="width:${xpInLevel()}%"></div></div>
        <div style="font-size:13px;color:var(--gray-4);margin-top:6px;">Level ${level()} • ${xpInLevel()}/100 XP bis zum nächsten Level</div>
      </div>
      ${sections}
    </div>
  `);
}

function themaEmoji(t) {
  return { Basics: "⚡", Components: "🔩", Circuits: "📊", Installation: "🏠", Measurement: "📏" }[t] || "📚";
}

function changeLevel() {
  if (confirm("Level wechseln? Dein Fortschritt bleibt erhalten.")) {
    state.level = null;
    saveState();
    renderOnboarding();
  }
}

function showLockedInfo() {
  alert("Diese Lektion ist noch gesperrt. Schließe zuerst die vorherige Lektion ab!");
}

// ==============================================================
// SCREEN: Lektion
// ==============================================================
function startLesson(id) {
  if (state.hearts <= 0) {
    showModal("💔", "Keine Herzen mehr!", "Du hast keine Herzen mehr. Komm morgen wieder – deine Herzen füllen sich täglich auf.", "OK", () => hideModal());
    return;
  }
  const lesson = LESSONS.find(l => l.id === id);
  if (!lesson) return;
  state.currentLesson = id;
  state.currentIndex = 0;
  state.lessonCorrect = 0;
  state.lessonTotal = lesson.exercises.length;
  saveState();
  renderExercise();
}

function renderExercise() {
  const lesson = LESSONS.find(l => l.id === state.currentLesson);
  if (!lesson) { goHome(); return; }
  if (state.currentIndex >= lesson.exercises.length) {
    finishLesson();
    return;
  }

  const ex = lesson.exercises[state.currentIndex];
  const progressPct = ((state.currentIndex) / lesson.exercises.length) * 100;

  let body = "";
  switch (ex.type) {
    case "mc":       body = renderMC(ex); break;
    case "match":    body = renderMatch(ex); break;
    case "flashcard":body = renderFlashcard(ex); break;
    case "cloze":    body = renderCloze(ex); break;
    case "calc":     body = renderCalc(ex); break;
  }

  render(`
    <div class="screen">
      <div class="lesson-header">
        <button class="close-btn" onclick="quitLesson()" title="Lektion verlassen">✕</button>
        <div class="progress-bar"><div class="progress-fill" style="width:${progressPct}%"></div></div>
      </div>
      ${body}
      <div class="feedback" id="feedback"></div>
      <div class="footer-actions">
        <button class="btn btn-primary" id="checkBtn" onclick="checkAnswer()" disabled>Prüfen</button>
      </div>
    </div>
  `);

  // spezielle Nachaktion für Flashcards (kein Check nötig)
  if (ex.type === "flashcard") {
    document.getElementById("checkBtn").disabled = false;
    document.getElementById("checkBtn").textContent = "Weiter";
    document.getElementById("checkBtn").onclick = () => nextExercise(true);
  }
}

// ---- Renderer für die Übungstypen ----
let selectedIndex = null;
let selectedValue = null;

function renderMC(ex) {
  selectedIndex = null;
  const opts = ex.options.map((o, i) =>
    `<button class="option" data-idx="${i}" onclick="selectOption(${i})">${o}</button>`
  ).join("");
  return `
    <div class="exercise-card">
      <div class="exercise-question">${ex.question}</div>
      <div class="options-list">${opts}</div>
    </div>
  `;
}

function renderMatch(ex) {
  selectedIndex = null;
  const opts = ex.options.map((o, i) =>
    `<button class="option" data-idx="${i}" onclick="selectOption(${i})">${o}</button>`
  ).join("");
  return `
    <div class="exercise-card">
      <div class="exercise-question">${ex.instruction}</div>
      <div class="symbol-box">${ex.symbol}</div>
      <div class="options-list">${opts}</div>
    </div>
  `;
}

function renderFlashcard(ex) {
  return `
    <div class="exercise-card" style="background:transparent;box-shadow:none;padding:0;">
      <div class="exercise-question" style="text-align:center;">Karteikarte – tippe zum Umdrehen</div>
      <div class="flashcard" id="fc" onclick="document.getElementById('fc').classList.toggle('flipped')">
        <div class="flashcard-inner">
          <div class="flashcard-front">
            <div class="front-text">${ex.front}</div>
            <div class="hint">👆 Antippen zum Umdrehen</div>
          </div>
          <div class="flashcard-back">
            <div class="back-text">${ex.back}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCloze(ex) {
  selectedValue = null;
  return `
    <div class="exercise-card">
      <div class="exercise-question">Fülle die Lücke:</div>
      <p style="font-size:18px;margin-bottom:20px;line-height:1.5;">${ex.text.replace("___", "<strong style='color:var(--blue)'>___</strong>")}</p>
      <input class="text-input" type="text" id="clozeInput" placeholder="Antwort" oninput="onTextInput(this)" onkeydown="if(event.key==='Enter')checkAnswer()" autocomplete="off">
    </div>
  `;
}

function renderCalc(ex) {
  selectedValue = null;
  return `
    <div class="exercise-card">
      <div class="exercise-question">${ex.question}</div>
      <input class="text-input" type="text" inputmode="decimal" id="calcInput" placeholder="Zahl (z.B. 12 oder 1,5)" oninput="onTextInput(this)" onkeydown="if(event.key==='Enter')checkAnswer()" autocomplete="off">
      ${ex.hint ? `<p class="hint-text">Tipp: ${ex.hint}${ex.unit ? " (Einheit: " + ex.unit + ")" : ""}</p>` : ""}
    </div>
  `;
}

// ---- Interaktion ----
function selectOption(i) {
  selectedIndex = i;
  document.querySelectorAll(".option").forEach(el => el.classList.remove("selected"));
  document.querySelector(`.option[data-idx="${i}"]`).classList.add("selected");
  document.getElementById("checkBtn").disabled = false;
}

function onTextInput(el) {
  selectedValue = el.value.trim();
  document.getElementById("checkBtn").disabled = selectedValue.length === 0;
}

function checkAnswer() {
  const lesson = LESSONS.find(l => l.id === state.currentLesson);
  const ex = lesson.exercises[state.currentIndex];
  let correct = false;
  let correctText = "";

  if (ex.type === "mc" || ex.type === "match") {
    correct = selectedIndex === ex.correct;
    correctText = ex.options[ex.correct];
    document.querySelectorAll(".option").forEach((el, i) => {
      el.classList.remove("selected");
      if (i === ex.correct) el.classList.add("correct");
      else if (i === selectedIndex && !correct) el.classList.add("wrong");
      el.style.pointerEvents = "none";
    });
  } else if (ex.type === "cloze") {
    const answers = [ex.answer, ...(ex.altAnswers || [])].map(normalize);
    correct = answers.includes(normalize(selectedValue));
    correctText = ex.answer;
  } else if (ex.type === "calc") {
    const num = parseFloat(String(selectedValue).replace(",", "."));
    const tol = ex.tolerance ?? 0.01;
    correct = !isNaN(num) && Math.abs(num - ex.answer) <= tol;
    correctText = `${ex.answer}${ex.unit ? " " + ex.unit : ""}`;
  }

  showFeedback(correct, correctText);
  updateAfterAnswer(correct);
}

function normalize(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function showFeedback(correct, correctText) {
  const fb = document.getElementById("feedback");
  fb.className = "feedback show " + (correct ? "correct" : "wrong");
  fb.innerHTML = correct
    ? `<div class="feedback-title">✅ Richtig! +10 XP</div><div class="feedback-detail">Weiter so!</div>`
    : `<div class="feedback-title">❌ Nicht ganz.</div><div class="feedback-detail">Richtige Antwort: <strong>${correctText}</strong></div>`;

  const btn = document.getElementById("checkBtn");
  btn.textContent = "Weiter";
  btn.className = "btn " + (correct ? "btn-primary" : "btn-red");
  btn.disabled = false;
  btn.onclick = () => nextExercise(correct);
}

function updateAfterAnswer(correct) {
  if (correct) {
    state.xp += 10;
    state.lessonCorrect += 1;
    markActiveToday();
  } else {
    state.hearts = Math.max(0, state.hearts - 1);
  }
  saveState();
  renderTopbar();
}

function nextExercise(wasCorrect) {
  if (state.hearts <= 0) {
    showModal("💔", "Alle Herzen weg!", "Du hast keine Herzen mehr. Versuche es morgen erneut – deine Herzen füllen sich automatisch wieder auf.", "Zurück zum Menü", () => { hideModal(); goHome(); });
    return;
  }
  state.currentIndex += 1;
  saveState();
  renderExercise();
}

function quitLesson() {
  if (confirm("Lektion wirklich verlassen? Dein Fortschritt in dieser Lektion geht verloren.")) {
    state.currentLesson = null;
    saveState();
    goHome();
  }
}

function finishLesson() {
  const lesson = LESSONS.find(l => l.id === state.currentLesson);
  const pct = Math.round((state.lessonCorrect / state.lessonTotal) * 100);
  const passed = pct >= 60;

  if (passed) {
    state.completedLessons[lesson.id] = true;
    // Bonus XP für abgeschlossene Lektion
    state.xp += 20;
    saveState();
    showModal(
      "🎉",
      "Lektion abgeschlossen!",
      `Du hast <strong>${state.lessonCorrect} von ${state.lessonTotal}</strong> Aufgaben richtig (${pct}%).`,
      "Weiter",
      () => { hideModal(); goHome(); },
      `<div class="modal-stats">+${state.lessonCorrect * 10 + 20} XP • 🔥 Streak: ${state.streak}</div>`
    );
  } else {
    showModal(
      "😕",
      "Fast geschafft!",
      `Du hast nur ${pct}% richtig. Ab 60% ist eine Lektion bestanden – probier es noch einmal.`,
      "Nochmal versuchen",
      () => { hideModal(); startLesson(lesson.id); }
    );
  }
}

// ==============================================================
// Modal
// ==============================================================
function showModal(emoji, title, text, btnText, cb, extra = "") {
  const bd = document.getElementById("modal");
  bd.innerHTML = `
    <div class="modal">
      <div class="modal-emoji">${emoji}</div>
      <h2>${title}</h2>
      ${extra}
      <p>${text}</p>
      <button class="btn btn-primary" id="modalBtn">${btnText}</button>
    </div>
  `;
  bd.classList.add("show");
  document.getElementById("modalBtn").onclick = cb;
}
function hideModal() { document.getElementById("modal").classList.remove("show"); }

// ==============================================================
// Export für Inline-onclick-Handler
// ==============================================================
window.chooseLevel = chooseLevel;
window.startLesson = startLesson;
window.checkAnswer = checkAnswer;
window.selectOption = selectOption;
window.onTextInput = onTextInput;
window.quitLesson = quitLesson;
window.goHome = goHome;
window.changeLevel = changeLevel;
window.showLockedInfo = showLockedInfo;

// ==============================================================
// Start
// ==============================================================
updateStreakAndHearts();
goHome();
