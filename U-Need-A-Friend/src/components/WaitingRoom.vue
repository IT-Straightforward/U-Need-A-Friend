<template>
  <div class="waiting-room">
    <h2>Waiting for host to start the game...</h2>
    <p>Game Code: <strong>{{ gameId }}</strong></p>

    <div v-if="!gameIsOver">
        <h4>Players in Lobby: ({{ players.length }})</h4>
        <ul v-if="players.length > 0">
        <li v-for="playerItem in players" :key="playerItem.id">
            {{ playerItem.name }}
            <span v-if="playerItem.id === ownSocketId" class="you-indicator">(You)</span>
        </li>
        </ul>
        <p v-else>You are the first one here!</p>
        <p class="status-message" v-if="statusMessage">{{ statusMessage }}</p>
    </div>
    <div v-else>
        <p class="game-over-message">{{ statusMessage }}</p>
        <router-link to="/join" class="link-button">Back to Join Game</router-link>
    </div>
    <button v-if="!gameIsOver" @click="triggerLeaveGame" class="leave-button">Leave Lobby</button>
  </div>
</template>

<script setup>
import { ref, inject, onMounted, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
  gameId: {
    type: String,
    required: true
  }
});

const socket = inject('socket');
const router = useRouter();

const players = ref([]);
const ownSocketId = ref('');
const statusMessage = ref('Connecting and waiting for updates...');
const gameIsOver = ref(false); // Für gameCancelled oder gameEnded

// --- Socket Event Handler ---
const handleGameUpdate = (data) => {
  if (data.gameId === props.gameId) {
    players.value = data.players || [];
    if (data.message) {
        statusMessage.value = data.message;
    } else if (players.value.length > 0 && !gameIsOver.value){
        statusMessage.value = 'Lobby updated. Waiting for host...';
    }
  }
};

const handleGoToGame = (data) => {
  if (data.gameId === props.gameId) {
    console.log('Navigating to game:', data.gameId);
    // Hier keine Symbole mehr aus localStorage, Game.vue erhält sie via 'gameStarted'
    router.push(`/game/${props.gameId}`);
  }
};

const handleGameCancelled = (data) => {
  statusMessage.value = data.message || 'The game has been cancelled by the host.';
  gameIsOver.value = true;
  // Optional: Automatische Weiterleitung nach einiger Zeit
  // setTimeout(() => router.push('/join'), 3000);
};

const handleGameEnded = (data) => {
  statusMessage.value = `Game ended: ${data.message || data.reason}`;
  gameIsOver.value = true;
  // setTimeout(() => router.push('/join'), 3000);
};

onMounted(() => {
  ownSocketId.value = socket.id;
  statusMessage.value = 'Joining lobby...';

  // Explizit dem Server mitteilen, dass man Updates für dieses Spiel abonnieren möchte
  // (Der Server fügt den Socket bereits dem Raum in 'joinGame' hinzu, dies ist eine zusätzliche Bestätigung/Aktion)
  // socket.emit('subscribeToLobbyUpdates', { gameId: props.gameId });
  // => Dies ist im Grunde durch socket.join(gameId) serverseitig bei 'joinGame' abgedeckt.
  // Ein initiales 'gameUpdate' wäre gut, wenn der Server es direkt nach dem Join sendet.
  // Oder der Client fordert es an:
  socket.emit('requestInitialLobbyState', { gameId: props.gameId }); // Neuer Event-Vorschlag

  socket.on('gameUpdate', handleGameUpdate); // Spielerliste etc.
  socket.on('goToGame', handleGoToGame);     // Host hat Spiel gestartet
  socket.on('gameCancelled', handleGameCancelled); // Host hat Spiel abgebrochen
  socket.on('gameEnded', handleGameEnded);       // Spiel serverseitig beendet (z.B. Host-Disconnect)

  // Fallback, falls die Seite direkt aufgerufen wird und noch nicht im Spiel ist.
  // Dies würde eine robustere Logik erfordern, um den Spielbeitritt erneut zu versuchen.
});

onUnmounted(() => {
  socket.off('gameUpdate', handleGameUpdate);
  socket.off('goToGame', handleGoToGame);
  socket.off('gameCancelled', handleGameCancelled);
  socket.off('gameEnded', handleGameEnded);

  // Beim Verlassen des Warteraums nicht unbedingt 'leaveGame' senden,
  // da der Nutzer vielleicht nur navigiert. 'disconnect' wird serverseitig behandelt.
  // Ein expliziter "Leave Lobby"-Button ist besser.
});

function triggerLeaveGame() {
  if (!gameIsOver.value) {
    socket.emit('leaveGame', { gameId: props.gameId });
    router.push('/join');
  }
}

</script>

<style scoped>
.waiting-room {
  max-width: 500px;
  margin: 2rem auto;
  padding: 1.5rem;
  text-align: center;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05);
}
ul {
  list-style: none;
  padding: 0;
  margin-bottom: 1.5rem;
}
li {
  padding: 0.3rem 0;
  border-bottom: 1px solid #f0f0f0;
}
li:last-child {
  border-bottom: none;
}
.you-indicator {
  font-style: italic;
  color: #007bff;
  margin-left: 0.5rem;
}
.status-message {
  margin-top: 1rem;
  padding: 0.75rem;
  background-color: #e9ecef;
  border-radius: 4px;
  color: #495057;
}
.game-over-message {
    color: #dc3545;
    font-weight: bold;
    margin-bottom: 1rem;
}
.link-button, .leave-button {
  display: inline-block;
  padding: 0.75rem 1.5rem;
  margin-top: 1rem;
  text-decoration: none;
  color: white;
  background-color: #007bff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.leave-button {
    background-color: #dc3545;
}
.link-button:hover, .leave-button:hover {
  opacity: 0.9;
}
</style>