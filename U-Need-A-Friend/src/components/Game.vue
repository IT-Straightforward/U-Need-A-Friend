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

const handleTurnSuccess = (data) => {
  // Markiere die gematchte Karte als permanent umgedreht
  const matchedCard = playerBoard.value.find(c => c.symbol === data.symbol);
  if (matchedCard) {
    matchedCard.isMatched = true;
  }

  // --- HINZUGEFÜGT: GRÜNEN GLOW ANWENDEN ---
  const el = cardElements.value[data.symbol];
  if (el) {
    el.classList.add('glow-success');
    // Glow nach 1.5 Sekunden wieder entfernen
    setTimeout(() => {
      el.classList.remove('glow-success');
    }, 1500);
  }
};

const handleTurnFail = (data) => {
  if (!data || !data.selections) return;

  // 1. Finde NUR die Auswahl, die von DIESEM Client gemacht wurde.
  const myChoice = data.selections.find(sel => sel.playerId === myPlayerId.value);

  // Wenn wir unsere Auswahl nicht finden (sollte nie passieren), nichts tun.
  if (!myChoice) return;

  const mySymbol = myChoice.symbol;

  // 2. Wende den roten Glow NUR auf die eigene Karte an.
  const el = cardElements.value[mySymbol];
  if (el) {
    el.classList.add('glow-fail');
    setTimeout(() => {
      el.classList.remove('glow-fail');
    }, 1500);
  }

  // 3. Drehe NUR die eigene Karte nach einer Verzögerung wieder um.
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

/* --- NEUE, KORRIGIERTE REGELN --- */

/* 1. Der Glow-Effekt gilt immer, wenn eine Karte ausgewählt ist. */
.card-container.is-selected .card-inner {
  box-shadow: 0 0 25px 8px rgba(255, 255, 100, 0.9);
  animation: pulse-animation 1.5s infinite;
}

/* 2. Die Skalierung (das "Hervorheben") gilt nur, wenn die Karte ausgewählt, aber noch nicht umgedreht ist. */
.card-container.is-selected .card-inner:not(.is-flipped) {
  transform: scale(1.05);
}

/* 3. Die Drehung gilt für jede umgedrehte Karte. */
.card-inner.is-flipped {
  transform: rotateY(180deg);
}

/* 4. Wenn eine Karte ausgewählt UND umgedreht ist, kombiniere beide Transformationen. */
.card-container.is-selected .card-inner.is-flipped {
  transform: scale(1.05) rotateY(180deg);
}

/* GRÜNER GLOW FÜR ERFOLG */
.card-container.glow-success .card-inner {
  box-shadow: 0 0 25px 8px rgba(100, 255, 100, 0.9);
  animation: pulse-success 1.5s 1; /* Animation nur einmal abspielen */
}

@keyframes pulse-success {
  0% {
    box-shadow: 0 0 25px 8px rgba(100, 255, 100, 0.7);
  }
  50% {
    box-shadow: 0 0 30px 12px rgba(100, 255, 100, 0.9);
  }
  100% {
    box-shadow: 0 0 25px 8px rgba(100, 255, 100, 0.7);
  }
}

/* ROTER GLOW FÜR FEHLSCHLAG */
.card-container.glow-fail .card-inner {
  box-shadow: 0 0 25px 8px rgba(255, 100, 100, 0.9);
  animation: pulse-fail 1.5s 1; /* Animation nur einmal abspielen */
}

@keyframes pulse-fail {
  0% {
    box-shadow: 0 0 25px 8px rgba(255, 100, 100, 0.7);
  }
  50% {
    box-shadow: 0 0 30px 12px rgba(255, 100, 100, 0.9);
  }
  100% {
    box-shadow: 0 0 25px 8px rgba(255, 100, 100, 0.7);
  }
}

@keyframes pulse-animation {
  0% {
    box-shadow: 0 0 25px 8px rgba(255, 255, 100, 0.7);
  }
  50% {
    box-shadow: 0 0 30px 12px rgba(255, 255, 100, 0.9);
  }
  100% {
    box-shadow: 0 0 25px 8px rgba(255, 255, 100, 0.7);
  }
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
