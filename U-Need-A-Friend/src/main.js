import { createApp } from 'vue';
import { createPinia } from 'pinia' 
import App from './App.vue';
import router from './router';
import socket from './socket'; // <<< Importiere die konfigurierte Socket-Instanz

const app = createApp(App);

// Stelle die zentrale Socket-Instanz allen Komponenten über inject('socket') bereit
app.provide('socket', socket);

app.use(router);
app.use(createPinia()) 

app.mount('#app');