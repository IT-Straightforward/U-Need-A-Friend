// stores/roomDefinitionsStore.js
import { defineStore } from 'pinia';
import { ref } from 'vue';
import  socket  from '@/socket';

export const useRoomDefinitionsStore = defineStore('roomDefinitions', () => {
  const rooms = ref([]);
  const isLoading = ref(false);
  const error = ref(null);

  async function fetchRoomDefinitions() {
    if ((rooms.value.length > 0 && !error.value) || isLoading.value) {
      if (isLoading.value) {
        console.log('[RoomDefinitionsStore] Ladevorgang läuft bereits.');
        return;
      }
      if (rooms.value.length > 0) {
        console.log('[RoomDefinitionsStore] Raumdefinitionen bereits geladen.');
        return;
      }
    }

    isLoading.value = true;
    error.value = null;
    console.log('[RoomDefinitionsStore] Fordere Raumdefinitionen über Socket an...');

    return new Promise((resolve, reject) => {
      // Listener für die Daten-Antwort (nur einmal ausführen)
      socket.once('predefined-rooms-data', (data) => {
        console.log('[RoomDefinitionsStore] Raumdefinitionen über Socket empfangen:', data);
        rooms.value = data;
        isLoading.value = false;
        resolve(rooms.value);
      });

      socket.once('predefined-rooms-error', (errorData) => {
        console.error('[RoomDefinitionsStore] Fehler beim Empfangen der Raumdefinitionen über Socket:', errorData);
        error.value = errorData.message || 'Unbekannter Socket-Fehler';
        isLoading.value = false;
        reject(new Error(error.value)); // Das Promise mit einem Fehler ablehnen
      });

      // Den Request an den Server senden
      socket.emit('request-room');

      // Optional: Timeout für die Anfrage
      setTimeout(() => {
        if (isLoading.value) { // Immer noch am Laden nach Timeout
          const timeoutMsg = 'Timeout beim Warten auf Raumdefinitionen vom Socket-Server.';
          console.error(`[RoomDefinitionsStore] ${timeoutMsg}`);
          error.value = timeoutMsg;
          isLoading.value = false;
          reject(new Error(timeoutMsg));
        }
      }, 10000); // 10 Sekunden Timeout
    });
  }

  function getRoomById(id) {
    if (!id) return null;
    return rooms.value.find(room => room.id.toUpperCase() === id.toUpperCase());
  }

  return {
    rooms,
    isLoading,
    error,
    fetchRoomDefinitions,
    getRoomById
  };
});