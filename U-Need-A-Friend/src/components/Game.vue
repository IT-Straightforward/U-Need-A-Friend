<template>
  <main class="mobile-container" :style="computedContainerStyle">
    <div class="device-box">
      <div class="card-grid">
        <div
          v-for="(card, index) in playerBoard"
          :key="`card-${index}`"
          class="card-container"
          :class="{ 'is-selected': mySelectionIndex === index }"
          @click="handleCardFlip(card, index)"
          :ref="el => setCardRef(el, card.symbol)"
        >
          <div
            class="card-inner"
            :class="{ 'is-flipped': card.isFlipped || card.isMatched }"
          >
            <div class="card-face card-back"></div>
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
    </div>
  </main>
</template>
<script setup>
import { ref, inject, onMounted, onUnmounted, computed, watch, onBeforeUpdate } from 'vue';
import GameIcon from './GameIcon.vue';
import { useRouter } from 'vue-router';
import { useGameSessionStore } from '@/stores/gameSessionStore';
import { storeToRefs } from 'pinia';

const props = defineProps({
  gameId: { type: String, required: true },
});

const socket = inject('socket');
const router = useRouter();
const gameSessionStore = useGameSessionStore();
const { currentThemeFolder } = storeToRefs(gameSessionStore);

//DOM
const cardElements = ref({}); // Speichert die DOM-Elemente der Karten
const setCardRef = (el, symbol) => {
  if (el) {
    cardElements.value[symbol] = el;
  }
};
onBeforeUpdate(() => {
  cardElements.value = {};
});

// --- Zustand ---
const playerBoard = ref([]);
const turnNumber = ref(0);
const mySelectionIndex = ref(null);
const canFlipCard = ref(false);
const gameIsEffectivelyOver = ref(false);
const myPlayerId = ref(null);

// --- Computed & Styles ---
const roomBgColor = ref('#fafafa');
const roomPrimaryColor = ref('#e0e0e0');
const computedContainerStyle = computed(() => ({
  '--bg-color': roomBgColor.value,
  '--primary-color': roomPrimaryColor.value,
}));
watch(
  roomBgColor,
  newColor => {
    if (newColor) {
      document.body.style.backgroundColor = newColor;
      document.body.style.transition = 'background-color 0.5s ease';
    }
  },
  { immediate: true }
);

// --- Socket Event Handler ---

const handleGameInitialized = data => {
  if (data.gameId !== props.gameId) return;
  if (data.themeFolder) {
    gameSessionStore.setCurrentThemeFolder(data.themeFolder);
  }
  playerBoard.value = data.playerBoard;
  myPlayerId.value = data.playerId;
  gameIsEffectivelyOver.value = false;
};

const handleTurnBegan = data => {
  turnNumber.value = data.turnNumber;
  mySelectionIndex.value = null; // Eigene Auswahl zurücksetzen
  canFlipCard.value = true; // Züge erlauben

  // Alle nicht-gematchten Karten zurückdrehen
  playerBoard.value.forEach(card => {
    if (!card.isMatched) {
      card.isFlipped = false;
    }
  });
};

const handleTurnResolve = data => {
  if (!data || !data.allChoices) return;

  const myChoice = data.allChoices.find(
    choice => choice.playerId === myPlayerId.value
  );

  if (myChoice) {
    mySelectionIndex.value = null; 
    const cardToFlip = playerBoard.value[myChoice.cardIndex];
    if (cardToFlip) {
      console.log('Flipping card:', cardToFlip.symbol);
      cardToFlip.isFlipped = true;
    }
  }
};

// In Game.vue -> <script setup>

const handleTurnSuccess = (data) => {
  const matchedCard = playerBoard.value.find(c => c.symbol === data.symbol);
  if (matchedCard) {
    matchedCard.isMatched = true;
  }

  const el = cardElements.value[data.symbol];
  if (el) {
    el.classList.add('nod-success'); // new class
    // Remove the class after the animation finishes
    setTimeout(() => {
      el.classList.remove('nod-success'); // new class
    }, 800);
  }
};

const handleTurnFail = (data) => {
  if (!data || !data.selections) return;
  const myChoice = data.selections.find(sel => sel.playerId === myPlayerId.value);
  if (!myChoice) return;

  const mySymbol = myChoice.symbol;
  const el = cardElements.value[mySymbol];
  if (el) {
    el.classList.add('shake-fail'); // new class
    // Remove the class after the animation finishes
    setTimeout(() => {
      el.classList.remove('shake-fail'); // new class
    }, 800);
  }

  setTimeout(() => {
    const cardToFlipBack = playerBoard.value.find(card => card.symbol === mySymbol);
    if (cardToFlipBack && !cardToFlipBack.isMatched) {
      cardToFlipBack.isFlipped = false;
    }
  }, 1500);
};

const handleGameEnded = () => {
  gameIsEffectivelyOver.value = true;
  canFlipCard.value = false;
};

// --- Methoden ---

function handleCardFlip(card, index) {
  if (!canFlipCard.value || mySelectionIndex.value !== null || card.isMatched) {
    return;
  }
  canFlipCard.value = false; // Direkt weitere Klicks sperren
  mySelectionIndex.value = index;

  socket.emit('playerMadeSelection', {
    gameId: props.gameId,
    cardIndex: index,
    symbol: card.symbol,
  });
}

// --- Lifecycle & Socket Setup ---

onMounted(() => {
  socket.on('gameInitialized', handleGameInitialized);
  socket.on('turnBegan', handleTurnBegan);
  socket.on('turnResolve', handleTurnResolve);
  socket.on('turnSuccess', handleTurnSuccess);
  socket.on('turnFail', handleTurnFail);
  socket.on('gameEnded', handleGameEnded);

  const persistentPlayerId = sessionStorage.getItem('myGamePlayerId');
  if (!persistentPlayerId) {
    router.replace('/');
    console.log('[Game.vue] Kein persistentPlayerId gefunden. Zurück zur Startseite.');
    return;
  }

  socket.emit(
    'joinGame',
    {
      roomId: props.gameId,
      persistentPlayerId: persistentPlayerId,
    },
    response => {
      if (response && response.success) {
        console.log('[Game.vue] Join/Reconnect zur Spiel-Session erfolgreich.');
        socket.emit('playerReadyForGame', { gameId: props.gameId });
      } else {
        alert('Konnte nicht wieder mit dem Spiel verbinden.');
        router.replace('/');
      }
    }
  );
});

onUnmounted(() => {
  socket.off('gameInitialized', handleGameInitialized);
  socket.off('turnBegan', handleTurnBegan);
  socket.off('turnResolve', handleTurnResolve);
  socket.off('turnSuccess', handleTurnSuccess);
  socket.off('turnFail', handleTurnFail);
  socket.off('gameEnded', handleGameEnded);
  document.body.style.backgroundColor = '';
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
  font-family: 'Helvetica Neue', sans-serif;
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

/* --- Core Flip & Selection Logic --- */

.card-container.is-selected .card-inner {
  box-shadow: 0 0 25px 8px rgba(255, 255, 100, 0.9);
}

.card-inner.is-flipped {
  transform: rotateY(180deg);
}

/* --- NEW: Success & Fail Animations --- */

/* "Nod" animation for a correct choice */
.card-container.nod-success .card-inner {
  animation: nod-animation 0.8s ease-in-out;
}

@keyframes nod-animation {
  0%, 100% { transform: rotateY(180deg) translateY(0); }
  25% { transform: rotateY(180deg) translateY(-10px); }
  50% { transform: rotateY(180deg) translateY(5px); }
  75% { transform: rotateY(180deg) translateY(-5px); }
}

/* "Shake" animation for a wrong choice */
.card-container.shake-fail .card-inner {
  animation: shake-animation 0.8s cubic-bezier(.36,.07,.19,.97);
}

@keyframes shake-animation {
  0%, 100% { transform: rotateY(180deg) translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: rotateY(180deg) translateX(-8px); }
  20%, 40%, 60%, 80% { transform: rotateY(180deg) translateX(8px); }
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

