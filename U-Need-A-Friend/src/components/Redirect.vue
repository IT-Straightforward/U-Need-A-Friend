<template>
  <div class="redirect-container">
    <div class="loader"></div>
    <h2 class="status-text">{{ statusMessage }}</h2>
  </div>
</template>

<script setup>
import { ref, onMounted, inject } from 'vue';
import { useRouter } from 'vue-router';

const socket = inject('socket');
const router = useRouter();

const statusMessage = ref('Searching for Room...');

onMounted(() => {
  if (!socket.connected) {
    statusMessage.value = 'Connecting to server...';
    socket.connect();
  }

  socket.once('connect', () => {
    statusMessage.value = 'Connected! Asking server for a game...';

    socket.emit('playerWantsToJoin', (response) => {
      if (response?.success && response.gameId) {
        console.log(`[Redirect.vue] Server returned game: ${response.gameId}`);
        router.push({ name: 'WaitingRoom', params: { gameId: response.gameId } });
      } else {
        statusMessage.value = 'No available game found.';
        console.error('[Redirect.vue] Failed to get a gameId from server:', response);
      }
    });
  });

  socket.on('connect_error', (err) => {
    statusMessage.value = 'Connection to server failed.';
    console.error('[Redirect.vue] Socket connection error:', err);
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
