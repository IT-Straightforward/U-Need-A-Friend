<template>
  <div class="admin-panel">
    <h2>Game Room Management</h2>

    <div v-if="isLoading && !predefinedRooms.length" class="loading">Loading room data...</div>
    <div v-if="errorMessage" class="error-message global-error">{{ errorMessage }}</div>

    <div class="room-list" v-if="!isLoading && !selectedRoom">
      <h3>Available Rooms</h3>
      <ul v-if="predefinedRooms.length > 0">
        <li v-for="room in predefinedRooms" :key="room.id"
            :class="{
              'active': room.isActive && !room.isRunning,
              'running': room.isRunning,
              'inactive': !room.isActive
            }"
            @click="selectRoom(room)"
            tabindex="0" @keyup.enter="selectRoom(room)" @keyup.space="selectRoom(room)"
            class="room-list-item">
          <div class="room-info">
            <strong>{{ room.name }} ({{ room.id }})</strong>
            <span class="room-status-text">
              Status:
              <template v-if="room.isActive">
                {{ room.isRunning ? 'Game Running' : `Waiting (${room.playerCount} players)` }}
              </template>
              <template v-else>
                Inactive
              </template>
            </span>
          </div>
          <div class="room-actions">
            <button v-if="!room.isActive" @click.stop="activateRoom(room.id)" :disabled="activatingRoomId === room.id" class="action-button activate-button">
              {{ activatingRoomId === room.id ? 'Activating...' : 'Activate' }}
            </button>
            <button v-else @click.stop="selectRoom(room)" class="action-button manage-button">
              {{ room.isRunning ? 'View Game' : 'Manage Lobby' }}
            </button>
          </div>
        </li>
      </ul>
      <p v-else-if="!isLoading">No predefined rooms found or server might be unavailable.</p>
    </div>

    <div v-if="selectedRoom" class="room-details">
      <h3>Managing: {{ selectedRoom.name }} <span class="room-id-detail">({{ selectedRoom.id }})</span></h3>
      <button @click="deselectRoom" class="back-button">&larr; Back to Room List</button>

      <div v-if="activatingRoomId === selectedRoom.id" class="loading-inline">Activating room...</div>
      <p v-if="actionMessage" class="action-message">{{ actionMessage }}</p>

      <div v-if="!selectedRoomData.isActive && !gameIsEffectivelyOver">
          <p class="room-status-detail">This room is currently inactive.</p>
          <button @click="activateRoom(selectedRoom.id)" :disabled="activatingRoomId === selectedRoom.id" class="action-button activate-button-detail">
            {{ activatingRoomId === selectedRoom.id ? 'Activating...' : 'Activate Session' }}
          </button>
      </div>

      <div v-if="selectedRoomData.isActive">
        <p class="status-line">
          <strong>Status:</strong>
          <span :class="{'status-running': selectedRoomData.isRunning, 'status-waiting': !selectedRoomData.isRunning}">
            {{ selectedRoomData.isRunning ? 'Game in Progress' : `Lobby (${selectedRoomData.players.length} / ${selectedRoom.maxPlayers})` }}
          </span>
        </p>

        <div class="join-info-container">
            <h4>Player Join Information:</h4>
            <div v-if="joinUrl" class="join-details">
                <p><strong>Scan QR or use Link:</strong> <a :href="joinUrl" target="_blank" rel="noopener noreferrer">{{ joinUrl }}</a></p>
                <div class="qr-code-display" title="QR Code for players to scan and join">
                  <qrcode-vue :value="joinUrl" :size="200" level="H" render-as="svg" />
                </div>
            </div>
        </div>

        <div class="player-list-container">
            <h4>Players in Session ({{selectedRoomData.players.length}}):</h4>
            <ul v-if="selectedRoomData.players && selectedRoomData.players.length > 0">
              <li v-for="(player, index) in selectedRoomData.players" :key="player.id" class="player-item">
                <span>Spieler {{ index + 1 }} <small class="player-id-small">(ID: {{ player.id.substring(0,6) }}...)</small></span>
                <span v-if="player.isReadyInLobby" class="ready-status">✓ Ready</span>
              </li>
            </ul>
            <p v-else>No players have joined this session yet.</p>
        </div>

        <div class="admin-actions-for-room">
          <h4>Room Actions:</h4>
        </div>

       <div v-if="selectedRoomData.isRunning" class="progress-info-admin">
  <h4>Game Progress</h4>
  <div class="matched-symbols-container-admin">
    <div v-for="symbol in selectedRoomDetails.matchedSymbols" :key="symbol" class="piece-slot-admin">
      <GameIcon :iconName="symbol" :themeFolder="selectedRoom.id.toLowerCase()" />
    </div>
  </div>
  <div v-if="selectedRoomDetails.currentTurn" class="turn-status-admin">
    <p>
      <strong>Turn:</strong> {{ selectedRoomDetails.currentTurn.turnNumber }} | 
      <strong>Choices:</strong> {{ selectedRoomDetails.currentTurn.choicesCount }} / {{ selectedRoomData.players.length }}
    </p>
  </div>
</div>
      </div>
      
      <div v-if="gameIsEffectivelyOver && selectedRoom" class="game-over-admin-detail">
          <p>The session for room "{{selectedRoom.name}}" has ended.</p>
          <button @click="deselectRoom" class="action-button">Back to Room List</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, inject } from 'vue';
import QrcodeVue from 'qrcode.vue';

const socket = inject('socket');

// --- Zustand ---
const isLoading = ref(true);
const errorMessage = ref('');
const predefinedRooms = ref([]);
const selectedRoom = ref(null);
const selectedRoomData = reactive({
  id: null,
  isActive: false,
  isRunning: false,
  players: [], 
});
const gameIsEffectivelyOver = ref(false);
const activatingRoomId = ref(null);
const startingGameId = ref(null);
const resettingRoomId = ref(null);
const actionMessage = ref('');
const selectedRoomDetails = reactive({
    matchedSymbols: [],
    currentTurn: null
});

// Neuer Handler für die Admin-Ansicht
const handleRoomDetailsUpdate = (data) => {
    if (selectedRoom.value && selectedRoom.value.id === data.roomId) {
        if (data.status) { // von roomStatusUpdate
            Object.assign(selectedRoomData, data.status);
            if (data.status.matchedSymbols) selectedRoomDetails.matchedSymbols = data.status.matchedSymbols;
            if (data.status.currentTurn) selectedRoomDetails.currentTurn = data.status.currentTurn;
        }
        if (data.details) { // von getRoomDetails
            Object.assign(selectedRoomData, data.details);
            selectedRoomDetails.matchedSymbols = data.details.matchedSymbols || [];
            selectedRoomDetails.currentTurn = data.details.currentTurn || null;
        }
    }
};


// --- Computed Properties ---

// GEÄNDERT: URL zeigt auf die neue Auto-Join Route
const joinUrl = computed(() => {
  if (selectedRoom.value && selectedRoomData.isActive) {
    const baseUrl = window.location.origin;
    return `${baseUrl}/waiting/${selectedRoom.value.id}`;
  }
  return '';
});

// NEU: Wandelt Spieler-IDs in ihre numerischen Indexe um (für "Spieler 1", "Spieler 2")
const playerIndexMap = computed(() => {
    return selectedRoomData.players.reduce((map, player, index) => {
        map[player.id] = index;
        return map;
    }, {});
});


// --- Socket Event Handler ---

const handleRoomOverview = (roomsFromServer) => {
  isLoading.value = false;
  predefinedRooms.value = roomsFromServer;
};

const handleRoomStatusUpdate = (updatedRoom) => {
  const roomInList = predefinedRooms.value.find(r => r.id === updatedRoom.roomId);
  if (roomInList && updatedRoom.status) {
    Object.assign(roomInList, updatedRoom.status);
  }
  
  if (selectedRoom.value && selectedRoom.value.id === updatedRoom.roomId && updatedRoom.status) {
    Object.assign(selectedRoomData, updatedRoom.status);
    
    if (updatedRoom.status.matchedSymbols) selectedRoomDetails.matchedSymbols = updatedRoom.status.matchedSymbols;
    if (updatedRoom.status.currentTurn) selectedRoomDetails.currentTurn = updatedRoom.status.currentTurn;

    if (!updatedRoom.status.isActive) gameIsEffectivelyOver.value = true;
  }
};

const handleAdminPlayerJoinedOrLeft = (data) => {
    if (selectedRoom.value && selectedRoom.value.id === data.roomId) {
        selectedRoomData.players = data.players || [];
    }
    const roomInList = predefinedRooms.value.find(r => r.id === data.roomId);
    if (roomInList) roomInList.playerCount = (data.players || []).length;
};




const handleAdminError = (errorData) => {
    errorMessage.value = errorData.message || 'An admin error occurred.';
    activatingRoomId.value = null;
    startingGameId.value = null;
    resettingRoomId.value = null;
};


// --- Lifecycle Hooks ---
onMounted(() => {
  socket.emit('admin:getRoomOverview', (overview) => {
    handleRoomOverview(overview || []);
  });
   socket.on('admin:roomDetailsUpdate', handleRoomDetailsUpdate); 
  socket.on('admin:roomStatusUpdate', handleRoomStatusUpdate);
  socket.on('admin:playerJoinedRoom', handleAdminPlayerJoinedOrLeft);
  socket.on('admin:playerLeftRoom', handleAdminPlayerJoinedOrLeft);
  socket.on('admin:error', handleAdminError);
});

onUnmounted(() => {
  socket.off('admin:roomStatusUpdate');
  socket.off('admin:playerJoinedRoom');
  socket.off('admin:playerLeftRoom');
  socket.off('roundStartedForHost');
  socket.off('admin:error');
});

// --- Methoden ---
// In AdminPanel.vue -> <script setup>

function selectRoom(room) {
  selectedRoom.value = { ...room };
  actionMessage.value = '';
  errorMessage.value = '';
  gameIsEffectivelyOver.value = !room.isActive;

  // Setze die Detail-Infos immer zurück, wenn ein neuer Raum gewählt wird
  selectedRoomDetails.matchedSymbols = [];
  selectedRoomDetails.currentTurn = null;

  if (room.isActive) {
    socket.emit('admin:getRoomDetails', { roomId: room.id }, (response) => {
      if (response.success && response.details) {
        Object.assign(selectedRoomData, response.details);
        // Fülle die neuen Detail-Objekte aus der Antwort
        selectedRoomDetails.matchedSymbols = response.details.matchedSymbols || [];
        selectedRoomDetails.currentTurn = response.details.currentTurn || null;
      } else {
        errorMessage.value = response.error;
      }
    });
  } else {
    selectedRoomData.isActive = false;
    selectedRoomData.isRunning = false;
    selectedRoomData.players = [];
  }
}




function deselectRoom() {
  selectedRoom.value = null;
}

// In AdminPanel.vue -> <script setup>

function activateRoom(roomId) {
  activatingRoomId.value = roomId;

  socket.emit('admin:activateRoom', { roomId }, (response) => {
      activatingRoomId.value = null; 
      if (response && response.success) {
        actionMessage.value = `Raum ${roomId} wurde erfolgreich aktiviert.`;
        
    
        const roomInfoForSelection = {
            id: response.roomId,
            ...response.status
        };
        selectRoom(roomInfoForSelection);

      } else {
        errorMessage.value = response.error || 'Activation failed.';
      }
  });
}

function triggerStartGame(roomId) {
  startingGameId.value = roomId;
  socket.emit('admin:startGameInstance', { roomId });
  // Setze den Ladezustand nach einer kurzen Verzögerung zurück,
  // da die Antwort über Events kommt und nicht über einen Callback.
  setTimeout(() => startingGameId.value = null, 2000);
}

function triggerResetRoom(roomId) {
  resettingRoomId.value = roomId;
  socket.emit('admin:resetRoom', { roomId });
  setTimeout(() => resettingRoomId.value = null, 2000);
}

</script>

<style scoped>
/* Die Styles können größtenteils gleich bleiben. */
.admin-panel { padding: 20px; font-family: sans-serif; max-width: 900px; margin: auto; }
.loading, .error-message, .loading-inline { padding: 10px; margin-bottom: 15px; border-radius: 4px; }
.loading, .loading-inline { background-color: #e0e0e0; }
.error-message { background-color: #ffdddd; color: #d8000c; }
.action-message { background-color: #d4edda; color: #155724; padding: 10px; border-radius: 4px; }
.room-list ul { list-style: none; padding: 0; }
.room-list-item { padding: 10px 15px; border: 1px solid #ccc; margin-bottom: 8px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background-color 0.2s; }
.room-list-item:hover { background-color: #f0f0f0; }
.room-list-item .room-info { display: flex; flex-direction: column; gap: 4px; }
.room-list-item.active { border-left: 5px solid #4CAF50; }
.room-list-item.running { border-left: 5px solid #2196F3; }
.room-list-item.inactive { border-left: 5px solid #9e9e9e; }
.room-details { margin-top: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 4px; background-color: #f9f9f9; }
.back-button { margin-bottom: 15px; background-color: #6c757d; color:white; border:none; padding: 8px 15px; border-radius:4px; cursor:pointer; }
.action-button { border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; }
.action-button:disabled { background-color: #ccc !important; cursor: not-allowed; }
.activate-button, .activate-button-detail { background-color: #4CAF50; color: white; }
.manage-button { background-color: #007bff; color: white; }
.start-game-button { background-color: #2196F3; color: white; }
.reset-button { background-color: #f44336; color: white; }
.join-info-container, .player-list-container, .admin-actions-for-room { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #eee; }
.qr-code-display { margin-top: 0.5rem; }
.player-list-container ul { list-style: none; padding: 0; }
.player-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee; }
.player-id-small { color: #777; font-size: 0.8em; margin-left: 8px; }
.ready-status { color: green; font-weight: bold; font-size: 0.9em; }
.round-info-admin { margin-top: 1rem; padding: 0.75rem; background-color: #e9ecef; border: 1px solid #ced4da; border-radius: 4px; }
.symbol-display { font-family: monospace; background: #fff; padding: 2px 5px; border-radius: 3px; border: 1px solid #ccc; }
.status-running { color: #007bff; font-weight: bold; }
.status-waiting { color: #28a745; font-weight: bold; }
</style>