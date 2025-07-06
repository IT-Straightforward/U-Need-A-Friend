<template>
  <main class="mobile-container" :style="computedContainerStyle">
    
  
    <div class="device-box">
      <div class="card-grid">
        <div
          v-for="(card, index) in playerBoard"
          :key="`card-${index}`"
          class="card-container"
          @click="handleCardFlip(card, index)"
        >
          <div class="card-inner" :class="{ 'is-flipped': card.isFlipped || card.isMatched }">
            <div class="card-face card-back">
              </div>
            <div class="card-face card-front">
              <GameIcon
                v-if="card.symbol"
                :iconName="card.symbol"
                :themeFolder="currentThemeFolder"
              />
            </div>
          </div>
        </div>
      </div>
      <button v-if="!gameIsEffectivelyOver" class="leave-btn" @click="triggerLeaveGame">
        Leave Game
      </button>
      <router-link v-else to="/" class="leave-btn router-link-btn">
        Back to Start
      </router-link>
    </div>

  </main>
</template>
<script setup>
import { ref, inject, onMounted, onUnmounted, computed, watch } from "vue";
import GameIcon from "./GameIcon.vue";
import { useRouter } from "vue-router";
import { useGameSessionStore } from "@/stores/gameSessionStore";
import { storeToRefs } from "pinia";

const props = defineProps({
  gameId: { type: String, required: true },
});

const socket = inject("socket");
const router = useRouter();
const gameSessionStore = useGameSessionStore();
const { currentThemeFolder } = storeToRefs(gameSessionStore);

// --- NEUER ZUSTAND für das Memory-Spiel ---
const playerBoard = ref([]); // Das 3x3-Board des Spielers, Format: [{ symbol, isFlipped, isMatched }]
const matchedSymbols = ref([]); // Die oben in der Leiste gezeigten, gefundenen Symbole
const turnNumber = ref(0);
const canFlipCard = ref(false); // Kontrolliert, ob der Spieler eine Karte umdrehen darf

const gameMessage = ref("Initializing game connection...");
const isErrorMessage = ref(false);
const gameIsEffectivelyOver = ref(false);

// --- Computed Properties & Styles (bleiben größtenteils gleich) ---
const roomBgColor = ref("#fafafa");
const roomPrimaryColor = ref("#e0e0e0");
const computedContainerStyle = computed(() => ({
  "--bg-color": roomBgColor.value,
  "--primary-color": roomPrimaryColor.value,
}));
watch(roomBgColor, (newColor) => {
    if (newColor) {
      document.body.style.backgroundColor = newColor;
      document.body.style.transition = "background-color 0.5s ease";
    }
  },
  { immediate: true });
  watch(playerBoard, (newBoard) => {
    // Wenn das Board aktualisiert wird, stelle sicher, dass alle Karten korrekt initialisiert sind
    console.log("[Game.vue] Player board updated:", newBoard);
    newBoard.forEach(card => {
      card.isFlipped = false;
      card.isMatched = false;
    });
  }, { immediate: true }
);


// --- NEUE SOCKET EVENT HANDLER ---

const handleGameInitialized = (data) => {
  console.log("[Game.vue] Spiel initialisiert:", data);
  if (data.gameId !== props.gameId) return;
   if (data.themeFolder) {
    gameSessionStore.setCurrentThemeFolder(data.themeFolder);
  }
  playerBoard.value = data.playerBoard;
  matchedSymbols.value = data.matchedSymbols || [];
  gameIsEffectivelyOver.value = false;

  if (data.pastelPalette) {
    roomBgColor.value = data.pastelPalette.primary;
    roomPrimaryColor.value = data.pastelPalette.accent3;
  }
};

const handleTurnBegan = (data) => {
  turnNumber.value = data.turnNumber;
  playerBoard.value.forEach(card => {
    if (!card.isMatched) {
      card.isFlipped = false;
    }
  });

  canFlipCard.value = true; 
};

const handleTurnSuccess = (data) => {
  const matchedCard = playerBoard.value.find(c => c.symbol === data.symbol);
  if (matchedCard) {
    matchedCard.isMatched = true;
  }
};

const handleTurnFail = (data) => {

};

const handleTurnWasReset = (data) => {

  canFlipCard.value = false;
};

const handleGameEnded = (data) => {
  gameIsEffectivelyOver.value = true;
  canFlipCard.value = false;
};

const handleGameError = (data) => {
  gameIsEffectivelyOver.value = true;
};


// --- METHODEN ---

function handleCardFlip(card, index) {
  if (!canFlipCard.value || card.isFlipped || card.isMatched) {
    return; 
  }

  card.isFlipped = true;
  canFlipCard.value = false; 

  socket.emit("playerFlippedCard", {
    gameId: props.gameId,
    cardIndex: index,
    symbol: card.symbol,
  });
}

function triggerLeaveGame() {
  if (!gameIsEffectivelyOver.value) {
    socket.emit("leaveGame", { gameId: props.gameId });
  }
  router.replace("/");
}


// --- LIFECYCLE & SOCKET SETUP ---


onMounted(() => {
  socket.on("gameInitialized", handleGameInitialized);
  socket.on("turnBegan", handleTurnBegan);
  socket.on("turnSuccess", handleTurnSuccess);
  socket.on("turnFail", handleTurnFail);
  socket.on("turnWasReset", handleTurnWasReset);
  socket.on("gameEnded", handleGameEnded);
  socket.on("gameError", handleGameError);

  const persistentPlayerId = sessionStorage.getItem("myGamePlayerId");
  if (!persistentPlayerId) {
    router.replace("/");
    return;
  }

  socket.emit("joinGame", {
      roomId: props.gameId,
      persistentPlayerId: persistentPlayerId,
    },
    (response) => {
      if (response && response.success) {
        console.log("[Game.vue] Join/Reconnect zur Spiel-Session erfolgreich.");
        
  
        socket.emit('playerReadyForGame', { gameId: props.gameId });
        
      } else {
        alert("Konnte nicht wieder mit dem Spiel verbinden. Es wurde möglicherweise beendet.");
        router.replace("/");
      }
    }
  );
});

onUnmounted(() => {
  // Räume die neuen Listener auf
  socket.off("gameInitialized", handleGameInitialized);
  socket.off("turnBegan", handleTurnBegan);
  socket.off("turnSuccess", handleTurnSuccess);
  socket.off("turnFail", handleTurnFail);
  socket.off("turnWasReset", handleTurnWasReset);
  socket.off("gameEnded", handleGameEnded);
  socket.off("gameError", handleGameError);

  document.body.style.backgroundColor = "";
  document.body.style.transition = "";
});
</script>

<style scoped>
/* --- Haupt-Layout --- */
.mobile-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 100dvh;
  background: var(--bg-color, #fafafa);
  padding: 1rem;
  box-sizing: border-box;
  font-family: "Helvetica Neue", sans-serif;
  gap: 1rem;
  transition: background 0.5s ease;
}

/* --- Haupt-Box & Karten-Grid --- */
.device-box {
  background: var(--primary-color, #f0f0f0);
  width: 100%;
  max-width: 380px;
  border-radius: 32px;
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.15);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  box-sizing: border-box;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  width: 100%;
}

/* --- Karten-Styling (3D Flip Animation) --- */
.card-container {
  aspect-ratio: 1 / 1;
  perspective: 1000px;
  cursor: pointer;
}

.card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  transition: transform 0.6s;
  transform-style: preserve-3d;
  border-radius: 12px;
}

.card-container:hover .card-inner:not(.is-flipped) {
  transform: translateY(-5px);
}

.card-inner.is-flipped {
  transform: rotateY(180deg);
}

.card-face {
  position: absolute;
  width: 100%;
  height: 100%;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 12px;
  font-size: 2rem;
}

.card-back {
  background-color: #5cb85c;
  border: 4px solid white;
  box-sizing: border-box;
}
.card-back::after {
  content: '?';
  color: white;
  font-weight: bold;
  font-size: 2em;
}

.card-front {
  background-color: #f0f8ff;
  transform: rotateY(180deg);
}
.card-front .game-png-icon {
  max-width: 75%;
  max-height: 75%;
}

/* --- Nachrichten und Buttons --- */
.leave-btn {
  background: #d9534f;
  color: white;
  font-size: 1rem;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 12px;
  margin-top: auto;
  width: 100%;
  cursor: pointer;
  text-decoration: none;
  display: inline-block;
  text-align: center;
  box-sizing: border-box;
}
</style>
