// ==================================================================
// Lerninhalte für die Elektro-Lern-App
// Aufgeteilt nach Themen und Schwierigkeitsstufen
// ==================================================================

(function() {

const LEVELS = {
  azubi1: { name: "Azubi 1. Lehrjahr", color: "#58cc02" },
  azubi2: { name: "Azubi 2. Lehrjahr", color: "#1cb0f6" },
  azubi3: { name: "Azubi 3./4. Lehrjahr", color: "#ce82ff" },
  meister: { name: "Meister / Fortgeschrittene", color: "#ff9600" },
};

// Schaltzeichen als Inline-SVG (skalierbar, immer scharf)
const SYMBOLS = {
  widerstand: `<svg viewBox="0 0 100 40"><line x1="0" y1="20" x2="20" y2="20" stroke="currentColor" stroke-width="2"/><rect x="20" y="10" width="60" height="20" fill="none" stroke="currentColor" stroke-width="2"/><line x1="80" y1="20" x2="100" y2="20" stroke="currentColor" stroke-width="2"/></svg>`,
  kondensator: `<svg viewBox="0 0 100 40"><line x1="0" y1="20" x2="45" y2="20" stroke="currentColor" stroke-width="2"/><line x1="45" y1="5" x2="45" y2="35" stroke="currentColor" stroke-width="2"/><line x1="55" y1="5" x2="55" y2="35" stroke="currentColor" stroke-width="2"/><line x1="55" y1="20" x2="100" y2="20" stroke="currentColor" stroke-width="2"/></svg>`,
  spule: `<svg viewBox="0 0 100 40"><line x1="0" y1="20" x2="15" y2="20" stroke="currentColor" stroke-width="2"/><path d="M 15 20 Q 25 5 35 20 Q 45 5 55 20 Q 65 5 75 20 Q 85 5 85 20" fill="none" stroke="currentColor" stroke-width="2"/><line x1="85" y1="20" x2="100" y2="20" stroke="currentColor" stroke-width="2"/></svg>`,
  diode: `<svg viewBox="0 0 100 40"><line x1="0" y1="20" x2="40" y2="20" stroke="currentColor" stroke-width="2"/><polygon points="40,8 40,32 60,20" fill="currentColor"/><line x1="60" y1="8" x2="60" y2="32" stroke="currentColor" stroke-width="2"/><line x1="60" y1="20" x2="100" y2="20" stroke="currentColor" stroke-width="2"/></svg>`,
  led: `<svg viewBox="0 0 100 40"><line x1="0" y1="20" x2="40" y2="20" stroke="currentColor" stroke-width="2"/><polygon points="40,8 40,32 60,20" fill="currentColor"/><line x1="60" y1="8" x2="60" y2="32" stroke="currentColor" stroke-width="2"/><line x1="60" y1="20" x2="100" y2="20" stroke="currentColor" stroke-width="2"/><line x1="65" y1="5" x2="75" y2="0" stroke="currentColor" stroke-width="1.5" marker-end="url(#arr)"/><line x1="72" y1="10" x2="82" y2="5" stroke="currentColor" stroke-width="1.5"/><defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs></svg>`,
  transistor_npn: `<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="22" fill="none" stroke="currentColor" stroke-width="2"/><line x1="40" y1="15" x2="40" y2="45" stroke="currentColor" stroke-width="3"/><line x1="20" y1="30" x2="40" y2="30" stroke="currentColor" stroke-width="2"/><line x1="40" y1="20" x2="60" y2="10" stroke="currentColor" stroke-width="2"/><line x1="60" y1="10" x2="60" y2="0" stroke="currentColor" stroke-width="2"/><line x1="40" y1="40" x2="60" y2="50" stroke="currentColor" stroke-width="2"/><line x1="60" y1="50" x2="60" y2="60" stroke="currentColor" stroke-width="2"/><polygon points="55,42 60,50 50,48" fill="currentColor"/></svg>`,
  schalter: `<svg viewBox="0 0 100 40"><line x1="0" y1="20" x2="30" y2="20" stroke="currentColor" stroke-width="2"/><circle cx="32" cy="20" r="2" fill="currentColor"/><line x1="32" y1="20" x2="65" y2="8" stroke="currentColor" stroke-width="2"/><circle cx="68" cy="20" r="2" fill="currentColor"/><line x1="68" y1="20" x2="100" y2="20" stroke="currentColor" stroke-width="2"/></svg>`,
  masse: `<svg viewBox="0 0 60 60"><line x1="30" y1="0" x2="30" y2="25" stroke="currentColor" stroke-width="2"/><line x1="10" y1="25" x2="50" y2="25" stroke="currentColor" stroke-width="3"/><line x1="18" y1="35" x2="42" y2="35" stroke="currentColor" stroke-width="2"/><line x1="24" y1="45" x2="36" y2="45" stroke="currentColor" stroke-width="2"/></svg>`,
  batterie: `<svg viewBox="0 0 100 40"><line x1="0" y1="20" x2="40" y2="20" stroke="currentColor" stroke-width="2"/><line x1="40" y1="5" x2="40" y2="35" stroke="currentColor" stroke-width="3"/><line x1="50" y1="12" x2="50" y2="28" stroke="currentColor" stroke-width="2"/><line x1="55" y1="5" x2="55" y2="35" stroke="currentColor" stroke-width="3"/><line x1="65" y1="12" x2="65" y2="28" stroke="currentColor" stroke-width="2"/><line x1="65" y1="20" x2="100" y2="20" stroke="currentColor" stroke-width="2"/></svg>`,
  sicherung: `<svg viewBox="0 0 100 40"><line x1="0" y1="20" x2="20" y2="20" stroke="currentColor" stroke-width="2"/><rect x="20" y="12" width="60" height="16" fill="none" stroke="currentColor" stroke-width="2"/><line x1="20" y1="20" x2="80" y2="20" stroke="currentColor" stroke-width="2"/><line x1="80" y1="20" x2="100" y2="20" stroke="currentColor" stroke-width="2"/></svg>`,
  gluehlampe: `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="18" fill="none" stroke="currentColor" stroke-width="2"/><line x1="17" y1="17" x2="43" y2="43" stroke="currentColor" stroke-width="2"/><line x1="43" y1="17" x2="17" y2="43" stroke="currentColor" stroke-width="2"/></svg>`,
};

// ==================================================================
// LEKTIONEN – Thema: Grundlagen
// ==================================================================
const LESSONS = [
  // ------------- GRUNDLAGEN -------------
  {
    id: "grund_1",
    thema: "Grundlagen",
    titel: "Grundgrößen der Elektrotechnik",
    icon: "⚡",
    levels: ["azubi1", "azubi2", "azubi3", "meister"],
    exercises: [
      { type: "flashcard", front: "Spannung (U)", back: "Elektrische Potentialdifferenz, gemessen in Volt (V)." },
      { type: "flashcard", front: "Stromstärke (I)", back: "Menge der bewegten Ladung pro Zeit, gemessen in Ampere (A)." },
      { type: "flashcard", front: "Widerstand (R)", back: "Behinderung des Stromflusses, gemessen in Ohm (Ω)." },
      { type: "mc", question: "In welcher Einheit wird die elektrische Spannung gemessen?", options: ["Ampere", "Ohm", "Volt", "Watt"], correct: 2 },
      { type: "mc", question: "Welches Formelzeichen steht für die Stromstärke?", options: ["U", "I", "R", "P"], correct: 1 },
      { type: "mc", question: "Der elektrische Widerstand wird gemessen in …", options: ["Volt", "Watt", "Ohm", "Farad"], correct: 2 },
      { type: "cloze", text: "Die Formel des Ohmschen Gesetzes lautet U = ___ · R.", answer: "I" },
      { type: "calc", question: "Berechne den Strom: U = 12 V, R = 4 Ω. I = ?", answer: 3, unit: "A", hint: "I = U / R" },
      { type: "calc", question: "Berechne die Spannung: I = 2 A, R = 5 Ω. U = ?", answer: 10, unit: "V", hint: "U = I · R" },
    ],
  },
  {
    id: "grund_2",
    thema: "Grundlagen",
    titel: "Ohmsches Gesetz & Leistung",
    icon: "📐",
    levels: ["azubi1", "azubi2", "azubi3", "meister"],
    exercises: [
      { type: "flashcard", front: "Ohmsches Gesetz", back: "U = R · I  (Spannung = Widerstand · Strom)" },
      { type: "flashcard", front: "Elektrische Leistung P", back: "P = U · I, gemessen in Watt (W)." },
      { type: "flashcard", front: "Arbeit W", back: "W = P · t, gemessen in Wattsekunden (Ws) oder Kilowattstunden (kWh)." },
      { type: "mc", question: "Wie berechnet man die elektrische Leistung?", options: ["P = U / I", "P = U · I", "P = R · I", "P = U + I"], correct: 1 },
      { type: "mc", question: "Ein Verbraucher hat 230 V und 0,5 A. Wie hoch ist die Leistung?", options: ["115 W", "230 W", "460 W", "11,5 W"], correct: 0 },
      { type: "cloze", text: "Elektrische Arbeit: W = P · ___", answer: "t" },
      { type: "calc", question: "R = 10 Ω, I = 2 A. Wie groß ist P?", answer: 40, unit: "W", hint: "P = R · I²" },
      { type: "calc", question: "U = 230 V, I = 10 A. Wie groß ist P?", answer: 2300, unit: "W", hint: "P = U · I" },
      { type: "calc", question: "Ein Gerät verbraucht 2000 W für 3 h. Wie viel kWh?", answer: 6, unit: "kWh", hint: "W = P · t" },
    ],
  },
  {
    id: "grund_3",
    thema: "Grundlagen",
    titel: "Reihen- und Parallelschaltung",
    icon: "🔗",
    levels: ["azubi1", "azubi2", "azubi3", "meister"],
    exercises: [
      { type: "flashcard", front: "Reihenschaltung Widerstand", back: "R_ges = R1 + R2 + R3 + … (Widerstände werden addiert)" },
      { type: "flashcard", front: "Parallelschaltung Widerstand", back: "1/R_ges = 1/R1 + 1/R2 + … (Kehrwerte werden addiert)" },
      { type: "flashcard", front: "Reihenschaltung Strom", back: "Der Strom ist überall gleich groß." },
      { type: "flashcard", front: "Parallelschaltung Spannung", back: "Die Spannung ist an allen Bauteilen gleich." },
      { type: "mc", question: "Bei einer Reihenschaltung gilt für den Strom:", options: ["I ist überall gleich", "I addiert sich", "I halbiert sich", "I ist null"], correct: 0 },
      { type: "mc", question: "Zwei 10 Ω Widerstände parallel ergeben:", options: ["20 Ω", "10 Ω", "5 Ω", "2 Ω"], correct: 2 },
      { type: "calc", question: "R1 = 4 Ω, R2 = 6 Ω in Reihe. R_ges = ?", answer: 10, unit: "Ω", hint: "R_ges = R1 + R2" },
      { type: "calc", question: "R1 = 6 Ω, R2 = 3 Ω parallel. R_ges = ?", answer: 2, unit: "Ω", hint: "R = (R1·R2)/(R1+R2)" },
    ],
  },

  // ------------- BAUTEILE -------------
  {
    id: "bau_1",
    thema: "Bauteile",
    titel: "Passive Bauelemente",
    icon: "🔩",
    levels: ["azubi1", "azubi2", "azubi3", "meister"],
    exercises: [
      { type: "flashcard", front: "Widerstand", back: "Passives Bauteil, begrenzt den Stromfluss. Einheit: Ohm (Ω)." },
      { type: "flashcard", front: "Kondensator", back: "Speichert elektrische Ladung. Einheit: Farad (F)." },
      { type: "flashcard", front: "Spule / Induktivität", back: "Speichert Energie im Magnetfeld. Einheit: Henry (H)." },
      { type: "match", instruction: "Ordne das Schaltzeichen dem richtigen Bauteil zu:", symbol: SYMBOLS.widerstand, options: ["Widerstand", "Kondensator", "Spule", "Diode"], correct: 0 },
      { type: "match", instruction: "Welches Bauteil zeigt dieses Symbol?", symbol: SYMBOLS.kondensator, options: ["Widerstand", "Kondensator", "Batterie", "Spule"], correct: 1 },
      { type: "match", instruction: "Welches Bauteil zeigt dieses Symbol?", symbol: SYMBOLS.spule, options: ["Widerstand", "Kondensator", "Spule", "Sicherung"], correct: 2 },
      { type: "mc", question: "Ein Kondensator speichert …", options: ["Strom", "Magnetfeld", "elektrische Ladung", "Wärme"], correct: 2 },
      { type: "mc", question: "Die Einheit der Induktivität ist:", options: ["Farad", "Henry", "Ohm", "Coulomb"], correct: 1 },
    ],
  },
  {
    id: "bau_2",
    thema: "Bauteile",
    titel: "Halbleiter-Bauelemente",
    icon: "💡",
    levels: ["azubi2", "azubi3", "meister"],
    exercises: [
      { type: "flashcard", front: "Diode", back: "Halbleiter, lässt Strom nur in eine Richtung (Durchlassrichtung) fließen." },
      { type: "flashcard", front: "LED", back: "Leuchtdiode – wandelt elektrische Energie in Licht um." },
      { type: "flashcard", front: "Transistor (NPN)", back: "Schaltet oder verstärkt Signale. Anschlüsse: Basis, Kollektor, Emitter." },
      { type: "match", instruction: "Welches Bauteil zeigt dieses Symbol?", symbol: SYMBOLS.diode, options: ["Widerstand", "Diode", "Kondensator", "LED"], correct: 1 },
      { type: "match", instruction: "Welches Bauteil zeigt dieses Symbol?", symbol: SYMBOLS.led, options: ["Diode", "LED", "Fotowiderstand", "Schalter"], correct: 1 },
      { type: "match", instruction: "Welches Bauteil zeigt dieses Symbol?", symbol: SYMBOLS.transistor_npn, options: ["Diode", "IC", "Transistor NPN", "Spule"], correct: 2 },
      { type: "mc", question: "In welcher Richtung leitet eine Diode?", options: ["Sperrrichtung", "beiden", "Durchlassrichtung", "keiner"], correct: 2 },
      { type: "mc", question: "Anschlüsse eines Bipolartransistors:", options: ["Gate, Drain, Source", "Basis, Kollektor, Emitter", "Anode, Kathode, Gitter", "Plus, Minus, Erde"], correct: 1 },
      { type: "cloze", text: "Eine ___ ist eine leuchtende Diode.", answer: "LED" },
    ],
  },

  // ------------- SCHALTUNGEN -------------
  {
    id: "schalt_1",
    thema: "Schaltungen",
    titel: "Schaltzeichen lesen",
    icon: "📊",
    levels: ["azubi1", "azubi2", "azubi3", "meister"],
    exercises: [
      { type: "match", instruction: "Was zeigt dieses Symbol?", symbol: SYMBOLS.batterie, options: ["Kondensator", "Batterie", "Widerstand", "Diode"], correct: 1 },
      { type: "match", instruction: "Was zeigt dieses Symbol?", symbol: SYMBOLS.schalter, options: ["Schalter", "Sicherung", "Trenner", "Relais"], correct: 0 },
      { type: "match", instruction: "Was zeigt dieses Symbol?", symbol: SYMBOLS.masse, options: ["Erde", "Masse", "Neutralleiter", "Antenne"], correct: 1 },
      { type: "match", instruction: "Was zeigt dieses Symbol?", symbol: SYMBOLS.sicherung, options: ["Widerstand", "Sicherung", "Diode", "Relais"], correct: 1 },
      { type: "match", instruction: "Was zeigt dieses Symbol?", symbol: SYMBOLS.gluehlampe, options: ["Motor", "Glühlampe", "LED", "Signalhupe"], correct: 1 },
      { type: "mc", question: "Ein Schaltplan zeigt …", options: ["den räumlichen Aufbau", "die elektrische Verschaltung", "das Gehäuse", "die Farben"], correct: 1 },
    ],
  },
  {
    id: "schalt_2",
    thema: "Schaltungen",
    titel: "Wechsel- und Kreuzschaltung",
    icon: "🔀",
    levels: ["azubi2", "azubi3", "meister"],
    exercises: [
      { type: "flashcard", front: "Ausschaltung", back: "Ein Verbraucher wird von einer Stelle geschaltet." },
      { type: "flashcard", front: "Wechselschaltung", back: "Ein Verbraucher wird von zwei Stellen geschaltet (z.B. Treppenhaus)." },
      { type: "flashcard", front: "Kreuzschaltung", back: "Ein Verbraucher wird von drei oder mehr Stellen geschaltet." },
      { type: "mc", question: "Wie viele Wechselschalter braucht eine Wechselschaltung?", options: ["1", "2", "3", "4"], correct: 1 },
      { type: "mc", question: "In der Kreuzschaltung liegt der Kreuzschalter …", options: ["am Anfang", "am Ende", "zwischen zwei Wechselschaltern", "parallel"], correct: 2 },
      { type: "cloze", text: "Eine ___-Schaltung ermöglicht das Schalten von 2 Stellen.", answer: "Wechsel" },
    ],
  },

  // ------------- INSTALLATION / VDE -------------
  {
    id: "inst_1",
    thema: "Installation",
    titel: "Leiter & Netzsysteme",
    icon: "🏠",
    levels: ["azubi1", "azubi2", "azubi3", "meister"],
    exercises: [
      { type: "flashcard", front: "L1, L2, L3", back: "Außenleiter (früher: Phase). Führen die 3 Wechselspannungen (400 V zwischen zwei Leitern)." },
      { type: "flashcard", front: "N (Neutralleiter)", back: "Rückleiter, blau. Führt normalerweise keine Spannung gegen Erde." },
      { type: "flashcard", front: "PE (Schutzleiter)", back: "Grün-gelb, dient dem Personenschutz durch Verbindung mit Erde." },
      { type: "flashcard", front: "TN-System", back: "Sternpunkt geerdet, Schutzleiter mit dem Sternpunkt verbunden." },
      { type: "mc", question: "Welche Farbe hat der Schutzleiter?", options: ["Blau", "Braun", "Grün-Gelb", "Schwarz"], correct: 2 },
      { type: "mc", question: "Welche Farbe hat der Neutralleiter?", options: ["Rot", "Grau", "Blau", "Grün"], correct: 2 },
      { type: "mc", question: "Wie viele Außenleiter hat ein Drehstromnetz?", options: ["1", "2", "3", "4"], correct: 2 },
      { type: "mc", question: "Spannung zwischen L und N im Haushalt (D):", options: ["110 V", "230 V", "400 V", "12 V"], correct: 1 },
      { type: "mc", question: "Spannung zwischen zwei Außenleitern:", options: ["230 V", "400 V", "690 V", "50 V"], correct: 1 },
    ],
  },
  {
    id: "inst_2",
    thema: "Installation",
    titel: "Schutzmaßnahmen (VDE)",
    icon: "🛡️",
    levels: ["azubi2", "azubi3", "meister"],
    exercises: [
      { type: "flashcard", front: "5 Sicherheitsregeln", back: "1. Freischalten 2. Gegen Wiedereinschalten sichern 3. Spannungsfreiheit feststellen 4. Erden und kurzschließen 5. Benachbarte, unter Spannung stehende Teile abdecken." },
      { type: "flashcard", front: "RCD / FI-Schutzschalter", back: "Fehlerstrom-Schutzschalter, löst bei Fehlerströmen (meist ab 30 mA) aus – Personenschutz." },
      { type: "flashcard", front: "LS-Schalter", back: "Leitungsschutzschalter, schützt Leitungen vor Überlast und Kurzschluss." },
      { type: "flashcard", front: "IP-Schutzart", back: "Kennzeichnet Schutz gegen Fremdkörper (1. Ziffer) und Wasser (2. Ziffer). z.B. IP44." },
      { type: "mc", question: "Ein FI-Schutzschalter für Personenschutz löst aus bei:", options: ["300 mA", "30 mA", "10 A", "100 mA"], correct: 1 },
      { type: "mc", question: "Wie viele Sicherheitsregeln gibt es?", options: ["3", "4", "5", "6"], correct: 2 },
      { type: "mc", question: "IP44 bedeutet Schutz gegen …", options: ["Staub und Untertauchen", "Fremdkörper >1 mm und Spritzwasser", "nichts", "Explosionen"], correct: 1 },
      { type: "cloze", text: "LS steht für ___-Schalter.", answer: "Leitungsschutz" },
    ],
  },
  {
    id: "inst_3",
    thema: "Installation",
    titel: "Kabel & Querschnitte",
    icon: "🔌",
    levels: ["azubi3", "meister"],
    exercises: [
      { type: "flashcard", front: "NYM-J 3x1,5 mm²", back: "Standard-Installationsleitung: N=Norm, Y=PVC-Isolierung, M=Mantelleitung, J=mit Schutzleiter, 3 Adern á 1,5 mm²." },
      { type: "flashcard", front: "Absicherung 1,5 mm²", back: "Maximal 16 A (Standard-Steckdosenkreis)." },
      { type: "flashcard", front: "Absicherung 2,5 mm²", back: "Maximal 20-25 A, häufig für Herd oder große Verbraucher." },
      { type: "mc", question: "Welchen Querschnitt braucht eine 16-A-Steckdose mindestens?", options: ["0,75 mm²", "1,5 mm²", "2,5 mm²", "4 mm²"], correct: 1 },
      { type: "mc", question: "Was bedeutet das 'J' in NYM-J?", options: ["Jung", "Japan", "mit Schutzleiter", "Junction"], correct: 2 },
      { type: "calc", question: "P = 3680 W bei U = 230 V. Wie hoch ist der Strom I?", answer: 16, unit: "A", hint: "I = P / U" },
    ],
  },
  {
    id: "inst_4",
    thema: "Installation",
    titel: "Drehstrom & Motoren",
    icon: "⚙️",
    levels: ["azubi3", "meister"],
    exercises: [
      { type: "flashcard", front: "Sternschaltung (Y)", back: "Alle Wicklungsenden im Sternpunkt verbunden. U_Strang = U_Leiter/√3." },
      { type: "flashcard", front: "Dreieckschaltung (Δ)", back: "Wicklungen im Dreieck verbunden. I_Leiter = √3 · I_Strang." },
      { type: "flashcard", front: "Drehstromleistung", back: "P = √3 · U · I · cos φ" },
      { type: "mc", question: "Bei Sternschaltung ist U_Strang …", options: ["gleich U_Leiter", "U_Leiter · √3", "U_Leiter / √3", "0"], correct: 2 },
      { type: "mc", question: "Ein Drehstrommotor läuft mit 400 V (Leiter). Wie groß ist U im Strang bei Sternschaltung?", options: ["400 V", "230 V", "690 V", "115 V"], correct: 1 },
      { type: "calc", question: "P = √3 · 400 V · 10 A · 0,8 (cos φ). P = ? (auf Watt gerundet)", answer: 5543, unit: "W", tolerance: 5, hint: "√3 ≈ 1,732" },
    ],
  },
];

// Für globalen Zugriff im Browser
window.APP_DATA = { LEVELS, LESSONS, SYMBOLS };

})();
