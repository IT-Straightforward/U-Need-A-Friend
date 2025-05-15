// backend/index.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Für Produktion: spezifische Frontend-URL eintragen
    methods: ["GET", "POST"],
  },
});

const games = {};

function generateGameId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const EMOJI_POOL = [
  '😀', '😂', '😊', '😎', '🥳', '🤯', '😱', '👻', '👽', '🤖', '👾', '🤠', '🧐', '🧑‍🚀', '🦸', 
  '🧑‍🌾', '🧑‍🍳', '🧑‍🔧', '🧑‍🎨', '🧑‍🎤', '🐶', '🐱', '🐭', '🦊', '🐻', '🐼', '🐨', '🐵', '🦁', '🐸',
  '🐳', '🦋', '🦄', '🐞', '🐢', '🌵', '🌴', '🌸', '🍁', '🍄', '🍎', '🍌', '🍉', '🍕', '🍔', 
  '🍟', '🍩', '🍿', '🍭', '🍹', '⚽️', '🏀', '🎯', '🎮', '🎲', '🚀', '⚓️', '💡', '💎', '🎁',
  '🎉', '🔑', '💰', '💣', '⚙️', '🧭', '🔭', '🔮', '🛡️', '🏳️', '❤️', '⭐', '☀️', '🌙', '⚡️', 
  '🔥', '💧', '🌈', '✨', '⏳'
];
const SYMBOL_POOL = EMOJI_POOL; 

function shuffleArray(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("createGame", ({ playerName }, callback) => {
    let gameId = generateGameId();
    while (games[gameId]) {
      gameId = generateGameId();
    }

    games[gameId] = {
      id: gameId,
      hostId: socket.id,
      hostName: playerName || `Host-${socket.id.substring(0,4)}`,
      players: [],
      started: false,
      gameSettings: {},
      currentRound: null,
      readyPlayerCount: 0,
      nextTargetPlayerIndex: 0, // Wichtig für abwechselnden Target
      roundNumber: 0
    };

    socket.join(gameId);
    console.log(`Game ${gameId} created by host ${socket.id} (${games[gameId].hostName}). Host joined room.`);

    if (callback) {
      callback({ gameId, players: [], hostId: socket.id });
    }
  });

  socket.on("joinGame", ({ gameId, playerName }, callback) => {
    const game = games[gameId];
    if (!game) return callback && callback({ error: "Game not found" });
    if (game.started) return callback && callback({ error: "Game already in progress" });
    if (game.players.length >= 18) return callback && callback({ error: "Game is full (18 players max)" });
    if (game.players.find(p => p.id === socket.id)) return callback && callback({ error: "You are already in this game."});
    
    const newPlayer = { id: socket.id, name: playerName || `Player-${socket.id.substring(0, 4)}`, symbols: [], ready: false };
    game.players.push(newPlayer);
    socket.join(gameId);
    console.log(`Player ${socket.id} (${newPlayer.name}) joined game ${gameId}.`);
    const playerListForUpdate = game.players.map(p => ({ id: p.id, name: p.name }));
    io.to(gameId).emit("gameUpdate", { players: playerListForUpdate, gameId: game.id });
    if (callback) callback({ success: true, gameId });
  });

  socket.on("startGame", ({ gameId }) => {
    const game = games[gameId];
    if (!game || game.started || socket.id !== game.hostId) return;
    if (game.players.length < 2) {
        socket.emit('gameStartFailed', { message: 'Not enough players to start (minimum 2).' });
        return;
    }
    game.started = true;
    console.log(`Game ${gameId} marked as started by host ${socket.id}. Waiting for players to be ready.`);
    io.to(gameId).emit("goToGame", { gameId: game.id });
    socket.emit("gameNowStarting", { gameId: game.id, playerCount: game.players.length });
  });

  socket.on("playerReadyForGame", ({ gameId }) => {
    const game = games[gameId];
    if (!game || !game.started || socket.id === game.hostId) return;
    const player = game.players.find(p => p.id === socket.id);
    if (player && !player.ready) {
      player.ready = true;
      game.readyPlayerCount = (game.readyPlayerCount || 0) + 1;
      console.log(`Player ${player.name} ready. Total ready: ${game.readyPlayerCount}/${game.players.length}`);
      io.to(game.hostId).emit("playerReadyUpdate", { playerId: player.id, playerName: player.name, readyCount: game.readyPlayerCount, totalPlayers: game.players.length });
    }
    if (game.players.length > 0 && game.readyPlayerCount === game.players.length) {
      console.log(`All players ready in game ${gameId}. Assigning symbols.`);
      if (!assignSymbolsToAllPlayersInGame(game)) return;
      game.players.forEach(p => {
        io.to(p.id).emit("gameStarted", { playerId: p.id, buttons: p.symbols, gameId: game.id });
      });
      io.to(game.hostId).emit("allPlayersReadyGameRunning", { gameId: game.id });
      startNewRound(game);
    }
  });

  socket.on("requestInitialLobbyState", ({ gameId }) => {
    const game = games[gameId];
    if (game) {
      const playerListForUpdate = game.players.map(p => ({ id: p.id, name: p.name }));
      socket.emit("gameUpdate", { players: playerListForUpdate, gameId: game.id, message: "Welcome!" });
    } else {
      socket.emit("gameNotFound", { message: "Game not found."});
    }
  });

  // --- NEUER/ANGEPASSTER buttonPress Handler ---
  socket.on("buttonPress", ({ gameId, pressedSymbol }) => {
    const game = games[gameId];
    if (!game || !game.started || !game.currentRound || !game.currentRound.isActive || socket.id === game.hostId) {
      console.log(`[Game ${gameId}] Button press ignored: game/round not active or press by host.`);
      return;
    }

    const round = game.currentRound;
    const playerWhoPressed = game.players.find(p => p.id === socket.id);

    if (!playerWhoPressed) {
      console.log(`[Game ${gameId}] Button press from unknown player socket ID: ${socket.id}`);
      return; 
    }

    // Fall 1: Spieler drückt, der NICHT Target ist
    if (socket.id !== round.targetId) {
      console.log(`[Game ${gameId}] Player ${playerWhoPressed.name} (${socket.id}) pressed (Symbol: ${pressedSymbol}), but it's NOT their turn. Target is ${round.targetId}.`);
      io.to(socket.id).emit("feedback", { correct: false, message: "Not your turn!" });
      // Runde wird NICHT beendet, der eigentliche Target kann noch agieren.
      return;
    }

    // Fall 2: Der korrekte TARGET-Spieler hat gedrückt
    round.isActive = false; // Aktion des Targets beendet die Runde für weitere Eingaben

    if (pressedSymbol === round.currentTargetSymbol) {
      console.log(`✅ Correct press by TARGET ${playerWhoPressed.name} (${socket.id}): ${pressedSymbol} in game ${gameId}`);
      io.to(socket.id).emit("feedback", { correct: true, message: "Correct!" });
      setTimeout(() => startNewRound(game), 1500); 
    } else {
      console.log(`❌ Wrong press by TARGET ${playerWhoPressed.name} (${socket.id}): pressed ${pressedSymbol}, expected ${round.currentTargetSymbol} in game ${gameId}`);
      io.to(socket.id).emit("feedback", { correct: false, message: "Wrong Symbol!" });
      setTimeout(() => startNewRound(game), 1500);
    }
  });

  socket.on("leaveGame", ({ gameId }) => { 
    handlePlayerLeave(socket, gameId, true);
  });

  socket.on("cancelGame", ({ gameId }) => { 
    const game = games[gameId];
    if (game && socket.id === game.hostId && !game.started) {
        console.log(`Host ${socket.id} cancelled game ${gameId} before start.`);
        io.to(gameId).emit("gameCancelled", { message: "The host has cancelled the game." });
        game.players.forEach(p => {
            const playerSocket = io.sockets.sockets.get(p.id);
            if(playerSocket) playerSocket.leave(gameId);
        });
        delete games[gameId];
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
    let gameToEnd = null;
    let gameIdToEnd = null;
    for (const id in games) {
      if (games[id].hostId === socket.id) {
        gameToEnd = games[id]; gameIdToEnd = id;
        io.to(id).emit("gameEnded", { reason: "host_disconnected", message: "The host disconnected." });
        gameToEnd.players.forEach(p => { const ps = io.sockets.sockets.get(p.id); if(ps) ps.leave(id); });
        break;
      }
    }
    if (gameToEnd) { delete games[gameIdToEnd]; return; }
    for (const id in games) { if (handlePlayerLeave(socket, id, false)) break; }
  });

  function handlePlayerLeave(socket, gameId, explicitLeave) {
    const game = games[gameId];
    if (!game) return false;
    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) return false;
    const player = game.players[playerIndex];
    game.players.splice(playerIndex, 1);
    if(explicitLeave) socket.leave(gameId);
    console.log(`Player ${player.name} left game ${gameId}. Remaining: ${game.players.length}`);
    if (!game.started) {
      const playerList = game.players.map(p => ({ id: p.id, name: p.name }));
      io.to(gameId).emit("gameUpdate", { players: playerList, gameId: game.id, message: `${player.name} left lobby.` });
    } else {
      io.to(gameId).emit("playerLeftMidGame", { playerId: player.id, playerName: player.name });
      io.to(game.hostId).emit("playerLeftMidGameUpdate", {playerId: player.id, playerName: player.name, remainingPlayers: game.players.length });
      if (game.players.length < 2) {
        io.to(gameId).emit("gameEnded", { reason: "insufficient_players_mid_game", message: "Not enough players." });
        if(io.sockets.sockets.get(game.hostId)) io.to(game.hostId).emit("gameForceEnded", {message: "Not enough players."});
        delete games[gameId];
      } else if (game.currentRound && (game.currentRound.sourceId === player.id || game.currentRound.targetId === player.id)) {
        if(game.currentRound) game.currentRound.isActive = false;
        startNewRound(game);
      }
    }
    return true;
  }

  function assignSymbolsToAllPlayersInGame(game) {
    const playerCount = game.players.length;
    const totalSymbolsNeeded = playerCount * 4;
    if (totalSymbolsNeeded > SYMBOL_POOL.length) {
      const errorMsg = "Not enough unique symbols for all players.";
      io.to(game.id).emit("gameError", { message: errorMsg });
      io.to(game.hostId).emit("gameSetupError", { message: errorMsg });
      return false;
    }
    const shuffledPool = shuffleArray([...SYMBOL_POOL]);
    game.players.forEach((player, index) => {
      player.symbols = shuffledPool.slice(index * 4, (index * 4) + 4);
    });
    console.log(`Symbols assigned in game ${game.id}`);
    return true;
  }

  // --- ÜBERARBEITETE startNewRound Funktion für Ziel-Iteration ---
  function startNewRound(game) {
    if (!game || !game.players || game.players.length < 2) {
      if (game && game.id) {
        console.log(`[Game ${game.id}] Cannot start new round (not enough players: ${game.players?.length}). Ending game.`);
        io.to(game.id).emit("gameEnded", { reason: "insufficient_players_for_round", message: "Not enough players." });
        if (io.sockets.sockets.get(game.hostId)) {
            io.to(game.hostId).emit("gameForceEnded", { message: "Game ended: Insufficient players." });
        }
        delete games[game.id];
      }
      return;
    }

    console.log(`[Game ${game.id}] Starting new round. Current nextTargetPlayerIndex (before selection): ${game.nextTargetPlayerIndex}`);
    const sourcePlayer = game.players[Math.floor(Math.random() * game.players.length)];
    console.log(`[Game ${game.id}] Source player: ${sourcePlayer.name} (ID: ${sourcePlayer.id})`);

    let targetPlayer = null;
    const numPlayers = game.players.length;
    let searchStartIndex = game.nextTargetPlayerIndex || 0; // Index, ab dem wir suchen

    for (let i = 0; i < numPlayers; i++) {
      const currentPlayerIndex = (searchStartIndex + i) % numPlayers;
      const candidatePlayer = game.players[currentPlayerIndex];

      if (candidatePlayer.id !== sourcePlayer.id) {
        targetPlayer = candidatePlayer;
        game.nextTargetPlayerIndex = (currentPlayerIndex + 1) % numPlayers; // Nächste Runde startet Suche nach diesem Target
        break; 
      }
    }

    // Fallback, falls der obige Loop keinen Target findet (z.B. wenn alle anderen Spieler der Source wären, was bei >1 Spieler nicht sein kann)
    if (!targetPlayer) {
      console.warn(`[Game ${game.id}] Primary target selection loop failed. Attempting fallback. (Source: ${sourcePlayer.name})`);
      const otherPlayers = game.players.filter(p => p.id !== sourcePlayer.id);
      if (otherPlayers.length > 0) {
        targetPlayer = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
        const actualTargetIdx = game.players.findIndex(p => p.id === targetPlayer.id);
        game.nextTargetPlayerIndex = (actualTargetIdx + 1) % numPlayers;
        console.log(`[Game ${game.id}] Fallback selected target: ${targetPlayer.name}`);
      } else {
        console.error(`[Game ${game.id}] CRITICAL FALLBACK: No other players available to be target for source ${sourcePlayer.name}. Ending game.`);
        io.to(game.id).emit("gameEnded", { reason: "internal_error_no_target_fb", message: "Error: No target." });
        if (io.sockets.sockets.get(game.hostId)) {
            io.to(game.hostId).emit("gameForceEnded", { message: "Error: No target." });
        }
        delete games[game.id];
        return;
      }
    }
    
    console.log(`[Game ${game.id}] Final Target player: ${targetPlayer.name} (ID: ${targetPlayer.id}). Next round target search will start at index: ${game.nextTargetPlayerIndex}`);

    const targetSymbolIndexOnTargetDevice = Math.floor(Math.random() * targetPlayer.symbols.length);
    const currentTargetSymbol = targetPlayer.symbols[targetSymbolIndexOnTargetDevice];

    game.roundNumber = (game.roundNumber || 0) + 1;
    game.currentRound = {
      sourceId: sourcePlayer.id,
      targetId: targetPlayer.id,
      currentTargetSymbol: currentTargetSymbol,
      targetSymbolIndexOnTargetDevice: targetSymbolIndexOnTargetDevice,
      isActive: true,
      roundNumber: game.roundNumber
    };

    console.log(`New round ${game.roundNumber} for game ${game.id}: Source=${sourcePlayer.name}, Target=${targetPlayer.name}, Symbol=${currentTargetSymbol}`);

    game.players.forEach(player => {
      let payload = { role: 'inactive', currentTargetSymbol, roundNumber: game.roundNumber };
      if (player.id === sourcePlayer.id) payload.role = 'source';
      else if (player.id === targetPlayer.id) {
        payload.role = 'target';
        payload.yourTargetIndex = targetSymbolIndexOnTargetDevice;
      }
      io.to(player.id).emit('roundUpdate', payload);
    });

    io.to(game.hostId).emit('roundStartedForHost', {
        gameId: game.id, roundNumber: game.roundNumber,
        sourcePlayer: {id: sourcePlayer.id, name: sourcePlayer.name},
        targetPlayer: {id: targetPlayer.id, name: targetPlayer.name},
        targetSymbol: currentTargetSymbol
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎉 Server listening on port ${PORT}`));