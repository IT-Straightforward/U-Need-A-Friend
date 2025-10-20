import { io } from 'socket.io-client';

let socket;
const localBackendUrl = 'http://localhost:3000'; // lokale Backend-URL
const herokuBackendUrl = import.meta.env.VITE_BACKEND_URL || 'https://memory-breakout.herokuapp.com'; // Heroku production URL

if (import.meta.env.DEV) {
  socket = io(localBackendUrl, {
  });
  console.log(`Socket.IO (Frontend): Verbinde mit lokalem Dev-Server: ${localBackendUrl}`);
} else {
  socket = io(herokuBackendUrl); 
  console.log(`Socket.IO (Frontend): Verbinde mit Heroku-Backend: ${herokuBackendUrl}`);
}

socket.on('connect', () => {
  console.log(`Socket.IO (Frontend): Verbunden! Socket ID: ${socket.id}`);
});

socket.on('disconnect', (reason) => {
  console.log(`Socket.IO (Frontend): Verbindung getrennt - Grund: ${reason}`);
});

socket.on('connect_error', (error) => {
  console.error('Socket.IO (Frontend): Verbindungsfehler!', error);
});

export default socket;