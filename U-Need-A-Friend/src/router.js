// src/router.js
import { createRouter, createWebHistory } from 'vue-router';
import Redirect from '@/components/Redirect.vue';
import Game from '@/components/Game.vue';
import WaitingRoom from '@/components/WaitingRoom.vue';
import { useGameSessionStore } from '@/stores/gameSessionStore';
import { useRoomDefinitionsStore } from '@/stores/roomDefinitionsStore';

const routes = [
  { path: '/', redirect: '/redirect' },
  { path: '/redirect', component: Redirect },
  {
    path: '/game/:gameId',
    name: 'GameView',
    component: Game,
    props: true,
     beforeEnter: async (to, from, next) => {
      const gameIdFromRoute = to.params.gameId;

      const gameSessionStore = useGameSessionStore();
      const roomDefsStore = useRoomDefinitionsStore();


      if (roomDefsStore.rooms.length === 0 && !roomDefsStore.isLoading) {
        console.log('[Router Guard] Raumdefinitionen noch nicht geladen. Starte Fetch...');
        try {
          await roomDefsStore.fetchRoomDefinitions();
          console.log('[Router Guard] Raumdefinitionen nach Fetch im Guard geladen.');
        } catch (error) {
          console.error('[Router Guard] Fehler beim Laden der Raumdefinitionen im Guard:', error);
          gameSessionStore.setCurrentTheme('default');
          next();
          return;
        }
      } else if (roomDefsStore.isLoading) {
        console.log('[Router Guard] Raumdefinitionen laden gerade... (wird fortgesetzt, wenn fetch abgeschlossen).');
      }


const baseRoomId = gameIdFromRoute.split('_')[0]; 
const roomDefinition = roomDefsStore.getRoomById(baseRoomId);

      if (roomDefinition) {
        // Konvention: Theme-Ordner ist immer die ID des Raumes in Kleinbuchstaben.
        const themeToSet = roomDefinition.id.toLowerCase();
        gameSessionStore.setCurrentTheme(themeToSet);
        console.log(`[Router Guard] Theme für Spiel '${gameIdFromRoute}' (via Konvention) gesetzt auf: '${themeToSet}'`);
      } else {

        console.warn(`[Router Guard] Keine Definition für Spiel '${gameIdFromRoute}' gefunden. Fallback auf 'default' Theme.`);
        gameSessionStore.setCurrentTheme('default');
      }

      next();
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