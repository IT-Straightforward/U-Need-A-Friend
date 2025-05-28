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
      :disabled="isTogglingReady || countdownTime !== null" 
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
      :disabled="countdownTime !== null && !gameIsOver"
      :style="bubbles.leaveButton.style">
      <span class="bubble-text">Verlassen</span>
    </button>

    <div v-if="statusMessage && countdownTime === null && !gameIsOver" class="floating-status-message">
      {{ statusMessage }}
    </div>

    <div v-if="gameIsOver" class="game-over-overlay">
      <p class="game-over-text">{{ statusMessage }}</p>
      <router-link to="/join" class="bubble-base back-to-join-bubble-gameover">Zurück</router-link>
    </div>
  </div>
</template>

<script setup>
// In U-Need-A-Friend/src/components/WaitingRoom.vue
import { ref, reactive, onMounted, onUnmounted, computed, nextTick, inject } from 'vue'; // <<< 'inject' HINZUGEFÜGT
import { useRouter } from 'vue-router';


const props = defineProps({
  gameId: { // Dies ist die roomId
    type: String,
    required: true
  }
});

const socket = inject('socket');
const router = useRouter();

// Refs für den Client-Zustand
const players = ref([]);
const ownSocketId = ref('');
const roomDisplayName = ref(''); 
const roomPastelColor = ref('#E0F7FA'); // Standard-Pastellfarbe
const maxPlayersInRoom = ref(null); 
const statusMessage = ref('Warteraum wird geladen...');
const gameIsOver = ref(false);
const myReadyStatus = ref(false); 
const isTogglingReady = ref(false); 
const countdownTime = ref(null); 
const countdownEndTime = ref(null);
let localCountdownIntervalId = null;
let animationFrameId = null;

// --- Bubble Animations-Setup ---
const containerRef = ref(null); // Ref für den Hauptcontainer

// Reaktives Objekt für die Eigenschaften und Styles der Bubbles
// WICHTIG: Passe die `imagePath` hier an deine tatsächlichen Bildpfade an!
// Vite Aliase wie '@/' funktionieren hier direkt im String nicht, wenn sie nicht speziell aufgelöst werden.
// Am sichersten ist es, die Bilder im `public` Ordner zu haben und mit `/bild.png` zu referenzieren,
// oder den Import-Mechanismus für Assets zu nutzen, wenn sie in `src/assets` sind (siehe CSS unten).
// Für dieses Beispiel gehe ich davon aus, die Bilder sind im `public` Ordner oder werden korrekt aufgelöst.
// Alternativ kann man die background-image Eigenschaft direkt im :style setzen oder CSS-Klassen verwenden.

const bubbles = reactive({
  playerCount: { x: 200, y: 50, vx: 0.25, vy: 0.35, width: 100, height: 100, imagePath: '/src/assets/bubble-blue.png', style: {} }, 
  readyButton: { x: 50, y: 120, vx: -0.3, vy: 0.25, width: 170, height: 170, imagePath: '/src/assets/bubble-green.png', readyImagePath: '/src/assets/bubble-yellow.png', style: {} },
  leaveButton: { x: 100, y: 250, vx: 0.2, vy: -0.3, width: 120, height: 120, imagePath: '/src/assets/bubble-red.png', style: {} }
});

// Funktion, um die Inline-Styles für jede Bubble zu generieren
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
      backgroundImage: `url(${currentImage})`, // Pfad zum Bild
    };
  }
}

const computedRoomStyle = computed(() => ({
  backgroundColor: roomPastelColor.value,
  minHeight: '100vh', 
  width: '100%',
  position: 'relative', 
  overflow: 'hidden',
}));

function updateBubblePositions() {
  if (!containerRef.value) return;

  const containerWidth = containerRef.value.clientWidth;
  const containerHeight = containerRef.value.clientHeight;

  for (const key in bubbles) {
    const bubble = bubbles[key];

    bubble.x += bubble.vx;
    bubble.y += bubble.vy;

    // Kollision und Abprallen
    if (bubble.x + bubble.width > containerWidth) {
      bubble.x = containerWidth - bubble.width;
      bubble.vx *= -1;
    } else if (bubble.x < 0) {
      bubble.x = 0;
      bubble.vx *= -1;
    }

    if (bubble.y + bubble.height > containerHeight) {
      bubble.y = containerHeight - bubble.height;
      bubble.vy *= -1;
    } else if (bubble.y < 0) {
      bubble.y = 0;
      bubble.vy *= -1;
    }
  }
  updateBubbleDynamicStyles(); // Aktualisiere die Inline-Styles nach Positionsänderung
  animationFrameId = requestAnimationFrame(updateBubblePositions);
}

// --- Socket Event Handler (Logik wie zuvor) ---
const handleGameUpdate = (data) => { /* ... wie zuvor, setzt roomPastelColor, maxPlayersInRoom etc. ... */ 
  if (data.gameId === props.gameId) {
    players.value = data.players || [];
    if (data.roomName) roomDisplayName.value = data.roomName;
    if (data.pastelColor) roomPastelColor.value = data.pastelColor;
    if (data.maxPlayers !== undefined) maxPlayersInRoom.value = data.maxPlayers;
    const me = players.value.find(p => p.id === ownSocketId.value);
    if (me) myReadyStatus.value = me.isReadyInLobby;
    if (countdownTime.value === null && !gameIsOver.value) {
        if (data.message) statusMessage.value = data.message;
        else { /* Status basierend auf Spieler/Ready-Status */ }
    }
    updateBubbleDynamicStyles(); // Wichtig, um z.B. das Bild des Ready-Buttons zu ändern
  }
};
const handleGoToGame = (data) => { /* ... wie zuvor ... */ 
  if (data.gameId === props.gameId) {
    if(localCountdownIntervalId) clearInterval(localCountdownIntervalId); 
    countdownTime.value = null;
    router.push(`/game/${props.gameId}`);
  }
};
const handleLobbyCountdownStarted = (data) => { /* ... wie zuvor ... */ 
  if (data.roomId === props.gameId) {
    countdownEndTime.value = data.endTime;
    countdownTime.value = data.duration;
    statusMessage.value = ""; 
    if(localCountdownIntervalId) clearInterval(localCountdownIntervalId);
    localCountdownIntervalId = setInterval(() => {
      if (countdownEndTime.value === null) { clearInterval(localCountdownIntervalId); localCountdownIntervalId = null; return; }
      const remaining = Math.max(0, Math.round((countdownEndTime.value - Date.now()) / 1000));
      countdownTime.value = remaining;
      if (remaining <= 0) { clearInterval(localCountdownIntervalId); localCountdownIntervalId = null; }
    }, 1000);
  }
};
const handleLobbyCountdownCancelled = (data) => { /* ... wie zuvor ... */ 
  if (data.roomId === props.gameId) {
    if(localCountdownIntervalId) clearInterval(localCountdownIntervalId);
    localCountdownIntervalId = null; countdownTime.value = null; countdownEndTime.value = null;
    statusMessage.value = data.message || 'Countdown abgebrochen.';
  }
};
const handleGameCancelledOrEnded = (data, type = "ended") => { /* ... wie zuvor ... */ 
  let msg = '';
  if (type === "cancelled") msg = data.message || 'Das Spiel wurde abgebrochen.';
  else msg = `Sitzung beendet: ${data.message || data.reason}`;
  if (!data.gameId || data.gameId === props.gameId) {
    if(localCountdownIntervalId) clearInterval(localCountdownIntervalId);
    countdownTime.value = null; statusMessage.value = msg; gameIsOver.value = true;
  }
};
const handleGameNotFound = (data) => { /* ... wie zuvor ... */ 
  statusMessage.value = data.message || `Raum ${props.gameId} nicht gefunden oder inaktiv.`;
  gameIsOver.value = true;
};


onMounted(async () => {
  ownSocketId.value = socket.id;
  // ... (socket.on Handler registrieren wie zuvor) ...
  socket.on('gameUpdate', handleGameUpdate);
  socket.on('goToGame', handleGoToGame);
  socket.on('gameCancelled', (data) => handleGameCancelledOrEnded(data, "cancelled"));
  socket.on('gameEnded', (data) => handleGameCancelledOrEnded(data, "ended"));
  socket.on('gameNotFound', handleGameNotFound);
  socket.on('lobby:countdownStarted', handleLobbyCountdownStarted);
  socket.on('lobby:countdownCancelled', handleLobbyCountdownCancelled);

  socket.emit('requestInitialLobbyState', { gameId: props.gameId }); 

  await nextTick(); // Stellt sicher, dass das DOM gerendert wurde
  if (containerRef.value) {
    // Initiale Positionen etwas zufälliger im Container verteilen
    const cWidth = containerRef.value.clientWidth;
    const cHeight = containerRef.value.clientHeight;

    bubbles.playerCount.x = cWidth * 0.7 - bubbles.playerCount.width / 2;
    bubbles.playerCount.y = cHeight * 0.2 - bubbles.playerCount.height / 2;

    bubbles.readyButton.x = cWidth / 2 - bubbles.readyButton.width / 2;
    bubbles.readyButton.y = cHeight / 2 - bubbles.readyButton.height / 2;
    
    bubbles.leaveButton.x = cWidth / 2 - bubbles.leaveButton.width / 2;
    bubbles.leaveButton.y = cHeight * 0.8 - bubbles.leaveButton.height / 2;
    
    updateBubbleDynamicStyles(); // Initiale Styles setzen
    animationFrameId = requestAnimationFrame(updateBubblePositions);
  }
});

onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  if(localCountdownIntervalId) clearInterval(localCountdownIntervalId);
  // ... (socket.off für alle Handler) ...
  socket.off('gameUpdate', handleGameUpdate);
  socket.off('goToGame', handleGoToGame);
  socket.off('gameCancelled'); 
  socket.off('gameEnded');
  socket.off('gameNotFound', handleGameNotFound);
  socket.off('lobby:countdownStarted', handleLobbyCountdownStarted);
  socket.off('lobby:countdownCancelled', handleLobbyCountdownCancelled);
});

function toggleReadyStatus() {
  if (isTogglingReady.value || countdownTime.value !== null) return;
  isTogglingReady.value = true;
  const newReadyState = !myReadyStatus.value;
  socket.emit('player:setReadyStatus', { roomId: props.gameId, isReady: newReadyState }, (response) => {
    isTogglingReady.value = false;
    if (response && response.success) { 
        // myReadyStatus wird durch 'gameUpdate' aktualisiert
        // Hier könnte ein direktes UI-Feedback für den Klicker erfolgen, wenn gewünscht
    } else { 
      statusMessage.value = `Fehler: ${response?.error || 'Status konnte nicht gesetzt werden.'}`; 
    }
    updateBubbleDynamicStyles(); // Um ggf. Bild des Ready-Buttons zu aktualisieren
  });
}

function triggerLeaveGame() {
  if (!gameIsOver.value) {
    if(localCountdownIntervalId) clearInterval(localCountdownIntervalId); 
    countdownTime.value = null;
    socket.emit('leaveGame', { gameId: props.gameId });
  }
  router.push('/join'); 
}
</script>

<style scoped>
.waiting-room-app-container {
  width: 100%;
  min-height: 100vh;
  padding: 0;
  display: block; 
  position: relative; 
  overflow: hidden; /* Wichtig, damit Bubbles nicht rausragen */
  font-family: 'Baloo 2', cursive, 'Arial Rounded MT Bold', sans-serif; /* Freundliche, runde Schrift */
  color: white; 
  box-sizing: border-box;
  transition: background-color 0.5s ease-out;
}

.room-title-main {
  position: absolute;
  top: 25px; /* Etwas tiefer */
  left: 50%;
  transform: translateX(-50%);
  font-size: 2.8em;
  font-weight: 700; /* Etwas dicker */
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 3px 6px rgba(0,0,0,0.35);
  margin: 0;
  z-index: 10;
  letter-spacing: 1px;
}

.bubble-base { /* Gemeinsame Klasse für alle Bubbles */
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  background-color: transparent; /* Wichtig für PNGs */
  
  border-radius: 50%; /* Für den Fall, dass PNG nicht perfekt rund oder als Fallback */
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  color: #fff; /* Heller Text für dunklere Bubbles oder Text auf dem PNG anpassen */
  font-weight: 600; /* Angepasst */
  transition: transform 0.15s ease-out;
  padding: 10px; 
  box-sizing: border-box;
  border: none;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5); /* Textschatten für Lesbarkeit auf Bubble */
  /* Filter für leichten Glanz-Effekt, kann mit PNGs interferieren oder gut aussehen */
  /* filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2)) brightness(1.1); */
}

.bubble-button { /* Spezifisch für klickbare Bubbles */
  cursor: pointer; 
  user-select: none;
}
.bubble-button:hover:not(:disabled) {
  transform: scale(1.08) translateY(-3px); /* Stärkerer Hover */
  filter: brightness(1.15); /* Heller bei Hover */
}
.bubble-button:active:not(:disabled) {
  transform: scale(1.02) translateY(0px);
  filter: brightness(0.95);
}
.bubble-button:disabled {
  filter: grayscale(60%) opacity(0.6); /* PNG wird grauer und durchsichtiger */
  cursor: not-allowed;
}

.bubble-text {
  font-size: 1em; 
  line-height: 1.2;
}
.bubble-text-prominent {
  font-size: 1.3em; /* Etwas kleiner für Info-Bubble */
  display: block; 
}

.player-count-bubble .bubble-text { font-size: 0.8em; }
.player-count-bubble .bubble-text-prominent { font-size: 1.4em; }

.countdown-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(255, 255, 255, 0.2); /* Heller, transparenter Overlay */
  color: white;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%; 
  font-size: 2em; /* Größer für Countdown */
  font-weight: bold;
  backdrop-filter: blur(3px); /* Stärkerer Blur für Lesbarkeit */
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
}

.ready-bubble-button .bubble-text { font-size: 1.3em; } /* Größerer Text für Hauptaktion */
.leave-bubble-button .bubble-text { font-size: 1em; }

.floating-status-message {
  position: fixed; /* Fixed, damit es auch bei Scroll (falls doch mal) bleibt */
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(44, 62, 80, 0.85); /* Dunkleres Blau/Grau */
  color: white;
  padding: 12px 22px;
  border-radius: 25px; /* Bubble-Form */
  font-size: 0.95em;
  box-shadow: 0 4px 10px rgba(0,0,0,0.25);
  z-index: 100; /* Über allem */
  max-width: 80%;
  text-align: center;
}

.game-over-overlay { /* ... (wie zuletzt) ... */ }
.game-over-text { /* ... (wie zuletzt) ... */ }
.back-to-join-bubble-gameover { /* ... (wie zuletzt, ggf. PNG anwenden) ... */
  /* Erbt von .bubble-base, aber ist kein .bubble-button per se mehr */
  position: static; width: auto; height: auto;
  padding: 15px 30px; /* Größerer Padding */
  border-radius: 30px; /* Stärkere Rundung */
  margin-top: 15px;
  background-image: url('/src/assets/bubble-blue.png'); /* Beispiel für Button-PNG */
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