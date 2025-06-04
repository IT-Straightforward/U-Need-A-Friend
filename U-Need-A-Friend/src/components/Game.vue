<template>
  <main class="mobile-container">
    <div class="device-box">
      <div class="display-area">
 <span class="display-symbol">
   <template v-if="roleInCurrentRound === 'source' && currentTargetSymbolForRound">
     <GameIcon :iconName="currentTargetSymbolForRound" :themeFolder="currentThemeFolder" />
   </template>
   </span>
</div>

<div class="button-grid">
 <button
   v-for="(iconId, i) in playerButtons" :key="`button-${i}`"
   class="button"
   :class="{
     correct: feedbackState === 'correct' && lastCorrectSymbol === iconId,
     incorrect: feedbackState === 'incorrect' && lastPressedSymbol === iconId
   }"
   @click="handlePress(iconId)"
   :disabled="gameIsEffectivelyOver"
 >
   <GameIcon v-if="iconId" :iconName="iconId" :themeFolder="currentThemeFolder" />
   <span v-else>?</span>
 </button>
</div>
      <p v-if="gameMessage" class="game-message" :class="{ 'error': isErrorMessage }">{{ gameMessage }}</p>
      <button v-if="!gameIsEffectivelyOver" class="leave-btn" @click="triggerLeaveGame">Leave Game</button>
      <router-link v-else to="/join" class="leave-btn router-link-btn">Back to Lobby</router-link>
    </div>
  </main>
</template>

<script setup>
import { ref, inject, onMounted, onUnmounted, computed } from 'vue';
import GameIcon from './GameIcon.vue'; 
import { useRouter } from 'vue-router';
import { useGameSessionStore } from '@/stores/gameSessionStore'; // Pfad anpassen!
import { storeToRefs } from 'pinia'; // Um Store-Refs reaktiv zu halten

const props = defineProps({
  gameId: {
    type: String,
    required: true
  }
});

const socket = inject('socket');
const router = useRouter();

const gameSessionStore = useGameSessionStore(); 

const { currentThemeFolder } = storeToRefs(gameSessionStore);

const socketListenersInitialized = ref(false);

const ownPlayerId = ref('');
const playerButtons = ref([]); 
const currentTargetSymbolForRound = ref(''); 
const roleInCurrentRound = ref('inactive'); 
const gameMessage = ref('Initializing game connection...');
const isErrorMessage = ref(false);
const feedbackState = ref(''); 
const lastPressedSymbol = ref(''); 
const lastCorrectSymbol = ref('');
const gameIsEffectivelyOver = ref(false); 

// --- Computed Properties für die Anzeige ---
const displayContent = computed(() => {
  if (gameIsEffectivelyOver.value) return gameMessage.value || 'GAME OVER';
  
  if (roleInCurrentRound.value === 'source') {
    return currentTargetSymbolForRound.value; // Nur Source zeigt das Symbol
  }
  
  // Target zeigt "..." an, wenn er am Zug ist und kein Feedback angezeigt wird.
  if (roleInCurrentRound.value === 'target' && feedbackState.value !== 'correct' && feedbackState.value !== 'incorrect') {
    return ''; 
  }
  
  // Feedback-Anzeige (gilt für den Spieler, der die Aktion ausgeführt hat)
  if (feedbackState.value === 'correct') return '✅';
  if (feedbackState.value === 'incorrect') return '❌';
  
  // Standard für Inactive oder wenn keine spezifische Anzeige nötig ist
  if (gameMessage.value === 'Initializing game connection...' || gameMessage.value === 'Connecting to game...') return '...';
  return ''; // Ansonsten leer, um keine Hinweise zu geben
});

const isMyTurnAsTarget = computed(() => { // Wird nicht mehr für :disabled verwendet, aber ggf. für andere UI-Logik
  return roleInCurrentRound.value === 'target' && !feedbackState.value && !gameIsEffectivelyOver.value;
});


// --- Socket Event Handler ---
const handleGameStarted = (data) => {
  if (!props.gameId) { console.warn("handleGameStarted: props.gameId is missing!"); return; }
  if (data.gameId === props.gameId) {
    ownPlayerId.value = data.playerId;
    playerButtons.value = data.buttons || [];
    gameMessage.value = 'Game setup complete! Waiting for the first round.';
    isErrorMessage.value = false;
    gameIsEffectivelyOver.value = false;
  }
};

const handleRoundUpdate = (data) => {
  feedbackState.value = ''; 
  lastPressedSymbol.value = '';
  lastCorrectSymbol.value = '';
  isErrorMessage.value = false; 
  gameIsEffectivelyOver.value = false;

  roleInCurrentRound.value = data.role;
  currentTargetSymbolForRound.value = data.currentTargetSymbol;

  // Generische Nachricht für alle Spieler, um keine Rollen zu verraten
  gameMessage.value = `Runde ${data.roundNumber || ''}`; 
};

const handleFeedback = (data) => {
  if (data.correct) {
    feedbackState.value = 'correct';
    // lastCorrectSymbol wird gesetzt, um das Styling auf den korrekten Button anzuwenden,
    // falls der aktuelle Spieler der Target war und richtig gedrückt hat.
    // Das currentTargetSymbolForRound ist das Symbol, das korrekt war.
    if (roleInCurrentRound.value === 'target') {
        lastCorrectSymbol.value = currentTargetSymbolForRound.value;
    }
    gameMessage.value = data.message || 'Correct!';
  } else { 
    feedbackState.value = 'incorrect';
    // lastPressedSymbol wurde in handlePress gesetzt und zeigt an, welcher Button falsch war (oder wenn nicht am Zug)
    gameMessage.value = data.message || 'Incorrect or not your turn!';
  }
  isErrorMessage.value = !data.correct;
};

const handleGameEnded = (data) => {
  gameMessage.value = `Game Over: ${data.message || data.reason}`;
  isErrorMessage.value = true; 
  gameIsEffectivelyOver.value = true; 
  roleInCurrentRound.value = 'inactive';
};

const handlePlayerLeftMidGame = (data) => {
  if (data.playerId !== ownPlayerId.value) {
    gameMessage.value = `${data.playerName || 'A player'} has left the game.`;
    isErrorMessage.value = false;
  }
};

const handleGameError = (data) => {
  gameMessage.value = `Error: ${data.message || 'An unknown game error occurred.'}`;
  isErrorMessage.value = true; 
  gameIsEffectivelyOver.value = true;
};

const initializeSocketListeners = () => {
    if (socketListenersInitialized.value) return;
    // console.log(`[Game ${props.gameId}] Initializing socket listeners.`);
    socket.on('gameStarted', handleGameStarted);
    socket.on('roundUpdate', handleRoundUpdate);
    socket.on('feedback', handleFeedback);
    socket.on('gameEnded', handleGameEnded);
    socket.on('playerLeftMidGame', handlePlayerLeftMidGame);
    socket.on('gameError', handleGameError);
    socketListenersInitialized.value = true;
};

const cleanupSocketListeners = () => {
    // console.log(`[Game ${props.gameId || 'UNKNOWN'}] Cleaning up socket listeners.`);
    socket.off('gameStarted', handleGameStarted);
    socket.off('roundUpdate', handleRoundUpdate);
    socket.off('feedback', handleFeedback);
    socket.off('gameEnded', handleGameEnded);
    socket.off('playerLeftMidGame', handlePlayerLeftMidGame);
    socket.off('gameError', handleGameError);
    socketListenersInitialized.value = false;
};

onMounted(() => {
  if (props.gameId) {
    initializeSocketListeners();
    // console.log(`[Game ${props.gameId}] Component mounted. Emitting 'playerReadyForGame'.`);
    socket.emit('playerReadyForGame', { gameId: props.gameId });
  } else {
    console.error(`[Game MOUNTED] gameId prop is missing! Cannot initialize.`);
    gameMessage.value = 'CRITICAL ERROR: Game ID not available. Please rejoin.';
    isErrorMessage.value = true;
    gameIsEffectivelyOver.value = true;
  }
});

onUnmounted(() => {
  cleanupSocketListeners();
});

function handlePress(pressedSymbol) {
  if (gameIsEffectivelyOver.value) return;

  lastPressedSymbol.value = pressedSymbol; 
  
    console.log(`[Game ${props.gameId}] Player ${ownPlayerId.value} pressed symbol: ${pressedSymbol}. Role: ${roleInCurrentRound.value}. Emitting 'buttonPress'.`);
  socket.emit('buttonPress', {
    gameId: props.gameId,
    pressedSymbol: pressedSymbol 
  });
}

function triggerLeaveGame() {
  if (!gameIsEffectivelyOver.value) {
    socket.emit('leaveGame', { gameId: props.gameId });
  }
  router.replace('/join');
}
</script>

<style scoped>
/* Styles bleiben wie in deiner letzten Version */
.mobile-container { display: flex; justify-content: center; align-items: center; min-height: 100dvh; background: #fafafa; padding: 1rem; box-sizing: border-box; font-family: "Helvetica Neue", sans-serif; }
.device-box { background: #f0f0f0; width: 90vw; max-width: 360px; min-height: 70vh; border-radius: 32px; box-shadow: 0 0 24px rgba(0,0,0,0.15); padding: 2rem 1.5rem; display: flex; flex-direction: column; align-items: center; gap: 1.5rem; }
.display-area { width: 100%; height: 80px; background: #111; border-radius: 16px; display: flex; justify-content: center; align-items: center; color: #00ff99; font-weight: bold; letter-spacing: 2px; }
.display-symbol { font-size: 2.5rem; }
.button-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; width: 100%; }
/* In Game.vue -> <style scoped> */
.button {
  background: #5cb85c;
  color: white;
  font-size: 1.75rem; /* Beeinflusst die 'em'-Einheit in GameIcon, falls dort 'em' verwendet wird */
  border: none;
  border-radius: 16px;
  padding: 0.5rem; /* Reduziere Padding, um mehr Platz für das Icon zu schaffen, ODER erhöhe die Button-Dimensionen */
  text-align: center;
  user-select: none;
  transition: background 0.2s ease, transform 0.1s ease;
  cursor: pointer;

  /* Wichtig für die Icon-Größe und Zentrierung: */
  display: flex;
  justify-content: center;
  align-items: center;
  /* Gib dem Button eine Mindesthöhe oder lass sie durch Inhalt + Padding entstehen.
     Die Icons in GameIcon sind jetzt auf max. 2.5em der Button-Schriftgröße begrenzt.
     1.75rem * 2.5 = ca. 4.375rem (ca. 70px bei 16px Basis).
     Das Padding kommt noch dazu.
  */
  min-height: 80px; /* Beispiel, anpassen! */
  min-width: 80px;  /* Beispiel, anpassen! */
}.button:disabled { background-color: #aaa !important; cursor: not-allowed !important; opacity: 0.7; }
.button:not(:disabled):active { background: #449d44; transform: scale(0.95); }
.button.correct { background-color: #28a745 !important; }
.button.incorrect { background-color: #dc3545 !important; animation: shake 0.5s; }
@keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
.game-message { font-size: 1.1rem; color: #333; min-height: 1.5em; padding: 0.5rem; margin-top: 1rem; border-radius: 4px; text-align: center; width:100%; font-weight: bold;}
.game-message.error { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
.leave-btn { background: #d9534f; color: white; font-size: 1rem; padding: 0.75rem 1.5rem; border: none; border-radius: 12px; margin-top: auto; width: 100%; cursor: pointer; text-decoration: none; display: inline-block; text-align:center; box-sizing: border-box; }
.leave-btn:hover { background: #c9302c; }
</style>