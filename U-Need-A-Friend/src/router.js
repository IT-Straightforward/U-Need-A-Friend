// src/router.js
import { createRouter, createWebHistory } from 'vue-router';
import AdminPanel from '@/components/AdminPanel.vue';
import JoinGame from '@/components/JoinGame.vue';
import Game from '@/components/Game.vue';
import WaitingRoom from '@/components/WaitingRoom.vue';
import { useGameSessionStore } from '@/stores/gameSessionStore';
import { useRoomDefinitionsStore } from '@/stores/roomDefinitionsStore';

const routes = [
  { path: '/', redirect: '/create' },
  { path: '/join', component: JoinGame },
  { path: '/create', component: AdminPanel },
  {
    path: '/game/:gameId',
    name: 'GameView',
    component: Game,
    props: true,
     beforeEnter: async (to, from, next) => {
      const gameIdFromRoute = to.params.gameId;

      const gameSessionStore = useGameSessionStore();
      const roomDefsStore = useRoomDefinitionsStore();

      // 1. Sicherstellen, dass die Raumdefinitionen geladen sind.
      //    (Dieser Teil bleibt wie von dir gepostet und ist gut so)
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
        // Hier könnte man noch robuster warten, aber für den Start ist es okay,
        // wenn fetchRoomDefinitions so gebaut ist, dass es schnell ist oder schon läuft.
      }

      // 2. Raumdefinition anhand der gameId aus dem Store holen und Theme per Konvention setzen.
      const roomDefinition = roomDefsStore.getRoomById(gameIdFromRoute);

      if (roomDefinition) {
        // Konvention: Theme-Ordner ist immer die ID des Raumes in Kleinbuchstaben.
        const themeToSet = roomDefinition.id.toLowerCase();
        gameSessionStore.setCurrentTheme(themeToSet);
        console.log(`[Router Guard] Theme für Spiel '${gameIdFromRoute}' (via Konvention) gesetzt auf: '${themeToSet}'`);
      } else {
        // Keine Raumdefinition gefunden, Fallback auf 'default'
        console.warn(`[Router Guard] Keine Definition für Spiel '${gameIdFromRoute}' gefunden. Fallback auf 'default' Theme.`);
        gameSessionStore.setCurrentTheme('default');
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