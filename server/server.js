const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 8080;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ==========================
// CONFIGURACIÓN PRO
// ==========================

const BOARD_WIDTH = 800;
const BOARD_HEIGHT = 600;
const BOX = 20;

const GAME_SPEED = 80;        // Más bajo = más rápido
const STATE_SPEED = 80;       // Cada cuánto se manda estado
const MAX_FOODS = 28;
const INITIAL_LENGTH = 4;
const MAX_NAME_LENGTH = 18;

const colors = [
  "#00ffff",
  "#ffcc00",
  "#ff66cc",
  "#66ff66",
  "#ff6666",
  "#9966ff",
  "#00ff99",
  "#ff9933",
  "#3399ff",
  "#ffffff",
  "#ff4444",
  "#44ffcc"
];

let players = {};
let foods = [];
let eventHistory = [];

// ==========================
// RUTA DE PRUEBA
// ==========================

app.get("/", (req, res) => {
  res.send("Servidor PRO WebSocket Snake activo");
});

// ==========================
// UTILIDADES
// ==========================

function generateId() {
  return "player_" + Math.random().toString(36).substring(2, 10);
}

function randomColor() {
  return colors[Math.floor(Math.random() * colors.length)];
}

function randomPosition() {
  return {
    x: Math.floor(Math.random() * (BOARD_WIDTH / BOX)) * BOX,
    y: Math.floor(Math.random() * (BOARD_HEIGHT / BOX)) * BOX
  };
}

function sanitizeName(name) {
  return String(name || "")
    .trim()
    .replace(/[<>]/g, "")
    .substring(0, MAX_NAME_LENGTH);
}

function createFood() {
  return randomPosition();
}

function fillFoods() {
  while (foods.length < MAX_FOODS) {
    foods.push(createFood());
  }
}

function createSnake(position) {
  const snake = [];

  for (let i = 0; i < INITIAL_LENGTH; i++) {
    snake.push({
      x: position.x - BOX * i,
      y: position.y
    });
  }

  return snake;
}

function createPlayer(id) {
  const position = randomPosition();

  return {
    id,
    name: "Jugador-" + Math.floor(Math.random() * 1000),
    color: randomColor(),
    score: 0,
    alive: true,
    direction: "RIGHT",
    nextDirection: "RIGHT",
    snake: createSnake(position),
    lastInputAt: Date.now()
  };
}

function isOppositeDirection(current, next) {
  return (
    (current === "UP" && next === "DOWN") ||
    (current === "DOWN" && next === "UP") ||
    (current === "LEFT" && next === "RIGHT") ||
    (current === "RIGHT" && next === "LEFT")
  );
}

function broadcast(data) {
  const message = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function sendTo(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function addEvent(message) {
  const event = {
    type: "event",
    name: "Sistema",
    message,
    time: Date.now()
  };

  eventHistory.unshift(event);

  if (eventHistory.length > 30) {
    eventHistory.pop();
  }

  broadcast({
    type: "chat",
    name: "Sistema",
    message
  });
}

function broadcastChat(name, message) {
  broadcast({
    type: "chat",
    name,
    message
  });
}

function resetPlayer(player, reason) {
  const position = randomPosition();

  player.score = Math.max(0, player.score - 1);
  player.alive = true;
  player.direction = "RIGHT";
  player.nextDirection = "RIGHT";
  player.snake = createSnake(position);

  if (reason) {
    addEvent(reason);
  }
}

function getPublicState() {
  return {
    type: "state",
    players,
    foods,
    events: eventHistory,
    board: {
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
      box: BOX
    },
    serverTime: Date.now()
  };
}

function sendGameState() {
  broadcast(getPublicState());
}

// ==========================
// LÓGICA DEL JUEGO
// ==========================

function updatePlayer(player) {
  if (!player || !player.snake || player.snake.length === 0) {
    return;
  }

  if (!isOppositeDirection(player.direction, player.nextDirection)) {
    player.direction = player.nextDirection;
  }

  const head = player.snake[0];

  let newHead = {
    x: head.x,
    y: head.y
  };

  if (player.direction === "UP") newHead.y -= BOX;
  if (player.direction === "DOWN") newHead.y += BOX;
  if (player.direction === "LEFT") newHead.x -= BOX;
  if (player.direction === "RIGHT") newHead.x += BOX;

  // Choque con borde
  if (
    newHead.x < 0 ||
    newHead.y < 0 ||
    newHead.x >= BOARD_WIDTH ||
    newHead.y >= BOARD_HEIGHT
  ) {
    resetPlayer(player, player.name + " chocó con el borde y reapareció.");
    return;
  }

  // Choque consigo mismo
  for (let i = 1; i < player.snake.length; i++) {
    const part = player.snake[i];

    if (newHead.x === part.x && newHead.y === part.y) {
      resetPlayer(player, player.name + " chocó consigo mismo y reapareció.");
      return;
    }
  }

  // Choque con otros jugadores
  for (const otherId in players) {
    const otherPlayer = players[otherId];

    if (!otherPlayer || otherId === player.id) continue;

    for (let i = 0; i < otherPlayer.snake.length; i++) {
      const part = otherPlayer.snake[i];

      if (newHead.x === part.x && newHead.y === part.y) {
        resetPlayer(
          player,
          player.name + " chocó con " + otherPlayer.name + " y reapareció."
        );
        return;
      }
    }
  }

  player.snake.unshift(newHead);

  let ateFood = false;

  for (let i = 0; i < foods.length; i++) {
    const food = foods[i];

    if (newHead.x === food.x && newHead.y === food.y) {
      player.score++;
      foods.splice(i, 1);
      ateFood = true;

      if (player.score % 5 === 0) {
        addEvent(player.name + " llegó a " + player.score + " puntos.");
      }

      break;
    }
  }

  if (!ateFood) {
    player.snake.pop();
  }

  fillFoods();
}

function gameLoop() {
  for (const id in players) {
    updatePlayer(players[id]);
  }
}

function stateLoop() {
  sendGameState();
}

// ==========================
// WEBSOCKET
// ==========================

wss.on("connection", (ws) => {
  const id = generateId();
  const player = createPlayer(id);

  ws.playerId = id;
  players[id] = player;

  console.log("Jugador conectado:", player.name);

  sendTo(ws, {
    type: "welcome",
    id: player.id,
    name: player.name,
    color: player.color
  });

  sendTo(ws, {
    type: "history",
    events: eventHistory
  });

  addEvent(player.name + " se unió al juego.");
  sendGameState();

  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch (error) {
      console.log("Mensaje inválido:", message.toString());
      return;
    }

    const currentPlayer = players[ws.playerId];

    if (!currentPlayer) return;

    if (data.type === "direction") {
      const direction = data.direction;

      if (
        direction === "UP" ||
        direction === "DOWN" ||
        direction === "LEFT" ||
        direction === "RIGHT"
      ) {
        if (!isOppositeDirection(currentPlayer.direction, direction)) {
          currentPlayer.nextDirection = direction;
          currentPlayer.lastInputAt = Date.now();
        }
      }
    }

    if (data.type === "chat") {
      const text = String(data.message || "").trim().substring(0, 120);

      if (text !== "") {
        broadcastChat(currentPlayer.name, text);
      }
    }

    if (data.type === "rename") {
      const newName = sanitizeName(data.name);

      if (newName !== "") {
        const oldName = currentPlayer.name;
        currentPlayer.name = newName;

        sendTo(ws, {
          type: "welcome",
          id: currentPlayer.id,
          name: currentPlayer.name,
          color: currentPlayer.color
        });

        addEvent(oldName + " ahora se llama " + currentPlayer.name + ".");
        sendGameState();
      }
    }
  });

  ws.on("close", () => {
    const disconnectedPlayer = players[ws.playerId];

    if (disconnectedPlayer) {
      addEvent(disconnectedPlayer.name + " salió del juego.");
      console.log("Jugador desconectado:", disconnectedPlayer.name);
      delete players[ws.playerId];
      sendGameState();
    }
  });

  ws.on("error", (error) => {
    console.log("Error WebSocket:", error.message);
  });
});

// ==========================
// INICIAR
// ==========================

fillFoods();

setInterval(gameLoop, GAME_SPEED);
setInterval(stateLoop, STATE_SPEED);

server.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor PRO WebSocket Snake escuchando en puerto " + PORT);
});