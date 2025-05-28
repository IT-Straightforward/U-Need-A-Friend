// backend/index.js (oder server.js, je nachdem wie deine Datei heißt)
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs'); // NEU: Für das Dateisystem

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"],
  },
});

const frontendPath = path.join(__dirname, 'public_frontend');
app.use(express.static(frontendPath));

// --- Lade vordefinierte Raumkonfigurationen ---
let PREDEFINED_ROOM_CONFIGS = [];
try {
  const rawData = fs.readFileSync(path.join(__dirname, 'predefinedRooms.json'));
  PREDEFINED_ROOM_CONFIGS = JSON.parse(rawData);
  console.log("Successfully loaded predefined rooms:", PREDEFINED_ROOM_CONFIGS.map(r => r.id).join(', '));
} catch (error) {
  console.error("Error loading predefinedRooms.json:", error);
  // Hier könntest du entscheiden, ob der Server ohne Raumkonfigurationen starten soll oder nicht
  // process.exit(1); // Beendet den Prozess, wenn die Räume kritisch sind
}
// ----------------------------------------------

const games = {}; // Speichert aktive Spielinstanzen, gekeyed mit der Raum-ID

// EMOJI_POOL und shuffleArray bleiben wie gehabt
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

  // --- NEUE ADMIN SOCKET EVENTS ---

  socket.on("admin:getRoomOverview", (callback) => {
    console.log(`[Admin ${socket.id}] requested room overview.`);
    const overview = PREDEFINED_ROOM_CONFIGS.map(roomConfig => {
      const activeGameInstance = games[roomConfig.id];
      return {
        id: roomConfig.id,
        name: roomConfig.name,
        description: roomConfig.description,
        maxPlayers: roomConfig.maxPlayers,
        isActive: !!activeGameInstance, // Ist eine Spielinstanz aktiv?
        isRunning: activeGameInstance ? activeGameInstance.started : false, // Läuft das Spiel in der Instanz?
        playerCount: activeGameInstance ? activeGameInstance.players.length : 0,
      };
    });
    if (typeof callback === 'function') {
        callback(overview); // Sende Übersicht an den anfragenden Admin
    } else {
        socket.emit('admin:roomOverview', overview); // Alternative, falls kein Callback
    }
  });

// In backend/index.js, innerhalb von io.on("connection", (socket) => { ... });

socket.on("admin:activateRoom", ({ roomId }, callback) => { // Der Callback vom Client ist optional
  console.log(`[Admin ${socket.id}] wants to activate room: ${roomId}`);
  const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId);

  if (!roomConfig) {
    const errorMsg = `Room configuration for ID '${roomId}' not found.`;
    console.log(`Attempt to activate non-existent room: ${roomId}`);
    if (callback) callback({ success: false, error: errorMsg });
    socket.emit('admin:error', { message: errorMsg, roomId }); // Spezifischer Fehler an diesen Admin
    return;
  }

  let wasAlreadyActiveAndManagedByThisSocket = false;
  let needsGeneralStatusUpdate = true;

  if (games[roomId]) { // Raum-Instanz existiert bereits
    if (games[roomId].adminSocketId === socket.id) {
      // Derselbe Admin-Socket (z.B. versehentlicher Doppelklick auf Activate)
      console.log(`Room ${roomId} is already active and managed by this exact admin socket (${socket.id}). Reconfirming.`);
      wasAlreadyActiveAndManagedByThisSocket = true;
      needsGeneralStatusUpdate = false; // Status hat sich nicht grundlegend für andere geändert
    } else if (games[roomId].adminSocketId) {
      // Raum ist aktiv, aber von einem *anderen* Admin-Socket gemanagt
      // Hier könntest du entscheiden, ob eine Übernahme erlaubt ist oder ein Fehler gesendet wird.
      // Fürs Erste: Fehler, da unklar ist, ob der andere Admin noch aktiv ist.
      const errorMsg = `Room ${roomId} is currently managed by another admin session. Please reset if needed.`;
      console.log(errorMsg + ` (Current: ${games[roomId].adminSocketId}, Requested by: ${socket.id})`);
      if (callback) callback({ success: false, error: errorMsg });
      socket.emit('admin:error', { message: errorMsg, roomId });
      return;
    }
    // Falls adminSocketId null/undefined war, aber der Raum existiert (sollte nicht sein, aber zur Sicherheit)
    games[roomId].adminSocketId = socket.id; // Dieser Admin übernimmt/aktualisiert
    socket.join(roomId); // Sicherstellen, dass Admin im Raum ist
    console.log(`Admin ${socket.id} (re-)joined room ${roomId} as manager.`);

  } else {
    // Raum existiert nicht in `games`, also neu erstellen und aktivieren
    console.log(`Activating new room instance for ${roomId} by admin ${socket.id}.`);
    games[roomId] = {
      id: roomId,
      name: roomConfig.name,
      maxPlayers: roomConfig.maxPlayers,
      adminSocketId: socket.id,
      players: [],
      started: false,
      currentRound: null,
      readyPlayerCount: 0,
      nextTargetPlayerIndex: 0,
      roundNumber: 0,
    };
    socket.join(roomId);
    console.log(`[Admin ${socket.id}] successfully activated new room instance ${roomId}.`);
  }

  // Aktuellen Status der Raum-Instanz zusammenstellen
  const gameInstance = games[roomId];
  const currentStatusPayload = {
    isActive: true, // Per Definition jetzt aktiv
    isRunning: gameInstance.started,
    playerCount: gameInstance.players.length,
    players: gameInstance.players.map(p => ({ id: p.id, name: p.name })), // Spielerliste mitsenden
  };

  // Bestätigung an den anfragenden Admin senden
  const successMessage = wasAlreadyActiveAndManagedByThisSocket ? 
                         `Room ${roomId} management reconfirmed.` : 
                         `Room ${roomId} activated successfully.`;
  
  socket.emit('admin:roomActivated', { 
    roomId, 
    message: successMessage,
    status: currentStatusPayload // Aktuellen, detaillierten Status mitsenden
  });
  
  if (typeof callback === 'function') { // Auch den optionalen Callback bedienen
      callback({ success: true, roomId, status: currentStatusPayload });
  }

  // Wenn eine neue Instanz erstellt wurde oder sich der grundlegende Status geändert hat,
  // sende ein Update an alle (anderen) Admins für die Raumübersicht.
  if (needsGeneralStatusUpdate) {
    io.emit('admin:roomStatusUpdate', { 
        roomId: roomId, 
        status: { // Sende nur die für die Übersicht relevanten Status
            isActive: true, 
            isRunning: gameInstance.started, 
            playerCount: gameInstance.players.length 
            // Spielerliste nicht unbedingt an alle Admins in der Übersicht, nur an den managenden
        }
    });
  }
});

  // `admin:startGameInstance` und `admin:resetRoom` folgen später.

  // --- ANGEPASSTE SPIELER SOCKET EVENTS ---

  // Die alte "createGame" wird nicht mehr von Spielern verwendet.
  // socket.on("createGame", ... ); // ENTFERNEN oder auskommentieren

  // --- Spieler Events ---
  socket.on("joinGame", ({ roomId, playerName }, callback) => {
    const gameInstance = games[roomId];
    const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId);

    if (!roomConfig) { /* ... Fehler ... */ return; }
    if (!gameInstance || !gameInstance.adminSocketId) { /* ... Fehler ... */ return; }
    if (gameInstance.started) { /* ... Fehler ... */ return; }
    if (gameInstance.players.length >= (roomConfig.maxPlayers || 6 )) { /* ... Fehler ... */ return; } // Nutze maxPlayers aus Config
    if (gameInstance.players.find(p => p.id === socket.id)) { /* ... Fehler ... */ return; }
    
    const newPlayer = { 
      id: socket.id, 
      name: playerName || `Player-${socket.id.substring(0, 4)}`, 
      symbols: [], 
      ready: false, 
      isReadyInLobby: false
    };
    gameInstance.players.push(newPlayer);
    socket.join(roomId);
    console.log(`Player ${socket.id} (${newPlayer.name}) joined room ${roomId}.`);
    
    const playerListForUpdate = gameInstance.players.map(p => ({ id: p.id, name: p.name, isReadyInLobby: p.isReadyInLobby }));
    
    io.to(roomId).emit("gameUpdate", { 
        players: playerListForUpdate, 
        gameId: roomId, // gameId ist die roomId
        roomName: gameInstance.name, 
        pastelColor: roomConfig.pastelColor, // NEU
        maxPlayers: roomConfig.maxPlayers    // NEU
    }); 
    
    if (gameInstance.adminSocketId && io.sockets.sockets.get(gameInstance.adminSocketId)) {
      io.to(gameInstance.adminSocketId).emit('admin:playerJoinedRoom', { roomId, players: playerListForUpdate });
      // ... (admin:roomStatusUpdate wie zuvor) ...
    }
    if (callback) callback({ success: true, gameId: roomId, roomName: gameInstance.name });
  });
  // `startGame` wird zu `adminStartGameInstance` (oder ähnlich) und vom Admin ausgelöst
  // Der bisherige `startGame`-Handler muss angepasst/ersetzt werden.
  // Wir nennen ihn hier um, um Verwechslungen zu vermeiden, und der Admin löst ihn aus.
  socket.on("admin:startGameInstance", ({ roomId }) => {
    const game = games[roomId];
    if (!game || socket.id !== game.adminSocketId) { /* ... Fehler ... */ return; }
    if (game.started) {
        socket.emit('admin:error', { message: `Game in room ${roomId} is already starting or running.` });
        return;
    }
    if (game.players.length < 2) { /* ... Fehler ... */ return; }

    const allPlayersInLobbyReady = game.players.length > 0 && game.players.every(p => p.isReadyInLobby);
    if (!allPlayersInLobbyReady) {
      const notReadyPlayers = game.players.filter(p => !p.isReadyInLobby).map(p => p.name);
      socket.emit('admin:error', { message: `Admin start: Not all players are ready. Waiting for: ${notReadyPlayers.join(', ')}` });
      return;
    }

    // Wenn Admin startet und alle bereit sind, aber Countdown noch nicht lief -> starte Countdown
    if (!game.lobbyCountdownTimerId) {
        console.log(`[Game ${roomId}] Admin triggered start, all players ready. Starting 10s countdown.`);
        // Duplizierter Countdown-Start-Code hier oder besser eine Hilfsfunktion
        // Um es kurz zu halten, hier die Annahme, dass der Countdown-Start-Mechanismus
        // in player:setReadyStatus bereits den Fall abdeckt.
        // Oder der Admin-Start löst jetzt den Countdown aus, wenn alle bereit sind.
        // Für jetzt: Wenn alle bereit sind und Admin klickt, starten wir Countdown direkt hier,
        // falls er nicht schon läuft.
        game.lobbyCountdownEndTime = Date.now() + 10000;
        io.to(roomId).emit('lobby:countdownStarted', { roomId, duration: 10, endTime: game.lobbyCountdownEndTime });
        if (game.lobbyCountdownTimerId) clearInterval(game.lobbyCountdownTimerId); // clear just in case
        game.lobbyCountdownTimerId = setInterval(() => { /* ... (gleiche Logik wie oben im setInterval) ... */
            const gameInstanceForInterval = games[roomId];
            if (!gameInstanceForInterval || !gameInstanceForInterval.lobbyCountdownEndTime) {
                if(gameInstanceForInterval && gameInstanceForInterval.lobbyCountdownTimerId) clearInterval(gameInstanceForInterval.lobbyCountdownTimerId);
                if(gameInstanceForInterval) gameInstanceForInterval.lobbyCountdownTimerId = null;
                return;
            }
            const remainingTime = Math.max(0, Math.round((gameInstanceForInterval.lobbyCountdownEndTime - Date.now()) / 1000));
            io.to(roomId).emit('lobby:countdownTick', { roomId, remainingTime });
            if (remainingTime <= 0) {
                clearInterval(gameInstanceForInterval.lobbyCountdownTimerId);
                gameInstanceForInterval.lobbyCountdownTimerId = null;
                gameInstanceForInterval.lobbyCountdownEndTime = null;
                const stillAllReady = gameInstanceForInterval.players.length > 0 && gameInstanceForInterval.players.filter(p => p.isReadyInLobby).length === gameInstanceForInterval.players.length;
                if (stillAllReady && gameInstanceForInterval.players.length >=2) {
                    gameInstanceForInterval.started = true; gameInstanceForInterval.isRunning = false;
                    gameInstanceForInterval.players.forEach(p => p.ready = false); gameInstanceForInterval.readyPlayerCount = 0;
                    gameInstanceForInterval.players.forEach(pSocket => io.to(pSocket.id).emit("goToGame", { gameId: roomId, roomName: gameInstanceForInterval.name }));
                    io.to(gameInstanceForInterval.adminSocketId).emit("admin:gameInstanceStarted", { roomId, playerCount: gameInstanceForInterval.players.length });
                    io.emit('admin:roomStatusUpdate', { /* ... */ });
                } else {
                    io.to(roomId).emit('lobby:countdownCancelled', { roomId, message: 'Not all players were ready.' });
                }
            }
        }, 1000);
    } else {
        socket.emit('admin:error', { message: `Countdown already running for room ${roomId}.` });
    }
  });


  // `playerReadyForGame` und `buttonPress` verwenden jetzt `gameId` als `roomId`
  // Die Logik darin sollte weiterhin funktionieren, da sie auf `games[gameId]` zugreift.
  // Beispielhafte Anpassung (nur gameId zu roomId gedanklich):
  socket.on("playerReadyForGame", ({ gameId }) => { // gameId ist hier die roomId
    const game = games[gameId];
    if (!game || !game.started || socket.id === game.adminSocketId) return;
    
    const player = game.players.find(p => p.id === socket.id);
    if (player && !player.ready) { // 'ready' ist hier "assets loaded"
      player.ready = true;
      game.readyPlayerCount = (game.readyPlayerCount || 0) + 1;
      console.log(`Player ${player.name} (assets loaded) in room ${gameId}. Total game-ready: ${game.readyPlayerCount}/${game.players.length}`);
      // Admin muss nicht unbedingt über jeden einzelnen "asset loaded" Status informiert werden,
      // aber über den Gesamtfortschritt via allPlayersReadyGameRunning.
    }

    if (game.players.length > 0 && game.readyPlayerCount === game.players.length) {
      console.log(`All players loaded assets in room ${gameId}. Assigning symbols & starting rounds.`);
      // Ab hier ist das Spiel wirklich "isRunning"
      game.isRunning = true; // Setze isRunning jetzt hier
      if (!assignSymbolsToAllPlayersInGame(game)) return;
      
      game.players.forEach(p => {
        io.to(p.id).emit("gameStarted", { playerId: p.id, buttons: p.symbols, gameId: game.id, roomName: game.name });
      });
      io.to(game.adminSocketId).emit("allPlayersReadyGameRunning", { gameId: game.id }); // Signalisiert dem Admin, dass Runden beginnen
      // Update auch den globalen Admin Status
       io.emit('admin:roomStatusUpdate', { 
        roomId: gameId, 
        status: { 
            isActive: true, 
            isRunning: true, // JETZT isRunning = true
            playerCount: game.players.length,
            players: game.players.map(p=>({id: p.id, name: p.name, isReadyInLobby: p.isReadyInLobby, ready: p.ready})) 
        }
    });
      startNewRound(game);
    }
  });
   // --- NEUES EVENT: Spieler setzt seinen Bereitschaftsstatus im Warteraum ---
   socket.on('player:setReadyStatus', ({ roomId, isReady }, callback) => {
    const gameInstance = games[roomId];
    if (!gameInstance || !gameInstance.adminSocketId || gameInstance.started) { // Nicht mehr ändern, wenn Spiel gestartet ist
      return callback && callback({ success: false, error: "Room not active or game already started." });
    }
    const player = gameInstance.players.find(p => p.id === socket.id);
    if (!player) {
      return callback && callback({ success: false, error: "Player not found." });
    }

    player.isReadyInLobby = !!isReady;
    console.log(`Player ${player.name} in room ${roomId} set ready status to: ${player.isReadyInLobby}`);

    const playerListForUpdate = gameInstance.players.map(p => ({ id: p.id, name: p.name, isReadyInLobby: p.isReadyInLobby }));
    io.to(roomId).emit("gameUpdate", { 
        players: playerListForUpdate, 
        gameId: roomId, 
        roomName: gameInstance.name,
        pastelColor: PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId)?.pastelColor, // Farbe erneut senden
        maxPlayers: PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId)?.maxPlayers
    });

    const readyCount = gameInstance.players.filter(p => p.isReadyInLobby).length;
    io.to(gameInstance.adminSocketId).emit("playerReadyUpdate", { 
        gameId: roomId, playerId: player.id, playerName: player.name, isReady: player.isReadyInLobby,
        readyCount: readyCount, totalPlayers: gameInstance.players.length 
    });

    // --- Countdown Logik ---
    if (player.isReadyInLobby) { // Spieler hat sich auf Bereit gesetzt
      const allPlayersReady = gameInstance.players.length > 0 && readyCount === gameInstance.players.length;
      if (allPlayersReady && !gameInstance.lobbyCountdownTimerId && gameInstance.players.length >= 2) { // Mindestens 2 Spieler benötigt
        console.log(`[Game ${roomId}] All players ready! Starting 10s countdown.`);
        gameInstance.lobbyCountdownEndTime = Date.now() + 10000; // 10 Sekunden
        io.to(roomId).emit('lobby:countdownStarted', { 
            roomId, 
            duration: 10, 
            endTime: gameInstance.lobbyCountdownEndTime 
        });

        // Stoppe alten Timer, falls vorhanden (sollte nicht, aber sicher ist sicher)
        if (gameInstance.lobbyCountdownTimerId) clearInterval(gameInstance.lobbyCountdownTimerId);

        gameInstance.lobbyCountdownTimerId = setInterval(() => {
          const game = games[roomId]; // Immer die aktuelle Instanz holen
          if (!game || !game.lobbyCountdownEndTime) { // Spiel wurde resettet oder Countdown beendet
            if(game && game.lobbyCountdownTimerId) clearInterval(game.lobbyCountdownTimerId);
            if(game) game.lobbyCountdownTimerId = null;
            return;
          }

          const remainingTime = Math.max(0, Math.round((game.lobbyCountdownEndTime - Date.now()) / 1000));
          io.to(roomId).emit('lobby:countdownTick', { roomId, remainingTime });

          if (remainingTime <= 0) {
            clearInterval(game.lobbyCountdownTimerId);
            game.lobbyCountdownTimerId = null;
            game.lobbyCountdownEndTime = null;
            
            // Prüfen, ob immer noch alle bereit sind (könnte sich geändert haben)
            const stillAllReady = game.players.length > 0 && game.players.filter(p => p.isReadyInLobby).length === game.players.length;
            if (stillAllReady && game.players.length >= 2) {
                console.log(`[Game ${roomId}] Countdown finished. All still ready. Proceeding to start game logic.`);
                // Hier wird die Logik von "admin:startGameInstance" im Grunde übernommen
                game.started = true; // Markiert, dass goToGame gesendet wird, Assets laden
                game.isRunning = false; // Runden laufen noch nicht
                game.players.forEach(p => p.ready = false); // Asset-Ready-Status zurücksetzen
                game.readyPlayerCount = 0;


                game.players.forEach(pSocket => { // Sende an Spieler-Sockets
                    io.to(pSocket.id).emit("goToGame", { gameId: roomId, roomName: game.name });
                });
                io.to(game.adminSocketId).emit("admin:gameInstanceStarted", { roomId: game.id, playerCount: game.players.length });
                io.emit('admin:roomStatusUpdate', { /* ... status: isRunning: false (noch) ... */ });
            } else {
                console.log(`[Game ${roomId}] Countdown finished, but not all players are ready anymore. Aborting game start.`);
                io.to(roomId).emit('lobby:countdownCancelled', { roomId, message: 'Not all players were ready when countdown ended.' });
            }
          }
        }, 1000);
      }
    } else { // Spieler hat sich auf "Nicht Bereit" gesetzt
      if (gameInstance.lobbyCountdownTimerId) {
        console.log(`[Game ${roomId}] Player ${player.name} un-readied. Cancelling countdown.`);
        clearInterval(gameInstance.lobbyCountdownTimerId);
        gameInstance.lobbyCountdownTimerId = null;
        gameInstance.lobbyCountdownEndTime = null;
        io.to(roomId).emit('lobby:countdownCancelled', { roomId, message: `${player.name} is not ready.` });
      }
    }
    // --- Ende Countdown Logik ---

    if (callback) callback({ success: true, currentReadyStatus: player.isReadyInLobby });
  });

  socket.on("requestInitialLobbyState", ({ gameId }) => { // gameId ist hier die roomId
    const game = games[gameId];
    if (game && game.adminSocketId) { // Nur wenn Raum aktiv ist
      const playerListForUpdate = game.players.map(p => ({ id: p.id, name: p.name }));
     // Innerhalb von socket.on("requestInitialLobbyState", ...);

socket.emit("gameUpdate", { 
  players: playerListForUpdate, 
  gameId: game.id, 
  roomName: game.name, 
  message: "Welcome to the lobby!",
  maxPlayers: game.maxPlayers 
});

    } else {
      const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === gameId);
      socket.emit("gameNotFound", { message: roomConfig ? `Room "${roomConfig.name}" is not currently active.` : "Game room not found."});
    }
  });

  socket.on("buttonPress", ({ gameId, pressedSymbol }) => { // gameId ist hier die roomId
    const game = games[gameId];
    if (!game || !game.started || !game.currentRound || !game.currentRound.isActive || socket.id === game.adminSocketId) {
      return;
    }
    // ... (Rest der buttonPress Logik bleibt gleich, verwendet game als Referenz) ...
    const round = game.currentRound;
    const playerWhoPressed = game.players.find(p => p.id === socket.id);
    if (!playerWhoPressed) return;
    if (socket.id !== round.targetId) {
      io.to(socket.id).emit("feedback", { correct: false, message: "Not your turn!" });
      return;
    }
    round.isActive = false; 
    if (pressedSymbol === round.currentTargetSymbol) {
      io.to(socket.id).emit("feedback", { correct: true, message: "Correct!" });
      setTimeout(() => startNewRound(game), 1500); 
    } else {
      io.to(socket.id).emit("feedback", { correct: false, message: "Wrong Symbol!" });
      setTimeout(() => startNewRound(game), 1500);
    }
  });

  // `leaveGame`, `cancelGame` (wird zu `adminResetRoom` oder Teil davon), `disconnect`, `handlePlayerLeave`
  // müssen ebenfalls auf die neue Struktur mit `adminSocketId` und `roomId` angepasst werden.
// In backend/index.js, innerhalb von io.on("connection", (socket) => { ... });

socket.on("admin:getRoomDetails", ({ roomId }, callback) => {
  console.log(`[Admin ${socket.id}] requested details for room: ${roomId}`);
  const gameInstance = games[roomId];
  const roomConfig = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId);

  if (!roomConfig) {
    return callback && callback({ success: false, error: "Room configuration not found." });
  }

  if (gameInstance && gameInstance.adminSocketId === socket.id) { // Nur der managende Admin kann Details anfordern
    // Oder: if (gameInstance) { // Jeder (authentifizierte) Admin kann Details sehen
    const roomDetails = {
      roomId: gameInstance.id,
      name: gameInstance.name,
      isActive: true,
      isRunning: gameInstance.started,
      players: gameInstance.players.map(p => ({ id: p.id, name: p.name /*, ggf. isReady */ })),
      playerCount: gameInstance.players.length,
      maxPlayers: gameInstance.maxPlayers,
      // Füge hier weitere Details hinzu, die in der Admin-Detailansicht nützlich sind
      // z.B. currentRoundInfo, wenn das Spiel läuft
      currentRound: gameInstance.currentRound ? {
          roundNumber: gameInstance.roundNumber,
          sourcePlayer: gameInstance.players.find(p => p.id === gameInstance.currentRound.sourceId) 
                        ? { name: gameInstance.players.find(p => p.id === gameInstance.currentRound.sourceId).name, id: gameInstance.currentRound.sourceId } 
                        : null,
          targetPlayer: gameInstance.players.find(p => p.id === gameInstance.currentRound.targetId)
                        ? { name: gameInstance.players.find(p => p.id === gameInstance.currentRound.targetId).name, id: gameInstance.currentRound.targetId }
                        : null,
          targetSymbol: gameInstance.currentRound.currentTargetSymbol
      } : null,
      readyPlayerCount: gameInstance.readyPlayerCount,
      // playerReadyStatus: ... // (Müsste serverseitig für den Raum gespeichert werden, falls Admin das braucht)
    };
    if (callback) callback({ success: true, details: roomDetails });
    // Alternativ oder zusätzlich ein Event an den Socket senden:
    // socket.emit('admin:roomDetailsUpdate', roomDetails);
  } else if (gameInstance) {
    if (callback) callback({ success: false, error: "You are not the current manager of this active room session." });
  } else {
    // Raum ist nicht aktiv, sende Basisinfos aus Konfiguration
    const roomDetails = {
        roomId: roomConfig.id,
        name: roomConfig.name,
        isActive: false,
        isRunning: false,
        players: [],
        playerCount: 0,
        maxPlayers: roomConfig.maxPlayers
    };
    if (callback) callback({ success: true, details: roomDetails});
  }
});
  socket.on("admin:resetRoom", ({ roomId }) => {
    const game = games[roomId];
    if (game && socket.id === game.adminSocketId) {
        console.log(`[Admin ${socket.id}] resetting room ${roomId}`);
        // Alle Spieler im Raum informieren und kicken (optional)
        game.players.forEach(p => {
            const playerSocket = io.sockets.sockets.get(p.id);
            if (playerSocket) {
                playerSocket.emit('gameEnded', { reason: 'admin_reset', message: 'The room has been reset by the admin.' });
                playerSocket.leave(roomId);
            }
        });
        // Spielinstanz löschen oder zurücksetzen
        delete games[roomId]; // Einfachste Form des Resets
        // Alternative: game zurücksetzen (players=[], started=false, etc.)
        // games[roomId] = { ... (initialer Zustand wie in admin:activateRoom, aber ohne Callback) ... };
        // games[roomId].adminSocketId = socket.id; // Wichtig, wenn Objekt neu erstellt wird
        
        socket.emit('admin:roomReset', { roomId, message: `Room ${roomId} has been reset.` });
        io.emit('admin:roomStatusUpdate', { roomId: roomId, status: { isActive: false, isRunning: false, playerCount: 0, players: [] }});
    } else {
        socket.emit('admin:error', {message: 'Failed to reset room. Not authorized or room not found.'});
    }
  });


  socket.on("leaveGame", ({ gameId }) => { // gameId ist hier die roomId
    handlePlayerLeave(socket, gameId, true);
  });

  // cancelGame wird durch Admin-Aktionen (z.B. admin:resetRoom vor Spielstart) abgedeckt.
  // Der alte cancelGame Handler kann entfernt werden, wenn Admins Räume nicht mehr "erstellen" sondern "aktivieren".

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
    let gameToEnd = null;
    let gameIdToEnd = null; // Wird jetzt roomId sein
    let adminDisconnected = false;

    for (const roomId_iter in games) { // roomId_iter um Kollision mit äußerem roomId zu vermeiden
      if (games[roomId_iter].adminSocketId === socket.id) {
        console.log(`Admin ${socket.id} for room ${roomId_iter} disconnected. Resetting room.`);
        gameToEnd = games[roomId_iter];
        gameIdToEnd = roomId_iter;
        adminDisconnected = true;
        
        // Informiere Spieler im Raum über das Ende
        gameToEnd.players.forEach(p => {
            const playerSocket = io.sockets.sockets.get(p.id);
            if (playerSocket) {
                playerSocket.emit('gameEnded', { reason: 'admin_disconnected', message: 'The admin has disconnected. The room is now closed.' });
                playerSocket.leave(roomId_iter);
            }
        });
        break; 
      }
    }

    if (adminDisconnected && gameToEnd) {
      delete games[gameIdToEnd];
      // Sende ein Update an alle verbleibenden Admins über den neuen Status des Raumes
      io.emit('admin:roomStatusUpdate', { 
          roomId: gameIdToEnd, 
          status: { isActive: false, isRunning: false, playerCount: 0, players: [] }
      });
      return; 
    }

    // Wenn nicht Admin, dann prüfen, ob es ein Spieler war
    for (const roomId_iter in games) {
      if (handlePlayerLeave(socket, roomId_iter, false)) { 
          break; 
      }
    }
  });

  function handlePlayerLeave(socket, roomId, explicitLeave) {
    const game = games[roomId];
    if (!game) {
      // console.log(`[handlePlayerLeave] Game ${roomId} not found for socket ${socket.id}.`);
      return false; // Spiel existiert nicht
    }
  
    const playerIndex = game.players.findIndex(p => p.id === socket.id);
    if (playerIndex === -1) {
      // console.log(`[handlePlayerLeave] Player ${socket.id} not found in game ${roomId}.`);
      return false; // Spieler nicht in diesem Spiel
    }
  
    const leavingPlayer = { ...game.players[playerIndex] }; // Kopie für Infos erstellen
    const playerNameWhoLeft = leavingPlayer.name;
  
    // Spieler aus der Liste entfernen
    game.players.splice(playerIndex, 1);
  
    // Zähler für spielbereite Spieler (Assets geladen) anpassen, falls der Spieler 'ready' war
    if (leavingPlayer.ready && game.readyPlayerCount > 0) { 
      game.readyPlayerCount--;
    }
  
    if(explicitLeave) {
      socket.leave(roomId); 
      console.log(`[Game ${roomId}] Player ${playerNameWhoLeft} (${socket.id}) explicitly left. Remaining players: ${game.players.length}`);
    } else {
      // Bei implizitem 'disconnect' wird socket.leave(roomId) oft schon von Socket.IO oder im disconnect-Handler gehandhabt.
      console.log(`[Game ${roomId}] Player ${playerNameWhoLeft} (${socket.id}) disconnected. Remaining players: ${game.players.length}`);
    }
  
    // --- NEU: Lobby-Countdown abbrechen, falls einer lief ---
    if (game.lobbyCountdownTimerId) {
      console.log(`[Game ${roomId}] Player ${playerNameWhoLeft} left during lobby countdown. Cancelling countdown.`);
      clearInterval(game.lobbyCountdownTimerId);
      game.lobbyCountdownTimerId = null;
      game.lobbyCountdownEndTime = null;
      // Informiere Clients im Raum über den Abbruch
      io.to(roomId).emit('lobby:countdownCancelled', { 
          roomId, 
          message: `Countdown cancelled: ${playerNameWhoLeft} left the lobby.` 
      });
    }
    // --- Ende Countdown-Abbruch ---
  
    // Aktualisierte Spielerliste für Events vorbereiten
    const playerListForUpdate = game.players.map(p => ({ 
      id: p.id, 
      name: p.name, 
      isReadyInLobby: p.isReadyInLobby || false 
    }));
  
    // 1. Spieler im Raum informieren (WaitingRoom oder Game)
    const roomConfigForLeave = PREDEFINED_ROOM_CONFIGS.find(r => r.id === roomId) || {};
    io.to(roomId).emit("gameUpdate", { 
      players: playerListForUpdate, 
      gameId: roomId, 
      roomName: game.name, 
      pastelColor: roomConfigForLeave.pastelColor,
      maxPlayers: roomConfigForLeave.maxPlayers,
      message: `${playerNameWhoLeft} has left.` 
    });
  
    // 2. Spezifischen Admin dieser Raum-Instanz informieren
    if (game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)) {
      io.to(game.adminSocketId).emit('admin:playerLeftRoom', { 
        roomId, 
        players: playerListForUpdate,
        playerNameWhoLeft: playerNameWhoLeft 
      });
      // Update für den Admin über den Asset-Lade-Status, falls das Spiel gestartet, aber noch nicht 'isRunning' war
      if (game.started && !game.isRunning) { // game.started ist true wenn goToGame gesendet wurde
        io.to(game.adminSocketId).emit("playerReadyUpdate", {
            gameId: roomId,
            readyCount: game.readyPlayerCount, // Assets geladen
            totalPlayers: game.players.length 
        });
      }
    }
    
    let finalRoomIsActive = true;
    let finalRoomIsRunning = game.isRunning && game.players.length >= 2;
  
    // Spiellogik nach Verlassen des Spielers behandeln
    if (game.started) { // game.started = true, wenn Admin 'Start Game Instance' geklickt hatte und goToGame gesendet wurde
      if (game.players.length < 2) {
        console.log(`[Game ${roomId}] Game ended after player left. Not enough players (need at least 2). Remaining: ${game.players.length}`);
        finalRoomIsRunning = false;
        finalRoomIsActive = false; // Raum wird jetzt inaktiv, da Spiel nicht mehr laufen kann
        
        io.to(roomId).emit("gameEnded", { 
            reason: "insufficient_players_mid_game", 
            message: "Not enough players to continue the game." 
        });
        if(game.adminSocketId && io.sockets.sockets.get(game.adminSocketId)) {
             io.to(game.adminSocketId).emit("gameForceEnded", {
                 roomId: roomId, 
                 message: "Game ended: Not enough players after one left."
             });
        }
        delete games[roomId]; // Spielinstanz entfernen
      } else if (game.currentRound && (game.currentRound.sourceId === leavingPlayer.id || game.currentRound.targetId === leavingPlayer.id)) {
        // Wenn der gehende Spieler in der aktuellen Runde aktiv war UND das Spiel lief
        if(game.isRunning) { // Nur wenn Runden schon aktiv waren
          console.log(`[Game ${roomId}] Player ${playerNameWhoLeft} who was involved in current round left. Starting new round.`);
          if(game.currentRound) game.currentRound.isActive = false; 
          startNewRound(game);
        }
      } else if (game.started && !game.isRunning && game.readyPlayerCount === game.players.length && game.players.length > 0) {
        // Spieler verlässt während Asset-Ladephase, und DADURCH werden alle verbleibenden Spieler "asset-ready"
        console.log(`[Game ${roomId}] Player left during asset loading. All REMAINING players are now asset-ready. Starting rounds.`);
        game.isRunning = true;
        finalRoomIsRunning = true; // Wird für admin:roomStatusUpdate unten verwendet
        if (!assignSymbolsToAllPlayersInGame(game)) return true; 
        game.players.forEach(p => {
            io.to(p.id).emit("gameStarted", { playerId: p.id, buttons: p.symbols, gameId: game.id, roomName: game.name });
        });
        if(game.adminSocketId) io.to(game.adminSocketId).emit("allPlayersReadyGameRunning", { gameId: game.id });
        startNewRound(game);
      }
    } else { // Spiel war noch nicht mal gestartet (nur in Lobby)
        finalRoomIsRunning = false; // Kann nicht laufen, wenn nicht gestartet
        if (game.players.length === 0 && game.adminSocketId && !io.sockets.sockets.get(game.adminSocketId)) {
            // Letzter Spieler hat Lobby verlassen UND Admin ist auch nicht mehr da -> Raum löschen
            console.log(`[Game ${roomId}] Last player left lobby and admin is disconnected. Deleting room instance.`);
            finalRoomIsActive = false;
            delete games[roomId];
        }
    }
  
    // 3. Alle Admins für die Raumübersicht informieren (mit dem finalen Status)
    io.emit('admin:roomStatusUpdate', { 
      roomId: roomId, 
      status: { 
          isActive: finalRoomIsActive, // Hängt davon ab, ob die game Instanz noch existiert
          isRunning: finalRoomIsRunning, 
          playerCount: game.players.length, // game.players ist schon aktualisiert
          players: finalRoomIsActive ? playerListForUpdate : [] // Leere Spielerliste, wenn Raum inaktiv wird
      }
    });
  
    return true; // Spieler wurde gefunden und verarbeitet
  }


  // assignSymbolsToAllPlayersInGame und startNewRound bleiben strukturell gleich,
  // greifen aber auf games[roomId] zu, wobei roomId als game.id übergeben wird.
  function assignSymbolsToAllPlayersInGame(game) { /* ... wie gehabt ... */ 
    const playerCount = game.players.length;
    if (playerCount === 0) return true; // Nichts zu tun, wenn keine Spieler da sind
    const totalSymbolsNeeded = playerCount * 4;
    if (totalSymbolsNeeded > SYMBOL_POOL.length) {
      const errorMsg = "Not enough unique symbols for all players.";
      // Sende Fehler an Spieler im Raum
      game.players.forEach(p => io.to(p.id).emit("gameError", { message: errorMsg }));
      // Sende Fehler an den Admin des Raums
      if(game.adminSocketId) io.to(game.adminSocketId).emit("gameSetupError", { roomId: game.id, message: errorMsg });
      return false;
    }
    const shuffledPool = shuffleArray([...SYMBOL_POOL]);
    game.players.forEach((player, index) => {
      player.symbols = shuffledPool.slice(index * 4, (index * 4) + 4);
    });
    console.log(`Symbols assigned in game ${game.id}`);
    return true;
  }

  function startNewRound(game) { /* ... wie zuletzt korrigiert ... */
    if (!game || !game.players || game.players.length < 2) {
      if (game && game.id) {
        console.log(`[Game ${game.id}] Cannot start new round (not enough players: ${game.players?.length}). Ending game.`);
        io.to(game.id).emit("gameEnded", { reason: "insufficient_players_for_round", message: "Not enough players." });
        if (io.sockets.sockets.get(game.adminSocketId)) { // Geändert von game.hostId
            io.to(game.adminSocketId).emit("gameForceEnded", { roomId: game.id, message: "Game ended: Insufficient players." });
        }
        delete games[game.id];
        io.emit('admin:roomStatusUpdate', { roomId: game.id, status: { isActive: false, isRunning: false, playerCount: 0, players: [] }});
      }
      return;
    }
    game.roundNumber = (game.roundNumber || 0) + 1;
    const currentRoundNumberForLog = game.roundNumber;
    console.log(`[Game ${game.id}] Attempting to start round ${currentRoundNumberForLog}.`);
    console.log(`[Game ${game.id}]   Players in game: ${game.players.map(p => p.name).join(', ')} (Count: ${game.players.length})`);
    console.log(`[Game ${game.id}]   Current nextTargetPlayerIndex (before selection logic): ${game.nextTargetPlayerIndex}`);
    const sourcePlayer = game.players[Math.floor(Math.random() * game.players.length)];
    console.log(`[Game ${game.id}]   Round ${currentRoundNumberForLog} - Source selected: ${sourcePlayer.name} (ID: ${sourcePlayer.id})`);
    let targetPlayer = null;
    const numPlayers = game.players.length;
    let searchStartIndex = game.nextTargetPlayerIndex || 0;
    console.log(`[Game ${game.id}]   Round ${currentRoundNumberForLog} - Starting target search from index: ${searchStartIndex}`);
    for (let i = 0; i < numPlayers; i++) {
      const currentPlayerIndexInLoop = (searchStartIndex + i) % numPlayers;
      const candidatePlayer = game.players[currentPlayerIndexInLoop];
      console.log(`[Game ${game.id}]     Round ${currentRoundNumberForLog} - Target search loop (i=${i}): currentPlayerIndex=${currentPlayerIndexInLoop}, candidatePlayer=${candidatePlayer.name}`);
      if (candidatePlayer.id !== sourcePlayer.id) {
        targetPlayer = candidatePlayer;
        game.nextTargetPlayerIndex = (currentPlayerIndexInLoop + 1) % numPlayers;
        console.log(`[Game ${game.id}]     Round ${currentRoundNumberForLog} - Target FOUND: ${targetPlayer.name}. Setting nextTargetPlayerIndex for next round to: ${game.nextTargetPlayerIndex}`);
        break; 
      } else {
        console.log(`[Game ${game.id}]     Round ${currentRoundNumberForLog} - Candidate ${candidatePlayer.name} is source. Skipping.`);
      }
    }
    if (!targetPlayer) {
      console.warn(`[Game ${game.id}]   Round ${currentRoundNumberForLog} - Primary target selection loop FAILED. Attempting fallback. (Source: ${sourcePlayer.name})`);
      const otherPlayers = game.players.filter(p => p.id !== sourcePlayer.id);
      if (otherPlayers.length > 0) {
        targetPlayer = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
        const actualTargetIdx = game.players.findIndex(p => p.id === targetPlayer.id);
        if (actualTargetIdx !== -1) game.nextTargetPlayerIndex = (actualTargetIdx + 1) % numPlayers;
        else game.nextTargetPlayerIndex = 0;
        console.log(`[Game ${game.id}]   Round ${currentRoundNumberForLog} - Fallback selected target: ${targetPlayer.name}. Next index: ${game.nextTargetPlayerIndex}`);
      } else {
        console.error(`[Game ${game.id}]   Round ${currentRoundNumberForLog} - CRITICAL FALLBACK: No other players. Source: ${sourcePlayer.name}. Ending game.`);
        io.to(game.id).emit("gameEnded", { reason: "internal_error_no_target_fb", message: "Error: No target." });
        if (io.sockets.sockets.get(game.adminSocketId)) io.to(game.adminSocketId).emit("gameForceEnded", { roomId: game.id, message: "Error: No target." });
        delete games[game.id];
        io.emit('admin:roomStatusUpdate', { roomId: game.id, status: { isActive: false, isRunning: false, playerCount: 0, players: [] }});
        return;
      }
    }
    const targetSymbolIndexOnTargetDevice = Math.floor(Math.random() * targetPlayer.symbols.length);
    const currentTargetSymbol = targetPlayer.symbols[targetSymbolIndexOnTargetDevice];
    game.currentRound = {
      sourceId: sourcePlayer.id, targetId: targetPlayer.id, currentTargetSymbol,
      targetSymbolIndexOnTargetDevice, isActive: true, roundNumber: game.roundNumber
    };
    console.log(`[Game ${game.id}] Round ${game.roundNumber} set up: Source=${sourcePlayer.name}, Target=${targetPlayer.name}, Symbol=${currentTargetSymbol}. Next target search for round ${game.roundNumber +1} starts at index ${game.nextTargetPlayerIndex}.`);
    game.players.forEach(player => {
      let payload = { role: 'inactive', currentTargetSymbol, roundNumber: game.roundNumber };
      if (player.id === sourcePlayer.id) payload.role = 'source';
      else if (player.id === targetPlayer.id) {
        payload.role = 'target'; payload.yourTargetIndex = targetSymbolIndexOnTargetDevice;
      }
      io.to(player.id).emit('roundUpdate', payload);
    });
    io.to(game.adminSocketId).emit('roundStartedForHost', {
        gameId: game.id, roundNumber: game.roundNumber,
        sourcePlayer: {id: sourcePlayer.id, name: sourcePlayer.name},
        targetPlayer: {id: targetPlayer.id, name: targetPlayer.name},
        targetSymbol: currentTargetSymbol
    });
  }

}); // Ende von io.on("connection")

// SPA Fallback Route
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎉 Server listening on port ${PORT}`));