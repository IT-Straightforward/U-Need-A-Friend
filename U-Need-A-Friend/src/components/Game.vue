<template>
  <main class="mobile-container" :style="computedContainerStyle">
    <div class="collected-pieces-container">
      <div v-for="n in 4" :key="`piece-slot-${n}`" class="piece-slot">
        <GameIcon
          v-if="collectedPieces[n - 1]"
          :iconName="collectedPieces[n - 1]"
          :themeFolder="currentThemeFolder"
        />
        <span v-else class="placeholder-icon">?</span>
      </div>
    </div>

    <div class="device-box">
      <div class="display-area" :class="{ 'is-piece-round': isPieceRound }">
        <span class="display-symbol">
          <template
            v-if="
              roleInCurrentRound === 'source' && currentTargetSymbolForRound
            "
          >
            <GameIcon
              :iconName="currentTargetSymbolForRound"
              :themeFolder="currentThemeFolder"
            />
          </template>
          <div v-else class="dots-animation-container">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
        </span>
      </div>

      <div class="button-grid">
        <button
          v-for="(iconId, i) in playerButtons"
          :key="`button-${i}`"
          class="button"
          :class="{
            correct:
              feedbackState === 'correct' && lastCorrectSymbol === iconId,
            incorrect:
              feedbackState === 'incorrect' && lastPressedSymbol === iconId,
          }"
          @click="handlePress(iconId)"
          :disabled="gameIsEffectivelyOver"
        >
          <GameIcon
            v-if="iconId"
            :iconName="iconId"
            :themeFolder="currentThemeFolder"
          />
          <span v-else>?</span>
        </button>
      </div>

      <p
        v-if="gameMessage"
        class="game-message"
        :class="{ error: isErrorMessage }"
      >
        {{ gameMessage }}
      </p>
      <button
        v-if="!gameIsEffectivelyOver"
        class="leave-btn"
        @click="triggerLeaveGame"
      >
        Leave Game
      </button>
      <router-link v-else to="/" class="leave-btn router-link-btn"
        >Back to Start</router-link
      >
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

// --- Zustand für UI und Spiellogik ---
const socketListenersInitialized = ref(false);
const ownPlayerId = ref("");
const playerButtons = ref([]);
const currentTargetSymbolForRound = ref("");
const roleInCurrentRound = ref("inactive");
const gameMessage = ref("Initializing game connection...");
const isErrorMessage = ref(false);
const feedbackState = ref("");
const lastPressedSymbol = ref("");
const lastCorrectSymbol = ref("");
const gameIsEffectivelyOver = ref(false);
const collectedPieces = ref([]);
const isPieceRound = ref(false);
const roomBgColor = ref("#fafafa");
const roomPrimaryColor = ref("#e0e0e0");
const roomAccent1 = ref("#5cb85c");
const roomAccent2 = ref("#d9534f");

const computedContainerStyle = computed(() => ({
  "--bg-color": roomBgColor.value,
  "--primary-color": roomPrimaryColor.value,
  "--accent-color-1": roomAccent1.value,
  "--accent-color-2": roomAccent2.value,
}));
watch(
  roomBgColor,
  (newColor) => {
    if (newColor) {
      document.body.style.backgroundColor = newColor;
      // Fügt auch einen sanften Übergang hinzu
      document.body.style.transition = "background-color 0.5s ease";
    }
  },
  { immediate: true }
);

// --- Socket Event Handler ---
const handleTeamAwardedPiece = (data) => {
  if (data.gameId === props.gameId && data.pieceIcon) {
    collectedPieces.value.push(data.pieceIcon);
    gameMessage.value = `Your team won a piece!`;
    setTimeout(() => {
      gameMessage.value = `Round ${data.currentRoundNumber || ""}`;
    }, 3000);
  }
};

const handleTeamLostPiece = (data) => {
  if (data.gameId === props.gameId) {
    console.log("Team lost a piece. Updating UI.");
    collectedPieces.value = data.remainingPieces || [];
  }
};

const handleGameStarted = (data) => {
  if (data.gameId !== props.gameId) return;
  ownPlayerId.value = data.playerId;
  playerButtons.value = data.buttons || [];
  collectedPieces.value = data.initialPieces || [];
  gameMessage.value = "Game setup complete! Waiting for the first round.";
  isErrorMessage.value = false;
  gameIsEffectivelyOver.value = false;

  if (data.pastelPalette) {
    roomBgColor.value = data.pastelPalette.primary;
    roomPrimaryColor.value = data.pastelPalette.accent3;
    roomAccent1.value = data.pastelPalette.accent2;
    roomAccent2.value = data.pastelPalette.accent1;
  }
};

// In Game.vue -> <script setup>

const handleRoundUpdate = (data) => {
  // Setze zuerst immer den Zustand für eine neue Runde zurück
  feedbackState.value = '';
  lastPressedSymbol.value = '';
  lastCorrectSymbol.value = '';
  isErrorMessage.value = false;
  gameIsEffectivelyOver.value = false;
  
  // Übernehme die allgemeinen Runden-Informationen
  currentTargetSymbolForRound.value = data.currentTargetSymbol;
  isPieceRound.value = data.isPieceRound || false;
  const roundNumber = data.roundNumber || '';

  // +++ NEUE, INTELLIGENTE ROLLENZUWEISUNG +++
  // Fall 1: Der Server sendet die Rolle direkt mit (normaler Rundenwechsel)
  if (data.role) {
    roleInCurrentRound.value = data.role;
  } 
  // Fall 2: Die Rolle fehlt (passiert bei einem Reconnect), also leiten wir sie selbst ab
  else if (data.sourceId && data.targetId) {
    if (ownPlayerId.value === data.sourceId) {
      roleInCurrentRound.value = 'source';
    } else if (ownPlayerId.value === data.targetId) {
      roleInCurrentRound.value = 'target';
    } else {
      roleInCurrentRound.value = 'inactive';
    }
  } else {
    // Fallback, falls keine Rolleninformationen vorhanden sind
    roleInCurrentRound.value = 'inactive';
  }
  
  // Passe die Spielnachricht basierend auf der Bonusrunde an
  if (isPieceRound.value) {
    gameMessage.value = `Runde ${roundNumber} - Chance auf ein Teil!`;
  } else {
    gameMessage.value = `Runde ${roundNumber}`;
  }
};

const handleFeedback = (data) => {
  if (data.correct) {
    feedbackState.value = "correct";
    if (roleInCurrentRound.value === "target") {
      lastCorrectSymbol.value = currentTargetSymbolForRound.value;
    }
    gameMessage.value = data.message || "Correct!";
  } else {
    feedbackState.value = "incorrect";
    gameMessage.value = data.message || "Incorrect or not your turn!";
  }
  isErrorMessage.value = !data.correct;
};

const handleGameEnded = (data) => {
  gameMessage.value = `Game Over: ${data.message || data.reason}`;
  isErrorMessage.value = true;
  gameIsEffectivelyOver.value = true;
  roleInCurrentRound.value = "inactive";
};

// GEÄNDERT: Die Nachricht ist jetzt anonym, da playerName nicht mehr gesendet wird.
const handlePlayerLeftMidGame = (data) => {
  if (data.playerId !== ownPlayerId.value) {
    gameMessage.value = `A Player left the game.`;
    isErrorMessage.value = false;
  }
};

const handleGameError = (data) => {
  gameMessage.value = `Error: ${
    data.message || "An unknown game error occurred."
  }`;
  isErrorMessage.value = true;
  gameIsEffectivelyOver.value = true;
};

const initializeSocketListeners = () => {
  if (socketListenersInitialized.value) return;
  socket.on("gameStarted", handleGameStarted);
  socket.on("roundUpdate", handleRoundUpdate);
  socket.on("feedback", handleFeedback);
  socket.on("gameEnded", handleGameEnded);
  socket.on("playerLeftMidGame", handlePlayerLeftMidGame);
  socket.on("gameError", handleGameError);
  socket.on("teamAwardedPiece", handleTeamAwardedPiece);
  socket.on("teamLostPiece", handleTeamLostPiece);
  socketListenersInitialized.value = true;
};

const cleanupSocketListeners = () => {
  socket.off("gameStarted", handleGameStarted);
  socket.off("roundUpdate", handleRoundUpdate);
  socket.off("feedback", handleFeedback);
  socket.off("gameEnded", handleGameEnded);
  socket.off("playerLeftMidGame", handlePlayerLeftMidGame);
  socket.off("gameError", handleGameError);
  socket.off("teamAwardedPiece", handleTeamAwardedPiece);
  socket.off("teamLostPiece", handleTeamLostPiece);
  socketListenersInitialized.value = false;
};

// In Game.vue -> <script setup>

onMounted(() => {
  initializeSocketListeners(); // Listener wie gehabt initialisieren

  if (props.gameId) {
    // Hole die beständige Spieler-ID aus dem Speicher
    const persistentPlayerId = sessionStorage.getItem("myGamePlayerId");
    console.log(
      `[Game.vue] LESE persistent ID aus sessionStorage: ${persistentPlayerId}`
    );
    // Wenn keine ID da ist, kann der Spieler nicht im Spiel sein. Zurück zur Startseite.
    if (!persistentPlayerId) {
      console.error(
        "[Game.vue] No persistent player ID found. Cannot rejoin game directly. Redirecting to home."
      );
      router.replace("/");
      return;
    }

    // Sende das joinGame-Event, um dich wieder mit dem Spiel zu verbinden
    console.log(`[Game.vue] Attempting to reconnect to game ${props.gameId}`);
    socket.emit(
      "joinGame",
      {
        roomId: props.gameId,
        persistentPlayerId: persistentPlayerId,
      },
      (response) => {
        if (response && response.success) {
          console.log("[Game.vue] Reconnect successful.");

          // Wenn der Server den Spielstand mitschickt, lade ihn, um die UI wiederherzustellen
          if (response.gameState) {
            // Wir verwenden die handleGameStarted-Funktion, um den Basiszustand zu setzen
            handleGameStarted(response.gameState);

            // Wenn das Spiel schon lief, auch den Rundenstatus wiederherstellen
            if (response.gameState.currentRound) {
              handleRoundUpdate(response.gameState.currentRound);
            }
          }

          // Melde dem Server, dass dieses Frontend jetzt bereit für weitere Events ist
          socket.emit("playerReadyForGame", { gameId: props.gameId });
        } else {
          // Wiederverbindung fehlgeschlagen (z.B. Spiel wurde inzwischen beendet)
          console.error("Failed to reconnect:", response.error);
          alert(
            "Konnte nicht wieder mit dem Spiel verbinden. Es wurde möglicherweise beendet."
          );
          router.replace("/");
        }
      }
    );
  } else {
    console.error(`[Game.vue MOUNTED] gameId prop is missing! Redirecting.`);
    router.replace("/");
  }
});

onUnmounted(() => {
  cleanupSocketListeners();

  document.body.style.backgroundColor = "";
  document.body.style.transition = "";
});

function handlePress(pressedSymbol) {
  if (gameIsEffectivelyOver.value) return;
  lastPressedSymbol.value = pressedSymbol;
  socket.emit("buttonPress", {
    gameId: props.gameId,
    pressedSymbol: pressedSymbol,
  });
}

// GEÄNDERT: Leitet zur Startseite '/' statt zum nicht mehr existierenden '/join'
function triggerLeaveGame() {
  if (!gameIsEffectivelyOver.value) {
    socket.emit("leaveGame", { gameId: props.gameId });
  }
  router.replace("/");
}
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
  padding: 1rem 1.5rem;
  box-sizing: border-box;
  font-family: "Helvetica Neue", sans-serif;
  gap: 1.5rem;
  transition: background 0.5s ease;
}

/* --- "Collected Pieces"-Bereich --- */
/* In Game.vue -> <style scoped> */

/* --- "Collected Pieces"-Bereich --- */
.collected-pieces-container {
  display: flex;
  gap: 1rem;
  padding: 0.75rem;
  background-color: var(--primary-color, #e0e0e0);
  border-radius: 12px;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
  order: -1;

  /* --- NEUE ZEILEN FÜR DIE BREITE --- */
  width: 100%; /* Dieselbe Breite wie deine .device-box */
  max-width: 380px; /* Derselbe Maximalwert */
  box-sizing: border-box; /* Wichtig, damit Padding die Breite nicht sprengt */
  justify-content: center; /* Zentriert die Piece-Slots, falls Platz übrig ist */
}

/* ... der Rest deiner Styles bleibt unverändert ... */
.piece-slot {
  width: 60px;
  height: 60px;
  background-color: #ccc;
  border: 2px dashed #aaa;
  border-radius: 8px;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #999;
  font-size: 2rem;
  font-weight: bold;
}

/* KORRIGIERT: Der Selektor zielt jetzt auf die neue .game-png-icon Klasse */
/* Diese Regel wird jetzt von der GameIcon-Komponente selbst gesteuert, aber eine spezifische Regel hier schadet nicht */
.piece-slot .game-png-icon {
  max-width: 90%;
  max-height: 90%;
}

.placeholder-icon {
  user-select: none;
}

/* --- Device-Box und Display --- */
.device-box {
  background: var(--primary-color, #f0f0f0);
  width: 90%;
  max-width: 380px;
  border-radius: 32px;
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.15);
  padding: 2rem 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.display-area {
  width: 100%;
  height: 80px;
  background: #111;
  border-radius: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #00ff99;
  font-weight: bold;
  letter-spacing: 2px;
  transition: box-shadow 0.5s ease-in-out;
}

.display-area.is-piece-round {
  animation: pulse-gold-glow 2.5s infinite ease-in-out;
}

@keyframes pulse-gold-glow {
  0%,
  100% {
    box-shadow: none;
  }
  50% {
    box-shadow: 0 0 35px rgba(255, 215, 0, 0.8),
      0 0 20px rgba(255, 223, 100, 0.6);
  }
}

.display-symbol {
  font-size: 2.5rem;
  width: 70px;
  height: 70px;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* --- Punkte-Animation --- */
.dots-animation-container {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
}
.dot {
  display: block;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background-color: #282828;
  animation-name: light-up-dot;
  animation-duration: 1.8s;
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
}
@keyframes light-up-dot {
  0%,
  100% {
    background-color: #282828;
    transform: scale(1);
    box-shadow: none;
  }
  20% {
    background-color: #00ff99;
    transform: scale(1.2);
    box-shadow: 0 0 10px #00ff99, 0 0 5px rgba(255, 255, 255, 0.5);
  }
  40% {
    background-color: #282828;
    transform: scale(1);
    box-shadow: none;
  }
}
.dot:nth-child(1) {
  animation-delay: 0s;
}
.dot:nth-child(2) {
  animation-delay: 0.1s;
}
.dot:nth-child(3) {
  animation-delay: 0.2s;
}
.dot:nth-child(4) {
  animation-delay: 0.3s;
}
.dot:nth-child(5) {
  animation-delay: 0.4s;
}

/* --- Buttons und Nachrichten --- */
.button-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  width: 100%;
}

/* --- GEÄNDERT: Button-Styling zurückgesetzt --- */
.button {
  background: var(--accent-color-1, #5cb85c);
  color: white;
  /* Die Schriftgröße des Buttons bestimmt die Größe des Icons */
  font-size: 1.75rem;
  border: none;
  border-radius: 16px;
  padding: 0.75rem; /* Etwas mehr Padding für ein besseres Gefühl */
  text-align: center;
  user-select: none;
  transition: background 0.2s ease, transform 0.1s ease;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  /* min-height/width sind wieder auf dem alten Wert oder können ggf. weg */
  min-height: 80px;
  min-width: 80px;
}

/* GELÖSCHT: Die spezielle Regel für .game-png-icon im Button wird nicht mehr benötigt */
/*
.button :deep(.game-png-icon) {
    width: 75%;
    height: 75%;
}
*/

.button:disabled {
  background-color: #aaa !important;
  cursor: not-allowed !important;
  opacity: 0.7;
}
.button:not(:disabled):active {
  transform: scale(0.95);
  filter: brightness(0.9);
}
.button.correct {
  background-color: #28a745 !important;
}
.button.incorrect {
  background-color: #dc3545 !important;
  animation: shake 0.5s;
}
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-5px);
  }
  75% {
    transform: translateX(5px);
  }
}
.game-message {
  font-size: 1.1rem;
  color: #333;
  min-height: 1.5em;
  padding: 0.5rem;
  margin-top: 1rem;
  border-radius: 4px;
  text-align: center;
  width: 100%;
  font-weight: bold;
}
.game-message.error {
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}
.leave-btn {
  background: var(--accent-color-2, #d9534f);
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
.leave-btn:hover {
  filter: brightness(0.9);
}
</style>
