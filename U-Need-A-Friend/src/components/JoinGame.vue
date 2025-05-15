<template>
  <div class="join-game">
    <h2>Join Game</h2>

    <form @submit.prevent="join">
      <div>
        <label for="gameIdInput">Game ID:</label>
        <input id="gameIdInput" v-model="gameIdToJoin" required />
      </div>

      <div>
        <label for="playerNameInput">Your Name:</label>
        <input id="playerNameInput" v-model="playerName" placeholder="Optional" />
      </div>

      <button type="submit">Join Game</button>
    </form>

    <p class="alternative-link">Or <router-link to="/create">Create a new game</router-link></p>
    <p v-if="error" class="error-message">{{ error }}</p>
  </div>
</template>

<script setup>
import { ref, inject } from 'vue';
import { useRouter } from 'vue-router';

const socket = inject('socket');
const router = useRouter();

const gameIdToJoin = ref('');
const playerName = ref('');
const error = ref('');

function join() {
  error.value = ''; // Fehler zurücksetzen
  const trimmedIdFromInput = gameIdToJoin.value.trim(); // ID aus dem Inputfeld

  if (!trimmedIdFromInput) {
    error.value = 'Please enter a valid Game ID.';
    return;
  }

  console.log(`[JoinGame] Attempting to join game with ID: ${trimmedIdFromInput}`);
  socket.emit('joinGame', {
    gameId: trimmedIdFromInput, // Sende die vom Nutzer eingegebene ID
    playerName: playerName.value.trim() || `Player_${socket.id.substring(0, 4)}`
  }, (response) => {
    console.log(`[JoinGame] Response from server for 'joinGame':`, response);

    if (response && response.error) {
      error.value = response.error;
    } else if (response && response.success && response.gameId) {
      // WICHTIG: Verwende die vom Server bestätigte gameId für die Navigation!
      console.log(`[JoinGame] Join successful. Navigating to /waiting/${response.gameId}`);
      router.push(`/waiting/${response.gameId}`);
    } else {
      // Fallback-Fehler, falls die Antwortstruktur unerwartet ist
      error.value = 'Failed to join game. Invalid response from server or missing gameId in response.';
      console.error('[JoinGame] Invalid response from server for joinGame:', response);
    }
  });
}
</script>

<style scoped>
/* Styles wie zuvor */
.join-game {
  max-width: 500px;
  margin: auto;
  padding: 1rem;
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
}
button {
  padding: 0.75rem 1.5rem;
  cursor: pointer;
}
.alternative-link {
  margin-top: 1rem;
}
.error-message {
  color: red;
  margin-top: 1rem;
}
</style>