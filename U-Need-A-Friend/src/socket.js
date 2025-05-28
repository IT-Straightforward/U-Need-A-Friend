import { io } from 'socket.io-client';

let socket;
const localBackendUrl = 'http://localhost:3000'; // Deine lokale Backend-URL

// Vite stellt import.meta.env.DEV bereit (true im Dev-Modus, false im Prod-Build)
if (import.meta.env.DEV) {
  socket = io(localBackendUrl, {
    // Optionale zusätzliche Optionen für die Entwicklung, falls nötig
    // z.B. um sicherzustellen, dass Websockets verwendet werden:
    // transports: ['websocket'],
  });
  console.log(`Socket.IO (Frontend): Verbinde mit lokalem Dev-Server: ${localBackendUrl}`);
} else {
  // Produktionsmodus: Verbinde mit dem Server, von dem das Frontend geladen wurde.
  // Da dein Docker-Setup das Frontend vom Backend ausliefert, ist dies der richtige Weg.
  socket = io(); 
  console.log('Socket.IO (Frontend): Verbinde mit Origin-Server (Produktionsmodus).');
}

// Hilfreiche Logs für Verbindungsstatus (optional, aber gut für Debugging)
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