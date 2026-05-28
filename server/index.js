require("dotenv").config();

const mongoose = require("mongoose");
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Mongoose models ───────────────────────────────────────────

const questionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options:  { type: [String], required: true },
  correct:  { type: Number, required: true },
  duration: { type: Number, default: 20 }
});

const roomSchema = new mongoose.Schema({
  pin:       { type: String, unique: true, required: true },
  questions: [questionSchema],
  createdAt: { type: Date, default: Date.now, expires: 86400 } // auto-delete after 24 h
});

const Room = mongoose.model('Room', roomSchema);

// ── In-memory room store ──────────────────────────────────────
const rooms = {};

// ── Helpers ───────────────────────────────────────────────────

function generatePin() {
  let pin;
  do {
    pin = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms[pin]);
  return pin;
}

function getParticipantList(room) {
  return Object.values(room.participants).map(p => p.nickname);
}

function getLeaderboard(room) {
  return Object.values(room.participants)
    .map(p => ({ nickname: p.nickname, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

// Send an event to the host AND every connected presenter
function emitToHostAndPresenters(room, event, data) {
  io.to(room.hostId).emit(event, data);
  room.presenters.forEach(sid => io.to(sid).emit(event, data));
}

function endQuestion(pin) {
  const room = rooms[pin];
  if (!room || room.state !== 'question') return;
  room.state = 'leaderboard';

  const q      = room.questions[room.currentQuestion];
  const isLast = room.currentQuestion >= room.questions.length - 1;

  io.to(pin).emit('show:leaderboard', {
    leaderboard: getLeaderboard(room),
    correct: q.correct,
    isLast
  });
}

// ── REST: add a question to a room ───────────────────────────

app.post('/api/room/:pin/question', async (req, res) => {
  try {
    const { pin } = req.params;
    const { question, options, correct, duration } = req.body ?? {};

    if (!question || !Array.isArray(options) || options.length !== 4 ||
        options.some(o => !o) || correct === undefined || !duration) {
      return res.status(400).json({ error: 'Invalid question data.' });
    }

    if (!rooms[pin]) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    const q = {
      question,
      options,
      correct:  Number(correct),
      duration: Number(duration)
    };

    // Save to MongoDB (best-effort — in-memory is the live source of truth)
    Room.findOneAndUpdate({ pin }, { $push: { questions: q } }).catch(err =>
      console.error('MongoDB question save failed:', err)
    );

    rooms[pin].questions.push(q);

    res.json({ success: true, total: rooms[pin].questions.length });
  } catch (err) {
    console.error('POST /question error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Socket.io ─────────────────────────────────────────────────

io.on('connection', (socket) => {

  // Host creates a room
  socket.on('host:create', async () => {
    const pin = generatePin();

    try {
      await Room.create({ pin, questions: [] });
    } catch (err) {
      console.error('DB room create failed:', err);
    }

    rooms[pin] = {
      pin,
      hostId:          socket.id,
      state:           'lobby',
      participants:    {},
      presenters:      new Set(),   // socket IDs of presenter screens
      questions:       [],          // filled via POST /api/room/:pin/question
      currentQuestion: -1,
      questionStartTime: null,
      answers:         {},
      timer:           null
    };

    socket.join(pin);
    socket.data.pin    = pin;
    socket.data.isHost = true;
    socket.emit('host:created', { pin });
  });

  // Presenter joins (read-only display screen)
  socket.on('presenter:join', ({ pin }) => {
    const room = rooms[pin];
    if (!room) {
      socket.emit('join:error', { message: 'Room not found.' });
      return;
    }
    room.presenters.add(socket.id);
    socket.join(pin);
    socket.data.pin         = pin;
    socket.data.isPresenter = true;

    // Send the current lobby state immediately
    socket.emit('presenter:joined', {
      pin,
      participants: getParticipantList(room)
    });
  });

  // Participant joins
  socket.on('participant:join', ({ pin, nickname }) => {
    const room = rooms[pin];
    if (!room) {
      socket.emit('join:error', { message: 'Room not found.' });
      return;
    }
    if (room.state !== 'lobby') {
      socket.emit('join:error', { message: 'Game already started.' });
      return;
    }
    if (Object.values(room.participants).some(p => p.nickname === nickname)) {
      socket.emit('join:error', { message: 'Nickname already taken.' });
      return;
    }

    room.participants[socket.id] = { nickname, score: 0 };
    socket.join(pin);
    socket.data.pin    = pin;
    socket.data.isHost = false;

    socket.emit('participant:joined', { pin, nickname });
    // Notify host AND all presenter screens
    emitToHostAndPresenters(room, 'host:participants', {
      participants: getParticipantList(room)
    });
  });

  // Host advances to the next question
  socket.on('host:next', ({ pin }) => {
    const room = rooms[pin];
    if (!room || room.hostId !== socket.id) return;

    if (room.questions.length === 0) {
      socket.emit('host:error', { message: 'Add at least one question before starting.' });
      return;
    }

    const nextIndex = room.currentQuestion + 1;

    if (nextIndex >= room.questions.length) {
      room.state = 'finished';
      io.to(pin).emit('game:over', { leaderboard: getLeaderboard(room) });
      return;
    }

    room.currentQuestion  = nextIndex;
    room.state            = 'question';
    room.answers          = {};
    room.questionStartTime = Date.now();

    const q = room.questions[nextIndex];

    // Host: sees which answer is correct
    socket.emit('host:question', {
      question: q.question,
      options:  q.options,
      correct:  q.correct,
      duration: q.duration,
      index:    nextIndex,
      total:    room.questions.length
    });

    // Everyone else in the room (participants + presenters): no correct answer
    socket.to(pin).emit('participant:question', {
      question: q.question,
      options:  q.options,
      duration: q.duration,
      index:    nextIndex,
      total:    room.questions.length
    });

    room.timer = setTimeout(() => endQuestion(pin), q.duration * 1000);
  });

  // Participant submits an answer
  socket.on('participant:answer', ({ pin, answer }) => {
    const room = rooms[pin];
    if (!room || room.state !== 'question') return;
    if (room.answers[socket.id]) return; // one answer only

    const timeTaken = (Date.now() - room.questionStartTime) / 1000;
    const q         = room.questions[room.currentQuestion];
    const correct   = answer === q.correct;
    const points    = correct
      ? Math.max(0, Math.round(1000 * (1 - timeTaken / q.duration)))
      : 0;

    room.answers[socket.id] = { answer, timeTaken, correct, points };
    if (room.participants[socket.id]) {
      room.participants[socket.id].score += points;
    }

    socket.emit('participant:feedback', { correct, points });

    const answered = Object.keys(room.answers).length;
    const total    = Object.keys(room.participants).length;
    // Notify host AND presenter screens of live answer count
    emitToHostAndPresenters(room, 'host:answer-count', { answered, total });

    if (answered >= total) {
      clearTimeout(room.timer);
      endQuestion(pin);
    }
  });

  // Host manually ends the current question
  socket.on('host:end-question', ({ pin }) => {
    const room = rooms[pin];
    if (!room || room.hostId !== socket.id) return;
    clearTimeout(room.timer);
    endQuestion(pin);
  });

  socket.on('disconnect', () => {
    const pin = socket.data.pin;
    if (!pin || !rooms[pin]) return;

    const room = rooms[pin];

    if (socket.data.isHost) {
      clearTimeout(room.timer);
      io.to(pin).emit('game:closed');
      delete rooms[pin];
    } else if (socket.data.isPresenter) {
      room.presenters.delete(socket.id);
    } else {
      delete room.participants[socket.id];
      delete room.answers[socket.id];
      emitToHostAndPresenters(room, 'host:participants', {
        participants: getParticipantList(room)
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`QuizBlast running → http://localhost:${PORT}`);
  console.log(`  Host:        http://localhost:${PORT}/host.html`);
  console.log(`  Participant: http://localhost:${PORT}/participant.html`);
  console.log(`  Presenter:   http://localhost:${PORT}/presenter.html`);
});
