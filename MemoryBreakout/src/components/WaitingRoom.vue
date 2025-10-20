<template>
  <div
    class="waiting-room-app-container"
    :style="computedRoomStyle"
    ref="containerRef"
  >
    <h2 class="room-title-main">Memory Breakout</h2>
    <div class="device-box">
      <div class="card-grid">
        <div
          v-for="(card, index) in cardGrid"
          :key="`card-${index}`"
          class="card-container"
          :class="{
            'is-ready-button': card.isReadyButton,
            'disabled-during-countdown': isCountdownActive,
          }"
          @click="card.isReadyButton && toggleReadyStatus()"
        >
          <div class="card-inner" :class="{ 'is-flipped': card.isFlipped }">
            <div class="card-face card-back">
              <div v-if="card.isReadyButton" class="ready-button-content">
                <span v-if="!isTogglingReady">Ready?</span>
                <span v-else>...</span>
              </div>
              <span v-else>?</span>
            </div>
            <div class="card-face card-front">
              <div v-if="card.isReadyButton">
                <span class="bubble-text">
                  {{ players.filter(p => p.isReadyInLobby).length }} /
                  {{ maxPlayersInRoom || '?' }}
                </span>
              </div>
              <img
                v-else
                :src="card.iconUrl"
                alt="icon"
                class="game-png-icon"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="statusMessage && !isCountdownActive && !gameIsOver"
      class="floating-status-message"
    >
      {{ statusMessage }}
    </div>

    <div v-if="gameIsOver" class="game-over-overlay">
      <p class="game-over-text">{{ statusMessage }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, inject, watch } from 'vue';
import { useRouter } from 'vue-router';

const iconModules = import.meta.glob('@/assets/icons/studio/*.png', {
  eager: true,
});
const availableIcons = Object.values(iconModules).map(module => module.default);

const clockwiseOrder = [0, 1, 2, 5, 8, 7, 6, 3];

const props = defineProps({
  gameId: { type: String, required: true },
});

const socket = inject('socket');
const router = useRouter();

// --- Zustand ---
const players = ref([]);
const roomDisplayName = ref('');
const roomBGColor = ref('#cfcfcf');
const roomAccentColor1 = ref('#e8e8e8');
const roomAccentColor2 = ref('#dcdcdc');
const maxPlayersInRoom = ref(null);
const statusMessage = ref('Joining game...');
const gameIsOver = ref(false);
const myReadyStatus = ref(false);
const isTogglingReady = ref(false);
const isJoining = ref(true);
const isCountdownActive = ref(false);
let countdownAnimationInterval = null;
const cardGrid = ref([]);

// --- Utility ---
const shuffleArray = array => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

const setupGrid = () => {
  if (availableIcons.length === 0) {
    console.warn('No icons found in /src/assets/icons/studio/.');
    return;
  }

  const grid = [];
  const shuffledIcons = shuffleArray([...availableIcons]);

  for (let i = 0; i < 9; i++) {
    const isCenter = i === 4;
    grid.push({
      isReadyButton: isCenter,
      iconUrl: isCenter ? null : shuffledIcons[i % shuffledIcons.length],
      isFlipped: false, 
    });
  }

  cardGrid.value = grid;
};

// --- Computed & Watcher ---
const computedRoomStyle = computed(() => ({
  '--bg-color': roomBGColor.value,
  '--accent1': roomAccentColor1.value,
  '--accent2': roomAccentColor2.value,
}));

watch(
  roomBGColor,
  newColor => {
    if (newColor) {
      document.body.style.backgroundColor = newColor;
      document.body.style.transition = 'background-color 0.5s ease';
    }
  },
  { immediate: true }
);

// --- Socket Event Handlers ---
const handleGameUpdate = data => {
  if (data.gameId !== props.gameId) return;
  if (data.roomName) roomDisplayName.value = data.roomName;
  if (data.maxPlayers !== undefined) maxPlayersInRoom.value = data.maxPlayers;
  if (data.pastelPalette) {
    roomBGColor.value = data.pastelPalette.primary;
    roomAccentColor1.value = data.pastelPalette.accent1;
    roomAccentColor2.value = data.pastelPalette.accent2;
  }
  if (data.players !== undefined) {
    players.value = data.players;
    const me = players.value.find(p => p.id === socket.id);
    if (me) {
      myReadyStatus.value = me.isReadyInLobby;
      if (cardGrid.value[4]) {
        cardGrid.value[4].isFlipped = me.isReadyInLobby;
      }
    }
  }
  if (data.message && !isCountdownActive.value && !gameIsOver.value) {
    statusMessage.value = data.message;
  } else if (!isCountdownActive.value && !gameIsOver.value) {
    const readyCount = players.value.filter(p => p.isReadyInLobby).length;
    if (readyCount === players.value.length && players.value.length >= 2) {
      statusMessage.value = 'All ready! Starting countdown...';
    } else if (players.value.length > 0) {
      statusMessage.value = 'Waiting for all players to be ready...';
    } else {
      statusMessage.value = 'You are in the lobby.';
    }
  }
};

const handleGoToGame = data => {
  if (data.gameId === props.gameId) {
    console.log(`[WaitingRoom.vue] Navigating to game ${props.gameId}`);
    if (countdownAnimationInterval) clearInterval(countdownAnimationInterval);
    router.push(`/game/${props.gameId}`);
  }
};

const handleLobbyCountdownStarted = data => {
  if (data.roomId !== props.gameId) return;

  statusMessage.value = 'Starting game!';
  isCountdownActive.value = true;
  if (countdownAnimationInterval) clearInterval(countdownAnimationInterval);

  let flipCounter = 0;

  const firstIndex = clockwiseOrder[flipCounter];
  if (cardGrid.value[firstIndex]) {
    cardGrid.value[firstIndex].isFlipped = true;
  }
  flipCounter++;

  countdownAnimationInterval = setInterval(() => {
    if (flipCounter < clockwiseOrder.length) {
      const cardToFlipIndex = clockwiseOrder[flipCounter];
      if (cardGrid.value[cardToFlipIndex]) {
        cardGrid.value[cardToFlipIndex].isFlipped = true;
      }
      flipCounter++;
    } else {
      clearInterval(countdownAnimationInterval);
    }
  }, 1000);
};

const handleLobbyCountdownCancelled = data => {
  if (data.roomId !== props.gameId) return;

  if (countdownAnimationInterval) clearInterval(countdownAnimationInterval);
  isCountdownActive.value = false;
  statusMessage.value = data.message || 'Countdown cancelled.';
  cardGrid.value.forEach((card, index) => {
    if (index !== 4) {
      card.isFlipped = false;
    }
  });
};

const handleGameCancelledOrEnded = data => {
  let msg = `Session ended: ${data.message || data.reason}`;
  if (!data.gameId || data.gameId === props.gameId) {
    handleLobbyCountdownCancelled({ roomId: props.gameId });
    statusMessage.value = msg;
    gameIsOver.value = true;
  }
};

const handleGameNotFound = data => {
  statusMessage.value =
    data.message || `Room ${props.gameId} not found or inactive.`;
  gameIsOver.value = true;
};

onMounted(async () => {
  setupGrid();

  socket.on('gameUpdate', handleGameUpdate);
  socket.on('goToGame', handleGoToGame);
  socket.on('gameEnded', data => handleGameCancelledOrEnded(data, 'ended'));
  socket.on('gameNotFound', handleGameNotFound);
  socket.on('lobby:countdownStarted', handleLobbyCountdownStarted);
  socket.on('lobby:countdownCancelled', handleLobbyCountdownCancelled);

  if (props.gameId) {
    const persistentPlayerId = sessionStorage.getItem('myGamePlayerId');

    socket.emit(
      'joinGame',
      {
        roomId: props.gameId,
        persistentPlayerId: persistentPlayerId,
      },
      response => {
        isJoining.value = false;
        if (response && response.success) {
          console.log(`[WaitingRoom] Erfolgreich beigetreten/wiederverbunden.`);

          if (response.newPersistentId) {
            sessionStorage.setItem('myGamePlayerId', response.newPersistentId);
          }

          if (response.gameState) {
            const state = response.gameState;
            roomDisplayName.value = state.roomName;
            maxPlayersInRoom.value = state.maxPlayers;
            players.value = state.players;
            if (state.pastelPalette) {
              roomBGColor.value = state.pastelPalette.primary;
            }
            const me = state.players.find(p => p.id === socket.id);
            if (me) myReadyStatus.value = me.isReadyInLobby;
            if (state.lobbyCountdownEndTime) {
              handleLobbyCountdownStarted({
                roomId: props.gameId,
                endTime: state.lobbyCountdownEndTime,
              });
            }
          }

          console.log(
            "[WaitingRoom] Setze initialen Ready-Status auf 'false' auf dem Server."
          );
          socket.emit(
            'player:setReadyStatus',
            { roomId: props.gameId, isReady: false },
            statusResponse => {
              if (statusResponse && statusResponse.success) {
         
                myReadyStatus.value = statusResponse.currentReadyStatus; 
              }
            }
          );
   
        } else {
          statusMessage.value = ` ${
            response.error || 'Something went wrong.'
          }`;
          gameIsOver.value = true;
        }
      }
    );
  } else {
    isJoining.value = false;
    statusMessage.value = 'No Room found. Try refreshing the page.';
    gameIsOver.value = true;
  }

  await nextTick();
  if (containerRef.value) {
    updateBubblePositions();
    animationFrameId = requestAnimationFrame(updateBubblePositions);
  }
});

onUnmounted(() => {
  if (countdownAnimationInterval) clearInterval(countdownAnimationInterval);
  socket.off('gameUpdate', handleGameUpdate);
  socket.off('goToGame', handleGoToGame);
  socket.off('gameEnded');
  socket.off('gameNotFound', handleGameNotFound);
  socket.off('lobby:countdownStarted', handleLobbyCountdownStarted);
  socket.off('lobby:countdownCancelled', handleLobbyCountdownCancelled);
  document.body.style.backgroundColor = '';
});

// --- Methoden ---
function toggleReadyStatus() {
  if (isJoining.value || isTogglingReady.value) return;

  const newReadyState = !myReadyStatus.value;

  if (isCountdownActive.value && newReadyState === true) return;

  isTogglingReady.value = true;

  socket.emit(
    'player:setReadyStatus',
    { roomId: props.gameId, isReady: newReadyState },
    response => {
      isTogglingReady.value = false;

      if (response && response.success) {
        myReadyStatus.value = response.currentReadyStatus;

        const centerIndex = 4;
        cardGrid.value[centerIndex].isFlipped = newReadyState;

  
        if (isCountdownActive.value && newReadyState === false) {
          console.log('[WaitingRoom] Countdown canceled by player toggle.');
          socket.emit('lobby:cancelCountdown', { roomId: props.gameId });
          handleLobbyCountdownCancelled({
            roomId: props.gameId,
            message: 'Countdown aborted.',
          });
        }
      } else {
        statusMessage.value = `Error: ${
          response?.error || 'Could not set status.'
        }`;
      }
    }
  );
}
</script>
<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;700&display=swap');

/* --- Main Layout --- */
.waiting-room-app-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  width: 100%;
  background-color: var(--bg-color, #cfcfcf);
  padding: 1rem;
  box-sizing: border-box;
  font-family: 'Nunito', sans-serif;
  gap: 1.5rem;
  transition: background-color 0.5s ease;
  overflow: hidden;
  position: relative;
}

.room-title-main {
  font-size: clamp(2rem, 6vw, 3.2rem);
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 3px 6px rgba(0,0,0,0.35);
  margin: 0;
  position: absolute;
  top: 40px; /* ⬅️ vorher: 25px */
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  white-space: nowrap;
}



.player-count-display {
  position: absolute;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 20px;
  color: white;
  text-align: center;
  z-index: 10;
  font-weight: 600;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.player-count-display .bubble-text-prominent {
  font-size: 1.3em;
  display: block;
}

@media (max-width: 480px) {
  .room-title-main {
    font-size: 1.6em;
    top: 15px;
  }
  .player-count-display {
    top: 60px;
  }
}

/* --- Device Box & Card Grid --- */
.device-box {
  background: var(--accent1, #f0f0f0);
  width: 100%;
  max-width: 380px;
  border-radius: 32px;
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.15);
  padding: 1.5rem;
  box-sizing: border-box;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  width: 100%;
}

/* --- Card 3D Flip Styling --- */
.card-container {
  aspect-ratio: 1 / 1;
  perspective: 1000px;
}

.card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  border-radius: 12px;
  transition: transform 0.6s cubic-bezier(0.68, -0.55, 0.27, 1.55),
    box-shadow 0.3s ease;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
}

.card-inner.is-flipped {
  transform: rotateY(180deg);
}

.card-face {
  position: absolute;
  width: 100%;
  height: 100%;
  backface-visibility: hidden; 
  -webkit-backface-visibility: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 12px;
}

.card-back {
  background-color: #5cb85c;
  color: white;
  font-size: 3em;
  font-weight: 700;
}

.card-front {
  background-color: #f0f8ff;
  transform: rotateY(180deg); 
}

.game-png-icon {
  max-width: 70%;
  max-height: 70%;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.2));
}

/* --- Center Ready Button --- */
.card-container.is-ready-button {
  cursor: pointer;
}

.card-container.is-ready-button .card-front {
  background-color: #ffffff; 
  color: #2e2e2e;
  font-size: 1.5rem;
  font-weight: bold;
  transition: background-color 0.3s ease;
}

.card-container.is-ready-button.is-ready .card-front {
  background-color: #5cb85c;
}

.card-container.is-ready-button.disabled-during-countdown {
  filter: opacity(0.7);
}

/* --- Floating Messages & Overlays --- */
.floating-status-message {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background-color: var(--accent2, rgba(44, 62, 80, 0.85));
  color: white;
  padding: 12px 22px;
  border-radius: 25px;
  font-size: 0.95em;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
  z-index: 100;
  max-width: 80%;
  text-align: center;
}

.game-over-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 200;
  text-align: center;
  padding: 2rem;
  box-sizing: border-box;
}

.game-over-text {
  font-size: 1.5em;
  color: white;
  margin: 0;
}

.bubble-base {
  font-family: inherit;
}

.back-to-join-bubble-gameover {
  position: static;
  width: auto;
  height: auto;
  padding: 15px 30px;
  border-radius: 30px;
  margin-top: 15px;
  background-color: #4285f4;
  color: white;
  cursor: pointer;
  font-weight: 600;
  font-size: 1.1em;
  text-decoration: none;
  transition: transform 0.2s;
}

.back-to-join-bubble-gameover:hover {
  transform: scale(1.05);
}
.card-container.is-ready-button .card-back {
  font-size: clamp(1rem, 3vw, 1.6rem);
  text-align: center;
}

.card-container.is-ready-button .card-front {
  font-size: 1.4em;
  text-align: center;
}
</style>
