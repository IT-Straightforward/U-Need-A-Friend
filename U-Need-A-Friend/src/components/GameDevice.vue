<!-- src/components/GameDevice.vue -->
<template>
  <div class="game-device">
    <h2 v-if="!gameActive">Waiting for game to start...</h2>
    <div v-else class="device">
      <!-- Display screen -->
      <div class="screen">
        <!-- Show symbol if this player is source for current round -->
        <span v-if="currentSymbol">{{ currentSymbol }}</span>
        <!-- If target and waiting for input, maybe show a placeholder or blinking indicator -->
        <span v-if="isTarget && currentSymbol === null">?</span>
      </div>
      <!-- Buttons -->
      <div class="buttons">
        <button 
          v-for="(sym, idx) in symbols" :key="idx" 
          :class="{ blink: isTarget && blinkIndex === idx }"
          @click="pressButton(idx)">
          {{ sym }}
        </button>
      </div>
      <!-- Leave Game -->
      <button class="leave-btn" @click="leaveGame">Leave Game</button>
    </div>
    <!-- Some status messages -->
    <p v-if="message" class="status">{{ message }}</p>
  </div>
</template>

<script setup>
import { inject, reactive, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const socket = inject('socket');
const route = useRoute();
const router = useRouter();

const state = reactive({
  gameActive: false,
  symbols: [],        // this player's 4 symbols
  currentSymbol: null, // symbol to display (if this player is source)
  isTarget: false,
  blinkIndex: null,   // which button index is blinking for target
  message: ''
});

// On mount, set up socket event listeners relevant to game
function setupSocketListeners() {
  // Receive assigned symbols on game start
  socket.on('gameStarted', (data) => {
    if (data.gameId !== route.params.gameId) return;  // ensure it's for this game
    state.symbols = data.symbols;
    state.gameActive = true;
    state.message = 'Game started! Await instructions...';
  });

  // Round updates (source/target/none)
  socket.on('roundUpdate', (data) => {
    // data: { role: 'source'/'target'/'none', symbol?, index? }
    if (!state.gameActive) return;
    if (data.role === 'source') {
      // I am source, display the symbol
      state.currentSymbol = data.symbol;
      state.isTarget = false;
      state.blinkIndex = null;
      state.message = 'You are the Source! Displaying symbol.';
    } else if (data.role === 'target') {
      // I am target, one of my symbols is hidden/blinking
      state.currentSymbol = null; // nothing to show on screen
      state.isTarget = true;
      state.blinkIndex = data.index;
      state.message = 'You are the Target! Recall and press the missing symbol.';
    } else {
      // role 'none' -> not directly involved this round
      state.currentSymbol = null;
      state.isTarget = false;
      state.blinkIndex = null;
      state.message = 'Waiting for other players...';
    }
  });

  // Feedback on button press (optional handling)
  socket.on('feedback', (data) => {
    if (!state.gameActive) return;
    if (data.correct) {
      state.message = 'Correct! 🎉 Get ready for the next round...';
    } else {
      state.message = 'Incorrect, try again!';
    }
    // Message will be quickly overwritten by next round's roundUpdate or could be cleared after a timeout
  });

  // If game ends (e.g., host left or not enough players)
  socket.on('gameEnded', (data) => {
    state.message = 'Game ended: ' + (data.reason || '');
    state.gameActive = false;
    // Optionally, navigate back to join screen after a short delay
    setTimeout(() => {
      router.replace('/join');
    }, 3000);
  });

  // If a player left (not necessarily ending game)
  socket.on('playerLeft', (data) => {
    state.message = `${data.playerName} left the game.`;
    // If needed, handle re-adjusting game state if target/source left mid-round.
  });
}

// Attach listeners on mount, remove on unmount to avoid duplicates
onMounted(setupSocketListeners);
onUnmounted(() => {
  socket.off('gameStarted');
  socket.off('roundUpdate');
  socket.off('feedback');
  socket.off('gameEnded');
  socket.off('playerLeft');
});

// Method to handle button click
function pressButton(index) {
  if (!state.gameActive) return;
  // Emit the button press to server
  socket.emit('buttonPress', { gameId: route.params.gameId, index: index });
  // (Server will respond with 'feedback' and possibly trigger a new round via 'roundUpdate')
}

// Method to leave game intentionally
function leaveGame() {
  // Simply disconnect socket or emit a leave message
  socket.disconnect();  // this will trigger disconnect handling on server
  // Navigate back to join screen
  router.replace('/join');
}
</script>

<style scoped>
/* Simple styles for device layout */
.device {
  border: 2px solid #333; padding: 1em; display: inline-block;
}
.screen {
  width: 200px; height: 50px; margin-bottom: 1em;
  background: #000; color: #0f0; font-size: 2em;
  display: flex; align-items: center; justify-content: center;
}
.buttons {
  display: grid;
  grid-template-columns: repeat(2, 100px);
  grid-gap: 0.5em;
}
.buttons button {
  padding: 1em;
}
.buttons button.blink {
  animation: blink 1s infinite alternate;
}
@keyframes blink {
  from { background-color: yellow; }
  to { background-color: inherit; }
}
.leave-btn {
  margin-top: 1em;
}
.status {
  margin-top: 0.5em;
  font-style: italic;
}
</style>
