const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// ==========================
// CONFIGURACIÓN DEL JUEGO
// ==========================

const BOARD_WIDTH = 800;
const BOARD_HEIGHT = 600;
const BOX = 20;

const players = {};
let foods = [];

const COLORS = [
  "#00ffff",
  "#ffcc00",
  "#ff66cc",
  "#66ff66",
  "#ff6666",
  "#6699ff",
  "#ffffff",
  "#ff9900",
  "#cc99ff",
  "#00ff99"
];

const FOOD_COUNT = 25;

// ==========================
// FUNCIONES GENERALES
// ==========================

function generateId() {
  return "player_" + Math.random().toString(36).substring(2, 10);
}

function randomGridPosition() {
  return {
    x: Math.floor(Math.random() * (BOARD_WIDTH / BOX)) * BOX,
    y: Math.floor(Math.random() * (BOARD_HEIGHT / BOX)) * BOX
  };
}

function generateFoods() {
  foods = [];

  for (let i = 0; i < FOOD_COUNT; i++) {
    foods.push(randomGridPosition());
  }
}

function createPlayer(id) {
  const pos = randomGridPosition();

  return {
    id: id,
    name: "Jugador-" + id.substring(7, 11),
    color: COLORS[Object.keys(players).length % COLORS.length],
    snake: [
      { x: pos.x, y: pos.y },
      { x: pos.x - BOX, y: pos.y },
      { x: pos.x - BOX * 2, y: pos.y }
    ],
    direction: "RIGHT",
    nextDirection: "RIGHT",
    score: 0,
    alive: true
  };
}

function broadcast(data) {
  const message = JSON.stringify(data);

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function sendChat(name, message) {
  broadcast({
    type: "chat",
    name: name,
    message: message
  });
}

// ==========================
// LÓGICA DEL JUEGO
// ==========================

function movePlayers() {
  for (const id in players) {
    const player = players[id];

    if (!player.alive) continue;

    player.direction = player.nextDirection;

    const head = player.snake[0];

    if (!head) continue;

    let newHead = {
      x: head.x,
      y: head.y
    };

    if (player.direction === "UP") newHead.y -= BOX;
    if (player.direction === "DOWN") newHead.y += BOX;
    if (player.direction === "LEFT") newHead.x -= BOX;
    if (player.direction === "RIGHT") newHead.x += BOX;

    // Modo tipo Slither: si sale por un borde, aparece por el otro
    if (newHead.x < 0) newHead.x = BOARD_WIDTH - BOX;
    if (newHead.x >= BOARD_WIDTH) newHead.x = 0;
    if (newHead.y < 0) newHead.y = BOARD_HEIGHT - BOX;
    if (newHead.y >= BOARD_HEIGHT) newHead.y = 0;

    // Colisión con otros jugadores
    if (collidesWithAnySnake(newHead, id)) {
      sendChat("Sistema", player.name + " chocó y reinició.");
      resetPlayer(player);
      continue;
    }

    player.snake.unshift(newHead);

    const foodIndex = getFoodCollisionIndex(newHead);

    if (foodIndex !== -1) {
      player.score += 1;
      foods.splice(foodIndex, 1);
      foods.push(randomGridPosition());
    } else {
      player.snake.pop();
    }
  }

  broadcastState();
}

function getFoodCollisionIndex(position) {
  for (let i = 0; i < foods.length; i++) {
    if (foods[i].x === position.x && foods[i].y === position.y) {
      return i;
    }
  }

  return -1;
}

function collidesWithAnySnake(position, currentPlayerId) {
  for (const id in players) {
    const player = players[id];

    for (let i = 0; i < player.snake.length; i++) {
      // No comparar la nueva cabeza con la cabeza actual del mismo jugador
      if (id === currentPlayerId && i === 0) {
        continue;
      }

      const part = player.snake[i];

      if (position.x === part.x && position.y === part.y) {
        return true;
      }
    }
  }

  return false;
}

function resetPlayer(player) {
  const pos = randomGridPosition();

  player.snake = [
    { x: pos.x, y: pos.y },
    { x: pos.x - BOX, y: pos.y },
    { x: pos.x - BOX * 2, y: pos.y }
  ];

  player.direction = "RIGHT";
  player.nextDirection = "RIGHT";
  player.score = 0;
  player.alive = true;
}

function broadcastState() {
  broadcast({
    type: "state",
    players: players,
    foods: foods,
    board: {
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
      box: BOX
    }
  });
}

function changeDirection(player, newDirection) {
  if (!player) return;

  if (
    newDirection === "UP" && player.direction !== "DOWN" ||
    newDirection === "DOWN" && player.direction !== "UP" ||
    newDirection === "LEFT" && player.direction !== "RIGHT" ||
    newDirection === "RIGHT" && player.direction !== "LEFT"
  ) {
    player.nextDirection = newDirection;
  }
}

// ==========================
// WEBSOCKET
// ==========================

wss.on("connection", ws => {
  const id = generateId();
  const player = createPlayer(id);

  players[id] = player;
  ws.playerId = id;

  ws.send(JSON.stringify({
    type: "welcome",
    id: id,
    name: player.name,
    color: player.color
  }));

  sendChat("Sistema", player.name + " se unió al juego.");
  broadcastState();

  ws.on("message", message => {
    try {
      const data = JSON.parse(message.toString());
      const player = players[ws.playerId];

      if (!player) return;

      if (data.type === "chat") {
        sendChat(player.name, data.message);
      }

      if (data.type === "direction") {
        changeDirection(player, data.direction);
      }

      if (data.type === "rename") {
        const oldName = player.name;
        player.name = data.name || player.name;

        sendChat("Sistema", oldName + " ahora se llama " + player.name + ".");
        broadcastState();
      }

    } catch (error) {
      // Compatibilidad con el chat anterior:
      // Si llega texto simple, lo reenviamos como mensaje de chat.
      const player = players[ws.playerId];

      if (player) {
        sendChat(player.name, message.toString());
      }
    }
  });

  ws.on("close", () => {
    const player = players[ws.playerId];

    if (player) {
      sendChat("Sistema", player.name + " salió del juego.");
      delete players[ws.playerId];
      broadcastState();
    }
  });
});

// ==========================
// RUTA HTTP
// ==========================

app.get("/", (req, res) => {
  res.send("Servidor Snake + Chat WebSocket activo");
});

// ==========================
// INICIO
// ==========================

generateFoods();

setInterval(movePlayers, 160);

server.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});