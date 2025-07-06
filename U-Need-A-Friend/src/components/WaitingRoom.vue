<template>
  <div class="waiting-room-app-container" :style="computedRoomStyle" ref="containerRef">
    <h2 class="room-title-main">{{ roomDisplayName || gameId }}</h2>

    <div 
      class="bubble-base player-count-bubble" 
      :style="bubbles.playerCount.style"> 
      <span class="bubble-text">Spieler</span>
      <span class="bubble-text-prominent">{{ players.length }} / {{ maxPlayersInRoom || '?' }}</span>
      <div v-if="countdownTime !== null" class="countdown-overlay">
        {{ countdownTime }}s
      </div>
    </div>

    <button 
      class="bubble-base ready-bubble-button" 
      @click="toggleReadyStatus" 
      :disabled="isJoining || isTogglingReady" 
      :class="{'is-ready': myReadyStatus, 'disabled-during-countdown': countdownTime !== null}"
      :style="bubbles.readyButton.style">
      <span v-if="!isTogglingReady" class="bubble-text">
        <span v-if="myReadyStatus">Bereit! ✓</span>
        <span v-else>Bereit?</span>
      </span>
      <span v-else class="bubble-text">...</span>
    </button>

    <button 
      class="bubble-base leave-bubble-button" 
      @click="triggerLeaveGame" 
      :style="bubbles.leaveButton.style">
      <span class="bubble-text">Verlassen</span>
    </button>

    <div v-if="statusMessage && countdownTime === null && !gameIsOver" class="floating-status-message">
      {{ statusMessage }}
    </div>

    <div v-if="gameIsOver" class="game-over-overlay">
      <p class="game-over-text">{{ statusMessage }}</p>
      <router-link to="/" class="bubble-base back-to-join-bubble-gameover">Zurück</router-link>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, nextTick, inject, watch } from 'vue';
import { useGameSessionStore } from '@/stores/gameSessionStore';
import { useRouter } from 'vue-router';
import bubbleBluePath from '@/assets/bubble-blue.png'; 
import bubbleGreenPath from '@/assets/bubble-green.png';
import bubbleYellowPath from '@/assets/bubble-yellow.png';
import bubbleRedPath from '@/assets/bubble-red.png';

const props = defineProps({
  gameId: { type: String, required: true }
});

const socket = inject('socket');
const router = useRouter();
const gameSessionStore = useGameSessionStore(); 

// --- Zustand ---
const players = ref([]);
const roomDisplayName = ref(''); 
const roomBGColor = ref('#cfcfcf');
const roomAccentColor1 = ref('#e8e8e8');
const roomAccentColor2 = ref('#dcdcdc');
const roomAccentColor3 = ref('#f5f5f5');
const maxPlayersInRoom = ref(null); 
const statusMessage = ref('Trete dem Spiel bei...');
const gameIsOver = ref(false);
const myReadyStatus = ref(false); 
const isTogglingReady = ref(false); 
const isJoining = ref(true); 
const countdownTime = ref(null); 
const countdownEndTime = ref(null);
let localCountdownIntervalId = null;
let animationFrameId = null;
const containerRef = ref(null);

const bubbles = reactive({
  playerCount: { x: 200, y: 50, vx: 0.25, vy: 0.35, width: 100, height: 100, imagePath: bubbleBluePath, style: {} }, 
  readyButton: { x: 50, y: 120, vx: -0.3, vy: 0.25, width: 170, height: 170, imagePath: bubbleGreenPath, readyImagePath: bubbleYellowPath, style: {} },
  leaveButton: { x: 100, y: 250, vx: 0.2, vy: -0.3, width: 120, height: 120, imagePath: bubbleRedPath, style: {} }
});

// --- Computed & Watcher ---
const computedRoomStyle = computed(() => ({
  backgroundColor: roomBGColor.value,
  '--accent1': roomAccentColor1.value,
  '--accent2': roomAccentColor2.value,
  '--accent3': roomAccentColor3.value,
  minHeight: '100vh',
  width: '100%',
  position: 'relative',
  overflow: 'hidden',
}));

watch(roomBGColor, (newColor) => {
  if (newColor) {
    document.body.style.backgroundColor = newColor;
    document.body.style.transition = 'background-color 0.5s ease';
  }
}, { immediate: true });

// --- Methoden & Handler ---
function updateBubbleDynamicStyles() {
  for (const key in bubbles) {
    const bubble = bubbles[key];
    let currentImage = bubble.imagePath;
    if (key === 'readyButton' && myReadyStatus.value && bubble.readyImagePath) {
      currentImage = bubble.readyImagePath;
    }
    bubbles[key].style = {
      position: 'absolute',
      top: `${bubble.y}px`,
      left: `${bubble.x}px`,
      width: `${bubble.width}px`,
      height: `${bubble.height}px`,
      backgroundImage: `url(${currentImage})`,
    };
  }
}

function updateBubblePositions() {
  if (!containerRef.value) return;
  const containerWidth = containerRef.value.clientWidth;
  const containerHeight = containerRef.value.clientHeight;
  for (const key in bubbles) {
    const bubble = bubbles[key];
    bubble.x += bubble.vx;
    bubble.y += bubble.vy;
    if (bubble.x + bubble.width > containerWidth || bubble.x < 0) bubble.vx *= -1;
    if (bubble.y + bubble.height > containerHeight || bubble.y < 0) bubble.vy *= -1;
  }
  updateBubbleDynamicStyles();
  animationFrameId = requestAnimationFrame(updateBubblePositions);
}

const handleGameUpdate = (data) => {
  if (data.gameId !== props.gameId) return;
  if (data.roomName) roomDisplayName.value = data.roomName;
  if (data.maxPlayers !== undefined) maxPlayersInRoom.value = data.maxPlayers;
  if (data.pastelPalette) {
    roomBGColor.value = data.pastelPalette.primary;
    roomAccentColor1.value = data.pastelPalette.accent1;
    roomAccentColor2.value = data.pastelPalette.accent2;
    roomAccentColor3.value = data.pastelPalette.accent3;
  }
  if (data.players !== undefined) {
    players.value = data.players;
    const me = players.value.find(p => p.id === socket.id);
    if (me) myReadyStatus.value = me.isReadyInLobby;
  }
  if (data.message && countdownTime.value === null && !gameIsOver.value) {
    statusMessage.value = data.message;
  } else if (countdownTime.value === null && !gameIsOver.value) {
      const readyCount = players.value.filter(p => p.isReadyInLobby).length;
      if (readyCount === players.value.length && players.value.length >= 2) {
          statusMessage.value = 'Alle bereit! Countdown startet gleich...';
      } else if (players.value.length > 0) {
          statusMessage.value = 'Warte auf Bereitschaft aller Spieler...';
      } else {
          statusMessage.value = 'Du bist in der Lobby.';
      }
  }
  updateBubbleDynamicStyles();
};

const handleGoToGame = (data) => {
  if (data.gameId === props.gameId) {
    if(localCountdownIntervalId) clearInterval(localCountdownIntervalId);
    router.push(`/game/${props.gameId}`);
  }
};

const handleLobbyCountdownStarted = (data) => {
  console.log("Coutndown gestartet:", data);
  if (data.roomId === props.gameId) {
    countdownEndTime.value = data.endTime;
    statusMessage.value = "";
    if(localCountdownIntervalId) clearInterval(localCountdownIntervalId);
    
    const tick = () => {
      if (countdownEndTime.value === null) {
        if(localCountdownIntervalId) clearInterval(localCountdownIntervalId);
        localCountdownIntervalId = null;
        return;
      }
      const remaining = Math.max(0, Math.round((countdownEndTime.value - Date.now()) / 1000));
      countdownTime.value = remaining;
      if (remaining <= 0) {
        if(localCountdownIntervalId) clearInterval(localCountdownIntervalId);
        localCountdownIntervalId = null;
      }
    };
    tick();
    localCountdownIntervalId = setInterval(tick, 1000);
  }
};

const handleLobbyCountdownCancelled = (data) => {
  if (data.roomId === props.gameId) {
    if(localCountdownIntervalId) clearInterval(localCountdownIntervalId);
    localCountdownIntervalId = null;
    countdownTime.value = null;
    countdownEndTime.value = null;
    statusMessage.value = data.message || 'Countdown abgebrochen.';
  }
};

const handleGameCancelledOrEnded = (data, type = "ended") => {
  let msg = (type === "cancelled")
    ? (data.message || 'Das Spiel wurde abgebrochen.')
    : `Sitzung beendet: ${data.message || data.reason}`;
  if (!data.gameId || data.gameId === props.gameId) {
    if(localCountdownIntervalId) clearInterval(localCountdownIntervalId);
    countdownTime.value = null;
    statusMessage.value = msg;
    gameIsOver.value = true;
  }
};

const handleGameNotFound = (data) => {
  statusMessage.value = data.message || `Raum ${props.gameId} nicht gefunden oder inaktiv.`;
  gameIsOver.value = true;
};

// In WaitingRoom.vue -> <script setup>

onMounted(async () => {
  // Listener für eingehende Events registrieren
  socket.on('gameUpdate', handleGameUpdate);
  socket.on('goToGame', handleGoToGame);
  socket.on('gameEnded', (data) => handleGameCancelledOrEnded(data, "ended"));
  socket.on('gameNotFound', handleGameNotFound);
  socket.on('lobby:countdownStarted', handleLobbyCountdownStarted);
  socket.on('lobby:countdownCancelled', handleLobbyCountdownCancelled);

  if (props.gameId) {
    const persistentPlayerId = sessionStorage.getItem('myGamePlayerId');
    
    socket.emit('joinGame', {
      roomId: props.gameId,
      persistentPlayerId: persistentPlayerId
    }, (response) => {
      isJoining.value = false;
      if (response && response.success) {
        console.log(`[WaitingRoom] Erfolgreich beigetreten/wiederverbunden.`);
        
        if (response.newPersistentId) {
          sessionStorage.setItem('myGamePlayerId', response.newPersistentId);
        }

        if (response.gameState) {
          // Stelle den Zustand aus dem Callback wieder her
          // (dieser Teil ist für Reconnects in eine laufende Lobby wichtig)
          const state = response.gameState;
          roomDisplayName.value = state.roomName;
          maxPlayersInRoom.value = state.maxPlayers;
          players.value = state.players;
          if (state.pastelPalette) {
              roomBGColor.value = state.pastelPalette.primary;
              // ... etc.
          }
          const me = state.players.find(p => p.id === socket.id);
          if (me) myReadyStatus.value = me.isReadyInLobby;
          if (state.lobbyCountdownEndTime) {
            handleLobbyCountdownStarted({ roomId: props.gameId, endTime: state.lobbyCountdownEndTime });
          }
        }
        
        // +++ NEU: Setze den Spieler beim Beitritt explizit auf "nicht bereit" +++
        console.log("[WaitingRoom] Setze initialen Ready-Status auf 'false' auf dem Server.");
        socket.emit('player:setReadyStatus', { roomId: props.gameId, isReady: false }, (statusResponse) => {
            if (statusResponse && statusResponse.success) {
                // Aktualisiere den lokalen Status basierend auf der Bestätigung des Servers
                myReadyStatus.value = statusResponse.currentReadyStatus; // Sollte 'false' sein
            }
        });
        // +++ ENDE NEU +++

      } else {
        statusMessage.value = `Beitritt fehlgeschlagen: ${response.error || 'Unbekannter Fehler'}`;
        gameIsOver.value = true;
      }
    });
  } else {
      isJoining.value = false;
      statusMessage.value = 'Fehler: Keine Raum-ID gefunden.';
      gameIsOver.value = true;
  }
  
  await nextTick();
  if (containerRef.value) {
    updateBubblePositions();
    animationFrameId = requestAnimationFrame(updateBubblePositions);
  }
});
onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  if(localCountdownIntervalId) clearInterval(localCountdownIntervalId);
  socket.off('gameUpdate', handleGameUpdate);
  socket.off('goToGame', handleGoToGame);
  socket.off('gameEnded');
  socket.off('gameCancelled');
  socket.off('gameNotFound', handleGameNotFound);
  socket.off('lobby:countdownStarted', handleLobbyCountdownStarted);
  socket.off('lobby:countdownCancelled', handleLobbyCountdownCancelled);
  document.body.style.backgroundColor = '';
  document.body.style.transition = '';
});

function toggleReadyStatus() {
  if (isJoining.value || isTogglingReady.value) return;

  isTogglingReady.value = true;
  const newReadyState = !myReadyStatus.value;
  socket.emit('player:setReadyStatus', { roomId: props.gameId, isReady: newReadyState }, (response) => {
    isTogglingReady.value = false;
    if (response && response.success) {
      myReadyStatus.value = response.currentReadyStatus;
    } else {
      statusMessage.value = `Fehler: ${response?.error || 'Status konnte nicht gesetzt werden.'}`;
    }
    updateBubbleDynamicStyles();
  });
}

function triggerLeaveGame() {
  if (!gameIsOver.value) {
    socket.emit('leaveGame', { gameId: props.gameId });
  }
  router.push('/');
}
</script>

<style scoped>
.waiting-room-app-container {
  width: 100%;
  min-height: 100vh;
  padding: 1rem 1.5rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  position: relative; 
  overflow: hidden;
  font-family: 'Baloo 2', cursive, 'Arial Rounded MT Bold', sans-serif;
  color: white; 
  box-sizing: border-box;
  background-color: var(--bg-color, #cfcfcf);
  transition: background-color 0.5s ease-out;
}

.room-title-main {
  position: absolute;
  top: 25px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 2.2em;
  font-weight: 700; 
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 3px 6px rgba(0,0,0,0.35);
  margin: 0;
  z-index: 10;
  letter-spacing: 1px;
}

@media (max-width: 480px) {
  .room-title-main {
    font-size: 1.6em;
    top: 15px;
  }
}

.bubble-base { 
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  background-color: transparent; 
  border-radius: 50%; 
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  color: #fff; 
  font-weight: 600;
  transition: transform 0.15s ease-out, filter 0.15s ease-out;
  padding: 10px; 
  box-sizing: border-box;
  border: none;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5); 
  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2)) brightness(1.1);
}

.ready-bubble-button, .leave-bubble-button, .player-count-bubble {
  position: absolute; /* Bubbles werden jetzt absolut positioniert */
}

.ready-bubble-button, .leave-bubble-button {
  cursor: pointer; 
  user-select: none;
}
.ready-bubble-button:hover:not(:disabled), .leave-bubble-button:hover:not(:disabled) {
  transform: scale(1.08) translateY(-3px);
  filter: brightness(1.15) drop-shadow(0 6px 12px rgba(0,0,0,0.3));
}
.ready-bubble-button:active:not(:disabled), .leave-bubble-button:active:not(:disabled) {
  transform: scale(1.02) translateY(0px);
  filter: brightness(0.95) drop-shadow(0 2px 4px rgba(0,0,0,0.2));
}
.ready-bubble-button:disabled {
  filter: grayscale(60%) opacity(0.6) drop-shadow(0 4px 8px rgba(0,0,0,0.2));
  cursor: not-allowed;
}

.bubble-text {
  font-size: 1em; 
  line-height: 1.2;
}
.bubble-text-prominent {
  font-size: 1.3em;
  display: block; 
}

.player-count-bubble .bubble-text { font-size: 0.8em; }
.player-count-bubble .bubble-text-prominent { font-size: 1.4em; }

.countdown-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: var(--accent1, rgba(255, 255, 255, 0.2));
  color: white;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%; 
  font-size: 2em;
  font-weight: bold;
  backdrop-filter: blur(3px);
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
}

.ready-bubble-button .bubble-text { font-size: 1.3em; }
.leave-bubble-button .bubble-text { font-size: 1em; }

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
  box-shadow: 0 4px 10px rgba(0,0,0,0.25);
  z-index: 100;
  max-width: 80%;
  text-align: center;
}

.game-over-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background-color: rgba(0,0,0,0.7);
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
  color: var(--accent3, white);
  margin: 0;
}
.back-to-join-bubble-gameover {
  position: static; width: auto; height: auto;
  padding: 15px 30px;
  border-radius: 30px;
  margin-top: 15px;
  background-image: url('@/assets/bubble-blue.png');
  color: white;
  cursor: pointer;
  font-weight: 600;
  font-size: 1.1em;
  text-decoration: none;
}
.back-to-join-bubble-gameover:hover {
    transform: scale(1.05);
}
</style>