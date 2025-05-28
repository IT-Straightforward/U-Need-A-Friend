<template>
  <div class="join-game">
    <h2>Join Game</h2>

    <form @submit.prevent="join">
      <div>
        <label for="roomIdInput">Room Code:</label> <input id="roomIdInput" v-model="roomIdToJoin" required />
      </div>

      <div>
        <label for="playerNameInput">Your Name:</label>
        <input id="playerNameInput" v-model="playerName" placeholder="Optional" />
      </div>

      <button type="submit" :disabled="isJoining">
        {{ isJoining ? 'Joining...' : 'Join Room' }} </button>
    </form>

    <p v-if="error" class="error-message">{{ error }}</p>
  </div>
</template>

<script setup>
import { ref, inject, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router'; // useRoute importieren

const socket = inject('socket');
const router = useRouter();
const route = useRoute(); // useRoute Instanz für Zugriff auf Routen-Informationen

const roomIdToJoin = ref(''); // Umbenannt von gameIdToJoin
const playerName = ref('');
const error = ref('');
const isJoining = ref(false); // Für den Ladezustand des Buttons

onMounted(() => {
  // Prüfe auf 'room' Query-Parameter in der URL (z.B. von einem QR-Code-Scan)
  const roomFromUrl = route.query.room; 
  if (roomFromUrl) {
    console.log(`[JoinGame] Found room ID in URL query: ${roomFromUrl}`);
    // IDs sind oft Case-Sensitive oder werden serverseitig als Uppercase erwartet (z.B. OCEAN)
    // Wandle es hier direkt um, falls deine IDs immer Uppercase sind.
    roomIdToJoin.value = String(roomFromUrl).toUpperCase(); 
  }
});

function join() {
  error.value = ''; 
  // IDs ggf. immer als Uppercase behandeln, falls deine Raum-IDs so definiert sind
  const currentRoomId = roomIdToJoin.value.trim().toUpperCase(); 

  if (!currentRoomId) {
    error.value = 'Please enter a valid Room Code.';
    return;
  }
  isJoining.value = true;

  console.log(`[JoinGame] Attempting to join room with ID: ${currentRoomId}`);
  // Server erwartet 'roomId' im Payload
  socket.emit('joinGame', { 
    roomId: currentRoomId, 
    playerName: playerName.value.trim() || `Player_${socket.id.substring(0, 4)}`
  }, (response) => {
    isJoining.value = false; // Ladezustand zurücksetzen
    console.log(`[JoinGame] Response from server for 'joinGame':`, response);

    if (response && response.error) {
      error.value = response.error;
    } else if (response && response.success && response.gameId) { // Server sendet 'gameId' (was die roomId ist)
      console.log(`[JoinGame] Join successful. Navigating to /waiting/${response.gameId}`);
      router.push(`/waiting/${response.gameId}`); // Verwende die vom Server bestätigte ID für die Navigation
    } else {
      error.value = 'Failed to join room. Invalid response from server or missing gameId in response.';
      console.error('[JoinGame] Invalid response from server for joinGame:', response);
    }
  });
}
</script>

<style scoped>
.join-game {
  max-width: 500px;
  margin: 2rem auto; /* Etwas mehr oberer Abstand */
  padding: 1.5rem;   /* Etwas mehr Innenabstand */
  background-color: #f9f9f9;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}
h2 {
  text-align: center;
  margin-bottom: 1.5rem;
  color: #333;
}
form > div {
  margin-bottom: 1rem;
}
label {
  display: block;
  margin-bottom: 0.3rem; /* Etwas mehr Abstand zum Input */
  font-weight: 500; /* Etwas fetter */
  color: #555;
}
input {
  width: 100%;
  padding: 0.75rem; /* Größeres Padding für bessere Touch-Bedienung */
  box-sizing: border-box;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
}
button {
  width: 100%; /* Button über volle Breite */
  padding: 0.85rem 1.5rem;
  cursor: pointer;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  transition: background-color 0.2s ease;
}
button:hover {
  background-color: #0056b3;
}
button:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}
.alternative-link { /* Nicht mehr im Template, aber Stil bleibt falls benötigt */
  margin-top: 1rem;
  text-align: center;
}
.error-message {
  color: #D8000C;
  background-color: #FFD2D2;
  padding: 0.75rem;
  margin-top: 1rem;
  border-radius: 4px;
  text-align: center;
}
</style>