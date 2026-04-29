const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 8080;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ==========================
// CONFIGURACIÓN DEL JUEGO
// ==========================

const BOARD_WIDTH = 800;
const BOARD_HEIGHT = 600;
const BOX = 20;

const GAME_SPEED = 100; // Menor número = más rápido. Recomendado: 100

const MAX_FOODS = 20;

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
  "#ffffff"
];

let players = {};
let foods = [];

// ==========================
// RUTA HTTP PARA PROBAR SERVER
// ==========================

app.get("/", (req, res) => {
  res.send("Servidor WebSocket Snake activo");
});

// ==========================
// FUNCIONES AUXILIARES
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

function createFood() {
  const position = randomPosition();

  return {
    x: position.x,
    y: position.y
  };
}

function fillFoods() {
  while (foods.length < MAX_FOODS) {
    foods.push(createFood());
  }
}

function createPlayer(id) {
  const position = randomPosition();

  return {
    id: id,
    name: "Jugador-" + Math.floor(Math.random() * 1000),
    color: randomColor(),
    score: 0,
    direction: "RIGHT",
    nextDirection: "RIGHT",
    alive: true,
    snake: [
      { x: position.x, y: position.y },
      { x: position.x - BOX, y: position.y },
      { x: position.x - BOX * 2, y: position.y }
    ]
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

function resetPlayer(player) {
  const position = randomPosition();

  player.score = 0;
  player.direction = "RIGHT";
  player.nextDirection = "RIGHT";
  player.alive = true;
  player.snake = [
    { x: position.x, y: position.y },
    { x: position.x - BOX, y: position.y },
    { x: position.x - BOX * 2, y: position.y }
  ];
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

function broadcastChat(name, message) {
  broadcast({
    type: "chat",
    name: name,
    message: message
  });
}

function sendGameState() {
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

// ==========================
// LÓGICA DEL JUEGO
// ==========================

function updatePlayer(player) {
  if (!player.alive || !player.snake || player.snake.length === 0) {
    resetPlayer(player);
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

  if (player.direction === "UP") {
    newHead.y -= BOX;
  }

  if (player.direction === "DOWN") {
    newHead.y += BOX;
  }

  if (player.direction === "LEFT") {
    newHead.x -= BOX;
  }

  if (player.direction === "RIGHT") {
    newHead.x += BOX;
  }

  // Si choca con el borde, reaparece
  if (
    newHead.x < 0 ||
    newHead.y < 0 ||
    newHead.x >= BOARD_WIDTH ||
    newHead.y >= BOARD_HEIGHT
  ) {
    broadcastChat("Sistema", player.name + " chocó con el borde y reapareció.");
    resetPlayer(player);
    return;
  }

  // Si choca consigo mismo, reaparece
  for (let i = 1; i < player.snake.length; i++) {
    if (newHead.x === player.snake[i].x && newHead.y === player.snake[i].y) {
      broadcastChat("Sistema", player.name + " chocó consigo mismo y reapareció.");
      resetPlayer(player);
      return;
    }
  }

  // Si choca con otro jugador, reaparece
  for (const otherId in players) {
    const otherPlayer = players[otherId];

    if (otherId === player.id) {
      continue;
    }

    for (let i = 0; i < otherPlayer.snake.length; i++) {
      const part = otherPlayer.snake[i];

      if (newHead.x === part.x && newHead.y === part.y) {
        broadcastChat("Sistema", player.name + " chocó con " + otherPlayer.name + " y reapareció.");
        resetPlayer(player);
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

  sendGameState();
}

// ==========================
// WEBSOCKET
// ==========================

wss.on("connection", (ws) => {
  const id = generateId();
  const player = createPlayer(id);

  players[id] = player;
  ws.playerId = id;

  console.log("Jugador conectado:", id);

  sendTo(ws, {
    type: "welcome",
    id: player.id,
    name: player.name,
    color: player.color
  });

  broadcastChat("Sistema", player.name + " se unió al juego.");
  sendGameState();

  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(message.toString());
    } catch (error) {
      console.log("Mensaje no válido:", message.toString());
      return;
    }

    const currentPlayer = players[ws.playerId];

    if (!currentPlayer) {
      return;
    }

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
        }
      }
    }

    if (data.type === "chat") {
      const text = String(data.message || "").trim();

      if (text !== "") {
        broadcastChat(currentPlayer.name, text);
      }
    }

    if (data.type === "rename") {
      const newName = String(data.name || "").trim();

      if (newName !== "") {
        const oldName = currentPlayer.name;

        currentPlayer.name = newName.substring(0, 20);

        sendTo(ws, {
          type: "welcome",
          id: currentPlayer.id,
          name: currentPlayer.name,
          color: currentPlayer.color
        });

        broadcastChat("Sistema", oldName + " ahora se llama " + currentPlayer.name + ".");
        sendGameState();
      }
    }
  });

  ws.on("close", () => {
    const disconnectedPlayer = players[ws.playerId];

    if (disconnectedPlayer) {
      broadcastChat("Sistema", disconnectedPlayer.name + " salió del juego.");
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
// INICIAR SERVIDOR
// ==========================

fillFoods();

setInterval(gameLoop, GAME_SPEED);

server.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor WebSocket Snake escuchando en puerto " + PORT);
});