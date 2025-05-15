// src/main.js
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');  // URL of backend server

const app = createApp(App);

// Provide the socket to all components (so they can inject it)
app.provide('socket', socket);

app.use(router);
app.mount('#app');
