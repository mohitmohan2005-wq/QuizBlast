const socket = io();

// ── Helpers ───────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function updateParticipants(participants) {
  const countEl = document.getElementById('participant-count');
  const listEl  = document.getElementById('participant-list');
  countEl.textContent = `${participants.length} player${participants.length !== 1 ? 's' : ''} joined`;
  listEl.innerHTML    = participants
    .map(n => `<span class="participant-chip">${escHtml(n)}</span>`)
    .join('');
}

// ── Join ──────────────────────────────────────────────────────

document.getElementById('btn-join').addEventListener('click', join);
document.getElementById('input-pin').addEventListener('keydown', e => {
  if (e.key === 'Enter') join();
});

function join() {
  const pin   = document.getElementById('input-pin').value.trim();
  const errEl = document.getElementById('join-error');
  errEl.textContent = '';

  if (pin.length !== 6) {
    errEl.textContent = 'Enter a valid 6-digit PIN.';
    return;
  }
  socket.emit('presenter:join', { pin });
}

socket.on('join:error', ({ message }) => {
  document.getElementById('join-error').textContent = message;
});

// ── Lobby ─────────────────────────────────────────────────────

socket.on('presenter:joined', ({ pin, participants }) => {
  document.getElementById('lobby-pin').textContent = pin;
  updateParticipants(participants);
  showScreen('screen-lobby');
});

socket.on('host:participants', ({ participants }) => {
  updateParticipants(participants);
});

// ── Question ──────────────────────────────────────────────────

const COLORS  = ['opt-red', 'opt-blue', 'opt-yellow', 'opt-green'];
const SYMBOLS = ['▲', '●', '◆', '■'];

// Presenter receives the same event as participants (no correct answer included)
socket.on('participant:question', ({ question, options, duration, index, total }) => {
  document.getElementById('q-counter').textContent       = `Question ${index + 1} of ${total}`;
  document.getElementById('q-text').textContent          = question;
  document.getElementById('answer-count').textContent    = 'Answers: 0';

  // Options are non-interactive divs — same colours as participant buttons
  document.getElementById('q-options').innerHTML = options
    .map((opt, i) => `
      <div class="option ${COLORS[i]}">
        <span class="opt-symbol">${SYMBOLS[i]}</span> ${escHtml(opt)}
      </div>`)
    .join('');

  startTimer(duration);
  showScreen('screen-question');
});

socket.on('host:answer-count', ({ answered, total }) => {
  document.getElementById('answer-count').textContent = `Answers: ${answered} / ${total}`;
});

// ── Leaderboard ───────────────────────────────────────────────

socket.on('show:leaderboard', ({ leaderboard }) => {
  renderLeaderboard('leaderboard-list', leaderboard);
  showScreen('screen-leaderboard');
});

socket.on('game:over', ({ leaderboard }) => {
  renderLeaderboard('final-leaderboard', leaderboard);
  showScreen('screen-gameover');
});

socket.on('game:closed', () => {
  alert('The host has ended the game.');
  location.reload();
});
