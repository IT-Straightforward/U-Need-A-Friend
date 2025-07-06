// src/router.js
import { createRouter, createWebHistory } from 'vue-router';
import AdminPanel from '@/components/AdminPanel.vue';
import Redirect from '@/components/Redirect.vue';
import Game from '@/components/Game.vue';
import WaitingRoom from '@/components/WaitingRoom.vue';
import { useGameSessionStore } from '@/stores/gameSessionStore';
import { useRoomDefinitionsStore } from '@/stores/roomDefinitionsStore';

const routes = [
  { path: '/', redirect: '/redirect' },
  { path: '/redirect', component: Redirect }, 
  { path: '/create', component: AdminPanel },
  {
    path: '/game/:gameId',
    name: 'GameView',
    component: Game,
    props: true,
beforeEnter: async (to, from, next) => {
  const gameIdFromRoute = to.params.gameId; // z.B. "STUDIO_1"

  const gameSessionStore = useGameSessionStore();
  const roomDefsStore = useRoomDefinitionsStore();

  // 1. Sicherstellen, dass die Raumdefinitionen geladen sind (dieser Teil ist gut so).
  if (roomDefsStore.rooms.length === 0 && !roomDefsStore.isLoading) {
    try {
      await roomDefsStore.fetchRoomDefinitions();
    } catch (error) {
      console.error('[Router Guard] Kritischer Fehler beim Laden der Raumdefinitionen:', error);
      gameSessionStore.setCurrentThemeFolder('default'); // Fallback bei Ladefehler
      next();
      return;
    }
  }
  
  // 2. NEU: Die Basis-ID aus der Routen-ID extrahieren.
  const baseRoomId = gameIdFromRoute.split('_')[0].toUpperCase(); // "STUDIO_1" -> "STUDIO"

  // 3. GEÄNDERT: Suche mit der extrahierten Basis-ID.
  const roomDefinition = roomDefsStore.getRoomById(baseRoomId); // Suche nach "STUDIO"

  if (roomDefinition) {
    // Konvention: Theme-Ordner ist immer die ID des Raumes in Kleinbuchstaben.
    const themeToSet = roomDefinition.id.toLowerCase(); // "studio"
    gameSessionStore.setCurrentThemeFolder(themeToSet);
    console.log(`[Router Guard] Theme für Spiel '${gameIdFromRoute}' gesetzt auf: '${themeToSet}'`);
  } else {
    // Dieser Fall sollte jetzt nur noch eintreten, wenn die Basis-ID wirklich ungültig ist.
    console.warn(`[Router Guard] Keine Definition für Basis-Raum '${baseRoomId}' gefunden. Fallback auf 'default' Theme.`);
    gameSessionStore.setCurrentThemeFolder('default');
  }

  next(); // Wichtig: Navigation fortsetzen!
}
  },
  {
    path: '/waiting/:gameId',
    name: 'WaitingRoom',
    component: WaitingRoom,
    props: true
  }
];

export default createRouter({
  history: createWebHistory(),
  routes
});