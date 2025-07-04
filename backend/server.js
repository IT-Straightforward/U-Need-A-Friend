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

// --- Statische Konfiguration direkt im Code ---
const ROOM_TEMPLATE = { 
  "id": "STUDIO",
  "name": "The Studio",
  "maxPlayers": 3,
  "description": "The Studio by Ralf Hebecker",
  "pastelPalette": {
    "primary": "#a8d5ba",
    "accent1": "#d6ecd2",
    "accent2": "#b0e0c9",
    "accent3": "#e9f5ea"
  }
};
console.log(`Room template initialized: "${ROOM_TEMPLATE.name}"`);
const games = {};


let nextGameIdSuffix = 1; 

function createNewGameInstance() {
    const roomTemplate = ROOM_TEMPLATE; 
    if (!roomTemplate) {
        console.error("Keine Raum-Vorlage in predefinedRooms.json gefunden!");
        return null;
    }

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
        currentTurn: { turnNumber: 0, choices: {}, isResolved: true },
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
  // KORREKTUR: Wir verwenden die Variable, die auch existiert, und holen uns die Vorlage.
  const roomTemplate = ROOM_TEMPLATE;
  if (!roomTemplate) {
    console.error(`[Game ${game.roomId}] Keine Raum-Vorlage gefunden!`);
    return false;
  }

  const themeFolder = roomTemplate.id.toLowerCase();
  const fullSymbolPool = getSymbolPoolForTheme(themeFolder);
  const SYMBOLS_PER_GAME = 9;

  if (fullSymbolPool.length < SYMBOLS_PER_GAME) {
    const errorMsg = `Nicht genügend Symbole im Pool für Theme '${themeFolder}'. Benötigt: ${SYMBOLS_PER_GAME}, Verfügbar: ${fullSymbolPool.length}.`;
    console.error(`[Game ${game.roomId}] ${errorMsg}`);
    io.to(game.roomId).emit('gameError', { message: errorMsg });
    return false;
  }

  const shuffledPool = shuffleArray([...fullSymbolPool]);
  game.gameSymbols = shuffledPool.slice(0, SYMBOLS_PER_GAME);
  game.matchedSymbols = [];
  
  console.log(`[Game ${game.roomId}] Spielbrett wird mit diesen ${SYMBOLS_PER_GAME} Symbolen aufgebaut.`);

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
 

  if (game.started && game.players.length < 2) {
    io.to(roomId).emit('gameEnded', { reason: 'insufficient_players_mid_game', message: 'Not enough players.' });
    delete games[roomId];
  
  } else if (game.isRunning && game.currentTurn && !game.currentTurn.isResolved) {
    console.log(`[Game ${roomId}] Player left mid-turn. Resetting current turn.`);
    game.currentTurn.choices = {};
    game.currentTurn.isResolved = true; 
    
    const nextTurnNumber = (game.currentTurn.turnNumber || 0) + 1;
    game.currentTurn = { turnNumber: nextTurnNumber, choices: {}, isResolved: false };
    io.to(roomId).emit('turnBegan', { turnNumber: nextTurnNumber, matchedSymbols: game.matchedSymbols });
  }
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


  console.log(`[Server] Falling back to default icon pool (requested for theme '${themeFolder}').`);
  const defaultThemePath = path.join(ICONS_BASE_PATH, 'default');
  try {
    if (fs.existsSync(defaultThemePath)) {
      const files = fs.readdirSync(defaultThemePath);
      const defaultPool = files
        .filter(file => file.toLowerCase().endsWith('.png'))
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


socket.on('playerWantsToJoin', (callback) => {
    let game = findAvailableGame();
    if (!game) {
        game = createNewGameInstance();
    }
    if (game && callback) {
        callback({ success: true, gameId: game.roomId });
    } else if (callback) {
        callback({ success: false, error: "Konnte kein Spiel erstellen." });
    }
});

socket.on("joinGame", ({ roomId, persistentPlayerId }, callback) => {
  const game = games[roomId];


  if (!game) {
    return callback && callback({ success: false, error: "Spiel nicht gefunden." });
  }


  if (persistentPlayerId) {
    const existingPlayer = game.players.find(p => p.persistentId === persistentPlayerId);
    if (existingPlayer) {
      console.log(`[Game ${roomId}] Reconnecting player ${persistentPlayerId}. New socket: ${socket.id}`);
      
      existingPlayer.id = socket.id;
      socket.join(roomId);

      if (game.isRunning) {
        socket.emit('gameInitialized', { 
            playerBoard: existingPlayer.board, 
            gameId: game.roomId, 
            matchedSymbols: game.matchedSymbols, 
            pastelPalette: game.pastelPalette 
        });
        socket.emit('turnBegan', { turnNumber: game.currentTurn.turnNumber, matchedSymbols: game.matchedSymbols });
      } else {
        const playerList = game.players.map(p => ({ id: p.id, isReadyInLobby: p.isReadyInLobby }));
        socket.emit("gameUpdate", { players: playerList, gameId: roomId, roomName: game.name, maxPlayers: game.maxPlayers, pastelPalette: game.pastelPalette });
      }

      return callback && callback({ success: true, persistentPlayerId: existingPlayer.persistentId });
    }
  }

  if (game.started) {
    return callback && callback({ success: false, error: "Das Spiel hat bereits begonnen." });
  }
  if (game.players.length >= game.maxPlayers) {
    return callback && callback({ success: false, error: "Der Raum ist leider voll." });
  }

  const newPersistentId = crypto.randomUUID();
  const newPlayer = {
    id: socket.id,
    persistentId: newPersistentId,
    board: [],
    isReadyInLobby: false,
  };
  
  game.players.push(newPlayer);
  socket.join(roomId);
  console.log(`[Game ${roomId}] New player joined. Total players: ${game.players.length}`);
  
  const playerListForUpdate = game.players.map(p => ({ id: p.id, isReadyInLobby: p.isReadyInLobby }));
  io.to(roomId).emit("gameUpdate", { players: playerListForUpdate, gameId: roomId, roomName: game.name, maxPlayers: game.maxPlayers, pastelPalette: game.pastelPalette });
  
  if (game.players.length === game.maxPlayers) {
    startLobbyCountdown(game);
  }
  
  if (callback) callback({ success: true, newPersistentId });
});
socket.on('player:setReadyStatus', ({ roomId, isReady }, callback) => {
    const game = games[roomId];
    if (!game || game.started) {
        return callback && callback({ success: false, error: "Raum ist nicht aktiv oder das Spiel hat bereits begonnen." });
    }
    
    const player = game.players.find(p => p.id === socket.id);
    if (!player) {
        return callback && callback({ success: false, error: "Spieler nicht gefunden." });
    }

    player.isReadyInLobby = !!isReady;

    // Countdown abbrechen, wenn ein Spieler "Nicht bereit" klickt
    if (!isReady && game.lobbyCountdownTimerId) {
        clearInterval(game.lobbyCountdownTimerId);
        game.lobbyCountdownTimerId = null;
        game.lobbyCountdownEndTime = null;
        io.to(roomId).emit('lobby:countdownCancelled', { roomId, message: 'Ein Spieler ist nicht mehr bereit.' });
    }

    // Update an alle Spieler im Raum senden
    const playerListForUpdate = game.players.map(p => ({ id: p.id, isReadyInLobby: p.isReadyInLobby }));
    io.to(roomId).emit("gameUpdate", { players: playerListForUpdate, gameId: roomId });
    
    // 2. NEUE Logik zum Starten des Countdowns
    const readyCount = game.players.filter(p => p.isReadyInLobby).length;
    const totalPlayers = game.players.length;

    // Spielstartbedingungen: 3 Spieler im Raum ODER 2 Spieler, die BEIDE bereit sind.
    if ( (totalPlayers>1 && totalPlayers === readyCount) ) {
        startLobbyCountdown(game);
    }
    
    if (callback) callback({ success: true, currentReadyStatus: player.isReadyInLobby });
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

    // Wir starten keine Runde mehr aktiv, sondern warten auf Spieleraktionen
    console.log(`[Game ${gameId}] Spiel initialisiert und an Spieler gesendet. Warte auf erste Karten-Flips.`);
    game.currentTurn = { turnNumber: 1, choices: {}, isResolved: false };
    io.to(game.id).emit('turnBegan', { turnNumber: 1, matchedSymbols: game.matchedSymbols });
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

  const roomId = game.roomId;
  console.log(`[Game ${roomId}] Alle Spieler bereit. Automatischer 3s Countdown wird gestartet.`);
  
  // Setze die Endzeit für den Countdown
  game.lobbyCountdownEndTime = Date.now() + 10000;
  // Informiere alle Spieler, dass der Countdown beginnt
  io.to(roomId).emit('lobby:countdownStarted', {
    roomId,
    duration: 3,
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
