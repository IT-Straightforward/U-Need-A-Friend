import { createApp } from 'vue';
import { createPinia } from 'pinia' 
import App from './App.vue';
import router from './router';
import socket from './socket'; 

const app = createApp(App);

app.provide('socket', socket);

app.use(router);
app.use(createPinia()) 
app.mount('#app');