const socket = io();
let timerInterval = null; // holds the setInterval ID for the numeric countdown

// ── Helpers ───────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// duration  — total question time in seconds
// startTime — epoch ms when the server recorded questionStartTime
//
// Sync logic: the presenter may receive this event slightly after the server
// set questionStartTime (network delay). We compute how many seconds have
// already elapsed and start the bar / countdown from the correct offset,
// so the presenter display always matches the server's internal clock.
function startTimer(duration, startTime) {
  const elapsed   = Math.max(0, (Date.now() - startTime) / 1000); // seconds already gone
  const remaining = Math.max(0, duration - elapsed);               // seconds truly left

  // CSS fill bar: start at (remaining / duration) % and shrink to 0 over `remaining` s
  const fill = document.getElementById('q-timer-fill');
  fill.style.transition = 'none';
  fill.style.width = ((remaining / duration) * 100) + '%';
  fill.getBoundingClientRect(); // force reflow before transition starts
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
      // Turn red and pulse when 5 or fewer seconds remain
      text.classList.toggle('timer-urgent', secs <= 5);
    }, 1000);
  }
}

function updateParticipants(participants) {
  const countEl = document.getElementById('participant-count');
  const listEl  = document.getElementById('participant-list');
  countEl.textContent = `${participants.length} player${participants.length !== 1 ? 's' : ''} joined`;
  listEl.innerHTML    = participants
    .map(n => `<span class="participant-chip">${escHtml(n)}</span>`)
    .join('');
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

// Presenter receives participant:question (same payload as participants, no correct answer)
socket.on('participant:question', ({ question, options, duration, index, total, startTime }) => {
  document.getElementById('q-counter').textContent    = `Question ${index + 1} of ${total}`;
  document.getElementById('q-text').textContent       = question;
  document.getElementById('answer-count').textContent = 'Answers: 0';

  // Non-interactive coloured divs — same visual as participant buttons
  document.getElementById('q-options').innerHTML = options
    .map((opt, i) => `
      <div class="option ${COLORS[i]}">
        <span class="opt-symbol">${SYMBOLS[i]}</span> ${escHtml(opt)}
      </div>`)
    .join('');

  startTimer(duration, startTime);
  showScreen('screen-question');
});

socket.on('host:answer-count', ({ answered, total }) => {
  document.getElementById('answer-count').textContent = `Answers: ${answered} / ${total}`;
});

// ── Leaderboard ───────────────────────────────────────────────

socket.on('show:leaderboard', ({ leaderboard }) => {
  clearTimer();
  renderLeaderboard('leaderboard-list', leaderboard);
  showScreen('screen-leaderboard');
});

socket.on('game:over', ({ leaderboard }) => {
  clearTimer();
  renderLeaderboard('final-leaderboard', leaderboard);
  showScreen('screen-gameover');
});

// ── Restart ───────────────────────────────────────────────────

// Host started a new match — go back to the lobby (PIN stays the same)
socket.on('game:restarted', () => {
  clearTimer();
  showScreen('screen-lobby');
});

socket.on('game:closed', () => {
  alert('The host has ended the game.');
  location.reload();
});

// ── Slide ─────────────────────────────────────────────────────

socket.on('show:slide', ({ title, body }) => {
  clearTimer();
  document.getElementById('slide-title-display').textContent = title;
  document.getElementById('slide-body-display').textContent  = body || '';
  showScreen('screen-slide');
});

socket.on('slide:closed', () => {
  showScreen('screen-lobby');
});

// ── Q&A ───────────────────────────────────────────────────────

socket.on('start:qna', () => {
  document.getElementById('qna-list-presenter').innerHTML = '';
  showScreen('screen-qna');
});

socket.on('qa:new-item', ({ nickname, question }) => {
  const list = document.getElementById('qna-list-presenter');
  const item = document.createElement('div');
  item.className = 'qna-item';
  item.innerHTML =
    `<span class="qna-nickname">${escHtml(nickname)}</span>` +
    `<span class="qna-question">${escHtml(question)}</span>`;
  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
});

socket.on('qna:ended', () => {
  showScreen('screen-lobby');
});
