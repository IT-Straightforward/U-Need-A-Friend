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
      <div v-if="startingGameId === selectedRoom.id" class="loading-inline">Starting game...</div>
      <div v-if="resettingRoomId === selectedRoom.id" class="loading-inline">Resetting room...</div>
      <p v-if="actionMessage" class="action-message">{{ actionMessage }}</p> 
      
      <div v-if="!selectedRoomData.isActive && activatingRoomId !== selectedRoom.id && !gameIsEffectivelyOver">
          <p class="room-status-detail">This room is currently inactive or has been reset.</p>
          <button @click="activateRoom(selectedRoom.id)" :disabled="activatingRoomId === selectedRoom.id" class="action-button activate-button-detail">
            {{ activatingRoomId === selectedRoom.id ? 'Activating...' : 'Activate This Room Session' }}
          </button>
      </div>

      <div v-if="selectedRoomData.isActive">
        <p class="status-line">
          <strong>Current Status:</strong>
          <span :class="{'status-running': selectedRoomData.isRunning, 'status-waiting': !selectedRoomData.isRunning}">
            {{ selectedRoomData.isRunning ? 'Game in Progress' : `Lobby Open - Waiting for players (${selectedRoomData.players.length} / ${selectedRoom.maxPlayers || 'N/A'})` }}
          </span>
        </p>

        <div class="join-info-container">
            <h4>Player Join Information:</h4>
            <div v-if="joinUrl" class="join-details">
                <p><strong>Scan QR or use Link:</strong> <a :href="joinUrl" target="_blank" rel="noopener noreferrer">{{ joinUrl }}</a></p>
                <div class="qr-code-display" title="QR Code for players to scan and join">
                  <qrcode-vue :value="joinUrl" :size="220" level="H" render-as="svg" background="#fff" foreground="#333" />
                </div>
            </div>
            <p v-else>Room is not active or Join URL could not be generated.</p>
        </div>

        <div class="player-list-container">
            <h4>Players in Session ({{selectedRoomData.players.length}}):</h4>
            <ul v-if="selectedRoomData.players && selectedRoomData.players.length > 0">
            <li v-for="player in selectedRoomData.players" :key="player.id" class="player-item">
                <span>{{ player.name }} <small class="player-id-small">(ID: {{ player.id.substring(0,6) }}...)</small></span>
                <span v-if="playerReadyStatus[player.id]" class="ready-status">(Ready)</span>
            </li>
            </ul>
            <p v-else>No players have joined this session yet.</p>
        </div>

        <div class="admin-actions-for-room">
          <h4>Room Actions:</h4>
          <button
            v-if="!selectedRoomData.isRunning"
            @click="triggerStartGame(selectedRoom.id)"
            :disabled="selectedRoomData.players.length < 2 || startingGameId === selectedRoom.id || !selectedRoomData.isActive"
            class="action-button start-game-button">
            {{ startingGameId === selectedRoom.id ? 'Starting...' : 'Start Game' }}
          </button>
          <button @click="triggerResetRoom(selectedRoom.id)" class="action-button reset-button" :disabled="resettingRoomId === selectedRoom.id || !selectedRoomData.isActive">
            {{ resettingRoomId === selectedRoom.id ? 'Resetting...' : 'Reset Room (Kick All & Deactivate)' }}
          </button>
        </div>

         <div v-if="selectedRoomData.isRunning && currentRoundInfo.roundNumber" class="round-info-admin">
            <h4>Current Round Info: (Round {{ currentRoundInfo.roundNumber }})</h4>
            <p>
              Source: <strong>{{ currentRoundInfo.sourcePlayer?.name || 'N/A' }}</strong> |
              Target: <strong>{{ currentRoundInfo.targetPlayer?.name || 'N/A' }}</strong> |
              Symbol: <span class="symbol-display">{{ currentRoundInfo.targetSymbol }}</span>
            </p>
        </div>
      </div>
      
      <div v-if="gameIsEffectivelyOver && selectedRoom" class="game-over-admin-detail">
          <p>The session for room "{{selectedRoom.name}}" has ended or was reset by an admin action.</p>
          <p>You can reactivate it from the room list if needed.</p>
          <button @click="deselectRoom" class="action-button">Back to Room List</button>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, inject } from 'vue';
import QrcodeVue from 'qrcode.vue'; // Für den QR-Code

const socket = inject('socket');

// --- Reaktive Zustandsvariablen ---
const isLoading = ref(true); // Für die anfängliche Ladeanzeige der Raumliste
const isLoadingDetails = ref(false); // Für Ladezustand der Raumdetails
const errorMessage = ref(''); // Für allgemeine Fehlermeldungen

// Liste aller vordefinierten Räume mit ihrem Live-Status
const predefinedRooms = ref([]); 
// Format pro Raum-Objekt in predefinedRooms: 
// { id, name, description, maxPlayers, isActive, isRunning, playerCount }

// Der aktuell vom Admin im Detail betrachtete/gemanagte Raum
const selectedRoom = ref(null); // Hält das Raum-Objekt aus predefinedRooms

// Detaillierte Live-Daten des aktuell ausgewählten (selectedRoom) und aktiven Raumes
const selectedRoomData = reactive({
  id: null,
  isActive: false, // Ist eine Spielsitzung für diesen Raum aktiv?
  isRunning: false, // Läuft das Spiel in dieser Sitzung (Runden aktiv)?
  players: [],      // Spielerliste für die aktive Sitzung dieses Raumes
});

// Zeigt an, ob die Spielsitzung des selectedRoom definitiv beendet/resettet wurde
const gameIsEffectivelyOver = ref(false);

// Status der Bereitschaft einzelner Spieler im ausgewählten Raum
const playerReadyStatus = reactive({}); // z.B. { playerId1: true, playerId2: false }
const readyPlayerCount = ref(0);    // Anzahl bereiter Spieler im ausgewählten Raum

// Zustände für laufende Admin-Aktionen (um z.B. Buttons zu deaktivieren)
const activatingRoomId = ref(null);
const startingGameId = ref(null);
const resettingRoomId = ref(null);
const actionMessage = ref(''); // Feedback-Nachrichten für Admin-Aktionen

// Informationen zur aktuellen Runde des ausgewählten, laufenden Spiels
const currentRoundInfo = reactive({
  roundNumber: 0,
  sourcePlayer: null, // Objekt { id, name }
  targetPlayer: null, // Objekt { id, name }
  targetSymbol: ''
});

// --- Computed Properties ---
const joinUrl = computed(() => {
  // Zeige URL nur, wenn ein Raum ausgewählt UND dieser Raum serverseitig als aktiv bestätigt wurde
  if (selectedRoom.value && selectedRoomData.isActive) {
    const baseUrl = window.location.origin; 
    return `${baseUrl}/join?room=${selectedRoom.value.id}`;
  }
  return ''; 
});

// --- Socket Event Handler (vom Server empfangen) ---

const handleRoomOverview = (roomsFromServer) => {
  console.log("Admin: Received 'admin:roomOverview'", roomsFromServer);
  if (Array.isArray(roomsFromServer)) {
    predefinedRooms.value = roomsFromServer.map(room => ({
      id: room.id,
      name: room.name,
      description: room.description,
      maxPlayers: room.maxPlayers,
      isActive: room.isActive || false,
      isRunning: room.isRunning || false,
      playerCount: room.playerCount || 0
    }));
    // Wenn ein Raum zuvor ausgewählt war, dessen Daten aktualisieren, falls er noch existiert
    if (selectedRoom.value) {
        const updatedSelectedRoomInfo = predefinedRooms.value.find(r => r.id === selectedRoom.value.id);
        if (updatedSelectedRoomInfo) {
            selectRoom(updatedSelectedRoomInfo); // Wählt den Raum neu aus und aktualisiert selectedRoomData
        } else {
            deselectRoom(); // Der zuvor ausgewählte Raum existiert nicht mehr in der Übersicht
        }
    }
  } else {
    console.error("Admin: Received invalid data for room overview", roomsFromServer);
    errorMessage.value = "Failed to load room data correctly.";
  }
  isLoading.value = false;
};
// --- Handler für die Antwort vom Server ---
const handleAdminRoomDetails = (data) => {
  console.log("Admin: Received 'admin:roomDetails'", data);
  isLoadingDetails.value = false;
  if (data.success && data.details && selectedRoom.value && selectedRoom.value.id === data.details.roomId) {
    selectedRoomData.id = data.details.roomId;
    selectedRoomData.isActive = data.details.isActive;
    selectedRoomData.isRunning = data.details.isRunning;
    selectedRoomData.players = data.details.players || [];
    // Ggf. maxPlayers und andere Infos aus data.details.roomConfig hier auch setzen
    if (data.details.currentRound) {
        currentRoundInfo.roundNumber = data.details.currentRound.roundNumber;
        currentRoundInfo.sourcePlayer = data.details.currentRound.sourcePlayer;
        currentRoundInfo.targetPlayer = data.details.currentRound.targetPlayer;
        currentRoundInfo.targetSymbol = data.details.currentRound.targetSymbol;
    } else {
        currentRoundInfo.roundNumber = 0;
    }
    // readyPlayerCount und playerReadyStatus müssten auch vom Server kommen
    // oder über separate Events aktuell gehalten werden.
    // Für den Moment:
    readyPlayerCount.value = data.details.readyPlayerCount || 0;
    // playerReadyStatus muss serverseitig persistiert und hier gefüllt werden, wenn nötig.
    // Simpler Ansatz: erstmal nur die Liste der Spieler anzeigen.
  } else if (!data.success) {
    errorMessage.value = data.error || "Could not load room details.";
  }
};

const handleRoomStatusUpdate = (updatedRoom) => { 
  console.log("Admin: Received 'admin:roomStatusUpdate'", updatedRoom);
  const index = predefinedRooms.value.findIndex(r => r.id === updatedRoom.roomId);
  // Stelle sicher, dass updatedRoom.status existiert
  if (index !== -1 && updatedRoom.status) { 
    predefinedRooms.value[index].isActive = updatedRoom.status.isActive || false;
    predefinedRooms.value[index].playerCount = updatedRoom.status.playerCount || 0;
    predefinedRooms.value[index].isRunning = updatedRoom.status.isRunning || false;
  }
  
  if (selectedRoom.value && selectedRoom.value.id === updatedRoom.roomId && updatedRoom.status) {
    selectedRoomData.isActive = updatedRoom.status.isActive || false;
    selectedRoomData.isRunning = updatedRoom.status.isRunning || false;
    selectedRoomData.players = updatedRoom.status.players || selectedRoomData.players; // Spielerliste aktualisieren falls vorhanden
    if (!updatedRoom.status.isRunning && !updatedRoom.status.isActive) { // Wenn Raum resettet/deaktiviert wurde
      gameIsEffectivelyOver.value = true; // Markiere die "Sitzung" im Detailview als beendet
      currentRoundInfo.roundNumber = 0;
    }
  }
};

const handleRoomActivated = (data) => { 
  console.log("Admin: Received 'admin:roomActivated'", data);
  actionMessage.value = data.message || `Room ${data.roomId} is now active.`;
  activatingRoomId.value = null; 

  const roomInList = predefinedRooms.value.find(r => r.id === data.roomId);
  if (roomInList && data.status) {
    roomInList.isActive = data.status.isActive;
    roomInList.playerCount = data.status.playerCount;
    roomInList.isRunning = data.status.isRunning;
  }

  if (selectedRoom.value && selectedRoom.value.id === data.roomId && data.status) {
    selectedRoomData.isActive = data.status.isActive;
    selectedRoomData.isRunning = data.status.isRunning;
    selectedRoomData.players = data.status.players || []; 
    selectedRoomData.id = data.roomId;
    gameIsEffectivelyOver.value = false; // Eine neue aktive Sitzung ist nicht "over"
  }
};

const handleAdminPlayerJoinedOrLeft = (data) => { // Kombinierter Handler für Join/Left aus Admin-Perspektive
    console.log("Admin: Received player update for room", data.roomId, data.players);
    if (selectedRoom.value && selectedRoom.value.id === data.roomId) {
        selectedRoomData.players = data.players || [];
    }
    const roomInList = predefinedRooms.value.find(r => r.id === data.roomId);
    if(roomInList) roomInList.playerCount = (data.players || []).length;
};

const handleAdminGameInstanceStarted = (data) => {
    console.log("Admin: Received 'admin:gameInstanceStarted'", data);
    actionMessage.value = `Game in room ${data.roomId} has started.`;
    startingGameId.value = null;
    gameIsEffectivelyOver.value = false; // Spiel läuft, also nicht "over"
    const roomInList = predefinedRooms.value.find(r => r.id === data.roomId);
    if(roomInList) {
      roomInList.isRunning = true;
      roomInList.isActive = true; 
    }
    if (selectedRoom.value && selectedRoom.value.id === data.roomId) {
        selectedRoomData.isRunning = true;
        selectedRoomData.isActive = true;
    }
};

const handleAdminRoomReset = (data) => {
    console.log("Admin: Received 'admin:roomReset'", data);
    actionMessage.value = `Room ${data.roomId} has been reset.`;
    resettingRoomId.value = null;
    
    const roomInList = predefinedRooms.value.find(r => r.id === data.roomId);
    if(roomInList) {
      roomInList.isActive = false; 
      roomInList.isRunning = false;
      roomInList.playerCount = 0;
    }
    if (selectedRoom.value && selectedRoom.value.id === data.roomId) {
        selectedRoomData.isActive = false; 
        selectedRoomData.isRunning = false;
        selectedRoomData.players = [];
        currentRoundInfo.roundNumber = 0;
        gameIsEffectivelyOver.value = true; // Die Detailansicht dieser Sitzung ist "over"
    }
    // Kein explizites Neuladen der Übersicht mehr, da roomStatusUpdate dies tun sollte
    // oder der Server sendet direkt eine aktualisierte roomInList mit.
    // Für maximale Konsistenz kann ein erneutes Laden der Übersicht aber nicht schaden,
    // falls der Server nicht immer alle Admins per 'admin:roomStatusUpdate' erwischt.
    // socket.emit('admin:getRoomOverview'); // Bei Bedarf wieder aktivieren
};

const handleAdminError = (errorData) => {
    errorMessage.value = errorData.message || 'An administrative error occurred.';
    console.error("Admin Error from Server:", errorData);
    activatingRoomId.value = null; 
    startingGameId.value = null;
    resettingRoomId.value = null;
};

const handlePlayerReadyUpdateForAdmin = (data) => { 
  if (selectedRoom.value && selectedRoom.value.id === data.gameId) { // gameId ist hier die roomId
    playerReadyStatus[data.playerId] = true; // Oder Server sendet direkt den Status, nicht nur 'true'
    readyPlayerCount.value = data.readyCount; 
    // Aktualisiere auch die Spielerliste, falls der Server Ready-Flags mitsendet
    const playerInDetail = selectedRoomData.players.find(p => p.id === data.playerId);
    if (playerInDetail) playerInDetail.isReady = true; // Annahme, dass 'isReady' im Player-Objekt ist
  }
};

const handleRoundStartedForAdmin = (data) => { 
  if (selectedRoom.value && selectedRoom.value.id === data.gameId) { // gameId ist hier die roomId
    currentRoundInfo.roundNumber = data.roundNumber;
    currentRoundInfo.sourcePlayer = data.sourcePlayer;
    currentRoundInfo.targetPlayer = data.targetPlayer;
    currentRoundInfo.targetSymbol = data.targetSymbol;
    gameMessage.value = `Round ${data.roundNumber} is active.`; // Nachricht für Admin
  }
};

const handleAllPlayersReadyGameActuallyRunning = (data) => { // Neues Event vom Server
    if (selectedRoom.value && selectedRoom.value.id === data.gameId) {
        actionMessage.value = `All players in room ${data.gameId} are ready. Game is running with rounds.`;
        selectedRoomData.isRunning = true; // Sicherstellen
        gameIsEffectivelyOver.value = false;
    }
     const roomInList = predefinedRooms.value.find(r => r.id === data.gameId);
    if(roomInList) {
        roomInList.isRunning = true;
        roomInList.isActive = true;
    }
};

const handleGameEndedForAdmin = (data) => { // gameId ist hier die roomId
    console.log("Admin: Received 'gameEnded' for a room instance", data);
    actionMessage.value = `Game in room ${data.gameId || data.roomId} ended: ${data.reason || data.message}`;
    const roomId = data.gameId || data.roomId;

    const roomInList = predefinedRooms.value.find(r => r.id === roomId);
    if(roomInList) {
      roomInList.isRunning = false;
      roomInList.isActive = false; // Meistens bedeutet Spielende auch Inaktivität der Lobby
      roomInList.playerCount = 0;
    }
    if(selectedRoom.value && selectedRoom.value.id === roomId) {
        selectedRoomData.isRunning = false;
        selectedRoomData.isActive = false; 
        gameIsEffectivelyOver.value = true;
    }
};


// --- Lifecycle Hooks ---
onMounted(() => {
  console.log("AdminPanel mounted. Emitting 'admin:getRoomOverview'");
  socket.emit('admin:getRoomOverview');

  socket.on('admin:roomOverview', handleRoomOverview);
  socket.on('admin:roomStatusUpdate', handleRoomStatusUpdate);
  socket.on('admin:roomActivated', handleRoomActivated);
  socket.on('admin:playerJoinedRoom', handleAdminPlayerJoinedOrLeft);
  socket.on('admin:playerLeftRoom', handleAdminPlayerJoinedOrLeft);   
  socket.on('admin:gameInstanceStarted', handleAdminGameInstanceStarted);
  socket.on('admin:roomReset', handleAdminRoomReset);
  socket.on('admin:error', handleAdminError);
  
  // socket.on('admin:roomDetailsUpdate', handleAdminRoomDetails); // Falls Server per Event statt Callback antwortet

  socket.on('playerReadyUpdate', handlePlayerReadyUpdateForAdmin); 
  socket.on('roundStartedForHost', handleRoundStartedForAdmin);  
  socket.on('allPlayersReadyGameRunning', handleAllPlayersReadyGameActuallyRunning);
  socket.on('gameEnded', handleGameEndedForAdmin);
  socket.on('gameCancelled', handleAdminRoomReset); 
});

onUnmounted(() => {
  console.log("AdminPanel unmounted. Cleaning up socket listeners.");

  // Admin-spezifische Events
  socket.off('admin:roomOverview', handleRoomOverview);
  socket.off('admin:roomStatusUpdate', handleRoomStatusUpdate);
  socket.off('admin:roomActivated', handleRoomActivated);
  socket.off('admin:playerJoinedRoom', handleAdminPlayerJoinedOrLeft); // Derselbe Handler für beide
  socket.off('admin:playerLeftRoom', handleAdminPlayerJoinedOrLeft);   // Derselbe Handler für beide
  socket.off('admin:gameInstanceStarted', handleAdminGameInstanceStarted);
  socket.off('admin:roomReset', handleAdminRoomReset); // Für expliziten Reset durch Admin
  socket.off('admin:error', handleAdminError);

  // Allgemeine Spiel-Events, die das Admin-Panel auch interessieren (z.B. für den aktuell ausgewählten Raum)
  socket.off('playerReadyUpdate', handlePlayerReadyUpdateForAdmin); 
  socket.off('roundStartedForHost', handleRoundStartedForAdmin);  
  socket.off('allPlayersReadyGameRunning', handleAllPlayersReadyGameActuallyRunning); // Stelle sicher, dass handleAllPlayersReadyGameActuallyRunning definiert ist
  socket.off('gameEnded', handleGameEndedForAdmin); // Für allgemeine Spielende-Events
  socket.off('gameCancelled', handleAdminRoomReset); // Wenn Spielabbruch wie Reset behandelt wird

  // Falls du ein 'admin:roomDetailsUpdate'-Event für die Antwort auf 'admin:getRoomDetails' verwendest (statt Callback),
  // müsste das hier auch abgemeldet werden:
  // socket.off('admin:roomDetailsUpdate', handleAdminRoomDetails);
});

// --- Admin Aktionsmethoden (vom Template aufgerufen) ---
function selectRoom(room) {
  console.log("Admin: Selecting room for details", room.id);
  // Setze den ausgewählten Raum sofort, um die UI-Struktur (Titel etc.) zu aktualisieren
  selectedRoom.value = { ...room }; // Kopie des Raum-Objekts aus der Liste
  
  // Setze Standardwerte für selectedRoomData oder zeige Ladezustand
  selectedRoomData.id = room.id;
  selectedRoomData.isActive = room.isActive; // Übernehme Status aus Übersicht als vorläufigen Wert
  selectedRoomData.isRunning = room.isRunning;
  selectedRoomData.players = []; // Leere Spielerliste, bis Details vom Server kommen
  currentRoundInfo.roundNumber = 0; 
  for (const key in playerReadyStatus) delete playerReadyStatus[key];
  readyPlayerCount.value = 0;
  actionMessage.value = ''; 
  errorMessage.value = '';
  gameIsEffectivelyOver.value = !room.isActive; 

  // Wenn der Raum (potenziell) aktiv ist oder einfach um immer frische Daten zu haben:
  isLoadingDetails.value = true;
  console.log(`Admin: Emitting 'admin:getRoomDetails' for room ${room.id}`);
  socket.emit('admin:getRoomDetails', { roomId: room.id }, (response) => {
      // Verarbeitung der Antwort direkt hier im Callback
      handleAdminRoomDetails(response);
  });
}

function deselectRoom() {
  selectedRoom.value = null;
  selectedRoomData.id = null;
  selectedRoomData.isActive = false;
  selectedRoomData.isRunning = false;
  selectedRoomData.players = [];
  actionMessage.value = '';
  errorMessage.value = '';
  gameIsEffectivelyOver.value = false; // Zurück zur Listenansicht, kein Spiel ist "over" im Detailkontext
}

function activateRoom(roomId) {
  console.log("Admin: Emitting 'admin:activateRoom' for", roomId);
  errorMessage.value = ''; actionMessage.value = '';
  activatingRoomId.value = roomId;
  socket.emit('admin:activateRoom', { roomId });
}

function triggerStartGame(roomId) {
  console.log("Admin: Emitting 'admin:startGameInstance' for", roomId);
  errorMessage.value = ''; actionMessage.value = '';
  startingGameId.value = roomId;
  socket.emit('admin:startGameInstance', { roomId });
}

function triggerResetRoom(roomId) {
  console.log("Admin: Emitting 'admin:resetRoom' for", roomId);
  errorMessage.value = ''; actionMessage.value = '';
  resettingRoomId.value = roomId;
  socket.emit('admin:resetRoom', { roomId });
}

// Funktion, die aufgerufen werden könnte, wenn ein Spiel vorbei ist und der Admin die Detailansicht verlässt
// um einen neuen Raum zu erstellen/aktivieren.
function resetLobbyStateAndAllowNewCreation() {
    deselectRoom(); // Kehrt zur Raumliste zurück
    // Die Raumliste sollte sich über `admin:getRoomOverview` oder `admin:roomStatusUpdate` selbst aktualisieren
}

</script>
<style scoped>
.admin-panel {
  padding: 20px;
  font-family: sans-serif;
  max-width: 900px;
  margin: auto;
}
.loading, .error-message {
  padding: 10px;
  margin-bottom: 15px;
  border-radius: 4px;
}
.loading {
  background-color: #e0e0e0;
}
.error-message {
  background-color: #ffdddd;
  color: #d8000c;
}
.room-list ul {
  list-style: none;
  padding: 0;
}
.room-list li {
  padding: 10px 15px;
  border: 1px solid #ccc;
  margin-bottom: 8px;
  border-radius: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  transition: background-color 0.2s;
}
.room-list li:hover {
  background-color: #f0f0f0;
}
.room-list li.active {
  border-left: 5px solid #4CAF50; /* Grün für aktiv */
}
.room-list li.running {
  border-left: 5px solid #2196F3; /* Blau für laufend */
}
.room-list button {
  margin-left: 10px;
  padding: 5px 10px;
  cursor: pointer;
}
.room-details {
  margin-top: 20px;
  padding: 15px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: #f9f9f9;
}
.room-details h4 {
  margin-top: 15px;
  margin-bottom: 5px;
}
.room-details .actions button {
  margin-right: 10px;
  margin-top:10px;
  padding: 8px 15px;
}
.back-button {
  margin-bottom: 15px;
  background-color: #6c757d;
  color:white;
  border:none;
  padding: 8px 15px;
  border-radius:4px;
  cursor:pointer;
}
.reset-button {
  background-color: #f44336;
  color:white;
}
.manage-button {
    background-color: #007bff;
    color:white;
}
.view-button {
    background-color: #17a2b8;
}
.qr-code-placeholder {
  width: 128px; /* Beispielgröße */
  height: 128px;
  background-color: #eee;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 10px 0;
  border: 1px dashed #ccc;
  color: #777;
}
.ready-status {
  color: green;
  font-weight: bold;
  font-size: 0.9em;
  margin-left: 5px;
}
.round-info-admin {
    margin-top: 1rem;
    padding: 0.75rem;
    background-color: #e9ecef;
    border: 1px solid #ced4da;
    border-radius: 4px;
    font-size: 0.9em;
}
</style>