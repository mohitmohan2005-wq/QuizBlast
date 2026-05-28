const socket = io();
let currentPin     = null;
let questionCount  = 0;

// ── Helpers ───────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function renderLeaderboard(containerId, leaderboard) {
  const medalClass = ['top-1', 'top-2', 'top-3'];
  document.getElementById(containerId).innerHTML = leaderboard
    .map((p, i) => `
      <div class="leaderboard-row ${medalClass[i] ?? ''}">
        <span class="rank">${i + 1}</span>
        <span class="lb-name">${escHtml(p.nickname)}</span>
        <span class="lb-score">${p.score}</span>
      </div>`)
    .join('');
}

function startTimer(duration) {
  const fill = document.getElementById('q-timer-fill');
  fill.style.transition = 'none';
  fill.style.width = '100%';
  fill.getBoundingClientRect();
  fill.style.transition = `width ${duration}s linear`;
  fill.style.width = '0%';
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// Also allow Enter on the last option input to submit
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
  if (!text)               { errEl.textContent = 'Enter a question.';          return; }
  if (opts.some(o => !o))  { errEl.textContent = 'Fill in all 4 options.';     return; }
  if (!currentPin)         { errEl.textContent = 'Create a room first.';       return; }

  try {
    const res = await fetch(`/api/room/${currentPin}/question`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question: text, options: opts, correct, duration })
    });

    // res.json() throws if the server returns plain-text (e.g. old server with no route)
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON body */ }

    if (!res.ok) {
      errEl.textContent = data.error || `HTTP ${res.status} — did you restart the server?`;
      return;
    }

    questionCount++;
    appendQuestionItem(questionCount, text, opts[correct]);

    // Clear the form for the next question
    document.getElementById('qf-text').value = '';
    [0, 1, 2, 3].forEach(i => { document.getElementById(`qf-opt${i}`).value = ''; });
    document.getElementById('qf-duration').value = '20';
    document.getElementById('qf-text').focus();

    // Reflect count in the start button
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

socket.on('host:question', ({ question, options, correct, duration, index, total }) => {
  document.getElementById('q-counter').textContent  = `Question ${index + 1} of ${total}`;
  document.getElementById('q-text').textContent     = question;
  document.getElementById('answer-count').textContent = 'Answers: 0';

  document.getElementById('q-options').innerHTML = options
    .map((opt, i) => `
      <div class="option ${COLORS[i]} ${i === correct ? 'correct-opt' : ''}">
        <span class="opt-symbol">${SYMBOLS[i]}</span> ${escHtml(opt)}
      </div>`)
    .join('');

  startTimer(duration);
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
  renderLeaderboard('leaderboard-list', leaderboard);
  document.getElementById('btn-next').textContent = isLast ? 'End Game' : 'Next Question';
  showScreen('screen-leaderboard');
});

document.getElementById('btn-next').addEventListener('click', () => {
  socket.emit('host:next', { pin: currentPin });
});

// ── Game Over ─────────────────────────────────────────────────

socket.on('game:over', ({ leaderboard }) => {
  renderLeaderboard('final-leaderboard', leaderboard);
  showScreen('screen-gameover');
});
