import { defineStore } from 'pinia';
import { ref } from 'vue';

const roomTemplate = { 
  "id": "STUDIO",
  "name": "The Studio",
  "maxPlayers": 3,
  "description": "The Studio by Ralf Hebecker",
  "pastelPalette": {
    "primary": "#a8d5ba",
    "accent1": "#d6ecd2",
    "accent2": "#b0e0c9",
    "accent3": "#e9f5ea"
  }
};

export const useRoomDefinitionsStore = defineStore('roomDefinitions', () => {
  const rooms = ref([roomTemplate]);
  function getRoomById(id) {
    if (!id) return null;
    const baseId = id.split('_')[0].toUpperCase();
    return rooms.value.find(room => room.id.toUpperCase() === baseId);
  }
  return {
    rooms,
    getRoomById
  };
});