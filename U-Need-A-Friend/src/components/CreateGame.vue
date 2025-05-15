<template>
  <div class="create-game">
    <div v-if="!gameId">
      <h2>Create New Game</h2>
      <form @submit.prevent="createNewGame">
        <div>
          <label for="hostNameInput">Your Name (Host):</label>
          <input id="hostNameInput" v-model="hostName" placeholder="Optional" />
        </div>
        <button type="submit">Create Game</button>
      </form>
    </div>

    <div v-if="gameId" class="lobby">
      <h3>Lobby</h3>
      <p><strong>Game ID:</strong> {{ gameId }}</p>
      <p>Share this Game ID with players to join (2–6 players).</p>

      <h4>Players Joined: {{ players.length }}</h4>
      <ul v-if="players.length > 0">
        <li v-for="p in players" :key="p.id">
          {{ p.name }}
          <span v-if="playerReadyStatus[p.id]" class="ready-status">(Ready)</span>
        </li>
      </ul>
      <p v-else>Waiting for players to join...</p>

      <div class="status-messages">
        <p v-if="gameStatusMessage">{{ gameStatusMessage }}</p>
        <p v-if="errorMessages.length > 0" class="error-message" v-for="err in errorMessages" :key="err">{{ err }}</p>
      </div>
      
      <div class="host-actions">
        <button @click="attemptStartGame" :disabled="players.length < 2 || gameIsStartingOrRunning">
          Start Game
        </button>
        <button @click="triggerCancelGame" v-if="!gameIsStartingOrRunning" class="cancel-button">
          Cancel Game
        </button>
      </div>
       <p class="round-info" v-if="currentRoundInfo.roundNumber">
          Round {{ currentRoundInfo.roundNumber }}: Source: {{ currentRoundInfo.sourcePlayer?.name }}, Target: {{ currentRoundInfo.targetPlayer?.name }}, Symbol: {{ currentRoundInfo.targetSymbol }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { inject, ref, reactive, onMounted, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';

const socket = inject('socket');
const router = useRouter();

const hostName = ref('');
const gameId = ref('');
const players = ref([]); // Liste der Spieler (Telefone), nicht der Host
const gameStatusMessage = ref('');
const errorMessages = ref([]);
const playerReadyStatus = reactive({}); // z.B. { playerId1: true, playerId2: false }
const gameIsStartingOrRunning = ref(false);

const currentRoundInfo = reactive({
  roundNumber: 0,
  sourcePlayer: null,
  targetPlayer: null,
  targetSymbol: ''
});


// --- Socket Event Handler ---
const handleLobbyUpdate = (data) => {
  if (data.gameId === gameId.value) {
    players.value = data.players || [];
    gameStatusMessage.value = data.message || '';
  }
};

const handleGameCreation = (data) => {
  gameId.value = data.gameId;
  // Host ist nicht in data.players, was jetzt korrekt ist.
  // players.value wird durch 'gameUpdate' aktualisiert, wenn Spieler beitreten.
  gameStatusMessage.value = 'Lobby created. Waiting for players...';
};

const handlePlayerReadyUpdate = (data) => {
  playerReadyStatus[data.playerId] = true;
  gameStatusMessage.value = `${data.playerName} is ready (${data.readyCount}/${data.totalPlayers} ready).`;
};

const handleGameNowStarting = (data) => {
  gameStatusMessage.value = `Game ${data.gameId} is starting with ${data.playerCount} players... Waiting for them to load.`;
  gameIsStartingOrRunning.value = true;
  errorMessages.value = []; // Fehler zurücksetzen
};

const handleAllPlayersReadyGameRunning = () => {
  gameStatusMessage.value = 'All players ready! The game is now running.';
  errorMessages.value = [];
};

const handleRoundStartedForHost = (data) => {
  currentRoundInfo.roundNumber = data.roundNumber;
  currentRoundInfo.sourcePlayer = data.sourcePlayer;
  currentRoundInfo.targetPlayer = data.targetPlayer;
  currentRoundInfo.targetSymbol = data.targetSymbol;
  gameStatusMessage.value = `Round ${data.roundNumber} started.`;
};

const handleGameCancelledByHost = () => {
    gameStatusMessage.value = 'You cancelled the game.';
    resetLobbyState();
};

const handleGameEnded = (data) => {
  gameStatusMessage.value = `Game ended: ${data.message || data.reason}`;
  gameIsStartingOrRunning.value = false;
  // Optional: Nach kurzer Zeit zur Startseite zurückkehren
  setTimeout(resetLobbyState, 5000);
};

const handleGameStartFailed = (data) => {
    errorMessages.value.push(data.message || "Failed to start the game.");
    gameIsStartingOrRunning.value = false; // Erlaube erneuten Versuch oder Abbruch
};

const handleGameSetupError = (data) => {
    errorMessages.value.push(`Game Setup Error: ${data.message}`);
    gameIsStartingOrRunning.value = false;
};
const handleGameForceEnded = (data) => {
    errorMessages.value.push(`Important: ${data.message}`);
    gameIsStartingOrRunning.value = false;
    setTimeout(resetLobbyState, 5000);
}


onMounted(() => {
  socket.on('gameUpdate', handleLobbyUpdate); // Update der Spielerliste in der Lobby
  socket.on('playerReadyUpdate', handlePlayerReadyUpdate); // Spieler ist bereit
  socket.on('gameNowStarting', handleGameNowStarting); // Host hat Start geklickt, Spiel startet gleich
  socket.on('allPlayersReadyGameRunning', handleAllPlayersReadyGameRunning); // Alle Spieler geladen, Runden beginnen
  socket.on('roundStartedForHost', handleRoundStartedForHost); // Info über jede neue Runde
  socket.on('gameCancelled', handleGameCancelledByHost); // Bestätigung, dass Spiel (vom Host) abgebrochen wurde
  socket.on('gameEnded', handleGameEnded); // Spiel wurde serverseitig beendet
  socket.on('gameStartFailed', handleGameStartFailed);
  socket.on('gameSetupError', handleGameSetupError);
  socket.on('gameForceEnded', handleGameForceEnded);

  // Wenn der Host die Seite neu lädt, verliert er den Zustand.
  // Eine robustere Lösung würde serverseitiges Session-Management für den Host erfordern.
});

onUnmounted(() => {
  socket.off('gameUpdate', handleLobbyUpdate);
  socket.off('playerReadyUpdate', handlePlayerReadyUpdate);
  socket.off('gameNowStarting', handleGameNowStarting);
  socket.off('allPlayersReadyGameRunning', handleAllPlayersReadyGameRunning);
  socket.off('roundStartedForHost', handleRoundStartedForHost);
  socket.off('gameCancelled', handleGameCancelledByHost);
  socket.off('gameEnded', handleGameEnded);
  socket.off('gameStartFailed', handleGameStartFailed);
  socket.off('gameSetupError', handleGameSetupError);
  socket.off('gameForceEnded', handleGameForceEnded);


  // Wenn der Host die Komponente verlässt und das Spiel noch nicht gestartet wurde,
  // könnte man hier ein 'cancelGame' senden, aber der Server behandelt Host-Disconnects.
});

function resetLobbyState() {
    gameId.value = '';
    players.value = [];
    gameStatusMessage.value = '';
    errorMessages.value = [];
    gameIsStartingOrRunning.value = false;
    currentRoundInfo.roundNumber = 0;
    // Navigiere nicht automatisch, Host könnte ein neues Spiel erstellen wollen
}

function createNewGame() {
  errorMessages.value = [];
  socket.emit('createGame', { playerName: hostName.value.trim() }, (response) => {
    if (response && response.gameId) {
      handleGameCreation(response);
    } else {
      errorMessages.value.push(response.error || 'Could not create game.');
    }
  });
}

function attemptStartGame() {
  if (players.value.length >= 2 && gameId.value && !gameIsStartingOrRunning.value) {
    errorMessages.value = [];
    gameStatusMessage.value = 'Attempting to start game...';
    socket.emit('startGame', { gameId: gameId.value });
  } else if (players.value.length < 2) {
    errorMessages.value.push('At least 2 players are needed to start the game.');
  }
}

function triggerCancelGame() {
  if (gameId.value) {
    socket.emit('cancelGame', { gameId: gameId.value });
    // UI-Reset erfolgt durch 'gameCancelled' Event vom Server oder direkt
    // resetLobbyState(); // Oder auf Server-Antwort warten
  }
}

</script>

<style scoped>
.create-game {
  max-width: 600px;
  margin: auto;
  padding: 1.5rem;
  background-color: #f9f9f9;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}
h2, h3, h4 {
  color: #333;
}
ul {
  list-style: none;
  padding: 0;
}
li {
  background-color: #fff;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
  border-radius: 4px;
  border: 1px solid #eee;
}
.ready-status {
  color: green;
  font-weight: bold;
  margin-left: 0.5rem;
}
.status-messages {
  margin: 1rem 0;
  padding: 0.75rem;
  background-color: #eef;
  border-left: 3px solid #66f;
  min-height: 2em;
}
.error-message {
  color: #D8000C;
  background-color: #FFD2D2;
  padding: 0.5rem;
  margin-top: 0.5rem;
  border-radius: 4px;
}
.host-actions button {
  margin-right: 0.5rem;
  padding: 0.75rem 1.25rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background-color: #4CAF50;
  color: white;
}
.host-actions button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}
.host-actions .cancel-button {
  background-color: #f44336;
}
.round-info {
    margin-top: 1rem;
    padding: 0.75rem;
    background-color: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 4px;
}
form > div {
  margin-bottom: 1rem;
}
label {
  display: block;
  margin-bottom: 0.25rem;
}
input {
  width: 100%;
  padding: 0.5rem;
  box-sizing: border-box;
  border: 1px solid #ccc;
  border-radius: 4px;
}
</style>