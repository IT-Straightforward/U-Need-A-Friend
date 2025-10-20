// src/router.js
import { createRouter, createWebHistory } from 'vue-router';
import AdminPanel from '@/components/AdminPanel.vue';
import Redirect from '@/components/Redirect.vue';
import Game from '@/components/Game.vue';
import WaitingRoom from '@/components/WaitingRoom.vue';
import { useGameSessionStore } from '@/stores/gameSessionStore';

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
  const gameIdFromRoute = to.params.gameId; 

  const gameSessionStore = useGameSessionStore();

  // Always set theme to 'studio' for MemoryBreakout (single-room app)
  gameSessionStore.setCurrentThemeFolder('studio');
  console.log(`[Router Guard] Theme für Spiel '${gameIdFromRoute}' gesetzt auf: 'studio'`);

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