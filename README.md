# QuizBlast

QuizBlast is a real-time multiplayer quiz platform built using **Node.js, Express.js, Socket.IO, and MongoDB**. The platform enables hosts to create live quiz sessions, participants to join using a unique room PIN, and presenters to display questions and results during gameplay.

## Features

* Real-time multiplayer quiz sessions
* Unique room PIN system
* Presenter mode
* Dynamic speed-based scoring
* Live leaderboard updates
* Live answer count tracking
* Q&A session support
* Waiting state synchronization
* Restart / New Match functionality
* MongoDB persistence
* Mobile-friendly participant interface

## Tech Stack

### Frontend

* HTML
* CSS
* JavaScript

### Backend

* Node.js
* Express.js
* Socket.IO
* MongoDB
* Mongoose

## Project Structure

```text
QuizBlast/
├── public/
│   ├── host.html
│   ├── participant.html
│   ├── presenter.html
│   ├── host.js
│   ├── participant.js
│   ├── presenter.js
│   └── style.css
│
├── server/
│   └── index.js
│
├── package.json
├── package-lock.json
└── README.md
```

## Installation

Clone the repository:

```bash
git clone https://github.com/mohitmohan2005-wq/QuizBlast.git
cd QuizBlast
```

Install dependencies:

```bash
npm install
```

Create a `.env` file in the project root:

```env
MONGO_URI=your_mongodb_connection_string
```

Start the application:

```bash
npm start
```

## Application URLs

```text
Host:
http://localhost:3000/host.html

Participant:
http://localhost:3000/participant.html

Presenter:
http://localhost:3000/presenter.html
```

## Core Workflow

1. Host creates a room.
2. Backend generates a unique room PIN.
3. Participants join using the PIN.
4. Host starts questions.
5. Participants answer in real time.
6. Backend calculates speed-based scores.
7. Leaderboard updates instantly.
8. Host can launch Q&A sessions.
9. Session can be restarted without disconnecting participants.

## Scoring System

Scores are calculated based on correctness and response time.

* Faster correct answers receive higher points.
* Slower correct answers receive fewer points.
* Incorrect answers receive zero points.

## Author

Mohit Mohan
IIT Guwahati
