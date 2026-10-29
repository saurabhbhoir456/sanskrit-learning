(function () {
  "use strict";

  const STORAGE_KEY = "sanskrit-sangraha-v1";
  const CATEGORIES = [
    "Phrases", "Greetings", "Numbers", "Family", "Nature", "Animals",
    "Food", "Body", "Time", "Everyday Objects", "Verbs", "Adjectives"
  ];
  const WORDS = VOCAB.map(function (w, i) {
    return Object.assign({ id: "w" + i }, w);
  });
  const TOTAL = WORDS.length;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function emptyState() {
    return { known: {}, reviewed: 0, quizBest: 0, quizBestTotal: 10, history: [] };
  }

  function loadState() {
    const base = emptyState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      base.known = parsed.known && typeof parsed.known === "object" ? parsed.known : {};
      base.reviewed = Number(parsed.reviewed) || 0;
      base.quizBest = Number(parsed.quizBest) || 0;
      base.quizBestTotal = Number(parsed.quizBestTotal) || 10;
      base.history = Array.isArray(parsed.history) ? parsed.history : [];
      return base;
    } catch (err) {
      return base;
    }
  }

  let state = loadState();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* storage unavailable */
    }
  }

  let toastTimer = null;
  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 2200);
  }

  const speechOK = "speechSynthesis" in window;
  let voices = [];

  function refreshVoices() {
    if (!speechOK) return;
    try {
      voices = window.speechSynthesis.getVoices() || [];
    } catch (err) {
      voices = [];
    }
  }
  if (speechOK) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }

  function speak(text) {
    if (!speechOK) {
      toast("This browser does not support speech playback.");
      return;
    }
    window.speechSynthesis.cancel();
    if (!voices.length) refreshVoices();
    const utter = new SpeechSynthesisUtterance(text);
    const chosen =
      voices.find(function (v) { return /^sa([-_]|$)/i.test(v.lang); }) ||
      voices.find(function (v) { return /sanskrit/i.test(v.name || ""); }) ||
      voices.find(function (v) { return /^hi([-_]|$)/i.test(v.lang); }) ||
      voices.find(function (v) { return /(devanagari|hindi|marathi|nepali)/i.test(v.name || ""); });
    if (chosen) {
      utter.voice = chosen;
      utter.lang = chosen.lang;
    } else {
      utter.lang = "hi-IN";
    }
    utter.rate = 0.82;
    utter.pitch = 1;
    window.speechSynthesis.speak(utter);
  }

  let currentView = "cards";

  function setView(name) {
    currentView = name;
    $$(".view").forEach(function (v) {
      v.classList.toggle("active", v.id === "view-" + name);
    });
    $$(".tab").forEach(function (t) {
      const on = t.dataset.view === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
    });
    if (name === "progress") renderProgress();
    if (name === "vocab") renderVocab();
    if (name === "quiz") updateBestLabel();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  let deck = [];
  let deckIndex = 0;
  let deckCat = "All";
  let revealed = false;

  function fillCategorySelect() {
    const sel = $("#deck-category");
    sel.innerHTML = "";
    const all = document.createElement("option");
    all.value = "All";
    all.textContent = "All categories (" + TOTAL + ")";
    sel.appendChild(all);
    CATEGORIES.forEach(function (cat) {
      const count = WORDS.filter(function (w) { return w.cat === cat; }).length;
      if (!count) return;
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat + " (" + count + ")";
      sel.appendChild(opt);
    });
  }

  function buildDeck() {
    const pool = deckCat === "All"
      ? WORDS.slice()
      : WORDS.filter(function (w) { return w.cat === deckCat; });
    const mixed = shuffle(pool);
    deck = mixed.filter(function (w) { return !state.known[w.id]; })
      .concat(mixed.filter(function (w) { return state.known[w.id]; }));
    deckIndex = 0;
    renderCard();
  }

  function renderCard() {
    const card = $("#flashcard");
    const word = deck[deckIndex];
    if (!word) {
      $("#card-cat").textContent = "—";
      $("#card-dev").textContent = "—";
      $("#card-cat-back").textContent = "—";
      $("#card-dev-back").textContent = "—";
      $("#card-iast").textContent = "—";
      $("#card-en").textContent = "—";
      $("#deck-count").textContent = "No cards in this deck";
      return;
    }
    card.classList.remove("flipped");
    revealed = false;
    card.setAttribute("aria-label", "Flashcard for " + word.iast + " — activate to reveal");
    $("#card-cat").textContent = word.cat;
    $("#card-dev").textContent = word.dev;
    $("#card-cat-back").textContent = word.cat;
    $("#card-dev-back").textContent = word.dev;
    $("#card-iast").textContent = word.iast;
    $("#card-en").textContent = word.en;
    updateDeckMeta();
  }

  function updateDeckMeta() {
    const known = deck.filter(function (w) { return state.known[w.id]; }).length;
    const pct = deck.length ? Math.round((known / deck.length) * 100) : 0;
    $("#deck-bar").style.width = pct + "%";
    $("#deck-bar-wrap").setAttribute("aria-valuenow", String(pct));
    $("#deck-count").textContent = known + " of " + deck.length + " known in this deck";
  }

  function flipCard() {
    if (!deck.length) return;
    const card = $("#flashcard");
    const nowFlipped = !card.classList.contains("flipped");
    card.classList.toggle("flipped", nowFlipped);
    if (nowFlipped && !revealed) {
      revealed = true;
      state.reviewed += 1;
      saveState();
    }
  }

  function moveCard(delta) {
    if (!deck.length) return;
    deckIndex = (deckIndex + delta + deck.length) % deck.length;
    renderCard();
  }

  function rateCard(known) {
    const word = deck[deckIndex];
    if (!word) return;
    if (known) {
      state.known[word.id] = true;
      deckIndex = (deckIndex + 1) % deck.length;
    } else {
      delete state.known[word.id];
      deck.splice(deckIndex, 1);
      deck.push(word);
      if (deckIndex >= deck.length) deckIndex = 0;
    }
    saveState();
    renderCard();
  }

  let quiz = null;
  let quizDir = "en2sa";

  function updateBestLabel() {
    const el = $("#best-score");
    if (el) el.textContent = state.quizBest ? state.quizBest + " / " + state.quizBestTotal : "—";
  }

  function buildQuestion(word, dir) {
    function labelOf(w) { return dir === "en2sa" ? w.dev : w.en; }
    const correctLabel = labelOf(word);
    let pool = WORDS.filter(function (w) {
      return w.cat === word.cat && w.id !== word.id && labelOf(w) !== correctLabel;
    });
    if (pool.length < 3) {
      pool = WORDS.filter(function (w) {
        return w.id !== word.id && labelOf(w) !== correctLabel;
      });
    }
    const distractors = shuffle(pool).slice(0, 3);
    const options = shuffle([word].concat(distractors)).map(function (w) {
      return { label: labelOf(w), correct: w.id === word.id };
    });
    return {
      word: word,
      prompt: dir === "en2sa" ? word.en : word.dev,
      promptIsDev: dir === "sa2en",
      options: options
    };
  }

  function startQuiz() {
    const picked = shuffle(WORDS).slice(0, 10);
    quiz = {
      dir: quizDir,
      items: picked.map(function (w) { return buildQuestion(w, quizDir); }),
      index: 0,
      score: 0,
      misses: [],
      date: Date.now()
    };
    $("#quiz-setup").classList.add("hidden");
    $("#quiz-result").classList.add("hidden");
    $("#quiz-play").classList.remove("hidden");
    renderQuestion();
    $("#quiz-play").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderQuestion() {
    const item = quiz.items[quiz.index];
    $("#quiz-progress").textContent = "Question " + (quiz.index + 1) + " of " + quiz.items.length;
    $("#quiz-score").textContent = "Score " + quiz.score;
    const q = $("#quiz-question");
    q.textContent = item.prompt;
    q.classList.toggle("devanagari", item.promptIsDev);
    const wrap = $("#quiz-options");
    wrap.innerHTML = "";
    const letters = ["A", "B", "C", "D"];
    item.options.forEach(function (opt, i) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      const letter = document.createElement("span");
      letter.className = "letter";
      letter.textContent = letters[i];
      const label = document.createElement("span");
      label.className = "label" + (quiz.dir === "en2sa" ? " dev" : "");
      label.textContent = opt.label;
      btn.appendChild(letter);
      btn.appendChild(label);
      btn.addEventListener("click", function () { answerQuestion(i, btn); });
      wrap.appendChild(btn);
    });
    $("#quiz-feedback").textContent = "";
    $("#quiz-next").classList.add("hidden");
  }

  function answerQuestion(index, btn) {
    const item = quiz.items[quiz.index];
    const buttons = $$("#quiz-options .option");
    buttons.forEach(function (b, i) {
      b.disabled = true;
      if (item.options[i].correct) b.classList.add("correct");
    });
    const correct = item.options[index].correct;
    if (correct) {
      quiz.score += 1;
    } else {
      btn.classList.add("wrong");
      quiz.misses.push(item.word);
    }
    const word = item.word;
    const feedback = $("#quiz-feedback");
    feedback.innerHTML = "";
    const lead = document.createElement("strong");
    lead.textContent = correct ? "Correct. " : "Not quite. ";
    const dev = document.createElement("span");
    dev.className = "dev";
    dev.textContent = word.dev;
    const rest = document.createElement("span");
    rest.textContent = " · " + word.iast + " · " + word.en;
    feedback.appendChild(lead);
    feedback.appendChild(dev);
    feedback.appendChild(rest);
    $("#quiz-score").textContent = "Score " + quiz.score;
    const next = $("#quiz-next");
    next.textContent = quiz.index + 1 < quiz.items.length ? "Next question" : "See results";
    next.classList.remove("hidden");
    next.focus();
  }

  function nextQuestion() {
    quiz.index += 1;
    if (quiz.index >= quiz.items.length) {
      endQuiz();
    } else {
      renderQuestion();
    }
  }

  function endQuiz() {
    $("#quiz-play").classList.add("hidden");
    $("#quiz-result").classList.remove("hidden");
    const total = quiz.items.length;
    const pct = total ? quiz.score / total : 0;
    $("#result-heading").textContent =
      pct === 1 ? "Perfect score." :
      pct >= 0.7 ? "Nicely done." :
      pct >= 0.4 ? "Good progress." : "Keep practicing.";
    const scoreEl = $("#result-score");
    scoreEl.innerHTML = "";
    scoreEl.appendChild(document.createTextNode(String(quiz.score)));
    const small = document.createElement("small");
    small.textContent = " / " + total;
    scoreEl.appendChild(small);
    $("#result-note").textContent = pct >= 0.7
      ? "You are recalling these quickly. Try the other direction for a challenge."
      : "Review the words below, then run the quiz again.";

    const missBox = $("#result-misses");
    missBox.innerHTML = "";
    if (quiz.misses.length) {
      const label = document.createElement("p");
      label.className = "panel-label";
      label.textContent = "Words to review";
      missBox.appendChild(label);
      const list = document.createElement("div");
      list.className = "miss-list";
      quiz.misses.forEach(function (w) {
        const row = document.createElement("div");
        row.className = "miss-item";
        const d = document.createElement("span");
        d.className = "dev";
        d.textContent = w.dev;
        const i = document.createElement("span");
        i.className = "iast";
        i.textContent = w.iast;
        const e = document.createElement("span");
        e.className = "en";
        e.textContent = w.en;
        row.appendChild(d);
        row.appendChild(i);
        row.appendChild(e);
        list.appendChild(row);
      });
      missBox.appendChild(list);
    }

    if (quiz.score > state.quizBest) {
      state.quizBest = quiz.score;
      state.quizBestTotal = total;
    }
    state.history.push({ score: quiz.score, total: total, dir: quiz.dir, date: quiz.date });
    if (state.history.length > 20) state.history = state.history.slice(-20);
    saveState();
    updateBestLabel();
  }

  function vocabRow(w) {
    const row = document.createElement("div");
    row.className = "vocab-row";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "speak";
    btn.setAttribute("aria-label", "Pronounce " + w.iast);
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    btn.addEventListener("click", function () { speak(w.dev); });
    const dev = document.createElement("span");
    dev.className = "v-dev dev";
    dev.textContent = w.dev;
    const iast = document.createElement("span");
    iast.className = "v-iast";
    iast.textContent = w.iast;
    const en = document.createElement("span");
    en.className = "v-en";
    en.textContent = w.en;
    row.appendChild(btn);
    row.appendChild(dev);
    row.appendChild(iast);
    row.appendChild(en);
    return row;
  }

  function renderVocab() {
    const query = ($("#vocab-search").value || "").trim().toLowerCase();
    const list = $("#vocab-list");
    list.innerHTML = "";
    const matches = WORDS.filter(function (w) {
      if (!query) return true;
      return w.dev.toLowerCase().indexOf(query) !== -1 ||
        w.iast.toLowerCase().indexOf(query) !== -1 ||
        w.en.toLowerCase().indexOf(query) !== -1 ||
        w.cat.toLowerCase().indexOf(query) !== -1;
    });
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No matches. Try another spelling.";
      list.appendChild(empty);
      return;
    }
    CATEGORIES.forEach(function (cat) {
      const rows = matches.filter(function (w) { return w.cat === cat; });
      if (!rows.length) return;
      const group = document.createElement("section");
      group.className = "vocab-group";
      const heading = document.createElement("h3");
      heading.textContent = cat;
      group.appendChild(heading);
      const wrap = document.createElement("div");
      wrap.className = "vocab-rows";
      rows.forEach(function (w) { wrap.appendChild(vocabRow(w)); });
      group.appendChild(wrap);
      list.appendChild(group);
    });
  }

  function renderProgress() {
    const knownCount = WORDS.reduce(function (n, w) {
      return n + (state.known[w.id] ? 1 : 0);
    }, 0);
    $("#stat-known").textContent = String(knownCount);
    $("#stat-total").textContent = String(TOTAL);
    $("#stat-reviewed").textContent = String(state.reviewed);
    $("#stat-best").textContent = state.quizBest ? state.quizBest + "/" + state.quizBestTotal : "—";

    const catBox = $("#category-progress");
    catBox.innerHTML = "";
    CATEGORIES.forEach(function (cat) {
      const items = WORDS.filter(function (w) { return w.cat === cat; });
      if (!items.length) return;
      const known = items.reduce(function (n, w) {
        return n + (state.known[w.id] ? 1 : 0);
      }, 0);
      const line = document.createElement("div");
      line.className = "cat-line";
      const name = document.createElement("span");
      name.className = "cat-name";
      name.textContent = cat;
      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("span");
      fill.style.width = Math.round((known / items.length) * 100) + "%";
      bar.appendChild(fill);
      const num = document.createElement("span");
      num.className = "cat-num";
      num.textContent = known + " / " + items.length;
      line.appendChild(name);
      line.appendChild(bar);
      line.appendChild(num);
      catBox.appendChild(line);
    });

    const hist = $("#quiz-history");
    hist.innerHTML = "";
    if (!state.history.length) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      empty.textContent = "No quizzes yet. Take one to start tracking.";
      hist.appendChild(empty);
      return;
    }
    state.history.slice(-8).slice().sort(function (a, b) { return b.date - a.date; }).forEach(function (run) {
      const row = document.createElement("div");
      row.className = "history-row";
      const left = document.createElement("span");
      left.textContent = run.dir === "en2sa" ? "English → Sanskrit" : "Sanskrit → English";
      const score = document.createElement("span");
      score.className = "h-score";
      score.textContent = run.score + " / " + run.total;
      const date = document.createElement("span");
      date.className = "h-date";
      date.textContent = new Date(run.date).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
      });
      row.appendChild(left);
      row.appendChild(score);
      row.appendChild(date);
      hist.appendChild(row);
    });
  }

  function handleKeys(e) {
    if (currentView !== "cards") return;
    const tag = e.target && e.target.tagName ? e.target.tagName : "";
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(tag)) return;
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      flipCard();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      moveCard(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveCard(-1);
    } else if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      rateCard(true);
    }
  }

  function init() {
    fillCategorySelect();

    $("#deck-category").addEventListener("change", function (e) {
      deckCat = e.target.value;
      buildDeck();
    });
    $("#shuffle-deck").addEventListener("click", function () {
      buildDeck();
      toast("Deck shuffled");
    });
    $("#flashcard").addEventListener("click", flipCard);
    $("#flashcard").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        flipCard();
      }
    });
    $("#known-btn").addEventListener("click", function () { rateCard(true); });
    $("#again-btn").addEventListener("click", function () { rateCard(false); });
    $("#audio-btn").addEventListener("click", function () {
      const word = deck[deckIndex];
      if (word) speak(word.dev);
    });

    $$(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () { setView(tab.dataset.view); });
    });
    $$("[data-goto]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        setView(el.dataset.goto);
      });
    });

    $("#quiz-direction").addEventListener("click", function (e) {
      const btn = e.target.closest("button");
      if (!btn) return;
      quizDir = btn.dataset.dir;
      $$("#quiz-direction button").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
    });
    $("#start-quiz").addEventListener("click", startQuiz);
    $("#quiz-next").addEventListener("click", nextQuestion);
    $("#retry-quiz").addEventListener("click", startQuiz);
    $("#back-to-quiz-setup").addEventListener("click", function () {
      $("#quiz-result").classList.add("hidden");
      $("#quiz-play").classList.add("hidden");
      $("#quiz-setup").classList.remove("hidden");
    });

    $("#vocab-search").addEventListener("input", renderVocab);

    $("#reset-progress").addEventListener("click", function () {
      if (!window.confirm("Reset all saved progress in this browser?")) return;
      state = emptyState();
      saveState();
      renderProgress();
      buildDeck();
      updateBestLabel();
      toast("Progress reset");
    });

    document.addEventListener("keydown", handleKeys);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) saveState();
    });

    buildDeck();
    renderProgress();
    updateBestLabel();
  }

  init();
})();
