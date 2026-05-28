const socket = io();
let myPin         = null;
let myNickname    = null;
let answered      = false;
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

// duration  — total question time in seconds (e.g. 20)
// startTime — epoch ms when the server recorded questionStartTime
//
// Sync logic:
//   elapsed   = time already gone since server started the question
//   remaining = how many seconds are actually left when this client renders
//
// This ensures the bar and countdown are accurate even if the socket event
// arrived a few hundred ms late (e.g. slow network or tab was in the background).
function startTimer(duration, startTime) {
  const elapsed   = Math.max(0, (Date.now() - startTime) / 1000); // seconds already gone
  const remaining = Math.max(0, duration - elapsed);               // seconds truly left

  // CSS fill bar: start from (remaining / duration) % and shrink to 0 over `remaining` s
  const fill = document.getElementById('q-timer-fill');
  fill.style.transition = 'none';
  fill.style.width = ((remaining / duration) * 100) + '%';
  fill.getBoundingClientRect(); // force reflow so the reset lands before the transition
  fill.style.transition = `width ${remaining}s linear`;
  fill.style.width = '0%';

  // Numeric countdown (ticks every second)
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
      // Flash red when 5 seconds or fewer remain
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
      <div class="leaderboard-row ${p.nickname === myNickname ? 'my-row' : ''} ${medalClass[i] ?? ''}">
        <span class="rank">${i < 3 ? MEDALS[i] : i + 1}</span>
        <span class="lb-name">${escHtml(p.nickname)}</span>
        <span class="lb-score">${p.score}</span>
      </div>`)
    .join('');
}

// ── Join ──────────────────────────────────────────────────────

function join() {
  const pin      = document.getElementById('input-pin').value.trim();
  const nickname = document.getElementById('input-nickname').value.trim();
  const errEl    = document.getElementById('join-error');
  errEl.textContent = '';

  if (!pin)                   { errEl.textContent = 'Please enter the room PIN.';  return; }
  if (!nickname)              { errEl.textContent = 'Please enter a nickname.';    return; }
  if (pin.length !== 6)       { errEl.textContent = 'PIN must be 6 digits.';       return; }

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

// ── Question ──────────────────────────────────────────────────

const COLORS  = ['opt-red', 'opt-blue', 'opt-yellow', 'opt-green'];
const SYMBOLS = ['▲', '●', '◆', '■'];

socket.on('participant:question', ({ question, options, duration, index, total, startTime }) => {
  answered = false;

  document.getElementById('q-counter').textContent = `Question ${index + 1} of ${total}`;
  document.getElementById('q-text').textContent    = question;

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

      grid.querySelectorAll('.option').forEach(b => { b.disabled = true; });
      btn.classList.add('selected');

      socket.emit('participant:answer', {
        pin:    myPin,
        answer: parseInt(btn.dataset.index, 10)
      });
    });
  });

  startTimer(duration, startTime);
  showScreen('screen-question');
});

// ── Feedback ──────────────────────────────────────────────────

socket.on('participant:feedback', ({ correct, points }) => {
  clearTimer(); // stop countdown once they've answered
  const icon = document.getElementById('feedback-icon');
  icon.textContent = correct ? '✓' : '✗';
  icon.className   = `feedback-icon ${correct ? 'correct' : 'wrong'}`;

  document.getElementById('feedback-text').textContent   = correct ? 'Correct!' : 'Wrong!';
  document.getElementById('feedback-points').textContent = correct ? `+${points} pts` : 'No points';

  showScreen('screen-feedback');
});

// ── Leaderboard ───────────────────────────────────────────────

socket.on('show:leaderboard', ({ leaderboard }) => {
  clearTimer();
  renderLeaderboard('leaderboard-list', leaderboard);
  showScreen('screen-leaderboard');
});

// ── Game Over ─────────────────────────────────────────────────

socket.on('game:over', ({ leaderboard }) => {
  clearTimer();
  renderLeaderboard('final-leaderboard', leaderboard);
  showScreen('screen-gameover');
});

// ── Restart ───────────────────────────────────────────────────

// Host started a new match — send participants back to the waiting screen
socket.on('game:restarted', () => {
  clearTimer();
  showScreen('screen-waiting');
});

socket.on('game:closed', () => {
  alert('The host has ended the game.');
  location.reload();
});

// ── Slide ─────────────────────────────────────────────────────

socket.on('show:slide', () => {
  clearTimer();
  showScreen('screen-slide');
});

socket.on('slide:closed', () => {
  showScreen('screen-waiting');
});

// ── Q&A ───────────────────────────────────────────────────────

let qaSubmitted = false;

socket.on('start:qna', () => {
  qaSubmitted = false;
  document.getElementById('qa-input').value    = '';
  document.getElementById('qa-status').textContent = '';
  document.getElementById('btn-qa-submit').disabled = false;
  showScreen('screen-qna');
});

document.getElementById('btn-qa-submit').addEventListener('click', () => {
  if (qaSubmitted) return;
  const question = document.getElementById('qa-input').value.trim();
  if (!question) return;
  socket.emit('qa:submit', { pin: myPin, question });
  qaSubmitted = true;
  document.getElementById('btn-qa-submit').disabled = true;
  document.getElementById('qa-status').textContent  = 'Question submitted!';
});

socket.on('qna:ended', () => {
  showScreen('screen-waiting');
});
