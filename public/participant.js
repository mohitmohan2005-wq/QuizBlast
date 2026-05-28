const socket = io();
let myPin      = null;
let myNickname = null;
let answered   = false;

// ── Helpers ───────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function renderLeaderboard(containerId, leaderboard) {
  const medalClass = ['top-1', 'top-2', 'top-3'];
  document.getElementById(containerId).innerHTML = leaderboard
    .map((p, i) => `
      <div class="leaderboard-row ${p.nickname === myNickname ? 'my-row' : ''} ${medalClass[i] ?? ''}">
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
  fill.getBoundingClientRect(); // force reflow
  fill.style.transition = `width ${duration}s linear`;
  fill.style.width = '0%';
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Join ──────────────────────────────────────────────────

function join() {
  const pin      = document.getElementById('input-pin').value.trim();
  const nickname = document.getElementById('input-nickname').value.trim();
  const errEl    = document.getElementById('join-error');
  errEl.textContent = '';

  if (!pin)      { errEl.textContent = 'Please enter the room PIN.';  return; }
  if (!nickname) { errEl.textContent = 'Please enter a nickname.';     return; }
  if (pin.length !== 6) { errEl.textContent = 'PIN must be 6 digits.'; return; }

  socket.emit('participant:join', { pin, nickname });
}

document.getElementById('btn-join').addEventListener('click', join);
document.getElementById('input-pin').addEventListener('keydown',      e => { if (e.key === 'Enter') join(); });
document.getElementById('input-nickname').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

socket.on('join:error', ({ message }) => {
  document.getElementById('join-error').textContent = message;
});

socket.on('participant:joined', ({ pin, nickname }) => {
  myPin      = pin;
  myNickname = nickname;
  document.getElementById('waiting-name').textContent = `Joined as: ${escHtml(nickname)}`;
  showScreen('screen-waiting');
});

// ── Question ──────────────────────────────────────────────

const COLORS  = ['opt-red', 'opt-blue', 'opt-yellow', 'opt-green'];
const SYMBOLS = ['▲', '●', '◆', '■'];

socket.on('participant:question', ({ question, options, duration, index, total }) => {
  answered = false;

  document.getElementById('q-counter').textContent = `Question ${index + 1} of ${total}`;
  document.getElementById('q-text').textContent = question;

  const grid = document.getElementById('q-options');
  grid.innerHTML = options
    .map((opt, i) => `
      <button class="option ${COLORS[i]}" data-index="${i}">
        <span class="opt-symbol">${SYMBOLS[i]}</span> ${escHtml(opt)}
      </button>`)
    .join('');

  grid.querySelectorAll('.option').forEach(btn => {
    btn.addEventListener('click', () => {
      if (answered) return;
      answered = true;

      // Disable all buttons and highlight the chosen one
      grid.querySelectorAll('.option').forEach(b => { b.disabled = true; });
      btn.classList.add('selected');

      socket.emit('participant:answer', {
        pin: myPin,
        answer: parseInt(btn.dataset.index, 10)
      });
    });
  });

  startTimer(duration);
  showScreen('screen-question');
});

// ── Feedback ──────────────────────────────────────────────

socket.on('participant:feedback', ({ correct, points }) => {
  const icon = document.getElementById('feedback-icon');
  icon.textContent = correct ? '✓' : '✗';
  icon.className   = `feedback-icon ${correct ? 'correct' : 'wrong'}`;

  document.getElementById('feedback-text').textContent   = correct ? 'Correct!' : 'Wrong!';
  document.getElementById('feedback-points').textContent = correct ? `+${points} pts` : 'No points';

  showScreen('screen-feedback');
});

// ── Leaderboard ───────────────────────────────────────────

socket.on('show:leaderboard', ({ leaderboard }) => {
  renderLeaderboard('leaderboard-list', leaderboard);
  showScreen('screen-leaderboard');
});

// ── Game Over ─────────────────────────────────────────────

socket.on('game:over', ({ leaderboard }) => {
  renderLeaderboard('final-leaderboard', leaderboard);
  showScreen('screen-gameover');
});

socket.on('game:closed', () => {
  alert('The host has ended the game.');
  location.reload();
});
