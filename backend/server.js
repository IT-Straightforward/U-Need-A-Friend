const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

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
const frontendPath = path.join(__dirname, 'public_frontend');
const filePathToPredefinedRooms = path.join(__dirname, 'predefinedRooms.json');
const deployedIconPath = path.join(__dirname, 'assets_from_frontend', 'icons');
app.use(express.static(frontendPath));
let ICONS_BASE_PATH;
if (process.env.NODE_ENV === 'production') {
  // Diese Variable wird von den meisten Hosting-Providern automatisch gesetzt.
  console.log('SERVER: Running in production mode. Using deployed icon path.');
  ICONS_BASE_PATH = deployedIconPath;
} else {
  // Für die lokale Entwicklung.
  console.log(
    'SERVER: Running in development mode. Using local frontend source icon path.'
  );
  ICONS_BASE_PATH = localIconPath;
}

// Zusätzliche Sicherheitsprüfung, falls die Logik oben fehlschlägt.
if (!fs.existsSync(ICONS_BASE_PATH)) {
  console.warn(
    `WARNUNG: Der ausgewählte ICONS_BASE_PATH existiert nicht: ${ICONS_BASE_PATH}`
  );
  // Fallback auf den anderen Pfad als letzte Rettung
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

let PREDEFINED_ROOM_CONFIGS = [];
try {
  const rawData = fs.readFileSync(filePathToPredefinedRooms);
  PREDEFINED_ROOM_CONFIGS = JSON.parse(rawData);
  console.log(
    'Successfully loaded predefined rooms:',
    PREDEFINED_ROOM_CONFIGS.map(r => r.id).join(', ')
  );
} catch (error) {
  console.error('Error loading predefinedRooms.json:', error);
}
// ----------------------------------------------

const games = {};

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
/**
 * Lädt Symbol-Identifier (Dateinamen ohne .svg) aus einem spezifischen Theme-Ordner.
 * Fallback auf den 'default' Theme-Ordner, wenn der spezifische Ordner nicht existiert,
 * leer ist oder ein Fehler auftritt.
 * @param {string} themeFolder - Der Name des Theme-Ordners (z.B. 'zoo', 'foodcourt').
 * @returns {string[]} Ein Array von Symbol-Identifiern oder ein leeres Array bei Fehler.
 */
function getSymbolPoolForTheme(themeFolder) {
  const specificThemePath = path.join(ICONS_BASE_PATH, themeFolder);
  let pool = [];

  try {
    if (fs.existsSync(specificThemePath)) {
      const files = fs.readdirSync(specificThemePath);
      pool = files
        .filter(file => file.toLowerCase().endsWith('.svg'))
        .map(file => path.basename(file, '.svg'));
      if (pool.length > 0) {
        console.log(
          `[Server] Loaded ${pool.length} icons for theme '${themeFolder}' from ${specificThemePath}`
        );
        return pool; // Gibt themenspezifische Icons zurück, falls gefunden
      } else {
        console.warn(
          `[Server] No .svg files found in theme folder: ${specificThemePath}. Attempting fallback.`
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

  // Fallback zu 'default', wenn themenspezifische Icons nicht gefunden, leer oder Fehler
  console.log(
    `[Server] Falling back to default icon pool (requested for theme '${themeFolder}').`
  );
  const defaultThemePath = path.join(ICONS_BASE_PATH, 'default');
  try {
    if (fs.existsSync(defaultThemePath)) {
      const files = fs.readdirSync(defaultThemePath);
      const defaultPool = files
        .filter(file => file.toLowerCase().endsWith('.svg'))
        .map(file => path.basename(file, '.svg'));
      if (defaultPool.length > 0) {
        console.log(
          `[Server] Loaded ${defaultPool.length} icons from default theme folder as fallback.`
        );
        return defaultPool;
      } else {
        console.warn(
          `[Server] Warning: No .svg files found in default fallback icon folder: ${defaultThemePath}. Final pool will be empty.`
        );
        return [];
      }
    } else {
      console.error(
        `[Server] Error: Default icon folder path does not exist for fallback: ${defaultThemePath}. Final pool will be empty.`
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

function assignSymbolsToAllPlayersInGame(game) {
  // 1. Bestimme den Theme-Ordner für das aktuelle Spiel
  const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === game.id);
  const themeFolder = roomConfig?.id?.toLowerCase() || 'default'; // Deine Konvention

  // 2. Hole den Symbol-Pool für dieses Theme
  const currentSymbolPool = getSymbolPoolForTheme(themeFolder);

  const playerCount = game.players.length;
  if (playerCount === 0) return true; // Kein Fehler, aber auch nichts zu tun
  const totalSymbolsNeeded = playerCount * 4;

  if (currentSymbolPool.length === 0) {
    const errorMsg = `Symbol pool for theme '${themeFolder}' (and default fallback) is empty. Cannot assign symbols.`;
    console.error(`[Game ${game.id}] ${errorMsg}`);
    game.players.forEach(p => {
      const playerSocket = io.sockets.sockets.get(p.id);
      if (playerSocket) playerSocket.emit('gameError', { message: errorMsg });
    });
    if (game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)) {
      io.to(game.adminSocketId).emit('gameSetupError', {
        roomId: game.id,
        message: errorMsg,
      });
    }
    return false;
  }

  let symbolsToAssign;
  if (totalSymbolsNeeded > currentSymbolPool.length) {
    console.warn(
      `[Game ${game.id}] Warning: Not enough unique symbols in theme '${themeFolder}' pool (length ${currentSymbolPool.length}) for all players (${totalSymbolsNeeded} needed). Symbols will repeat.`
    );
    let extendedPool = [...currentSymbolPool];
    while (
      extendedPool.length < totalSymbolsNeeded &&
      currentSymbolPool.length > 0
    ) {
      extendedPool.push(...currentSymbolPool);
    }
    symbolsToAssign = shuffleArray(extendedPool).slice(0, totalSymbolsNeeded);
  } else {
    symbolsToAssign = shuffleArray([...currentSymbolPool]);
  }

  game.players.forEach((player, index) => {
    const startIndex = index * 4;
    player.iconSymbols = symbolsToAssign.slice(startIndex, startIndex + 4);
    if (player.iconSymbols.length < 4 && playerCount > 0) {
      // GEÄNDERT: player.name durch player.id ersetzt für eine eindeutige Log-Nachricht.
      console.warn(
        `[Game ${game.id}] Player with ID ${player.id} received only ${player.iconSymbols.length} symbols due to pool exhaustion.`
      );
    }
  });

  console.log(
    `[Game ${game.id}] Icon Identifiers from theme '${themeFolder}' pool assigned to ${playerCount} players.`
  );
  return true;
}

// SOCKET
io.on('connection', socket => {
  console.log(`[Server] Socket connected: ${socket.id}`);

  // Hier lauschst du auf das Event vom Client
  socket.on('request-predefined-rooms', () => {
    console.log(`Client ${socket.id} hat 'request-predefined-rooms' gesendet.`);

    fs.readFile(filePathToPredefinedRooms, 'utf8', (err, data) => {
      if (err) {
        console.error(
          `Fehler beim Lesen der predefinedRooms.json für Client ${socket.id}:`,
          err
        );
        // Sende eine Fehlermeldung zurück an DIESEN Client
        socket.emit('predefined-rooms-error', {
          message: 'Fehler beim Laden der Raumkonfiguration vom Server.',
        });
        return;
      }

      try {
        const jsonData = JSON.parse(data);
        // Sende die geparsten JSON-Daten zurück an DIESEN Client
        socket.emit('predefined-rooms-data', jsonData);
        console.log(
          `predefinedRooms.json erfolgreich an Client ${socket.id} gesendet.`
        );
      } catch (parseErr) {
        console.error(
          `Fehler beim Parsen der predefinedRooms.json für Client ${socket.id}:`,
          parseErr
        );
        socket.emit('predefined-rooms-error', {
          message:
            'Fehler beim Verarbeiten der Raumkonfiguration auf dem Server.',
        });
      }
    });
  });

  socket.on('admin:getRoomOverview', callback => {
    console.log(`[Admin ${socket.id}] requested room overview.`);
    const overview = PREDEFINED_ROOM_CONFIGS.map(roomConfig => {
      const activeGameInstance = games[roomConfig.id];
      return {
        id: roomConfig.id,
        name: roomConfig.name,
        description: roomConfig.description,
        maxPlayers: roomConfig.maxPlayers,
        pastelPalette: roomConfig.pastelPalette,
        isActive: !!activeGameInstance,
        isRunning: activeGameInstance ? activeGameInstance.isRunning : false,
        playerCount: activeGameInstance ? activeGameInstance.players.length : 0,
      };
    });
    if (typeof callback === 'function') {
      callback(overview);
    } else {
      socket.emit('admin:roomOverview', overview);
    }
  });

  socket.on('admin:activateRoom', ({ roomId }, callback) => {
    console.log(`[Admin ${socket.id}] wants to activate room: ${roomId}`);
    const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId);
    if (!roomConfig) {
      const errorMsg = `Room configuration for ID '${roomId}' not found.`;
      if (callback) callback({ success: false, error: errorMsg });
      socket.emit('admin:error', { message: errorMsg, roomId });
      return;
    }
    let wasAlreadyActive = false;
    let needsGeneralStatusUpdate = true;

    if (games[roomId]) {
      if (
        games[roomId].adminSocketId &&
        games[roomId].adminSocketId !== socket.id
      ) {
        const errorMsg = `Room ${roomId} is managed by another admin.`;
        if (callback) callback({ success: false, error: errorMsg });
        socket.emit('admin:error', { message: errorMsg, roomId });
        return;
      }
      console.log(
        `Room ${roomId} is already active or being reactivated by admin ${socket.id}.`
      );
      games[roomId].adminSocketId = socket.id;
      wasAlreadyActive = true;
      needsGeneralStatusUpdate = !games[roomId].adminSocketId;
      socket.join(roomId);
    } else {
      console.log(
        `Activating new room instance for ${roomId} by admin ${socket.id}.`
      );
      games[roomId] = {
        id: roomId,
        name: roomConfig.name,
        maxPlayers: roomConfig.maxPlayers,
        adminSocketId: socket.id,
        players: [],
        started: false,
        isRunning: false,
        currentRound: null,
        readyPlayerCount: 0,
        nextTargetPlayerIndex: 0,
        roundNumber: 0,
        collectedPieces: [],
        lobbyCountdownTimerId: null,
        lobbyCountdownEndTime: null,
        pastelPalette: roomConfig.pastelPalette,
      };
      socket.join(roomId);
    }
    const gameInstance = games[roomId];
    const currentStatusPayload = {
      isActive: true,
      isRunning: gameInstance.isRunning,
      playerCount: gameInstance.players.length,
      players: gameInstance.players.map(p => ({
        id: p.id,
        isReadyInLobby: p.isReadyInLobby,
      })),
      pastelPalette: gameInstance.pastelPalette,
      maxPlayers: gameInstance.maxPlayers,
    };
    const successMessage = wasAlreadyActive
      ? `Room ${roomId} management reconfirmed.`
      : `Room ${roomId} activated.`;
    socket.emit('admin:roomActivated', {
      roomId,
      message: successMessage,
      status: currentStatusPayload,
    });
    if (typeof callback === 'function') {
      callback({ success: true, roomId, status: currentStatusPayload });
    }
    if (needsGeneralStatusUpdate) {
      io.emit('admin:roomStatusUpdate', {
        roomId,
        status: {
          isActive: true,
          isRunning: gameInstance.isRunning,
          playerCount: gameInstance.players.length,
                  players: [], 
          pastelPalette: gameInstance.pastelPalette,
          maxPlayers: gameInstance.maxPlayers,
        },
      });
    }
  });

  if (typeof callback === 'function') {
    // Auch den optionalen Callback bedienen
    callback({ success: true, roomId, status: currentStatusPayload });
  }

  socket.on('admin:getRoomDetails', ({ roomId }, callback) => {
    console.log(`[Admin ${socket.id}] requested details for room: ${roomId}`);
    const gameInstance = games[roomId];
    const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId);
    if (!roomConfig)
      return (
        callback &&
        callback({ success: false, error: 'Room configuration not found.' })
      );

    if (gameInstance) {
      const playersWithReadyStatus = gameInstance.players.map(p => ({
        id: p.id,
        isReadyInLobby: p.isReadyInLobby || false,
      }));
      const currentRoundForAdmin =
      gameInstance.isRunning && gameInstance.currentRound
        ? {
            roundNumber: gameInstance.roundNumber,
            sourcePlayer: { id: gameInstance.currentRound.sourceId },
            targetPlayer: { id: gameInstance.currentRound.targetId },
            targetSymbol: gameInstance.currentRound.currentTargetSymbol,
          }
        : null;
      const roomDetails = {
        roomId: gameInstance.id,
        name: gameInstance.name,
        isActive: true,
        isRunning: gameInstance.isRunning,
        players: playersWithReadyStatus,
        playerCount: gameInstance.players.length,
        maxPlayers: gameInstance.maxPlayers,
        pastelPalette: gameInstance.pastelPalette,
        currentRound: currentRoundForAdmin,
        lobbyReadyPlayerCount: gameInstance.players.filter(
          p => p.isReadyInLobby
        ).length,
        assetReadyPlayerCount: gameInstance.readyPlayerCount,
      };
      if (callback) callback({ success: true, details: roomDetails });
    } else {
      const roomDetails = {
        roomId: roomConfig.id,
        name: roomConfig.name,
        isActive: false,
        isRunning: false,
        players: [],
        playerCount: 0,
        maxPlayers: roomConfig.maxPlayers,
        pastelPalette: roomConfig.pastelPalette,
      };
      if (callback) callback({ success: true, details: roomDetails });
    }
  });


socket.on("joinGame", ({ roomId }, callback) => {
    // Der Payload { roomId, playerName } wird zu { roomId } vereinfacht
    console.log(`[Server] Socket ${socket.id} is attempting to auto-join room: ${roomId}`);

    const gameInstance = games[roomId];
    const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId);

    // Diese Überprüfungen sind gut und bleiben erhalten
    if (!roomConfig) {
      return (
        callback &&
        callback({
          success: false,
          error: "Ungültige Raum-ID. Dieser Raum existiert möglicherweise nicht.",
        })
      );
    }
    if (!gameInstance || !gameInstance.adminSocketId) {
      return (
        callback &&
        callback({
          success: false,
          error: `Raum "${roomConfig.name}" ist derzeit nicht aktiv.`,
        })
      );
    }
    if (gameInstance.started) {
      return (
        callback &&
        callback({
          success: false,
          error: "Das Spiel in diesem Raum hat bereits begonnen.",
        })
      );
    }
    if (gameInstance.players.length >= (gameInstance.maxPlayers || roomConfig.maxPlayers)) {
      return (
        callback &&
        callback({
          success: false,
          error: `Raum "${roomConfig.name}" ist voll.`,
        })
      );
    }

    // GEÄNDERT: Logik, wenn Spieler bereits im Raum ist (z.B. nach Seiten-Refresh)
    // Wir blockieren den Spieler nicht, sondern bestätigen den Beitritt einfach erneut.
    if (gameInstance.players.find(p => p.id === socket.id)) {
      console.log(`[Game ${roomId}] Player ${socket.id} is already in the room. Reconfirming join.`);
      return (
        callback &&
        callback({ success: true, gameId: roomId, roomName: gameInstance.name })
      );
    }

    // GEÄNDERT: Das newPlayer-Objekt hat keine 'name'-Eigenschaft mehr.
    const newPlayer = {
      id: socket.id,
      symbols: [],
      ready: false,
      isReadyInLobby: false,
    };
    gameInstance.players.push(newPlayer);
    socket.join(roomId);

    // GEÄNDERT: Log-Nachricht ohne Namen.
    console.log(
      `[Game ${roomId}] Player ${socket.id} joined. Total players: ${gameInstance.players.length}`
    );

    // GEÄNDERT: Die Spielerliste für Updates enthält keine Namen mehr.
    const playerListForUpdate = gameInstance.players.map(p => ({
      id: p.id,
      isReadyInLobby: p.isReadyInLobby,
    }));

    const updatePayload = {
      players: playerListForUpdate,
      gameId: roomId,
      roomName: gameInstance.name,
      pastelPalette: gameInstance.pastelPalette,
      maxPlayers: gameInstance.maxPlayers,
    };
    io.to(roomId).emit('gameUpdate', updatePayload);

    // Admin-Updates werden ebenfalls mit der namenlosen Spielerliste gesendet.
    if (
      gameInstance.adminSocketId &&
      io.sockets.sockets.get(gameInstance.adminSocketId)
    ) {
      io.to(gameInstance.adminSocketId).emit('admin:playerJoinedRoom', {
        roomId,
        players: playerListForUpdate,
      });
      io.to(gameInstance.adminSocketId).emit('admin:roomStatusUpdate', {
        roomId,
        status: {
          isActive: true,
          isRunning: gameInstance.isRunning,
          playerCount: gameInstance.players.length,
          players: playerListForUpdate, // Angepasste Liste
          pastelPalette: gameInstance.pastelPalette,
          maxPlayers: gameInstance.maxPlayers,
        },
      });
    }
    
    // Erfolgs-Callback bleibt gleich.
    if (callback)
      callback({ success: true, gameId: roomId, roomName: gameInstance.name });
});

// In server.js, innerhalb von io.on("connection", ...)

socket.on('player:setReadyStatus', ({ roomId, isReady }, callback) => {
  const gameInstance = games[roomId];
  if (!gameInstance || !gameInstance.adminSocketId || gameInstance.started) {
    return callback && callback({ success: false, error: "Raum nicht aktiv oder Spiel hat bereits begonnen." });
  }
  const player = gameInstance.players.find(p => p.id === socket.id);
  if (!player) { return callback && callback({ success: false, error: "Spieler nicht gefunden." }); }

  player.isReadyInLobby = !!isReady;
  console.log(`[Game ${roomId}] Spieler ${player.id} Status: ${player.isReadyInLobby}`);

  // UI bei allen Spielern aktualisieren (damit sie die Häkchen sehen)
  const playerListForUpdate = gameInstance.players.map(p => ({ id: p.id, isReadyInLobby: p.isReadyInLobby }));
  io.to(roomId).emit("gameUpdate", { players: playerListForUpdate, gameId: roomId });
  
  // --- AUTOMATISCHE COUNTDOWN-STEUERUNG ---

  // 1. Countdown ABBRECHEN, wenn ein Spieler auf "nicht bereit" klickt
  if (!isReady && gameInstance.lobbyCountdownTimerId) {
    console.log(`[Game ${roomId}] Spieler ${player.id} hat 'Bereit' zurückgenommen. Countdown wird abgebrochen.`);
    clearInterval(gameInstance.lobbyCountdownTimerId);
    gameInstance.lobbyCountdownTimerId = null;
    gameInstance.lobbyCountdownEndTime = null;
    io.to(roomId).emit('lobby:countdownCancelled', { roomId, message: `Countdown abgebrochen, da ein Spieler nicht mehr bereit ist.` });
  }

  // 2. Prüfen, ob der Countdown GESTARTET werden soll
  const readyCount = gameInstance.players.filter(p => p.isReadyInLobby).length;
  const totalPlayers = gameInstance.players.length;
  const allPlayersReady = totalPlayers > 0 && readyCount === totalPlayers;

  if (allPlayersReady && totalPlayers >= 2) {
    // Alle sind bereit, es gibt genug Spieler -> Starte den Countdown!
    startLobbyCountdown(gameInstance);
  }

  if (callback) callback({ success: true, currentReadyStatus: player.isReadyInLobby });
});

  socket.on('admin:startGameInstance', ({ roomId }) => {
    const game = games[roomId];
    if (!game || socket.id !== game.adminSocketId) {
      socket.emit('admin:error', {
        message: 'Not authorized or game not found.',
      });
      return;
    }
    if (game.started || game.isRunning || game.lobbyCountdownTimerId) {
      socket.emit('admin:error', {
        message: `Game in room ${roomId} already starting, running, or in countdown.`,
      });
      return;
    }
    if (game.players.length < 2) {
      socket.emit('admin:error', {
        message: `Not enough players in room ${roomId} (minimum 2).`,
      });
      return;
    }
    const allPlayersInLobbyReady =
      game.players.length > 0 && game.players.every(p => p.isReadyInLobby);
    if (!allPlayersInLobbyReady) {
    
    
    const notReadyPlayerInfo = game.players
      .map((player, index) => ({ player, index: index + 1 })) 
      .filter(item => !item.player.isReadyInLobby)         
      .map(item => `Spieler ${item.index}`);                

    socket.emit('admin:error', {
      message: `Cannot start: Not all players are ready. Waiting for: ${notReadyPlayerInfo.join(
        ', '
      )}`,
    });
    return;
  }

    console.log(
      `[Game ${roomId}] Admin triggered start, all players ready. Starting 10s countdown.`
    );
    game.lobbyCountdownEndTime = Date.now() + 10000;
    io.to(roomId).emit('lobby:countdownStarted', {
      roomId,
      duration: 10,
      endTime: game.lobbyCountdownEndTime,
    });
    if (game.lobbyCountdownTimerId) clearInterval(game.lobbyCountdownTimerId);

    game.lobbyCountdownTimerId = setInterval(() => {
      const gameInstanceForInterval = games[roomId];
      if (
        !gameInstanceForInterval ||
        !gameInstanceForInterval.lobbyCountdownEndTime ||
        !gameInstanceForInterval.adminSocketId
      ) {
        if (
          gameInstanceForInterval &&
          gameInstanceForInterval.lobbyCountdownTimerId
        )
          clearInterval(gameInstanceForInterval.lobbyCountdownTimerId);
        if (gameInstanceForInterval)
          gameInstanceForInterval.lobbyCountdownTimerId = null;
        console.log(
          `[Game ${roomId}] Countdown interval cleared (game missing/ended or admin left).`
        );
        return;
      }
      const remainingTime = Math.max(
        0,
        Math.round(
          (gameInstanceForInterval.lobbyCountdownEndTime - Date.now()) / 1000
        )
      );
    
      if (remainingTime <= 0) {
        clearInterval(gameInstanceForInterval.lobbyCountdownTimerId);
        gameInstanceForInterval.lobbyCountdownTimerId = null;
        gameInstanceForInterval.lobbyCountdownEndTime = null;

        const stillAllReady = gameInstanceForInterval.players.every(
          p => p.isReadyInLobby
        );
        if (stillAllReady && gameInstanceForInterval.players.length >= 2) {
          console.log(
            `[Game ${roomId}] Countdown finished. All still ready. Proceeding to asset loading phase.`
          );
          gameInstanceForInterval.started = true;
          gameInstanceForInterval.isRunning = false;
          gameInstanceForInterval.players.forEach(p => (p.ready = false));
          gameInstanceForInterval.readyPlayerCount = 0;

          gameInstanceForInterval.players.forEach(pSocket => {
            const playerClientSocket = io.sockets.sockets.get(pSocket.id);
            if (playerClientSocket) {
              playerClientSocket.emit('goToGame', {
                gameId: roomId,
                roomName: gameInstanceForInterval.name,
              });
            }
          });
          io.to(gameInstanceForInterval.adminSocketId).emit(
            'admin:gameInstanceStarted',
            {
              roomId,
              playerCount: gameInstanceForInterval.players.length,
              message: 'Players sent to game view.',
            }
          );
          io.emit('admin:roomStatusUpdate', {
            roomId,
            status: {
              isActive: true,
              isRunning: false,
              playerCount: gameInstanceForInterval.players.length,
              players: gameInstanceForInterval.players.map(p => ({
                id: p.id,
                isReadyInLobby: p.isReadyInLobby,
              })),
              pastelPalette: gameInstanceForInterval.pastelPalette,
              maxPlayers: gameInstanceForInterval.maxPlayers,
            },
          });
        } else {
          console.log(
            `[Game ${roomId}] Countdown finished, but not all players are ready anymore or player count too low. Aborting game start.`
          );
          io.to(roomId).emit('lobby:countdownCancelled', {
            roomId,
            message:
              'Not all players were ready when countdown ended, or too few players.',
          });
        }
      }
    }, 1000);
    socket.emit('admin:info', {
      message: 'Countdown initiated for room ' + roomId,
    });
  });

  socket.on('playerReadyForGame', ({ gameId }) => {
    const game = games[gameId];
    if (!game || !game.started || socket.id === game.adminSocketId) return;
    const player = game.players.find(p => p.id === socket.id);
    if (player && !player.ready) {
      player.ready = true;
      game.readyPlayerCount = (game.readyPlayerCount || 0) + 1;
      console.log(
        `[Game ${gameId}] Player ${player.id} (assets loaded). Total game-ready: ${game.readyPlayerCount}/${game.players.length}`
      );
      if (game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)) {
        io.to(game.adminSocketId).emit('playerReadyUpdate', {
          gameId,
          playerId: player.id,
          isReady: true,
          readyCount: game.readyPlayerCount,
          totalPlayers: game.players.length,
          type: 'assetLoad',
        });
      }
    }
    // Der folgende Block ist entscheidend
    if (
      game.players.length > 0 &&
      game.readyPlayerCount === game.players.length
    ) {
      console.log(
        `[Game ${gameId}] All players loaded assets. Assigning symbols & starting rounds.`
      );

      if (!assignSymbolsToAllPlayersInGame(game)) {
        // Hier wird die korrigierte Funktion aufgerufen
        game.isRunning = false;
        console.error(
          `[Game ${gameId}] Critical: Failed to assign symbols. Game rounds will not start.`
        );
        // Sende Fehler an Admin und Spieler (bereits in assignSymbolsToAllPlayersInGame, aber ggf. hier noch spezifischer)
        return; // Verhindere, dass das Spiel ohne Symbole weitergeht
      }

      // Wenn Symbole erfolgreich zugewiesen wurden:
      game.isRunning = true;
      game.players.forEach(p => {
        const pSocket = io.sockets.sockets.get(p.id);
        // Stelle sicher, dass p.iconSymbols auch wirklich gesetzt ist
        if (pSocket)
          pSocket.emit('gameStarted', {
            playerId: p.id,
            buttons: p.iconSymbols || [],
            gameId: game.id,
            roomName: game.name,
            initialPieces: game.collectedPieces || [],
            pastelPalette: game.pastelPalette || roomConfig?.pastelPalette,
          });
      });

      if (game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)) {
        io.to(game.adminSocketId).emit('allPlayersReadyGameRunning', {
          gameId: game.id,
          message: 'Rounds are starting!',
        });
      }
      const playerListForUpdate = game.players.map(p => ({
        id: p.id,
        isReadyInLobby: p.isReadyInLobby,
        ready: p.ready,
      })); // 'ready' hinzugefügt
      io.emit('admin:roomStatusUpdate', {
        roomId: gameId,
        status: {
          isActive: true,
          isRunning: true,
          playerCount: game.players.length,
          players: playerListForUpdate,
          pastelPalette: game.pastelPalette,
          maxPlayers: game.maxPlayers,
        },
      });
      startNewRound(game);
    }
  });

  socket.on('requestInitialLobbyState', ({ gameId }) => {
    console.log(
      `[Server] Received 'requestInitialLobbyState' for room: ${gameId} from socket: ${socket.id}`
    );
    const game = games[gameId];
    const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === gameId);
    if (game && game.adminSocketId && roomConfig) {
      const playerListForUpdate = game.players.map(p => ({
        id: p.id,
        isReadyInLobby: p.isReadyInLobby || false,
      }));
      const payload = {
        players: playerListForUpdate,
        gameId: game.id,
        roomName: game.name,
        message: 'Welcome to the lobby!',
        iconThemeFolder: roomConfig.iconThemeFolder, // <<< HIER HINZUGEFÜGT
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

  // In server.js, innerhalb von io.on("connection", (socket) => { ... });

  // In server.js, innerhalb von io.on("connection", (socket) => { ... });

  socket.on('buttonPress', ({ gameId, pressedSymbol }) => {
    console.log(
      `[Server] Event 'buttonPress' empfangen von Socket ${socket.id}: gameId=${gameId}, symbol=${pressedSymbol}`
    );
    const game = games[gameId];
    const player = game ? game.players.find(p => p.id === socket.id) : null;

    // Grundlegende Überprüfungen, ob der Tastendruck überhaupt gültig ist
    if (
      !game ||
      !player ||
      !game.isRunning ||
      !game.currentRound ||
      !game.currentRound.isActive
    ) {
      let errorMsg = 'Not in an active round.';
      if (!game) errorMsg = 'Game not found.';
      else if (!player) errorMsg = 'Player not found in this game.';
      else if (!game.isRunning) errorMsg = 'Game is not currently running.';
      else if (!game.currentRound || !game.currentRound.isActive)
        errorMsg = 'Round has already ended.';

      console.warn(
        `[Game ${gameId}] Invalid button press by ${socket.id}. Reason: ${errorMsg}`
      );
      socket.emit('feedback', { correct: false, message: errorMsg });
      return;
    }

    // Überprüfen, ob der richtige Spieler (der 'target') das richtige Symbol drückt
    if (player.id === game.currentRound.targetId) {
      if (pressedSymbol === game.currentRound.currentTargetSymbol) {
        // --- KORREKTER TASTENDRUCK ---
        game.currentRound.isActive = false; // Runde sofort als beendet markieren
        const sourcePlayer = game.players.find(
          p => p.id === game.currentRound.sourceId
        );
        const feedbackMessage = `Well Done! You found a Piece!`;

        console.log(
          `[Game ${gameId}] Player ${player.id} (target) pressed CORRECT symbol.`
        );
        io.to(gameId).emit('feedback', {
          correct: true,
          message: feedbackMessage,
        });

        // LOGIK FÜR TEILEGEWINN (PIECES)
        // Prüfen, ob dies eine "Bonusrunde" ist (jede 3. Runde)
        if (game.roundNumber > 0 && game.roundNumber % 3 === 0) {
          const awardedPiece = game.currentRound.currentTargetSymbol;
          if (!game.collectedPieces) game.collectedPieces = []; // Sicherheitscheck
          game.collectedPieces.push(awardedPiece);

          console.log(
            `[Game ${gameId}] Team awarded a piece: '${awardedPiece}'. Total pieces: ${game.collectedPieces.length}`
          );

          // Informiere alle Spieler im Raum über das neu gewonnene Teil
          io.to(gameId).emit('teamAwardedPiece', {
            gameId: gameId,
            pieceIcon: awardedPiece,
            currentRoundNumber: game.roundNumber,
          });

          // SIEGBEDINGUNG PRÜFEN: Hat das Team 4 oder mehr Teile?
          if (game.collectedPieces.length >= 4) {
            console.log(
              `[Game ${gameId}] VICTORY! Team has collected 4 pieces.`
            );
            game.isRunning = false; // Spiel anhalten
            io.to(gameId).emit('gameEnded', {
              reason: 'victory_pieces_collected',
              message: 'Herzlichen Glückwunsch! Ihr habt alle Teile gesammelt!',
              collectedPieces: game.collectedPieces,
            });
            setTimeout(() => {
              if (games[gameId]) {
                const roomConfig =
                  PREDEFINED_ROOM_CONFIGS.find(r => r.id === gameId) || {};
                io.emit('admin:roomStatusUpdate', {
                  roomId: gameId,
                  status: {
                    isActive: false,
                    isRunning: false,
                    playerCount: 0,
                    players: [],
                  },
                });
                delete games[gameId];
              }
            }, 5000);
            return; // WICHTIG: Keine neue Runde starten
          }
        }

        // Wenn das Spiel nicht gewonnen wurde, starte die nächste Runde
        setTimeout(() => {
          if (games[gameId] && games[gameId].isRunning) {
            startNewRound(game);
          }
        }, 3000);
      } else {
        // --- FALSCHES SYMBOL GEDRÜCKT ---
        let feedbackMessage = `Oops, das war nicht das richtige Symbol!`;
        console.log(
          `[Game ${gameId}] Player ${player.id} (target) pressed INCORRECT symbol.`
        );

        // +++ LOGIK ZUM VERLIEREN EINES TEILS +++
        if (game.collectedPieces && game.collectedPieces.length > 0) {
          const lostPiece = game.collectedPieces.pop();
          feedbackMessage += ' Das Team verliert ein Teil!';
          console.log(
            `[Game ${gameId}] Team lost a piece: ${lostPiece}. Remaining: ${game.collectedPieces.length}`
          );
          io.to(gameId).emit('teamLostPiece', {
            gameId: gameId,
            lostPieceIcon: lostPiece,
            remainingPieces: game.collectedPieces,
          });
        }

        socket.emit('feedback', {
          correct: false,
          message: feedbackMessage,
          pressedByPlayerId: player.id,
        });
      }
    } else {
      // --- FALSCHER SPIELER HAT GEDRÜCKT ---
      let feedbackMessage = `Warte, bis du an der Reihe bist!`;
      console.log(
        `[Game ${gameId}] Player ${player.id} (not target) pressed a symbol.`
      );

      // +++ LOGIK ZUM VERLIEREN EINES TEILS (identisch) +++
      if (game.collectedPieces && game.collectedPieces.length > 0) {
        const lostPiece = game.collectedPieces.pop();
        feedbackMessage += ' Das Team verliert ein Teil!';
        console.log(
          `[Game ${gameId}] Team lost a piece due to wrong player action: ${lostPiece}. Remaining: ${game.collectedPieces.length}`
        );
        io.to(gameId).emit('teamLostPiece', {
          gameId: gameId,
          lostPieceIcon: lostPiece,
          remainingPieces: game.collectedPieces,
        });
      }

      socket.emit('feedback', {
        correct: false,
        message: feedbackMessage,
        pressedByPlayerId: player.id,
      });
    }
  });

  socket.on('admin:resetRoom', ({ roomId }) => {
    const game = games[roomId];
    if (game && socket.id === game.adminSocketId) {
      console.log(`[Admin ${socket.id}] resetting room ${roomId}`);
      if (game.lobbyCountdownTimerId) {
        // Aktiven Countdown stoppen
        clearInterval(game.lobbyCountdownTimerId);
        game.lobbyCountdownTimerId = null;
        game.lobbyCountdownEndTime = null;
        io.to(roomId).emit('lobby:countdownCancelled', {
          roomId,
          message: 'Room reset by admin.',
        });
      }
      game.players.forEach(p => {
        const playerSocket = io.sockets.sockets.get(p.id);
        if (playerSocket) {
          playerSocket.emit('gameEnded', {
            reason: 'admin_reset',
            message: 'The room has been reset.',
          });
          playerSocket.leave(roomId);
        }
      });
      delete games[roomId];
      socket.emit('admin:roomReset', {
        roomId,
        message: `Room ${roomId} has been reset.`,
      });
      const roomConfig =
        PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId) || {};
      io.emit('admin:roomStatusUpdate', {
        roomId: roomId,
        status: {
          isActive: false,
          isRunning: false,
          playerCount: 0,
          players: [],
          pastelPalette: roomConfig.pastelPalette,
          maxPlayers: roomConfig.maxPlayers,
        },
      });
    } else {
      socket.emit('admin:error', { message: 'Failed to reset room.' });
    }
  });
  socket.on('leaveGame', ({ gameId }) => {
    handlePlayerLeave(socket, gameId, true);
  });
 // In server.js, innerhalb von io.on("connection", (socket) => { ... });

socket.on('disconnect', () => {
  console.log(`[Server] Socket disconnected: ${socket.id}`);
  // Logik für den Fall, dass ein Spieler oder Admin die Verbindung verliert
  for (const roomId in games) {
    const game = games[roomId];
    // Prüfen, ob der getrennte Socket der Admin dieses Raumes war
    if (game.adminSocketId === socket.id) {
      console.log(`[Admin ${socket.id}] disconnected from managing room ${roomId}. Cleaning up room.`);
      if (game.lobbyCountdownTimerId) {
        clearInterval(game.lobbyCountdownTimerId);
        game.lobbyCountdownTimerId = null;
      }
      // Informiere alle verbleibenden Spieler im Raum, dass das Spiel beendet wurde
      game.players.forEach(playerInRoom => {
        const playerSocket = io.sockets.sockets.get(playerInRoom.id);
        if (playerSocket) {
          playerSocket.emit('gameEnded', {
            reason: 'admin_disconnect',
            message: 'The admin has disconnected, the room is now closed.',
          });
          playerSocket.leave(roomId);
        }
      });
      delete games[roomId];
      const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId) || {};
      io.emit('admin:roomStatusUpdate', {
        roomId: roomId,
        status: {
          isActive: false,
          isRunning: false,
          playerCount: 0,
          players: [],
          pastelPalette: roomConfig.pastelPalette,
          maxPlayers: roomConfig.maxPlayers,
        },
      });
      break; 
    } else {
      // Prüfen, ob der getrennte Socket ein Spieler in diesem Raum war
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        // Spieler hat die Verbindung verloren, rufe die jetzt korrigierte handlePlayerLeave-Funktion auf
        handlePlayerLeave(socket, roomId, false); // false für implizites Verlassen (disconnect)
        break;
      }
    }
  }
});
  // --- Hilfsfunktionen ---
  // Innerhalb von io.on("connection", (socket) => { ... HIER });

// In server.js

/**
 * Startet den 10-sekündigen Countdown für die Lobby, wenn nicht schon aktiv.
 * @param {object} game - Die Spielinstanz.
 */
function startLobbyCountdown(game) {
  // Verhindere, dass der Countdown mehrfach gestartet wird
  if (!game || game.lobbyCountdownTimerId) {
    return;
  }

  const roomId = game.id;
  console.log(`[Game ${roomId}] Alle Spieler bereit. Automatischer 10s Countdown wird gestartet.`);
  
  // Setze die Endzeit für den Countdown
  game.lobbyCountdownEndTime = Date.now() + 10000;
  // Informiere alle Spieler, dass der Countdown beginnt
  io.to(roomId).emit('lobby:countdownStarted', {
    roomId,
    duration: 10,
    endTime: game.lobbyCountdownEndTime,
  });

  // Starte den serverseitigen Timer
  game.lobbyCountdownTimerId = setInterval(() => {
    const gameInstanceForInterval = games[roomId];
    if (!gameInstanceForInterval || !gameInstanceForInterval.lobbyCountdownEndTime) {
      if (gameInstanceForInterval?.lobbyCountdownTimerId) {
        clearInterval(gameInstanceForInterval.lobbyCountdownTimerId);
        gameInstanceForInterval.lobbyCountdownTimerId = null;
      }
      return;
    }
    
    // Prüfen, ob der Countdown abgelaufen ist
    if (Date.now() >= gameInstanceForInterval.lobbyCountdownEndTime) {
      clearInterval(gameInstanceForInterval.lobbyCountdownTimerId);
      gameInstanceForInterval.lobbyCountdownTimerId = null;
      gameInstanceForInterval.lobbyCountdownEndTime = null;

      // Finale Überprüfung: Sind immer noch alle bereit?
      const stillAllReady = gameInstanceForInterval.players.every(p => p.isReadyInLobby);
      if (stillAllReady && gameInstanceForInterval.players.length >= 2) {
        console.log(`[Game ${roomId}] Countdown beendet. Spiel wird gestartet.`);
        gameInstanceForInterval.started = true; // Spiel geht in die nächste Phase
        gameInstanceForInterval.players.forEach(p => p.ready = false); // Asset-Ready-Status zurücksetzen
        gameInstanceForInterval.readyPlayerCount = 0;

        // Schicke alle Spieler zum Spielbildschirm
        io.to(roomId).emit('goToGame', { gameId: roomId });
        
        if (gameInstanceForInterval.adminSocketId) {
          io.to(gameInstanceForInterval.adminSocketId).emit('admin:gameInstanceStarted', { roomId, message: 'Spiel wurde automatisch gestartet.' });
        }
      } else {
        console.log(`[Game ${roomId}] Countdown beendet, aber nicht mehr alle Spieler bereit. Start abgebrochen.`);
        io.to(roomId).emit('lobby:countdownCancelled', { roomId, message: 'Start abgebrochen, da ein Spieler nicht mehr bereit war.' });
      }
    }
  }, 1000);
}

function handlePlayerLeave(socket, roomId, explicitLeave) {
  const game = games[roomId];
  if (!game) return false;

  const playerIndex = game.players.findIndex(p => p.id === socket.id);
  if (playerIndex === -1) return false;

  const leavingPlayer = { ...game.players[playerIndex] };
  game.players.splice(playerIndex, 1);

  if (leavingPlayer.ready && game.readyPlayerCount > 0) {
    game.readyPlayerCount--;
  }

  const leaveType = explicitLeave ? 'explicitly left' : 'disconnected';
  console.log(`[Game ${roomId}] Player with ID ${leavingPlayer.id} ${leaveType}. Remaining: ${game.players.length}`);

  // Nachricht für Countdown-Abbruch ist jetzt anonym.
  if (game.lobbyCountdownTimerId) {
    console.log(`[Game ${roomId}] A player left during lobby countdown. Cancelling countdown.`);
    clearInterval(game.lobbyCountdownTimerId);
    game.lobbyCountdownTimerId = null;
    game.lobbyCountdownEndTime = null;
    io.to(roomId).emit('lobby:countdownCancelled', {
      roomId,
      message: `Countdown cancelled: A player left the lobby.`,
    });
  }

  const playerListForUpdate = game.players.map(p => ({
    id: p.id,
    isReadyInLobby: p.isReadyInLobby || false,
  }));
  const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId) || {};

  const gameUpdatePayload = {
    players: playerListForUpdate, 
    gameId: roomId,
    roomName: game.name,
    pastelPalette: game.pastelPalette || roomConfig.pastelPalette,
    maxPlayers: game.maxPlayers || roomConfig.maxPlayers,
    message: `A player has left.`, 
  };
  io.to(roomId).emit('gameUpdate', gameUpdatePayload);

  if (game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)) {
    io.to(game.adminSocketId).emit('admin:playerLeftRoom', {
      roomId,
      players: playerListForUpdate, 
    });
    if (game.started && !game.isRunning) {
      io.to(game.adminSocketId).emit('playerReadyUpdate', {
        gameId: roomId,
        readyCount: game.readyPlayerCount,
        totalPlayers: game.players.length,
      });
    }
  }

  // Die restliche Logik zum Beenden des Spiels bei zu wenigen Spielern etc. bleibt erhalten,
  // da sie nicht von Namen abhängt.
  let finalRoomIsActive = true;
  let finalRoomIsRunning = game.isRunning && game.players.length >= 2;

  if (game.started) {
    if (game.players.length < 2) {
      finalRoomIsRunning = false;
      finalRoomIsActive = false;
      io.to(roomId).emit('gameEnded', { reason: 'insufficient_players_mid_game', message: 'Not enough players.' });
      if (game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)) {
        io.to(game.adminSocketId).emit('gameForceEnded', { roomId, message: 'Game ended: Not enough players.' });
      }
      delete games[roomId];
    } else if (
      game.currentRound &&
      (game.currentRound.sourceId === leavingPlayer.id || game.currentRound.targetId === leavingPlayer.id)
    ) {
      if (game.isRunning) {
        if (game.currentRound) game.currentRound.isActive = false;
        startNewRound(game);
      }
    } else if (
      game.started && !game.isRunning &&
      game.readyPlayerCount === game.players.length && game.players.length > 0
    ) {
      game.isRunning = true;
      finalRoomIsRunning = true;
      if (!assignSymbolsToAllPlayersInGame(game)) return true; // Gib true zurück, um die Funktion hier zu beenden
      game.players.forEach(p => {
        const pSocket = io.sockets.sockets.get(p.id);
        if (pSocket) pSocket.emit('gameStarted', {
          playerId: p.id,
          buttons: p.iconSymbols,
          gameId: game.id,
          roomName: game.name,
        });
      });
      if (game.adminSocketId) io.to(game.adminSocketId).emit('allPlayersReadyGameRunning', { gameId: game.id });
      startNewRound(game);
    }
  } else {
    finalRoomIsRunning = false;
  }

  // Sende ein Update an die Admin-Übersicht, falls der Raum nicht schon gelöscht wurde
  if (games[roomId]) {
    io.emit('admin:roomStatusUpdate', {
      roomId: roomId,
      status: {
        isActive: finalRoomIsActive,
        isRunning: finalRoomIsRunning,
        playerCount: game.players.length,
        players: finalRoomIsActive ? playerListForUpdate : [],
        pastelPalette: game.pastelPalette || roomConfig.pastelPalette,
        maxPlayers: game.maxPlayers || roomConfig.maxPlayers,
      },
    });
  }
  return true;
}

  function startNewRound(game) {
  if (!game || !game.players || game.players.length < 2) {
    if (game && game.id) {
      console.log(`[Game ${game.id}] Cannot start new round (not enough players: ${game.players?.length}). Ending game.`);
      io.to(game.id).emit('gameEnded', { reason: 'insufficient_players_for_round', message: 'Not enough players.' });
      if (io.sockets.sockets.get(game.adminSocketId)) {
        io.to(game.adminSocketId).emit('gameForceEnded', { roomId: game.id, message: 'Game ended: Insufficient players.' });
      }
      const roomCfgForDelete = PREDEFINED_ROOM_CONFIGS.find(r => r.id === game.id) || {};
      delete games[game.id];
      io.emit('admin:roomStatusUpdate', {
        roomId: game.id,
        status: { isActive: false, isRunning: false, playerCount: 0, players: [], pastelPalette: roomCfgForDelete.pastelPalette, maxPlayers: roomCfgForDelete.maxPlayers },
      });
    }
    return;
  }
  
  game.roundNumber = (game.roundNumber || 0) + 1;
  const currentRoundNumberForLog = game.roundNumber;
  console.log(`[Game ${game.id}] Attempting to start round ${currentRoundNumberForLog}.`);
  // GEÄNDERT: Log ohne Spielernamen
  console.log(`[Game ${game.id}]   Players (IDs): ${game.players.map(p => p.id.substring(0,6)).join(', ')} (Count: ${game.players.length})`);
  console.log(`[Game ${game.id}]   NextTargetPlayerIndex (before): ${game.nextTargetPlayerIndex}`);

  const isPieceRound = game.roundNumber > 0 && game.roundNumber % 3 === 0;
  if (isPieceRound) {
    console.log(`[Game ${game.id}] This is a PIECE ROUND!`);
  }

  const sourcePlayer = game.players[Math.floor(Math.random() * game.players.length)];
  // GEÄNDERT: Log ohne Spielernamen
  console.log(`[Game ${game.id}]   Round ${currentRoundNumberForLog} - Source ID: ${sourcePlayer.id}`);

  let targetPlayer = null;
  const numPlayers = game.players.length;
  let searchStartIndex = game.nextTargetPlayerIndex || 0;

  for (let i = 0; i < numPlayers; i++) {
    const currentPlayerIndexInLoop = (searchStartIndex + i) % numPlayers;
    const candidatePlayer = game.players[currentPlayerIndexInLoop];
    if (candidatePlayer.id !== sourcePlayer.id) {
      targetPlayer = candidatePlayer;
      game.nextTargetPlayerIndex = (currentPlayerIndexInLoop + 1) % numPlayers;
      break;
    }
  }

  if (!targetPlayer) {
    console.warn(`[Game ${game.id}] Round ${currentRoundNumberForLog} - Primary target selection FAILED. Fallback.`);
    const otherPlayers = game.players.filter(p => p.id !== sourcePlayer.id);
    if (otherPlayers.length > 0) {
      targetPlayer = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
      const actualTargetIdx = game.players.findIndex(p => p.id === targetPlayer.id);
      if (actualTargetIdx !== -1) game.nextTargetPlayerIndex = (actualTargetIdx + 1) % numPlayers;
      else game.nextTargetPlayerIndex = 0;
    } else {
      console.error(`[Game ${game.id}] CRITICAL FALLBACK: No other players. Ending game.`);
      io.to(game.id).emit('gameEnded', { reason: 'internal_error_no_target_fb', message: 'Error: No target.' });
      if (io.sockets.sockets.get(game.adminSocketId)) io.to(game.adminSocketId).emit('gameForceEnded', { roomId: game.id, message: 'Error: No target.' });
      const roomCfgForDeleteCrit = PREDEFINED_ROOM_CONFIGS.find(r => r.id === game.id) || {};
      delete games[game.id];
      io.emit('admin:roomStatusUpdate', {
        roomId: game.id,
        status: { isActive: false, isRunning: false, playerCount: 0, players: [], pastelPalette: roomCfgForDeleteCrit.pastelPalette, maxPlayers: roomCfgForDeleteCrit.maxPlayers },
      });
      return;
    }
  }
  // GEÄNDERT: Log ohne Spielernamen
  console.log(`[Game ${game.id}]   Round ${currentRoundNumberForLog} - Target ID: ${targetPlayer.id}. Next target search index: ${game.nextTargetPlayerIndex}`);

  if (!targetPlayer.iconSymbols || targetPlayer.iconSymbols.length === 0) {
    console.error(`[Game ${game.id}] CRITICAL: Target player ${targetPlayer.id} has no iconSymbols!`);
    return; // Runde kann nicht gestartet werden
  }

  const targetSymbolIndexOnTargetDevice = Math.floor(Math.random() * targetPlayer.iconSymbols.length);
  const currentTargetSymbol = targetPlayer.iconSymbols[targetSymbolIndexOnTargetDevice];
  game.currentRound = {
    sourceId: sourcePlayer.id,
    targetId: targetPlayer.id,
    currentTargetSymbol,
    targetSymbolIndexOnTargetDevice,
    isActive: true,
    roundNumber: game.roundNumber,
  };
  // GEÄNDERT: Log ohne Spielernamen
  console.log(`[Game ${game.id}] Round ${game.roundNumber} setup: Source ID=${sourcePlayer.id}, Target ID=${targetPlayer.id}, Symbol=${currentTargetSymbol}.`);

  game.players.forEach(player => {
    let payload = {
      role: 'inactive',
      currentTargetSymbol,
      roundNumber: game.roundNumber,
      isPieceRound: isPieceRound,
    };
    if (player.id === sourcePlayer.id) payload.role = 'source';
    else if (player.id === targetPlayer.id) {
      payload.role = 'target';
      payload.yourTargetIndex = targetSymbolIndexOnTargetDevice;
    }
    const pSocket = io.sockets.sockets.get(player.id);
    if(pSocket) pSocket.emit('roundUpdate', payload);
  });
  if (game.adminSocketId) {
    io.to(game.adminSocketId).emit('roundStartedForHost', {
      gameId: game.id,
      roundNumber: game.roundNumber,
      sourcePlayer: { id: sourcePlayer.id },
      targetPlayer: { id: targetPlayer.id },
      targetSymbol: currentTargetSymbol,
      isPieceRound: isPieceRound,
    });
  }
}
});

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎉 Server listening on port ${PORT}`));
