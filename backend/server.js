const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const localIconPath = path.join(
  __dirname,
  '..',
  'U-Need-A-Friend',
  'src',
  'assets',
  'icons'
);

const ROOM_TEMPLATE = {
  id: 'STUDIO',
  name: 'The Studio',
  maxPlayers: 3,
  description: 'The Sudio by Ralf Hebecker',
  pastelPalette: {
    primary: '#a8d5ba',
    accent1: '#d6ecd2',
    accent2: '#b0e0c9',
    accent3: '#e9f5ea',
  },
};

const frontendPath = path.join(__dirname, 'public_frontend');
const deployedIconPath = path.join(__dirname, 'assets_from_frontend', 'icons');
app.use(express.static(frontendPath));
let ICONS_BASE_PATH;
if (process.env.NODE_ENV === 'production') {
  console.log('SERVER: Running in production mode. Using deployed icon path.');
  ICONS_BASE_PATH = deployedIconPath;
} else {
  console.log(
    'SERVER: Running in development mode. Using local frontend source icon path.'
  );
  ICONS_BASE_PATH = localIconPath;
}

if (!fs.existsSync(ICONS_BASE_PATH)) {
  console.warn(
    `WARNUNG: Der ausgewählte ICONS_BASE_PATH existiert nicht: ${ICONS_BASE_PATH}`
  );
  const alternativePath =
    ICONS_BASE_PATH === localIconPath ? deployedIconPath : localIconPath;
  if (fs.existsSync(alternativePath)) {
    console.warn(`WARNUNG: Fallback auf alternativen Pfad: ${alternativePath}`);
    ICONS_BASE_PATH = alternativePath;
  } else {
    console.error(
      `FATAL: Keiner der Icon-Pfade konnte gefunden werden. Weder "${ICONS_BASE_PATH}" noch "${alternativePath}" existieren.`
    );
  }
} else {
  console.log(
    `SERVER: Successfully set ICONS_BASE_PATH to: ${ICONS_BASE_PATH}`
  );
}

const games = {};
let nextGameIdSuffix = 1;

function shuffleArray(array) {
  let currentIndex = array.length,
    randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
  return array;
}

function setupNewGameBoard(game) {
  const themeFolder = ROOM_TEMPLATE?.id?.toLowerCase() || 'default';
  game.themeFolder = themeFolder;
  const fullSymbolPool = getSymbolPoolForTheme(themeFolder);

  const SYMBOLS_PER_GAME = 9;

  if (fullSymbolPool.length < SYMBOLS_PER_GAME) {
    const errorMsg = `Nicht genügend Symbole im Pool für Theme '${themeFolder}'. Benötigt: ${SYMBOLS_PER_GAME}, Verfügbar: ${fullSymbolPool.length}.`;
    console.error(`[Game ${game.roomId}] ${errorMsg}`);
    io.to(game.roomId).emit('gameError', {
      message: errorMsg,
    });
    return false;
  }

  const shuffledPool = shuffleArray([...fullSymbolPool]);
  game.gameSymbols = shuffledPool.slice(0, SYMBOLS_PER_GAME);
  game.matchedSymbols = [];

  console.log(
    `[Game ${game.roomId}] Spielbrett wird mit diesen ${SYMBOLS_PER_GAME} Symbolen aufgebaut:`,
    game.gameSymbols.join(', ')
  );

  game.players.forEach(player => {
    const shuffledBoardSymbols = shuffleArray([...game.gameSymbols]);
    player.board = shuffledBoardSymbols.map(symbol => ({
      symbol: symbol,
      isFlipped: false,
      isMatched: false,
    }));
  });

  return true;
}

function removePlayerFromGame(persistentPlayerId, roomId) {
  const game = games[roomId];
  if (!game) return;

  const playerIndex = game.players.findIndex(
    p => p.persistentId === persistentPlayerId
  );
  if (playerIndex === -1) return;

  const leavingPlayer = game.players[playerIndex];

  if (leavingPlayer.removalTimeout) clearTimeout(leavingPlayer.removalTimeout);

  game.players.splice(playerIndex, 1);
  if (leavingPlayer.ready && game.readyPlayerCount > 0) game.readyPlayerCount--;

  if (game.lobbyCountdownTimerId) {
    clearInterval(game.lobbyCountdownTimerId);
    game.lobbyCountdownTimerId = null;
    game.lobbyCountdownEndTime = null;
    io.to(roomId).emit('lobby:countdownCancelled', {
      roomId,
      message: `A player left.`,
    });
  }

  const playerListForUpdate = game.players.map(p => ({
    id: p.id,
    isReadyInLobby: p.isReadyInLobby || false,
  }));
  io.to(roomId).emit('gameUpdate', {
    players: playerListForUpdate,
    gameId: roomId,
    message: `A player has left.`,
  });

  if (game.started && game.players.length < 2) {
    io.to(roomId).emit('gameEnded', {
      reason: 'insufficient_players_mid_game',
      message: 'Not enough players.',
    });
    delete games[roomId];
  } else if (
    game.isRunning &&
    game.currentTurn &&
    !game.currentTurn.isResolved
  ) {
    console.log(
      `[Game ${roomId}] Player left mid-turn. Resetting current turn.`
    );
    game.currentTurn.selections = [];
    game.currentTurn.isResolved = true;

    const nextTurnNumber = (game.currentTurn.turnNumber || 0) + 1;
    game.currentTurn = {
      turnNumber: nextTurnNumber,
      selections: [],
      isResolved: false,
    };
    io.to(roomId).emit('turnBegan', {
      turnNumber: nextTurnNumber,
      matchedSymbols: game.matchedSymbols,
    });
  }
}

function createNewGameInstance() {
  const roomTemplate = ROOM_TEMPLATE;
  const gameId = `${roomTemplate.id}_${nextGameIdSuffix++}`;
  const newGame = {
    roomId: gameId,
    name: roomTemplate.name,
    maxPlayers: roomTemplate.maxPlayers,
    players: [],
    started: false,
    isRunning: false,
    gameSymbols: [],
    matchedSymbols: [],
    currentTurn: {
      turnNumber: 0,
      selections: [],
      isResolved: true,
    },
    readyPlayerCount: 0,
    lobbyCountdownTimerId: null,
    lobbyCountdownEndTime: null,
    pastelPalette: roomTemplate.pastelPalette,
  };
  games[gameId] = newGame;
  console.log(`[Server] Neue Spiel-Instanz erstellt mit ID: ${gameId}`);
  return newGame;
}

function findAvailableGame() {
  for (const gameId in games) {
    const game = games[gameId];
    if (!game.started && game.players.length < game.maxPlayers) {
      return game;
    }
  }
  return null;
}

function getSymbolPoolForTheme(themeFolder) {
  const specificThemePath = path.join(ICONS_BASE_PATH, themeFolder);
  let pool = [];
  try {
    if (fs.existsSync(specificThemePath)) {
      const files = fs.readdirSync(specificThemePath);
      pool = files
        .filter(file => file.toLowerCase().endsWith('.png'))
        .map(file => path.basename(file, '.png'));
      if (pool.length > 0) {
        console.log(
          `[Server] Loaded ${pool.length} icons for theme '${themeFolder}'`
        );
        return pool;
      } else {
        console.warn(
          `[Server] No .png files found in theme folder: ${specificThemePath}. Attempting fallback.`
        );
      }
    } else {
      console.warn(
        `[Server] Theme folder path does not exist: ${specificThemePath}. Attempting fallback.`
      );
    }
  } catch (error) {
    console.error(
      `[Server] Error reading icon folder for theme '${themeFolder}':`,
      error,
      `Attempting fallback.`
    );
  }

  console.log(
    `[Server] Falling back to default icon pool (requested for theme '${themeFolder}').`
  );
  const defaultThemePath = path.join(ICONS_BASE_PATH, 'default');
  try {
    if (fs.existsSync(defaultThemePath)) {
      const files = fs.readdirSync(defaultThemePath);
      const defaultPool = files
        .filter(file => file.toLowerCase().endsWith('.png'))
        .map(file => path.basename(file, '.png'));
      if (defaultPool.length > 0) {
        console.log(
          `[Server] Loaded ${defaultPool.length} icons from default theme folder as fallback.`
        );
        return defaultPool;
      } else {
        console.warn(
          `[Server] Warning: No .png files found in default fallback icon folder. Final pool will be empty.`
        );
        return [];
      }
    } else {
      console.error(
        `[Server] Error: Default icon folder path does not exist for fallback. Final pool will be empty.`
      );
      return [];
    }
  } catch (error) {
    console.error(
      `[Server] Error reading default icon folder for fallback:`,
      error,
      `Final pool will be empty.`
    );
    return [];
  }
}

// SOCKET
io.on('connection', socket => {
  console.log(`[Server] Socket connected: ${socket.id}`);

  socket.on('request-room', () => {
    console.log(`[SOCKET] Client ${socket.id} hat 'request-room' gesendet.`);
    socket.emit('predefined-rooms-data', [ROOM_TEMPLATE]);
    console.log(
      `[SOCKET] ROOM_TEMPLATE erfolgreich an Client ${socket.id} gesendet.`
    );
  });

  socket.on('playerWantsToJoin', callback => {
    let game = findAvailableGame();

    if (!game) {
      game = createNewGameInstance();
    }

    if (game && callback) {
      callback({ success: true, gameId: game.roomId });
    } else if (callback) {
      callback({
        success: false,
        error: 'Konnte kein Spiel erstellen oder finden.',
      });
    }
  });

  socket.on('joinGame', ({ roomId, persistentPlayerId }, callback) => {
    const gameInstance = games[roomId];
    const roomConfig = ROOM_TEMPLATE;

    if (!roomConfig || !gameInstance) {
      return (
        callback &&
        callback({
          success: false,
          error: 'Raum nicht aktiv oder nicht gefunden.',
        })
      );
    }
    if (persistentPlayerId) {
      const existingPlayer = gameInstance.players.find(
        p => p.persistentId === persistentPlayerId
      );

      if (existingPlayer) {
        console.log(
          `[Game ${roomId}] Reconnecting player ${persistentPlayerId}. New socket: ${socket.id}`
        );

        if (existingPlayer.removalTimeout) {
          clearTimeout(existingPlayer.removalTimeout);
          delete existingPlayer.removalTimeout;
        }

        existingPlayer.id = socket.id;
        existingPlayer.disconnected = false;
        socket.join(roomId);

        if (callback)
          callback({
            success: true,
            persistentPlayerId: existingPlayer.persistentId,
          });

        if (!gameInstance.started) {
          const playerList = gameInstance.players.map(p => ({
            id: p.id,
            isReadyInLobby: p.isReadyInLobby,
          }));
          socket.emit('gameUpdate', {
            players: playerList,
            gameId: roomId,
            roomName: gameInstance.name,
            maxPlayers: gameInstance.maxPlayers,
            pastelPalette: gameInstance.pastelPalette,
          });
        } else {
          socket.emit('gameInitialized', {
            playerId: existingPlayer.id,
            playerBoard: existingPlayer.board,
            gameId: gameInstance.roomId,
            roomName: gameInstance.name,
            matchedSymbols: gameInstance.matchedSymbols,
            pastelPalette: gameInstance.pastelPalette,
            themeFolder: gameInstance.themeFolder,
          });
          io.to(roomId).emit('turnBegan', {
            turnNumber: gameInstance.currentTurn.turnNumber,
            matchedSymbols: gameInstance.matchedSymbols,
          });
        }

        const allPlayersList = gameInstance.players.map(p => ({
          id: p.id,
          isReadyInLobby: p.isReadyInLobby,
        }));
        io.to(roomId)
          .except(socket.id)
          .emit('gameUpdate', { players: allPlayersList, gameId: roomId });

        return;
      }
    }

    if (gameInstance.started) {
      return (
        callback &&
        callback({ success: false, error: 'Game has already started.' })
      );
    }
    if (gameInstance.players.length >= gameInstance.maxPlayers) {
      return (
        callback &&
        callback({
          success: false,
          error: `Room "${roomConfig.name}" is full.`,
        })
      );
    }

    const newPersistentId = crypto.randomUUID();
    const newPlayer = {
      id: socket.id,
      persistentId: newPersistentId,
      board: [],
      ready: false,
      isReadyInLobby: false,
      disconnected: false,
    };

    gameInstance.players.push(newPlayer);
    socket.join(roomId);
    console.log(
      `[Game ${roomId}] New player joined with socket ${socket.id} and persistentId ${newPersistentId}.`
    );

    const playerListForUpdate = gameInstance.players.map(p => ({
      id: p.id,
      isReadyInLobby: p.isReadyInLobby,
    }));
    io.to(roomId).emit('gameUpdate', {
      players: playerListForUpdate,
      gameId: roomId,
      roomName: gameInstance.name,
      pastelPalette: gameInstance.pastelPalette,
      maxPlayers: gameInstance.maxPlayers,
    });

    if (callback) callback({ success: true, newPersistentId: newPersistentId });
  });

  socket.on('player:setReadyStatus', ({ roomId, isReady }, callback) => {
    const gameInstance = games[roomId];
    if (!gameInstance || gameInstance.started) {
      return (
        callback &&
        callback({
          success: false,
          error: 'Raum nicht aktiv ODER Spiel hat bereits begonnen.',
        })
      );
    }
    const player = gameInstance.players.find(p => p.id === socket.id);
    if (!player) {
      return (
        callback &&
        callback({ success: false, error: 'Spieler nicht gefunden.' })
      );
    }

    player.isReadyInLobby = !!isReady;
    console.log(
      `[Game ${roomId}] Spieler ${player.id} Status: ${player.isReadyInLobby}`
    );

    const playerListForUpdate = gameInstance.players.map(p => ({
      id: p.id,
      isReadyInLobby: p.isReadyInLobby,
    }));
    io.to(roomId).emit('gameUpdate', {
      players: playerListForUpdate,
      gameId: roomId,
    });

    if (!isReady && gameInstance.lobbyCountdownTimerId) {
      console.log(
        `[Game ${roomId}] Spieler ${player.id} hat 'Bereit' zurückgenommen. Countdown wird abgebrochen.`
      );
      clearInterval(gameInstance.lobbyCountdownTimerId);
      gameInstance.lobbyCountdownTimerId = null;
      gameInstance.lobbyCountdownEndTime = null;
      io.to(roomId).emit('lobby:countdownCancelled', {
        roomId,
        message: `Countdown abgebrochen, da ein Spieler nicht mehr bereit ist.`,
      });
    }

    const readyCount = gameInstance.players.filter(
      p => p.isReadyInLobby
    ).length;
    const totalPlayers = gameInstance.players.length;
    const allPlayersReady = totalPlayers > 0 && readyCount === totalPlayers;

    if (allPlayersReady && totalPlayers >= 2) {
      startLobbyCountdown(gameInstance);
    }

    if (callback)
      callback({ success: true, currentReadyStatus: player.isReadyInLobby });
  });

  socket.on('playerReadyForGame', ({ gameId }) => {
    const game = games[gameId];
    if (!game || !game.started) return;

    const player = game.players.find(p => p.id === socket.id);
    if (player && !player.ready) {
      player.ready = true;
      game.readyPlayerCount = (game.readyPlayerCount || 0) + 1;
      console.log(
        `[Game ${gameId}] Spieler ${player.id} hat Assets geladen. Bereit: ${game.readyPlayerCount}/${game.players.length}`
      );
    }

    if (
      game.players.length > 0 &&
      game.readyPlayerCount === game.players.length
    ) {
      if (game.isRunning) {
        console.log(
          `[Game ${gameId}] Alle Spieler bereit, aber Spiel läuft bereits. Keine Aktion.`
        );
        return;
      }
      console.log(
        `[Game ${gameId}] Alle Spieler bereit. Initialisiere Spielbrett.`
      );

      if (!setupNewGameBoard(game)) {
        console.error(
          `[Game ${gameId}] Kritisch: Spielbrett konnte nicht initialisiert werden. Spiel wird nicht gestartet.`
        );
        return;
      }
      game.isRunning = true;

      game.players.forEach(p => {
        const pSocket = io.sockets.sockets.get(p.id);
        if (pSocket) {
          pSocket.emit('gameInitialized', {
            playerId: p.id,
            playerBoard: p.board,
            gameId: game.roomId,
            roomName: game.name,
            matchedSymbols: game.matchedSymbols,
            pastelPalette: game.pastelPalette,
            themeFolder: game.themeFolder,
          });
        }
      });

      console.log(
        `[Game ${gameId}] Spiel initialisiert und an Spieler gesendet. Warte auf erste Karten-Flips.`
      );
      game.currentTurn = {
        turnNumber: 1,
        selections: [],
        isResolved: false,
      };
      io.to(game.roomId).emit('turnBegan', {
        turnNumber: 1,
        matchedSymbols: game.matchedSymbols,
      });
    }
  });
  socket.on('requestInitialLobbyState', ({ gameId }) => {
    console.log(
      `[Server] Received 'requestInitialLobbyState' for room: ${gameId} from socket: ${socket.id}`
    );
    const game = games[gameId];
    const roomConfig = ROOM_TEMPLATE;
    if (game && roomConfig) {
      const playerListForUpdate = game.players.map(p => ({
        id: p.id,
        isReadyInLobby: p.isReadyInLobby || false,
      }));
      const payload = {
        players: playerListForUpdate,
        gameId: game.roomId,
        roomName: game.name,
        message: 'Welcome to the lobby!',
        iconThemeFolder: roomConfig.iconThemeFolder,
        pastelPalette: game.pastelPalette || roomConfig.pastelPalette,
        maxPlayers: game.maxPlayers || roomConfig.maxPlayers,
      };
      console.log(
        `[Server] Emitting 'gameUpdate' (initial state) to ${socket.id} for room ${gameId}.`
      );
      socket.emit('gameUpdate', payload);
    } else {
      console.warn(
        `[Server] No active game instance or config for room ${gameId} on requestInitialLobbyState.`
      );
      socket.emit('gameNotFound', {
        message: roomConfig
          ? `Room "${roomConfig.name}" is not active.`
          : `Room ${gameId} not found.`,
      });
    }
  });

  socket.on('leaveGame', ({ gameId }) => {
    const game = games[gameId];
    if (!game) return;
    const player = game.players.find(p => p.id === socket.id);
    if (player) {
      console.log(
        `[Game ${gameId}] Player ${player.persistentId} explicitly left the game.`
      );
      removePlayerFromGame(player.persistentId, gameId);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Server] Socket disconnected: ${socket.id}`);

    let playerWhoDisconnected = null;
    let gameIdOfPlayer = null;

    for (const roomId in games) {
      const game = games[roomId];

      const player = game.players.find(p => p.id === socket.id);
      if (player) {
        playerWhoDisconnected = player;
        gameIdOfPlayer = roomId;
        break;
      }
    }

    if (playerWhoDisconnected && gameIdOfPlayer) {
      const player = playerWhoDisconnected;
      const roomId = gameIdOfPlayer;
      const game = games[roomId];

      player.id = null;
      player.disconnected = true;
      console.log(
        `[Game ${roomId}] Player ${player.persistentId} disconnected. Starting 20s reconnect grace period.`
      );

      const removalTimeout = setTimeout(() => {
        const currentGame = games[roomId];
        if (currentGame) {
          const playerInGame = currentGame.players.find(
            p => p.persistentId === player.persistentId
          );
          if (playerInGame && playerInGame.disconnected) {
            console.log(
              `[Game ${roomId}] Grace period for ${player.persistentId} ended. Removing player permanently.`
            );
            removePlayerFromGame(player.persistentId, roomId);
          }
        }
      }, 20000);

      player.removalTimeout = removalTimeout;
    }
  });

  function resolveTurn(game) {
    const { selections } = game.currentTurn;

    const firstSymbol = selections.length > 0 ? selections[0].symbol : null;
    const allPlayersChoseSameSymbol = selections.every(
      sel => sel.symbol === firstSymbol
    );

    if (allPlayersChoseSameSymbol && firstSymbol) {
      console.log(
        `[Game ${game.roomId}] Turn ${game.currentTurn.turnNumber} SUCCESS. All players chose '${firstSymbol}'.`
      );
      game.matchedSymbols.push(firstSymbol);

      game.players.forEach(p => {
        const card = p.board.find(c => c.symbol === firstSymbol);
        if (card) card.isMatched = true;
      });

      io.to(game.roomId).emit('turnSuccess', {
        symbol: firstSymbol,
        matchedSymbols: game.matchedSymbols,
      });
      if (game.matchedSymbols.length === game.gameSymbols.length) {
        console.log(`[Game ${game.roomId}] VICTORY! All symbols matched.`);
        game.isRunning = false;
        io.to(game.roomId).emit('gameEnded', {
          reason: 'victory',
          message: 'Congratulations, you won!',
          matchedSymbols: game.matchedSymbols,
        });
        return;
      }
    } else {
      console.log(
        `[Game ${game.roomId}] Turn ${game.currentTurn.turnNumber} FAIL. Choices were different.`
      );
      io.to(game.roomId).emit('turnFail', { selections });
    }

    setTimeout(() => {
      if (!games[game.roomId] || !games[game.roomId].isRunning) return;

      const nextTurnNumber = game.currentTurn.turnNumber + 1;
      game.currentTurn = {
        turnNumber: nextTurnNumber,
        selections: [],
        isResolved: false,
      };

      io.to(game.roomId).emit('turnBegan', {
        turnNumber: nextTurnNumber,
        matchedSymbols: game.matchedSymbols,
      });
      console.log(`[Game ${game.roomId}] Starting turn ${nextTurnNumber}.`);
    }, 3000);
  }

  // In server.js -> socket.on('playerMadeSelection', ...)

socket.on('playerMadeSelection', ({ gameId, cardIndex, symbol }) => {
  const game = games[gameId];
  if (!game || !game.isRunning || game.currentTurn.isResolved) return;
  
  const player = game.players.find(p => p.id === socket.id);
  if (!player) return;

  const hasAlreadySelected = game.currentTurn.selections.some(sel => sel.playerId === socket.id);
  if (hasAlreadySelected) {
    console.warn(`[Game ${gameId}] Player ${socket.id} tried to select a second card in the same turn.`);
    return;
  }

  console.log(`[Game ${gameId}] Turn ${game.currentTurn.turnNumber}: Player ${socket.id} selected symbol '${symbol}'.`);
  
  game.currentTurn.selections.push({
    playerId: socket.id,
    cardIndex: cardIndex,
    symbol: symbol
  });

  const activePlayers = game.players.filter(p => !p.disconnected);
  if (game.currentTurn.selections.length === activePlayers.length) {
    game.currentTurn.isResolved = true;
    console.log(`[Game ${gameId}] All ${activePlayers.length} players have made a selection. Resolving turn.`);
    
    // Schritt 1: Allen Clients sagen, welche Karten sie umdrehen sollen.
    io.to(gameId).emit('turnResolve', { allChoices: game.currentTurn.selections });

    // Schritt 2: Nach einer kurzen Pause die Runde auswerten und das Ergebnis senden.
    setTimeout(() => {
      if (games[gameId]) {
        resolveTurn(game);
      }
    }, 1500); // 1.5s warten, damit die Flip-Animation sichtbar ist
  }
});

  function startLobbyCountdown(game) {
    if (!game || game.lobbyCountdownTimerId) {
      return;
    }

    const roomId = game.roomId;
    console.log(
      `[Game ${roomId}] Alle Spieler bereit. Automatischer 10s Countdown wird gestartet.`
    );

    game.lobbyCountdownEndTime = Date.now() + 10000;

    io.to(roomId).emit('lobby:countdownStarted', {
      roomId,
      duration: 10,
      endTime: game.lobbyCountdownEndTime,
    });

    game.lobbyCountdownTimerId = setInterval(() => {
      const gameInstanceForInterval = games[roomId];
      if (
        !gameInstanceForInterval ||
        !gameInstanceForInterval.lobbyCountdownEndTime
      ) {
        if (gameInstanceForInterval?.lobbyCountdownTimerId) {
          clearInterval(gameInstanceForInterval.lobbyCountdownTimerId);
          gameInstanceForInterval.lobbyCountdownTimerId = null;
        }
        return;
      }

      if (Date.now() >= gameInstanceForInterval.lobbyCountdownEndTime) {
        clearInterval(gameInstanceForInterval.lobbyCountdownTimerId);
        gameInstanceForInterval.lobbyCountdownTimerId = null;
        gameInstanceForInterval.lobbyCountdownEndTime = null;

        const stillAllReady = gameInstanceForInterval.players.every(
          p => p.isReadyInLobby
        );
        if (stillAllReady && gameInstanceForInterval.players.length >= 2) {
          console.log(
            `[Game ${roomId}] Countdown beendet. Spiel wird gestartet.`
          );
          gameInstanceForInterval.started = true;
          gameInstanceForInterval.players.forEach(p => (p.ready = false));
          gameInstanceForInterval.readyPlayerCount = 0;

          io.to(roomId).emit('goToGame', { gameId: roomId });
        } else {
          console.log(
            `[Game ${roomId}] Countdown beendet, aber nicht mehr alle Spieler bereit. Start abgebrochen.`
          );
          io.to(roomId).emit('lobby:countdownCancelled', {
            roomId,
            message: 'Start abgebrochen, da ein Spieler nicht mehr bereit war.',
          });
        }
      }
    }, 1000);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎉 Server listening on port ${PORT}`));
