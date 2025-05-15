// src/router.js
import { createRouter, createWebHistory } from 'vue-router';
import CreateGame from '@/components/CreateGame.vue';
import JoinGame from '@/components/JoinGame.vue';
import Game from '@/components/Game.vue'; // Import der Game-Komponente
import WaitingRoom from '@/components/WaitingRoom.vue';

const routes = [
  { path: '/', redirect: '/join' },
  { path: '/join', component: JoinGame },
  { path: '/create', component: CreateGame },
  {
    path: '/game/:gameId', 
    name: 'GameView',      
    component: Game,
    props: true          
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