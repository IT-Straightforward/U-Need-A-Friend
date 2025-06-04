const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"],
  },
});

const FRONTEND_SOURCE_PATH = path.join(__dirname, '..', 'U-Need-A-Friend');
const frontendPath = path.join(__dirname, 'public_frontend');
const filePathToPredefinedRooms = path.join(__dirname, 'predefinedRooms.json');
const ICONS_BASE_PATH = path.join(FRONTEND_SOURCE_PATH, 'src', 'assets', 'icons');
app.use(express.static(frontendPath));

let PREDEFINED_ROOM_CONFIGS = [];
try {
  const rawData = fs.readFileSync(filePathToPredefinedRooms);
  PREDEFINED_ROOM_CONFIGS = JSON.parse(rawData);
  console.log("Successfully loaded predefined rooms:", PREDEFINED_ROOM_CONFIGS.map(r => r.id).join(', '));
} catch (error) {
  console.error("Error loading predefinedRooms.json:", error);
}
// ----------------------------------------------

const games = {}; // Speichert aktive Spielinstanzen, gekeyed mit der Raum-ID

const games = {}; 

function shuffleArray(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
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
        console.log(`[Server] Loaded ${pool.length} icons for theme '${themeFolder}' from ${specificThemePath}`);
        return pool; // Gibt themenspezifische Icons zurück, falls gefunden
      } else {
        console.warn(`[Server] No .svg files found in theme folder: ${specificThemePath}. Attempting fallback.`);
      }
    } else {
      console.warn(`[Server] Theme folder path does not exist: ${specificThemePath}. Attempting fallback.`);
    }
  } catch (error) {
    console.error(`[Server] Error reading icon folder for theme '${themeFolder}':`, error, `Attempting fallback.`);
  }

  // Fallback zu 'default', wenn themenspezifische Icons nicht gefunden, leer oder Fehler
  console.log(`[Server] Falling back to default icon pool (requested for theme '${themeFolder}').`);
  const defaultThemePath = path.join(ICONS_BASE_PATH, 'default');
  try {
    if (fs.existsSync(defaultThemePath)) {
      const files = fs.readdirSync(defaultThemePath);
      const defaultPool = files
        .filter(file => file.toLowerCase().endsWith('.svg'))
        .map(file => path.basename(file, '.svg'));
      if (defaultPool.length > 0) {
        console.log(`[Server] Loaded ${defaultPool.length} icons from default theme folder as fallback.`);
        return defaultPool;
      } else {
        console.warn(`[Server] Warning: No .svg files found in default fallback icon folder: ${defaultThemePath}. Final pool will be empty.`);
        return [];
      }
    } else {
      console.error(`[Server] Error: Default icon folder path does not exist for fallback: ${defaultThemePath}. Final pool will be empty.`);
      return [];
    }
  } catch (error) {
    console.error(`[Server] Error reading default icon folder for fallback:`, error, `Final pool will be empty.`);
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
        if (playerSocket) playerSocket.emit("gameError", { message: errorMsg });
    });
    if(game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)) {
        io.to(game.adminSocketId).emit("gameSetupError", { roomId: game.id, message: errorMsg });
    }
    return false;
  }
  let symbolsToAssign;
  if (totalSymbolsNeeded > currentSymbolPool.length) {
    console.warn(`[Game ${game.id}] Warning: Not enough unique symbols in theme '${themeFolder}' pool (length ${currentSymbolPool.length}) for all players (${totalSymbolsNeeded} needed). Symbols will repeat.`);
    let extendedPool = [...currentSymbolPool];
    while(extendedPool.length < totalSymbolsNeeded && currentSymbolPool.length > 0) {
        extendedPool.push(...currentSymbolPool);
    }
    symbolsToAssign = shuffleArray(extendedPool).slice(0, totalSymbolsNeeded);
  } else {
    symbolsToAssign = shuffleArray([...currentSymbolPool]);
  }

  game.players.forEach((player, index) => {
      const startIndex = index * 4;
      player.iconSymbols = symbolsToAssign.slice(startIndex, startIndex + 4);
      if (player.iconSymbols.length < 4 && playerCount > 0) { // Nur warnen, wenn wirklich Spieler da sind
          console.warn(`[Game ${game.id}] Player ${player.name} received only ${player.iconSymbols.length} symbols due to pool exhaustion.`);
      }
  });

  console.log(`[Game ${game.id}] Icon Identifiers from theme '${themeFolder}' pool assigned to ${playerCount} players.`);
  return true;
}



// SOCKET 
io.on("connection", (socket) => {
  console.log(`[Server] Socket connected: ${socket.id}`);

  // Hier lauschst du auf das Event vom Client
  socket.on('request-predefined-rooms', () => {
    console.log(`Client ${socket.id} hat 'request-predefined-rooms' gesendet.`);

    fs.readFile(filePathToPredefinedRooms, 'utf8', (err, data) => {
      if (err) {
        console.error(`Fehler beim Lesen der predefinedRooms.json für Client ${socket.id}:`, err);
        // Sende eine Fehlermeldung zurück an DIESEN Client
        socket.emit('predefined-rooms-error', { message: 'Fehler beim Laden der Raumkonfiguration vom Server.' });
        return;
      }

      try {
        const jsonData = JSON.parse(data);
        // Sende die geparsten JSON-Daten zurück an DIESEN Client
        socket.emit('predefined-rooms-data', jsonData);
        console.log(`predefinedRooms.json erfolgreich an Client ${socket.id} gesendet.`);
      } catch (parseErr) {
        console.error(`Fehler beim Parsen der predefinedRooms.json für Client ${socket.id}:`, parseErr);
        socket.emit('predefined-rooms-error', { message: 'Fehler beim Verarbeiten der Raumkonfiguration auf dem Server.' });
      }
    });
  });

  socket.on("admin:getRoomOverview", (callback) => {
    console.log(`[Admin ${socket.id}] requested room overview.`);
    const overview = PREDEFINED_ROOM_CONFIGS.map(roomConfig => {
      const activeGameInstance = games[roomConfig.id];
      return {
        id: roomConfig.id, name: roomConfig.name, description: roomConfig.description,
        maxPlayers: roomConfig.maxPlayers, pastelPalette: roomConfig.pastelPalette,
        isActive: !!activeGameInstance,
        isRunning: activeGameInstance ? activeGameInstance.isRunning : false,
        playerCount: activeGameInstance ? activeGameInstance.players.length : 0,
      };
    });
    if (typeof callback === 'function') { callback(overview); } 
    else { socket.emit('admin:roomOverview', overview); }
  });

  socket.on("admin:activateRoom", ({ roomId }, callback) => {
    console.log(`[Admin ${socket.id}] wants to activate room: ${roomId}`);
    const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId);
    if (!roomConfig) {
      const errorMsg = `Room configuration for ID '${roomId}' not found.`;
      if (callback) callback({ success: false, error: errorMsg });
      socket.emit('admin:error', { message: errorMsg, roomId }); return;
    }
    let wasAlreadyActive = false;
    let needsGeneralStatusUpdate = true;

    if (games[roomId]) {
      if (games[roomId].adminSocketId && games[roomId].adminSocketId !== socket.id) {
        const errorMsg = `Room ${roomId} is managed by another admin.`;
        if (callback) callback({ success: false, error: errorMsg });
        socket.emit('admin:error', { message: errorMsg, roomId }); return;
      }
      console.log(`Room ${roomId} is already active or being reactivated by admin ${socket.id}.`);
      games[roomId].adminSocketId = socket.id; 
      wasAlreadyActive = true;
      needsGeneralStatusUpdate = !games[roomId].adminSocketId; 
      socket.join(roomId);
    } else {
      console.log(`Activating new room instance for ${roomId} by admin ${socket.id}.`);
      games[roomId] = {
        id: roomId, name: roomConfig.name, maxPlayers: roomConfig.maxPlayers,
        adminSocketId: socket.id, players: [],
        started: false, isRunning: false, currentRound: null, 
        readyPlayerCount: 0, nextTargetPlayerIndex: 0, roundNumber: 0,
        lobbyCountdownTimerId: null, lobbyCountdownEndTime: null,
        pastelPalette: roomConfig.pastelPalette,
      };
      socket.join(roomId);
    }
    const gameInstance = games[roomId];
    const currentStatusPayload = {
      isActive: true, isRunning: gameInstance.isRunning, playerCount: gameInstance.players.length,
      players: gameInstance.players.map(p => ({ id: p.id, name: p.name, isReadyInLobby: p.isReadyInLobby })),
      pastelPalette: gameInstance.pastelPalette, maxPlayers: gameInstance.maxPlayers
    };
    const successMessage = wasAlreadyActive ? `Room ${roomId} management reconfirmed.` : `Room ${roomId} activated.`;
    socket.emit('admin:roomActivated', { roomId, message: successMessage, status: currentStatusPayload });
    if (typeof callback === 'function') { callback({ success: true, roomId, status: currentStatusPayload }); }
    if (needsGeneralStatusUpdate) {
      io.emit('admin:roomStatusUpdate', { roomId, status: { isActive: true, isRunning: gameInstance.isRunning, playerCount: gameInstance.players.length, pastelPalette: gameInstance.pastelPalette, maxPlayers: gameInstance.maxPlayers } });
    }
  });
  
  if (typeof callback === 'function') { // Auch den optionalen Callback bedienen
      callback({ success: true, roomId, status: currentStatusPayload });
  }

  socket.on("admin:getRoomDetails", ({ roomId }, callback) => {
    console.log(`[Admin ${socket.id}] requested details for room: ${roomId}`);
    const gameInstance = games[roomId];
    const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId);
    if (!roomConfig) return callback && callback({ success: false, error: "Room configuration not found." });

    if (gameInstance) {
        const playersWithReadyStatus = gameInstance.players.map(p => ({ id: p.id, name: p.name, isReadyInLobby: p.isReadyInLobby || false}));
        const currentRoundForAdmin = gameInstance.isRunning && gameInstance.currentRound ? {
            roundNumber: gameInstance.roundNumber,
            sourcePlayer: gameInstance.players.find(p => p.id === gameInstance.currentRound.sourceId) 
                            ? { name: gameInstance.players.find(p => p.id === gameInstance.currentRound.sourceId).name, id: gameInstance.currentRound.sourceId } : null,
            targetPlayer: gameInstance.players.find(p => p.id === gameInstance.currentRound.targetId)
                            ? { name: gameInstance.players.find(p => p.id === gameInstance.currentRound.targetId).name, id: gameInstance.currentRound.targetId } : null,
            targetSymbol: gameInstance.currentRound.currentTargetSymbol
        } : null;
        const roomDetails = {
            roomId: gameInstance.id, name: gameInstance.name, isActive: true, isRunning: gameInstance.isRunning,
            players: playersWithReadyStatus, playerCount: gameInstance.players.length, maxPlayers: gameInstance.maxPlayers,
            pastelPalette: gameInstance.pastelPalette, currentRound: currentRoundForAdmin,
            lobbyReadyPlayerCount: gameInstance.players.filter(p => p.isReadyInLobby).length,
            assetReadyPlayerCount: gameInstance.readyPlayerCount 
        };
        if (callback) callback({ success: true, details: roomDetails });
    } else {
        const roomDetails = {
            roomId: roomConfig.id, name: roomConfig.name, isActive: false, isRunning: false,
            players: [], playerCount: 0, maxPlayers: roomConfig.maxPlayers, pastelPalette: roomConfig.pastelPalette
        };
        if (callback) callback({ success: true, details: roomDetails });
    }
  });

  socket.on("joinGame", ({ roomId, playerName }, callback) => {
    const gameInstance = games[roomId];
    const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId);

    if (!roomConfig) { return callback && callback({ success: false, error: "Invalid Room ID. This room may not exist." }); }
    if (!gameInstance || !gameInstance.adminSocketId) { return callback && callback({ success: false, error: `Room "${roomConfig.name}" is not currently active.` });}
    if (gameInstance.started) { return callback && callback({ success: false, error: "Game in this room has already started and is in progress." }); } // 'started' bedeutet hier, dass goToGame schon gesendet wurde
    if (gameInstance.players.length >= (gameInstance.maxPlayers || roomConfig.maxPlayers)) { return callback && callback({ success: false, error: `Room "${roomConfig.name}" is full.` }); }
    if (gameInstance.players.find(p => p.id === socket.id)) { return callback && callback({ success: false, error: "You are already in this room."}); }
    
    const newPlayer = { id: socket.id, name: playerName || `Player-${socket.id.substring(0,4)}`, symbols: [], ready: false, isReadyInLobby: false };
    gameInstance.players.push(newPlayer);
    socket.join(roomId);
    console.log(`[Game ${roomId}] Player ${socket.id} (${newPlayer.name}) joined. Total players: ${gameInstance.players.length}`);
    
    const playerListForUpdate = gameInstance.players.map(p => ({ id: p.id, name: p.name, isReadyInLobby: p.isReadyInLobby }));
    const updatePayload = { 
        players: playerListForUpdate, gameId: roomId, roomName: gameInstance.name, 
        pastelPalette: gameInstance.pastelPalette, // Farbe aus der aktiven gameInstance nehmen
        maxPlayers: gameInstance.maxPlayers 
    };
    io.to(roomId).emit("gameUpdate", updatePayload); 
    
    if (gameInstance.adminSocketId && io.sockets.sockets.get(gameInstance.adminSocketId)) {
      io.to(gameInstance.adminSocketId).emit('admin:playerJoinedRoom', { roomId, players: playerListForUpdate });
      io.to(gameInstance.adminSocketId).emit('admin:roomStatusUpdate', {roomId, status: {isActive:true, isRunning:gameInstance.isRunning, playerCount: gameInstance.players.length, players:playerListForUpdate, pastelPalette: gameInstance.pastelPalette, maxPlayers: gameInstance.maxPlayers}});
    }
    if (callback) callback({ success: true, gameId: roomId, roomName: gameInstance.name });
  });

  socket.on('player:setReadyStatus', ({ roomId, isReady }, callback) => {
    const gameInstance = games[roomId];
    if (!gameInstance || !gameInstance.adminSocketId || gameInstance.started) {
      return callback && callback({ success: false, error: "Room not active or game has proceeded." });
    }
    const player = gameInstance.players.find(p => p.id === socket.id);
    if (!player) { return callback && callback({ success: false, error: "Player not found." }); }

    player.isReadyInLobby = !!isReady;
    console.log(`[Game ${roomId}] Player ${player.name} set ready status to: ${player.isReadyInLobby}`);

    const playerListForUpdate = gameInstance.players.map(p => ({ id: p.id, name: p.name, isReadyInLobby: p.isReadyInLobby }));
    const updatePayload = { 
        players: playerListForUpdate, gameId: roomId, roomName: gameInstance.name,
        pastelPalette: gameInstance.pastelPalette, maxPlayers: gameInstance.maxPlayers
    };
    io.to(roomId).emit("gameUpdate", updatePayload);

    const readyCount = gameInstance.players.filter(p => p.isReadyInLobby).length;
    if(gameInstance.adminSocketId) {
        io.to(gameInstance.adminSocketId).emit("playerReadyUpdate", { 
            gameId: roomId, playerId: player.id, playerName: player.name, isReady: player.isReadyInLobby,
            readyCount: readyCount, totalPlayers: gameInstance.players.length 
        });
    }

    // Countdown Logik
    if (!player.isReadyInLobby && gameInstance.lobbyCountdownTimerId) { 
        console.log(`[Game ${roomId}] Player ${player.name} un-readied. Cancelling countdown.`);
        clearInterval(gameInstance.lobbyCountdownTimerId);
        gameInstance.lobbyCountdownTimerId = null; gameInstance.lobbyCountdownEndTime = null;
        io.to(roomId).emit('lobby:countdownCancelled', { roomId, message: `${player.name} is no longer ready. Countdown cancelled.` });
    }
    // Der Countdown wird jetzt nur noch durch "admin:startGameInstance" gestartet.
    // Die automatische Startlogik hier, wenn alle bereit sind, wird entfernt, um dem Admin die Kontrolle zu geben.
    
    if (callback) callback({ success: true, currentReadyStatus: player.isReadyInLobby });
  });
  
  socket.on("admin:startGameInstance", ({ roomId }) => {
    const game = games[roomId];
    if (!game || socket.id !== game.adminSocketId) {
        socket.emit('admin:error', { message: 'Not authorized or game not found.'}); return;
    }
    if (game.started || game.isRunning || game.lobbyCountdownTimerId) {
        socket.emit('admin:error', { message: `Game in room ${roomId} already starting, running, or in countdown.` }); return;
    }
    if (game.players.length < 2) { 
        socket.emit('admin:error', { message: `Not enough players in room ${roomId} (minimum 2).` }); return;
    }
    const allPlayersInLobbyReady = game.players.length > 0 && game.players.every(p => p.isReadyInLobby);
    if (!allPlayersInLobbyReady) {
      const notReadyPlayers = game.players.filter(p => !p.isReadyInLobby).map(p => p.name);
      socket.emit('admin:error', { message: `Cannot start: Not all players are ready. Waiting for: ${notReadyPlayers.join(', ')}` }); return;
    }

    console.log(`[Game ${roomId}] Admin triggered start, all players ready. Starting 10s countdown.`);
    game.lobbyCountdownEndTime = Date.now() + 10000; 
    io.to(roomId).emit('lobby:countdownStarted', { roomId, duration: 10, endTime: game.lobbyCountdownEndTime });
    if (game.lobbyCountdownTimerId) clearInterval(game.lobbyCountdownTimerId); 
    
    game.lobbyCountdownTimerId = setInterval(() => {
        const gameInstanceForInterval = games[roomId];
        if (!gameInstanceForInterval || !gameInstanceForInterval.lobbyCountdownEndTime || !gameInstanceForInterval.adminSocketId) {
            if(gameInstanceForInterval && gameInstanceForInterval.lobbyCountdownTimerId) clearInterval(gameInstanceForInterval.lobbyCountdownTimerId);
            if(gameInstanceForInterval) gameInstanceForInterval.lobbyCountdownTimerId = null;
            console.log(`[Game ${roomId}] Countdown interval cleared (game missing/ended or admin left).`);
            return;
        }
        const remainingTime = Math.max(0, Math.round((gameInstanceForInterval.lobbyCountdownEndTime - Date.now()) / 1000));
        // Client tickt selbst basierend auf endTime, io.emit('lobby:countdownTick',...) ist optional
        // io.to(roomId).emit('lobby:countdownTick', { roomId, remainingTime }); // Bei Bedarf aktivieren

        if (remainingTime <= 0) {
            clearInterval(gameInstanceForInterval.lobbyCountdownTimerId);
            gameInstanceForInterval.lobbyCountdownTimerId = null;
            gameInstanceForInterval.lobbyCountdownEndTime = null;
            
            const stillAllReady = gameInstanceForInterval.players.every(p => p.isReadyInLobby);
            if (stillAllReady && gameInstanceForInterval.players.length >=2) {
                console.log(`[Game ${roomId}] Countdown finished. All still ready. Proceeding to asset loading phase.`);
                gameInstanceForInterval.started = true; 
                gameInstanceForInterval.isRunning = false; 
                gameInstanceForInterval.players.forEach(p => p.ready = false); 
                gameInstanceForInterval.readyPlayerCount = 0;

                gameInstanceForInterval.players.forEach(pSocket => {
                    const playerClientSocket = io.sockets.sockets.get(pSocket.id);
                    if (playerClientSocket) {
                        playerClientSocket.emit("goToGame", { gameId: roomId, roomName: gameInstanceForInterval.name });
                    }
                });
                io.to(gameInstanceForInterval.adminSocketId).emit("admin:gameInstanceStarted", { roomId, playerCount: gameInstanceForInterval.players.length, message: "Players sent to game view." });
                io.emit('admin:roomStatusUpdate', { roomId, status: { isActive: true, isRunning: false, playerCount: gameInstanceForInterval.players.length, players: gameInstanceForInterval.players.map(p=>({id:p.id, name:p.name, isReadyInLobby: p.isReadyInLobby})), pastelPalette: gameInstanceForInterval.pastelPalette, maxPlayers: gameInstanceForInterval.maxPlayers }});
            } else {
                console.log(`[Game ${roomId}] Countdown finished, but not all players are ready anymore or player count too low. Aborting game start.`);
                io.to(roomId).emit('lobby:countdownCancelled', { roomId, message: 'Not all players were ready when countdown ended, or too few players.' });
            }
        }
    }, 1000);
    socket.emit('admin:info', {message: 'Countdown initiated for room ' + roomId});
  });
  
   socket.on("playerReadyForGame", ({ gameId }) => {
      const game = games[gameId];
      if (!game || !game.started || socket.id === game.adminSocketId) return;
      const player = game.players.find(p => p.id === socket.id);
      if (player && !player.ready) {
          player.ready = true;
          game.readyPlayerCount = (game.readyPlayerCount || 0) + 1;
          console.log(`[Game ${gameId}] Player ${player.name} (assets loaded). Total game-ready: ${game.readyPlayerCount}/${game.players.length}`);
          if(game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)){
             io.to(game.adminSocketId).emit("playerReadyUpdate", { gameId, playerId: player.id, playerName: player.name, isReady: true, readyCount: game.readyPlayerCount, totalPlayers: game.players.length, type: 'assetLoad' });
          }
      }
      // Der folgende Block ist entscheidend
      if (game.players.length > 0 && game.readyPlayerCount === game.players.length) {
          console.log(`[Game ${gameId}] All players loaded assets. Assigning symbols & starting rounds.`);
          
          if (!assignSymbolsToAllPlayersInGame(game)) { // Hier wird die korrigierte Funktion aufgerufen
              game.isRunning = false; 
              console.error(`[Game ${gameId}] Critical: Failed to assign symbols. Game rounds will not start.`);
              // Sende Fehler an Admin und Spieler (bereits in assignSymbolsToAllPlayersInGame, aber ggf. hier noch spezifischer)
              return; // Verhindere, dass das Spiel ohne Symbole weitergeht
          }
          
          // Wenn Symbole erfolgreich zugewiesen wurden:
          game.isRunning = true;
          game.players.forEach(p => {
              const pSocket = io.sockets.sockets.get(p.id);
              // Stelle sicher, dass p.iconSymbols auch wirklich gesetzt ist
              if (pSocket) pSocket.emit("gameStarted", { playerId: p.id, buttons: p.iconSymbols || [], gameId: game.id, roomName: game.name });
          });

          if(game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)) {
            io.to(game.adminSocketId).emit("allPlayersReadyGameRunning", { gameId: game.id, message: "Rounds are starting!" });
          }
          const playerListForUpdate = game.players.map(p => ({id:p.id, name:p.name, isReadyInLobby: p.isReadyInLobby, ready: p.ready})); // 'ready' hinzugefügt
          io.emit('admin:roomStatusUpdate', { roomId: gameId, status: { isActive: true, isRunning: true, playerCount: game.players.length, players: playerListForUpdate, pastelPalette: game.pastelPalette, maxPlayers: game.maxPlayers }});
          startNewRound(game);
      }
  });
  
  socket.on("requestInitialLobbyState", ({ gameId }) => {
   console.log(`[Server] Received 'requestInitialLobbyState' for room: ${gameId} from socket: ${socket.id}`);
  const game = games[gameId];
  const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === gameId);
  if (game && game.adminSocketId && roomConfig) {
      const playerListForUpdate = game.players.map(p => ({ id: p.id, name: p.name, isReadyInLobby: p.isReadyInLobby || false }));
      const payload = {
          players: playerListForUpdate, gameId: game.id, roomName: game.name,
          message: "Welcome to the lobby!",
          iconThemeFolder: roomConfig.iconThemeFolder, // <<< HIER HINZUGEFÜGT
          pastelPalette: game.pastelPalette || roomConfig.pastelPalette,
          maxPlayers: game.maxPlayers || roomConfig.maxPlayers
      };
      console.log(`[Server] Emitting 'gameUpdate' (initial state) to ${socket.id} for room ${gameId}.`);
      socket.emit("gameUpdate", payload);
  }else {
        console.warn(`[Server] No active game instance or config for room ${gameId} on requestInitialLobbyState.`);
        socket.emit("gameNotFound", { message: roomConfig ? `Room "${roomConfig.name}" is not active.` : `Room ${gameId} not found.`});
    }
  });

  socket.on("buttonPress", ({ gameId, pressedSymbol }) => {
    console.log(`[Server] Event 'buttonPress' empfangen von Socket <span class="math-inline">\{socket\.id\}\: gameId\=</span>{gameId}, symbol=${pressedSymbol}`);
    const game = games[gameId];
    // Finde den Spieler anhand der Socket-ID
    const player = game ? game.players.find(p => p.id === socket.id) : null;

    if (!game || !player) {
      console.warn(`[Game ${gameId}] Button press from unknown player (ID: ${socket.id}) or game not found.`);
      // Sende Feedback nur an den drückenden Spieler, da wir nicht wissen, ob er überhaupt im Raum ist
      socket.emit('feedback', { correct: false, message: 'Error: Game or player not found.' });
      return;
    }

    if (!game.isRunning || !game.currentRound || !game.currentRound.isActive) {
      console.log(`[Game ${gameId}] Button press by ${player.name} but game/round not active or already ended.`);
      socket.emit('feedback', { correct: false, message: 'Not currently in an active round or round ended.' });
      return;
    }

    // Logik zur Überprüfung des Button-Drucks
    let isCorrectPress = false;
    let feedbackMessage = '';

    // Nur der 'target'-Spieler kann einen korrekten Treffer landen
    if (player.id === game.currentRound.targetId) {
      if (pressedSymbol === game.currentRound.currentTargetSymbol) {
        isCorrectPress = true;
        const sourcePlayer = game.players.find(p => p.id === game.currentRound.sourceId);
        feedbackMessage = `Gut gemacht!`;
        console.log(`[Game ${gameId}] Player ${player.name} (target) pressed CORRECT symbol: ${pressedSymbol}`);

        // Markiere die Runde als beendet, damit nicht mehrfach gepunktet wird
        game.currentRound.isActive = false;

        // Hier könntest du Punkte vergeben, z.B.:
        // player.score = (player.score || 0) + 10; // Target bekommt Punkte
        // if (sourcePlayer) sourcePlayer.score = (sourcePlayer.score || 0) + 5; // Source bekommt Punkte

        // Sende spezifisches Feedback an alle im Raum
        io.to(gameId).emit('feedback', {
            correct: true,
            message: feedbackMessage,
            pressedByPlayerId: player.id, // Wer hat gedrückt
            symbol: pressedSymbol,
            sourcePlayerName: sourcePlayer ? sourcePlayer.name : 'Unknown',
            targetPlayerName: player.name
        });

        // Starte die nächste Runde nach einer kurzen Verzögerung
        setTimeout(() => {
            // Stelle sicher, dass das Spiel noch existiert und läuft, bevor eine neue Runde gestartet wird
            if (games[gameId] && games[gameId].isRunning) {
                 startNewRound(game);
            } else {
                console.log(`[Game ${gameId}] Spiel existiert nicht mehr oder läuft nicht, keine neue Runde nach korrektem Druck.`);
            }
        }, 3000); // 3 Sekunden Verzögerung als Beispiel

      } else {
        // Target hat falsch gedrückt
        feedbackMessage = `Oops, ${player.name}, das war nicht das richtige Symbol!`;
        console.log(`[Game ${gameId}] Player ${player.name} (target) pressed INCORRECT symbol: ${pressedSymbol}. Target was ${game.currentRound.currentTargetSymbol}`);
        // Sende Feedback nur an den drückenden Spieler (Target)
        socket.emit('feedback', {
            correct: false,
            message: feedbackMessage,
            pressedByPlayerId: player.id
        });
        // Hier keine neue Runde starten, der Target darf es ggf. nochmal versuchen oder die Runde läuft für ihn aus.
        // Das hängt von deiner genauen Spielmechanik ab.
      }
    } else {
      // Ein anderer Spieler (nicht Target) hat gedrückt
      feedbackMessage = `Warte, bis du an der Reihe bist, ${player.name}!`;
      console.log(`[Game ${gameId}] Player ${player.name} (not target) pressed symbol: ${pressedSymbol}`);
      // Sende Feedback nur an den drückenden Spieler
      socket.emit('feedback', {
          correct: false,
          message: feedbackMessage,
          pressedByPlayerId: player.id
      });
    }
  });
    socket.on("admin:resetRoom", ({ roomId }) => {
    const game = games[roomId];
    if (game && socket.id === game.adminSocketId) {
        console.log(`[Admin ${socket.id}] resetting room ${roomId}`);
        if (game.lobbyCountdownTimerId) { // Aktiven Countdown stoppen
            clearInterval(game.lobbyCountdownTimerId);
            game.lobbyCountdownTimerId = null;
            game.lobbyCountdownEndTime = null;
            io.to(roomId).emit('lobby:countdownCancelled', { roomId, message: 'Room reset by admin.' });
        }
        game.players.forEach(p => {
            const playerSocket = io.sockets.sockets.get(p.id);
            if (playerSocket) {
                playerSocket.emit('gameEnded', { reason: 'admin_reset', message: 'The room has been reset.' });
                playerSocket.leave(roomId);
            }
        });
        delete games[roomId]; 
        socket.emit('admin:roomReset', { roomId, message: `Room ${roomId} has been reset.` });
        const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId) || {};
        io.emit('admin:roomStatusUpdate', { roomId: roomId, status: { isActive: false, isRunning: false, playerCount: 0, players: [], pastelPalette: roomConfig.pastelPalette, maxPlayers: roomConfig.maxPlayers }});
    } else {
        socket.emit('admin:error', {message: 'Failed to reset room.'});
    }
  });
  socket.on("leaveGame", ({ gameId }) => { handlePlayerLeave(socket, gameId, true); });
   socket.on("disconnect", () => {
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
                    playerSocket.emit('gameEnded', { reason: 'admin_disconnect', message: 'The admin has disconnected, the room is now closed.' });
                    playerSocket.leave(roomId); // Spieler verlassen den Socket.IO Raum
                }
            });
            delete games[roomId]; // Entferne das Spiel aus den aktiven Spielen
            // Update für andere Admins/Übersicht
            const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId) || {};
            io.emit('admin:roomStatusUpdate', {
                roomId: roomId,
                status: { isActive: false, isRunning: false, playerCount: 0, players:[], pastelPalette: roomConfig.pastelPalette, maxPlayers: roomConfig.maxPlayers }
            });
            break; // Da ein Admin nur einen Raum managen kann (Annahme)
        } else {
            // Prüfen, ob der getrennte Socket ein Spieler in diesem Raum war
            const playerIndex = game.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                // Spieler hat die Verbindung verloren, rufe handlePlayerLeave auf
                handlePlayerLeave(socket, roomId, false); // false für implizites Verlassen (disconnect)
                break; // Spieler kann nur in einem Raum sein
            }
        }
    }
  });
  // --- Hilfsfunktionen ---
// Innerhalb von io.on("connection", (socket) => { ... HIER });

function handlePlayerLeave(socket, roomId, explicitLeave) {
  const game = games[roomId];
  if (!game) return false; 

  const playerIndex = game.players.findIndex(p => p.id === socket.id);
  if (playerIndex === -1) return false; 

  const leavingPlayer = { ...game.players[playerIndex] }; 
  const playerNameWhoLeft = leavingPlayer.name;
  game.players.splice(playerIndex, 1);

  if (leavingPlayer.ready && game.readyPlayerCount > 0) { 
    game.readyPlayerCount--;
  }

  if(explicitLeave) {
    socket.leave(roomId); 
    console.log(`[Game ${roomId}] Player ${playerNameWhoLeft} (${socket.id}) explicitly left. Remaining: ${game.players.length}`);
  } else {
    console.log(`[Game ${roomId}] Player ${playerNameWhoLeft} (${socket.id}) disconnected. Remaining: ${game.players.length}`);
  }

  if (game.lobbyCountdownTimerId) {
    console.log(`[Game ${roomId}] Player ${playerNameWhoLeft} left during lobby countdown. Cancelling countdown.`);
    clearInterval(game.lobbyCountdownTimerId);
    game.lobbyCountdownTimerId = null;
    game.lobbyCountdownEndTime = null;
    io.to(roomId).emit('lobby:countdownCancelled', { 
        roomId, 
        message: `Countdown cancelled: ${playerNameWhoLeft} left the lobby.` 
    });
  }

  const playerListForUpdate = game.players.map(p => ({ 
    id: p.id, name: p.name, isReadyInLobby: p.isReadyInLobby || false 
  }));
  const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId) || {}; // Für Farbe/MaxPlayer Fallback

  const gameUpdatePayload = { 
    players: playerListForUpdate, gameId: roomId, roomName: game.name, 
    pastelPalette: game.pastelPalette || roomConfig.pastelPalette,
    maxPlayers: game.maxPlayers || roomConfig.maxPlayers,
    message: `${playerNameWhoLeft} has left.` 
  };
  io.to(roomId).emit("gameUpdate", gameUpdatePayload);
  
  if (game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)) {
    io.to(game.adminSocketId).emit('admin:playerLeftRoom', { 
      roomId, players: playerListForUpdate, playerNameWhoLeft 
    });
    if (game.started && !game.isRunning) {
      io.to(game.adminSocketId).emit("playerReadyUpdate", {
          gameId: roomId, readyCount: game.readyPlayerCount, totalPlayers: game.players.length 
      });
    }
  }
  
  let finalRoomIsActive = true;
  let finalRoomIsRunning = game.isRunning && game.players.length >= 2;

  if (game.started) { 
    if (game.players.length < 2) {
      finalRoomIsRunning = false; finalRoomIsActive = false; 
      io.to(roomId).emit("gameEnded", { reason: "insufficient_players_mid_game", message: "Not enough players." });
      if(game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)) {
           io.to(game.adminSocketId).emit("gameForceEnded", { roomId, message: "Game ended: Not enough players." });
      }
      delete games[roomId]; 
    } else if (game.currentRound && (game.currentRound.sourceId === leavingPlayer.id || game.currentRound.targetId === leavingPlayer.id)) {
      if(game.isRunning) {
        if(game.currentRound) game.currentRound.isActive = false; 
        startNewRound(game);
      }
    } else if (game.started && !game.isRunning && game.readyPlayerCount === game.players.length && game.players.length > 0) {
      game.isRunning = true; finalRoomIsRunning = true;
      if (!assignSymbolsToAllPlayersInGame(game)) return true; 
      game.players.forEach(p => io.to(p.id).emit("gameStarted", { playerId: p.id, buttons: p.iconSymbols, gameId: game.id, roomName: game.name }));
      if(game.adminSocketId) io.to(game.adminSocketId).emit("allPlayersReadyGameRunning", { gameId: game.id });
      startNewRound(game);
    }
  } else { 
      finalRoomIsRunning = false; 
      // Logik für das Löschen des Raums, wenn der letzte Spieler die Lobby verlässt UND der Admin nicht verbunden ist
      // Diese Logik ist im `disconnect`-Handler des Admins schon abgedeckt.
      // Wenn es kein Admin-Disconnect ist, bleibt der Raum in `games{}` und wartet ggf. auf Reaktivierung.
      // Wir setzen isActive hier nicht unbedingt auf false, es sei denn, es gibt eine Regel dafür.
      // Das `admin:roomStatusUpdate` unten wird den aktuellen Stand reflektieren.
  }

  io.emit('admin:roomStatusUpdate', { 
    roomId: roomId, 
    status: { 
        isActive: finalRoomIsActive, 
        isRunning: finalRoomIsRunning, 
        playerCount: game.players.length, 
        players: finalRoomIsActive ? playerListForUpdate : [],
        pastelPalette: game.pastelPalette || roomConfig.pastelPalette,
        maxPlayers: game.maxPlayers || roomConfig.maxPlayers
    }
  });
  return true; 
}

function startNewRound(game) {
  if (!game || !game.players || game.players.length < 2) {
    if (game && game.id) {
      console.log(`[Game ${game.id}] Cannot start new round (not enough players: ${game.players?.length}). Ending game.`);
      io.to(game.id).emit("gameEnded", { reason: "insufficient_players_for_round", message: "Not enough players." });
      if (io.sockets.sockets.get(game.adminSocketId)) {
          io.to(game.adminSocketId).emit("gameForceEnded", { roomId: game.id, message: "Game ended: Insufficient players." });
      }
      const roomCfgForDelete = PREDEFINED_ROOM_CONFIGS.find(r => r.id === game.id) || {};
      delete games[game.id];
      io.emit('admin:roomStatusUpdate', { roomId: game.id, status: { isActive: false, isRunning: false, playerCount: 0, players: [], pastelPalette: roomCfgForDelete.pastelPalette, maxPlayers: roomCfgForDelete.maxPlayers }});
    }
    return;
  }
  game.roundNumber = (game.roundNumber || 0) + 1;
  const currentRoundNumberForLog = game.roundNumber;
  console.log(`[Game ${game.id}] Attempting to start round ${currentRoundNumberForLog}.`);
  console.log(`[Game ${game.id}]   Players: ${game.players.map(p => p.name).join(', ')} (Count: ${game.players.length})`);
  console.log(`[Game ${game.id}]   NextTargetPlayerIndex (before): ${game.nextTargetPlayerIndex}`);
  
  const sourcePlayer = game.players[Math.floor(Math.random() * game.players.length)];
  console.log(`[Game ${game.id}]   Round ${currentRoundNumberForLog} - Source: ${sourcePlayer.name}`);

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
      io.to(game.id).emit("gameEnded", { reason: "internal_error_no_target_fb", message: "Error: No target." });
      if (io.sockets.sockets.get(game.adminSocketId)) io.to(game.adminSocketId).emit("gameForceEnded", { roomId: game.id, message: "Error: No target." });
      const roomCfgForDeleteCrit = PREDEFINED_ROOM_CONFIGS.find(r => r.id === game.id) || {};
      delete games[game.id];
      io.emit('admin:roomStatusUpdate', { roomId: game.id, status: { isActive: false, isRunning: false, playerCount: 0, players: [], pastelPalette: roomCfgForDeleteCrit.pastelPalette, maxPlayers: roomCfgForDeleteCrit.maxPlayers }});
      return;
    }
  }
  console.log(`[Game ${game.id}]   Round ${currentRoundNumberForLog} - Target: ${targetPlayer.name}. Next target search index: ${game.nextTargetPlayerIndex}`);
  
  const targetSymbolIndexOnTargetDevice = Math.floor(Math.random() * targetPlayer.iconSymbols.length);
  const currentTargetSymbol = targetPlayer.iconSymbols[targetSymbolIndexOnTargetDevice];
  game.currentRound = {
    sourceId: sourcePlayer.id, targetId: targetPlayer.id, currentTargetSymbol,
    targetSymbolIndexOnTargetDevice, isActive: true, roundNumber: game.roundNumber
  };
  console.log(`[Game ${game.id}] Round ${game.roundNumber} setup: Source=${sourcePlayer.name}, Target=${targetPlayer.name}, Symbol=${currentTargetSymbol}.`);
  
  game.players.forEach(player => {
    let payload = { role: 'inactive', currentTargetSymbol, roundNumber: game.roundNumber };
    if (player.id === sourcePlayer.id) payload.role = 'source';
    else if (player.id === targetPlayer.id) {
      payload.role = 'target'; payload.yourTargetIndex = targetSymbolIndexOnTargetDevice;
    }
    io.to(player.id).emit('roundUpdate', payload);
  });
  if(game.adminSocketId) {
    io.to(game.adminSocketId).emit('roundStartedForHost', {
        gameId: game.id, roundNumber: game.roundNumber,
        sourcePlayer: {id: sourcePlayer.id, name: sourcePlayer.name},
        targetPlayer: {id: targetPlayer.id, name: targetPlayer.name},
        targetSymbol: currentTargetSymbol
    });
  }
}

});


app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎉 Server listening on port ${PORT}`));