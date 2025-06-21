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

// In server.js

function shuffleArray(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

function setupNewGameBoard(game) {
  const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === game.id);
  const themeFolder = roomConfig?.id?.toLowerCase() || 'default';
  const fullSymbolPool = getSymbolPoolForTheme(themeFolder);

  const SYMBOLS_PER_GAME = 9;

  if (fullSymbolPool.length < SYMBOLS_PER_GAME) {
    const errorMsg = `Nicht genügend Symbole im Pool für Theme '${themeFolder}'. Benötigt: ${SYMBOLS_PER_GAME}, Verfügbar: ${fullSymbolPool.length}.`;
    console.error(`[Game ${game.id}] ${errorMsg}`);
    io.to(game.id).emit('gameError', { message: errorMsg });
    if (game.adminSocketId) {
      io.to(game.adminSocketId).emit('gameSetupError', { roomId: game.id, message: errorMsg });
    }
    return false;
  }

  const shuffledPool = shuffleArray([...fullSymbolPool]);
  game.gameSymbols = shuffledPool.slice(0, SYMBOLS_PER_GAME);
  game.matchedSymbols = [];
  
  console.log(`[Game ${game.id}] Spielbrett wird mit diesen ${SYMBOLS_PER_GAME} Symbolen aufgebaut:`, game.gameSymbols.join(', '));

  game.players.forEach(player => {
    const shuffledBoardSymbols = shuffleArray([...game.gameSymbols]);
    player.board = shuffledBoardSymbols.map(symbol => ({
      symbol: symbol,
      isFlipped: false,
      isMatched: false
    }));
  });
  
  return true;
}
/**
 * Lädt Symbol-Identifier (Dateinamen ohne .svg) aus einem spezifischen Theme-Ordner.
 * Fallback auf den 'default' Theme-Ordner, wenn der spezifische Ordner nicht existiert,
 * leer ist oder ein Fehler auftritt.
 * @param {string} themeFolder - Der Name des Theme-Ordners (z.B. 'zoo', 'foodcourt').
 * @returns {string[]} Ein Array von Symbol-Identifiern oder ein leeres Array bei Fehler.
 */
// In server.js

  /**
 * Entfernt einen Spieler endgültig aus einem Spiel und aktualisiert den Spielzustand.
 * @param {string} persistentPlayerId - Die beständige ID des zu entfernenden Spielers.
 * @param {string} roomId - Die ID des Raumes.
 */
// In server.js

function removePlayerFromGame(persistentPlayerId, roomId) {
  const game = games[roomId];
  if (!game) return;

  const playerIndex = game.players.findIndex(p => p.persistentId === persistentPlayerId);
  if (playerIndex === -1) return;

  const leavingPlayer = game.players[playerIndex];
  
  if (leavingPlayer.removalTimeout) clearTimeout(leavingPlayer.removalTimeout);

  game.players.splice(playerIndex, 1);
  if (leavingPlayer.ready && game.readyPlayerCount > 0) game.readyPlayerCount--;

  if (game.lobbyCountdownTimerId) {
    clearInterval(game.lobbyCountdownTimerId);
    game.lobbyCountdownTimerId = null;
    game.lobbyCountdownEndTime = null;
    io.to(roomId).emit('lobby:countdownCancelled', { roomId, message: `A player left.` });
  }

  const playerListForUpdate = game.players.map(p => ({ id: p.id, isReadyInLobby: p.isReadyInLobby || false }));
  io.to(roomId).emit('gameUpdate', { players: playerListForUpdate, gameId: roomId, message: `A player has left.` });
  if (game.adminSocketId) io.to(game.adminSocketId).emit('admin:playerLeftRoom', { roomId, players: playerListForUpdate });

  // Spiel beenden, wenn zu wenige Spieler übrig sind
  if (game.started && game.players.length < 2) {
    io.to(roomId).emit('gameEnded', { reason: 'insufficient_players_mid_game', message: 'Not enough players.' });
    if(game.adminSocketId) io.to(game.adminSocketId).emit("gameForceEnded", { roomId, message: "Game ended: Not enough players." });
    delete games[roomId];
  
  // GEÄNDERT: Alte Rundenlogik komplett entfernt und durch neue ersetzt
  } else if (game.isRunning && game.currentTurn && !game.currentTurn.isResolved) {
    // Ein Spieler hat das Spiel mitten in einer ungelösten Runde verlassen.
    // Wir setzen die Runde für alle verbleibenden Spieler zurück.
    console.log(`[Game ${roomId}] Player left mid-turn. Resetting current turn.`);
    game.currentTurn.choices = {};
    game.currentTurn.isResolved = true; // Markiere sie als gelöst, um sie abzuschließen
    
    // Beginne eine neue Runde
    const nextTurnNumber = (game.currentTurn.turnNumber || 0) + 1;
    game.currentTurn = { turnNumber: nextTurnNumber, choices: {}, isResolved: false };
    io.to(roomId).emit('turnBegan', { turnNumber: nextTurnNumber, matchedSymbols: game.matchedSymbols });
  }
  
  // Sende immer ein Admin-Status-Update, wenn der Raum noch existiert
  if (games[roomId]) {
    io.emit('admin:roomStatusUpdate', { 
        roomId, 
        status: { 
            isActive: true, 
            isRunning: game.isRunning, 
            playerCount: game.players.length 
        } 
    });
  }
}

function getSymbolPoolForTheme(themeFolder) {
  const specificThemePath = path.join(ICONS_BASE_PATH, themeFolder);
  let pool = [];

  try {
    if (fs.existsSync(specificThemePath)) {
      const files = fs.readdirSync(specificThemePath);
      pool = files
        // GEÄNDERT: Suche jetzt nach .png statt .svg
        .filter(file => file.toLowerCase().endsWith('.png')) 
        // GEÄNDERT: Entferne die .png Endung
        .map(file => path.basename(file, '.png')); 
      if (pool.length > 0) {
        console.log(`[Server] Loaded ${pool.length} icons for theme '${themeFolder}'`);
        return pool;
      } else {
        console.warn(`[Server] No .png files found in theme folder: ${specificThemePath}. Attempting fallback.`);
      }
    } else {
      console.warn(`[Server] Theme folder path does not exist: ${specificThemePath}. Attempting fallback.`);
    }
  } catch (error) {
    console.error(`[Server] Error reading icon folder for theme '${themeFolder}':`, error, `Attempting fallback.`);
  }

  // Fallback zu 'default'
  console.log(`[Server] Falling back to default icon pool (requested for theme '${themeFolder}').`);
  const defaultThemePath = path.join(ICONS_BASE_PATH, 'default');
  try {
    if (fs.existsSync(defaultThemePath)) {
      const files = fs.readdirSync(defaultThemePath);
      const defaultPool = files
        // GEÄNDERT: Suche jetzt nach .png statt .svg
        .filter(file => file.toLowerCase().endsWith('.png'))
        // GEÄNDERT: Entferne die .png Endung
        .map(file => path.basename(file, '.png'));
      if (defaultPool.length > 0) {
        console.log(`[Server] Loaded ${defaultPool.length} icons from default theme folder as fallback.`);
        return defaultPool;
      } else {
        console.warn(`[Server] Warning: No .png files found in default fallback icon folder. Final pool will be empty.`);
        return [];
      }
    } else {
      console.error(`[Server] Error: Default icon folder path does not exist for fallback. Final pool will be empty.`);
      return [];
    }
  } catch (error) {
    console.error(`[Server] Error reading default icon folder for fallback:`, error, `Final pool will be empty.`);
    return [];
  }
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
      
      // NEUE STRUKTUR
      gameSymbols: [],        // Die 9 Symbole für diese Runde
      matchedSymbols: [],     // Array der erfolgreich gefundenen Symbole
      currentTurn: {          // Speichert die Auswahl der aktuellen Runde
        turnNumber: 0,
        choices: {},          // Map von { playerId: 'symbol' }
        isResolved: true,     // Zeigt an, ob die Runde ausgewertet wurde
      },
      // ENDE NEUE STRUKTUR

      readyPlayerCount: 0,
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
    
    // NEUE STRUKTUR für die Runden-Info im Admin Panel
    const currentTurnForAdmin =
    gameInstance.isRunning && gameInstance.currentTurn
      ? {
          turnNumber: gameInstance.currentTurn.turnNumber,
          choicesCount: Object.keys(gameInstance.currentTurn.choices).length,
          isResolved: gameInstance.currentTurn.isResolved
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
      matchedSymbols: gameInstance.matchedSymbols || [], // NEU
      currentTurn: currentTurnForAdmin, // GEÄNDERT
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


socket.on("joinGame", ({ roomId, persistentPlayerId }, callback) => {
  const gameInstance = games[roomId]; // Die Variable hier heißt gameInstance
  const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId);

  if (!roomConfig || !gameInstance || !gameInstance.adminSocketId) {
    return callback && callback({ success: false, error: "Raum nicht aktiv oder nicht gefunden." });
  }

  // --- WIEDERVERBINDUNGS-LOGIK (RECONNECT) ---
  if (persistentPlayerId) {
    const existingPlayer = gameInstance.players.find(p => p.persistentId === persistentPlayerId);
    
    if (existingPlayer) {
      console.log(`[Game ${roomId}] Reconnecting player ${persistentPlayerId}. New socket: ${socket.id}`);
      
      if (existingPlayer.removalTimeout) {
        clearTimeout(existingPlayer.removalTimeout);
        delete existingPlayer.removalTimeout;
      }
      
      existingPlayer.id = socket.id;
      existingPlayer.disconnected = false;
      socket.join(roomId);

      if (callback) callback({ success: true, persistentPlayerId: existingPlayer.persistentId });

      // NEUE, KORREKTE ZUSTANDS-WIEDERHERSTELLUNG
      if (!gameInstance.started) {
        const playerList = gameInstance.players.map(p => ({ id: p.id, isReadyInLobby: p.isReadyInLobby }));
        socket.emit("gameUpdate", {
          players: playerList,
          gameId: roomId,
          roomName: gameInstance.name,
          maxPlayers: gameInstance.maxPlayers,
          pastelPalette: gameInstance.pastelPalette
        });
      } else {
        socket.emit('gameInitialized', {
          playerId: existingPlayer.id,
          playerBoard: existingPlayer.board,
          gameId: gameInstance.id,
          roomName: gameInstance.name,
          matchedSymbols: gameInstance.matchedSymbols,
          pastelPalette: gameInstance.pastelPalette
        });
        io.to(roomId).emit('turnBegan', { 
            turnNumber: gameInstance.currentTurn.turnNumber, 
            matchedSymbols: gameInstance.matchedSymbols // HIER WAR DER FEHLER: game -> gameInstance
        });
      }
      
      const allPlayersList = gameInstance.players.map(p => ({ id: p.id, isReadyInLobby: p.isReadyInLobby }));
      io.to(roomId).except(socket.id).emit("gameUpdate", { players: allPlayersList, gameId: roomId });

      return;
    }
  }

  // --- LOGIK FÜR NEUEN SPIELER ---
  if (gameInstance.started) {
    return callback && callback({ success: false, error: "Game has already started." });
  }
  if (gameInstance.players.length >= gameInstance.maxPlayers) {
    return callback && callback({ success: false, error: `Room "${roomConfig.name}" is full.` });
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
  console.log(`[Game ${roomId}] New player joined with socket ${socket.id} and persistentId ${newPersistentId}.`);
  
  const playerListForUpdate = gameInstance.players.map(p => ({ id: p.id, isReadyInLobby: p.isReadyInLobby }));
  io.to(roomId).emit("gameUpdate", { players: playerListForUpdate, gameId: roomId, roomName: gameInstance.name, pastelPalette: gameInstance.pastelPalette, maxPlayers: gameInstance.maxPlayers });
  if (gameInstance.adminSocketId) {
    io.emit('admin:roomStatusUpdate', {
      roomId,
      status: {
        isActive: true,
        isRunning: gameInstance.isRunning,
        playerCount: gameInstance.players.length,
        players: playerListForUpdate
      },
    });
  }

  if (callback) callback({ success: true, newPersistentId: newPersistentId });
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
      `[Game ${gameId}] Spieler ${player.id} hat Assets geladen. Bereit: ${game.readyPlayerCount}/${game.players.length}`
    );
  }

  if (game.players.length > 0 && game.readyPlayerCount === game.players.length) {
    if (game.isRunning) {
      console.log(`[Game ${gameId}] Alle Spieler bereit, aber Spiel läuft bereits. Keine Aktion.`);
      return;
    }
    console.log(`[Game ${gameId}] Alle Spieler bereit. Initialisiere Spielbrett.`);

    if (!setupNewGameBoard(game)) {
      console.error(`[Game ${gameId}] Kritisch: Spielbrett konnte nicht initialisiert werden. Spiel wird nicht gestartet.`);
      return;
    }

    game.isRunning = true;

    game.players.forEach(p => {
      const pSocket = io.sockets.sockets.get(p.id);
      if (pSocket) {
        // NEUES EVENT: 'gameInitialized'
        pSocket.emit('gameInitialized', {
          playerId: p.id,
          playerBoard: p.board,
          gameId: game.id,
          roomName: game.name,
          matchedSymbols: game.matchedSymbols,
          pastelPalette: game.pastelPalette
        });
      }
    });

    io.emit('admin:roomStatusUpdate', {
      roomId: gameId,
      status: {
        isActive: true,
        isRunning: true,
        playerCount: game.players.length,
      },
    });

    // Wir starten keine Runde mehr aktiv, sondern warten auf Spieleraktionen
    console.log(`[Game ${gameId}] Spiel initialisiert und an Spieler gesendet. Warte auf erste Karten-Flips.`);
    game.currentTurn = { turnNumber: 1, choices: {}, isResolved: false };
    io.to(game.id).emit('turnBegan', { turnNumber: 1, matchedSymbols: game.matchedSymbols });
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

socket.on("leaveGame", ({ gameId }) => {
    const game = games[gameId];
    if (!game) return;
    const player = game.players.find(p => p.id === socket.id);
    if(player) {
        console.log(`[Game ${gameId}] Player ${player.persistentId} explicitly left the game.`);
        // Ruft direkt die zentrale Funktion ohne Gnadenfrist auf
        removePlayerFromGame(player.persistentId, gameId);
    }
});

socket.on('disconnect', () => {
  console.log(`[Server] Socket disconnected: ${socket.id}`);
  
  let playerWhoDisconnected = null;
  let gameIdOfPlayer = null;

  // Finde heraus, welcher Spieler in welchem Spiel getrennt wurde
  for (const roomId in games) {
    const game = games[roomId];
    if (game.adminSocketId === socket.id) {
      // Admin-Disconnect -> Spiel sofort auflösen
      console.log(`[Admin ${socket.id}] disconnected from room ${roomId}. Cleaning up room.`);
      io.to(roomId).emit('gameEnded', { reason: 'admin_disconnect', message: 'The admin has left.' });
      delete games[roomId];
      io.emit('admin:roomStatusUpdate', { roomId, status: { isActive: false, isRunning: false, playerCount: 0 }});
      return;
    }
    
    const player = game.players.find(p => p.id === socket.id);
    if (player) {
      playerWhoDisconnected = player;
      gameIdOfPlayer = roomId;
      break;
    }
  }

  // Wenn ein Spieler die Verbindung verloren hat, starte die Gnadenfrist
  if (playerWhoDisconnected && gameIdOfPlayer) {
    const player = playerWhoDisconnected;
    const roomId = gameIdOfPlayer;
    const game = games[roomId];
    
    player.id = null;
    player.disconnected = true;
    console.log(`[Game ${roomId}] Player ${player.persistentId} disconnected. Starting 20s reconnect grace period.`);

    // Setze einen Timer, um den Spieler endgültig zu entfernen
    const removalTimeout = setTimeout(() => {
      const currentGame = games[roomId];
      if (currentGame) {
        const playerInGame = currentGame.players.find(p => p.persistentId === player.persistentId);
        if (playerInGame && playerInGame.disconnected) {
          console.log(`[Game ${roomId}] Grace period for ${player.persistentId} ended. Removing player permanently.`);
          removePlayerFromGame(player.persistentId, roomId); // Ruft die neue Hilfsfunktion auf
        }
      }
    }, 20000); // 20 Sekunden Gnadenfrist

    // Speichere die Timeout-ID beim Spieler-Objekt
    player.removalTimeout = removalTimeout;
  }
});

// In server.js -> io.on('connection', socket => { ... HIER EINFÜGEN ... });

function resolveTurn(game) {
    const { choices } = game.currentTurn;
    const choiceValues = Object.values(choices);
    const firstChoice = choiceValues[0];
    
    // Prüfen, ob alle Spieler dasselbe Symbol gewählt haben
    const allPlayersChoseSameSymbol = choiceValues.every(choice => choice === firstChoice);

    if (allPlayersChoseSameSymbol) {
        console.log(`[Game ${game.id}] Turn ${game.currentTurn.turnNumber} SUCCESS. All players chose '${firstChoice}'.`);
        game.matchedSymbols.push(firstChoice);
        
        // Markiere das Symbol in den Boards aller Spieler als 'isMatched'
        game.players.forEach(p => {
            const card = p.board.find(c => c.symbol === firstChoice);
            if(card) card.isMatched = true;
        });

        io.to(game.id).emit('turnSuccess', { 
            symbol: firstChoice, 
            matchedSymbols: game.matchedSymbols 
        });

        // Siegbedingung prüfen
        if (game.matchedSymbols.length === game.gameSymbols.length) {
            console.log(`[Game ${game.id}] VICTORY! All symbols matched.`);
            game.isRunning = false;
            io.to(game.id).emit('gameEnded', { 
                reason: 'victory', 
                message: 'Congratulations, you won!',
                matchedSymbols: game.matchedSymbols
            });
            // TODO: Optional den Raum nach einer Weile aufräumen
            return;
        }

    } else {
        console.log(`[Game ${game.id}] Turn ${game.currentTurn.turnNumber} FAIL. Choices were different.`);
        io.to(game.id).emit('turnFail', { choices });
    }
    
    // Bereite die nächste Runde vor, egal ob Erfolg oder Fehlschlag
    setTimeout(() => {
        if (!games[game.id] || !games[game.id].isRunning) return;

        const nextTurnNumber = game.currentTurn.turnNumber + 1;
        game.currentTurn = { turnNumber: nextTurnNumber, choices: {}, isResolved: false };
        io.to(game.id).emit('turnBegan', { 
            turnNumber: nextTurnNumber, 
            matchedSymbols: game.matchedSymbols 
        });
        console.log(`[Game ${game.id}] Starting turn ${nextTurnNumber}.`);

    }, 3000); // 3 Sekunden Pause bis zur nächsten Runde
}


socket.on('playerFlippedCard', ({ gameId, cardIndex, symbol }) => {
    const game = games[gameId];
    if (!game || !game.isRunning || game.currentTurn.isResolved) return;
    
    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;

    // Sicherheitscheck: Hat der Spieler diese Karte bereits gewählt?
    if (game.currentTurn.choices[socket.id]) {
        console.warn(`[Game ${gameId}] Player ${socket.id} tried to choose a second card in the same turn.`);
        return;
    }

    console.log(`[Game ${gameId}] Turn ${game.currentTurn.turnNumber}: Player ${socket.id} chose symbol '${symbol}'.`);
    game.currentTurn.choices[socket.id] = symbol;

    // Informiere die anderen Spieler über diese Auswahl (für die Live-Anzeige)
    socket.to(gameId).emit('playerChoiceUpdate', {
        playerId: socket.id,
        cardIndex: cardIndex,
        symbol: symbol
    });

    // Prüfen, ob alle Spieler ihre Wahl getroffen haben
    const activePlayers = game.players.filter(p => !p.disconnected);
    if (Object.keys(game.currentTurn.choices).length === activePlayers.length) {
        game.currentTurn.isResolved = true;
        console.log(`[Game ${gameId}] All ${activePlayers.length} players have made a choice. Resolving turn.`);
        resolveTurn(game);
    }
});

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



});

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎉 Server listening on port ${PORT}`));
