const socket = io();
let currentPin    = null;
let questionCount = 0;
let timerInterval = null; // holds the setInterval ID for the numeric countdown

// ── Helpers ───────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function clearTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// duration  — total question time in seconds
// startTime — epoch ms when the server set questionStartTime
// The host fires the question and receives it back almost instantly,
// so elapsed ≈ 0, but using startTime keeps it consistent with participants.
function startTimer(duration, startTime) {
  const elapsed   = Math.max(0, (Date.now() - startTime) / 1000); // seconds already gone
  const remaining = Math.max(0, duration - elapsed);               // seconds left

  // CSS bar: start from the correct remaining % and shrink to 0 over `remaining` seconds
  const fill = document.getElementById('q-timer-fill');
  fill.style.transition = 'none';
  fill.style.width = ((remaining / duration) * 100) + '%';
  fill.getBoundingClientRect(); // force reflow so the reset takes before the transition
  fill.style.transition = `width ${remaining}s linear`;
  fill.style.width = '0%';

  // Numeric countdown
  const text = document.getElementById('q-timer-text');
  if (text) {
    clearTimer();
    let secs = Math.ceil(remaining);
    text.textContent = secs;
    text.classList.remove('timer-urgent');
    timerInterval = setInterval(() => {
      secs--;
      if (secs <= 0) { secs = 0; clearTimer(); }
      text.textContent = secs;
      text.classList.toggle('timer-urgent', secs <= 5);
    }, 1000);
  }
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Medal emoji for top 3, number for the rest
const MEDALS = ['🥇', '🥈', '🥉'];

function renderLeaderboard(containerId, leaderboard) {
  const medalClass = ['top-1', 'top-2', 'top-3'];
  document.getElementById(containerId).innerHTML = leaderboard
    .map((p, i) => `
      <div class="leaderboard-row ${medalClass[i] ?? ''}">
        <span class="rank">${i < 3 ? MEDALS[i] : i + 1}</span>
        <span class="lb-name">${escHtml(p.nickname)}</span>
        <span class="lb-score">${p.score}</span>
      </div>`)
    .join('');
}

// ── Setup ─────────────────────────────────────────────────────

document.getElementById('btn-create').addEventListener('click', () => {
  socket.emit('host:create');
});

socket.on('host:created', ({ pin }) => {
  currentPin    = pin;
  questionCount = 0;
  document.getElementById('pin-display').textContent = pin;
  document.getElementById('question-list').innerHTML = '';
  document.getElementById('btn-start').textContent   = 'Start Quiz';
  showScreen('screen-lobby');
});

// ── Lobby: participant list ────────────────────────────────────

socket.on('host:participants', ({ participants }) => {
  const list = document.getElementById('participant-list');
  list.innerHTML = participants.length === 0
    ? '<span class="hint">Waiting for players…</span>'
    : participants.map(n => `<span class="participant-chip">${escHtml(n)}</span>`).join('');
});

// ── Lobby: question builder ────────────────────────────────────

document.getElementById('btn-add-q').addEventListener('click', addQuestion);

document.getElementById('qf-opt3').addEventListener('keydown', e => {
  if (e.key === 'Enter') addQuestion();
});

async function addQuestion() {
  const errEl    = document.getElementById('qf-error');
  const text     = document.getElementById('qf-text').value.trim();
  const opts     = [0, 1, 2, 3].map(i => document.getElementById(`qf-opt${i}`).value.trim());
  const correct  = parseInt(document.getElementById('qf-correct').value, 10);
  const duration = parseInt(document.getElementById('qf-duration').value, 10) || 20;

  errEl.textContent = '';
  if (!text)              { errEl.textContent = 'Enter a question.';      return; }
  if (opts.some(o => !o)) { errEl.textContent = 'Fill in all 4 options.'; return; }
  if (!currentPin)        { errEl.textContent = 'Create a room first.';   return; }

  try {
    const res = await fetch(`/api/room/${currentPin}/question`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question: text, options: opts, correct, duration })
    });

    let data = {};
    try { data = await res.json(); } catch { /* non-JSON body */ }

    if (!res.ok) {
      errEl.textContent = data.error || `HTTP ${res.status} — did you restart the server?`;
      return;
    }

    questionCount++;
    appendQuestionItem(questionCount, text, opts[correct]);

    document.getElementById('qf-text').value = '';
    [0, 1, 2, 3].forEach(i => { document.getElementById(`qf-opt${i}`).value = ''; });
    document.getElementById('qf-duration').value = '20';
    document.getElementById('qf-text').focus();

    const label = questionCount === 1 ? '1 question' : `${questionCount} questions`;
    document.getElementById('btn-start').textContent = `Start Quiz  (${label})`;
  } catch (err) {
    console.error('addQuestion fetch error:', err);
    errEl.textContent = 'Could not reach server — is it running?';
  }
}

function appendQuestionItem(num, text, correctOption) {
  const list = document.getElementById('question-list');
  const item = document.createElement('div');
  item.className = 'question-item';
  item.innerHTML =
    `<span class="qi-num">${num}</span>` +
    `<span class="qi-text">${escHtml(text)}</span>` +
    `<span class="qi-correct">✓ ${escHtml(correctOption)}</span>`;
  list.appendChild(item);
}

// ── Start / host errors ───────────────────────────────────────

document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('host:next', { pin: currentPin });
});

socket.on('host:error', ({ message }) => {
  document.getElementById('qf-error').textContent = message;
});

// ── Question (host view) ──────────────────────────────────────

const COLORS  = ['opt-red', 'opt-blue', 'opt-yellow', 'opt-green'];
const SYMBOLS = ['▲', '●', '◆', '■'];

socket.on('host:question', ({ question, options, correct, duration, index, total, startTime }) => {
  document.getElementById('q-counter').textContent    = `Question ${index + 1} of ${total}`;
  document.getElementById('q-text').textContent       = question;
  document.getElementById('answer-count').textContent = 'Answers: 0';

  document.getElementById('q-options').innerHTML = options
    .map((opt, i) => `
      <div class="option ${COLORS[i]} ${i === correct ? 'correct-opt' : ''}">
        <span class="opt-symbol">${SYMBOLS[i]}</span> ${escHtml(opt)}
      </div>`)
    .join('');

  startTimer(duration, startTime);
  showScreen('screen-question');
});

socket.on('host:answer-count', ({ answered, total }) => {
  document.getElementById('answer-count').textContent = `Answers: ${answered} / ${total}`;
});

document.getElementById('btn-end-q').addEventListener('click', () => {
  socket.emit('host:end-question', { pin: currentPin });
});

// ── Leaderboard ───────────────────────────────────────────────

socket.on('show:leaderboard', ({ leaderboard, isLast }) => {
  clearTimer();
  renderLeaderboard('leaderboard-list', leaderboard);
  document.getElementById('btn-next').textContent = isLast ? 'End Game' : 'Next Question';
  showScreen('screen-leaderboard');
});

document.getElementById('btn-next').addEventListener('click', () => {
  socket.emit('host:next', { pin: currentPin });
});

// ── Game Over ─────────────────────────────────────────────────

socket.on('game:over', ({ leaderboard }) => {
  clearTimer();
  renderLeaderboard('final-leaderboard', leaderboard);
  showScreen('screen-gameover');
});

// ── Restart ───────────────────────────────────────────────────

document.getElementById('btn-restart').addEventListener('click', () => {
  socket.emit('host:restart-game', { pin: currentPin });
});

// Server confirmed the restart — go back to lobby (same PIN, same questions, scores reset)
socket.on('game:restarted', () => {
  showScreen('screen-lobby');
});

// ── Slide ─────────────────────────────────────────────────────

let slideFormOrigin = 'screen-lobby'; // remembers which screen opened the slide form

document.getElementById('btn-slide-lobby').addEventListener('click', () => {
  slideFormOrigin = 'screen-lobby';
  showScreen('screen-slide-form');
});
document.getElementById('btn-slide-lb').addEventListener('click', () => {
  slideFormOrigin = 'screen-leaderboard';
  showScreen('screen-slide-form');
});

document.getElementById('btn-slide-cancel').addEventListener('click', () => {
  showScreen(slideFormOrigin);
});

document.getElementById('btn-slide-show').addEventListener('click', () => {
  const title  = document.getElementById('sf-title').value.trim();
  const body   = document.getElementById('sf-body').value.trim();
  const errEl  = document.getElementById('sf-error');
  errEl.textContent = '';
  if (!title) { errEl.textContent = 'Please enter a slide title.'; return; }
  socket.emit('host:show-slide', { pin: currentPin, title, body });
});

socket.on('show:slide', ({ title, body }) => {
  document.getElementById('slide-title-host').textContent = title;
  document.getElementById('slide-body-host').textContent  = body || '';
  showScreen('screen-slide-host');
});

document.getElementById('btn-close-slide').addEventListener('click', () => {
  socket.emit('host:close-slide', { pin: currentPin });
});

// Server sends back leaderboard or slide:closed
socket.on('slide:closed', () => {
  // prev was lobby
  showScreen('screen-lobby');
  document.getElementById('sf-title').value = '';
  document.getElementById('sf-body').value  = '';
});

// ── Q&A ───────────────────────────────────────────────────────

document.getElementById('btn-qna-lobby').addEventListener('click', () => {
  socket.emit('host:start-qna', { pin: currentPin });
});
document.getElementById('btn-qna-lb').addEventListener('click', () => {
  socket.emit('host:start-qna', { pin: currentPin });
});

socket.on('start:qna', () => {
  document.getElementById('qna-list-host').innerHTML = '';
  showScreen('screen-qna-host');
});

socket.on('qa:new-item', ({ nickname, question }) => {
  const list = document.getElementById('qna-list-host');
  const item = document.createElement('div');
  item.className = 'qna-item';
  item.innerHTML =
    `<span class="qna-nickname">${escHtml(nickname)}</span>` +
    `<span class="qna-question">${escHtml(question)}</span>`;
  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
});

document.getElementById('btn-end-qna').addEventListener('click', () => {
  socket.emit('host:end-qna', { pin: currentPin });
});

socket.on('qna:ended', () => {
  // prev was lobby
  showScreen('screen-lobby');
});
