<template>
  <div class="redirect-container">
    <div class="loader"></div>
    <h2 class="status-text">{{ statusMessage }}</h2>
  </div>
</template>

<script setup>
import { ref, onMounted, inject } from 'vue';
import { useRouter } from 'vue-router';

// Hol dir die globalen Instanzen für Socket und Router
const socket = inject('socket');
const router = useRouter();

// Zustand für die Nachrichten an den Benutzer
const statusMessage = ref('Searching for Room...');

onMounted(() => {
  // Stelle sicher, dass der Socket verbunden ist, bevor wir etwas senden
  if (!socket.connected) {
    statusMessage.value = 'Connecting...';
    socket.connect();
  }

  // Lausche einmal auf das 'connect'-Event, um sicherzugehen, dass wir verbunden sind
  socket.once('connect', () => {
    statusMessage.value = 'Connected! Searching for Room...';
    
    // Frage den Server nach einem verfügbaren Spiel
    socket.emit('playerWantsToJoin', (response) => {
      if (response && response.success && response.gameId) {
        // Wenn der Server eine gameId zurückgibt, leite den Spieler dorthin weiter
        console.log(`[Redirect] Found a Game: ${response.gameId}. Redirecting...`);
        router.push({ name: 'WaitingRoom', params: { gameId: response.gameId } });
      } else {
        // Falls ein Fehler auftritt
        statusMessage.value = 'No Game found. Try again later.';
        console.error('Failed to get a gameId from server.', response);
      }
    });
  });

  // Fallback für den Fall, dass die Verbindung fehlschlägt
  socket.on('connect_error', (err) => {
      statusMessage.value = 'Verbindung zum Server fehlgeschlagen.';
      console.error('Connection Error:', err);
  });
});

</script>

<style scoped>
.redirect-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background-color: #f0f2f5;
  font-family: sans-serif;
}

.status-text {
  color: #333;
  margin-top: 20px;
}

.loader {
  border: 8px solid #f3f3f3;
  border-top: 8px solid #3498db;
  border-radius: 50%;
  width: 60px;
  height: 60px;
  animation: spin 1.5s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>