# code/Dockerfile

# ----- Frontend Build Stage -----
# Diese Stage baut deine Vue.js Frontend-Anwendung.
FROM node:18-alpine AS frontend-builder

# Setze das Arbeitsverzeichnis für die Frontend-Build-Schritte
WORKDIR /app/frontend

# Kopiere package.json und package-lock.json für das Frontend
# Das Sternchen bei package-lock.json* stellt sicher, dass es auch funktioniert, wenn die Datei nicht existiert (obwohl sie sollte).
COPY U-Need-A-Friend/package.json U-Need-A-Friend/package-lock.json* ./

# Installiere Frontend-Abhängigkeiten basierend auf package-lock.json (oder package.json)
RUN npm install

# Kopiere den Rest des Frontend-Quellcodes
# (nachdem npm install gelaufen ist, um den Docker-Cache besser zu nutzen)
COPY U-Need-A-Friend/ ./

# Baue die Frontend-Anwendung für die Produktion
# Das Ergebnis (statische Dateien) landet typischerweise in einem 'dist'-Ordner (z.B. /app/frontend/dist)
RUN npm run build


# ----- Backend Setup Stage (Finales Image) -----
# Diese Stage erstellt das finale Image mit dem Node.js Backend und den gebauten Frontend-Dateien.
FROM node:18-alpine

# Setze das Hauptarbeitsverzeichnis für die Anwendung im Container
WORKDIR /app

# --- Backend-spezifische Dateien kopieren und Abhängigkeiten installieren ---

# Kopiere package.json und package-lock.json für das Backend
COPY backend/package.json backend/package-lock.json* ./backend/

# Installiere nur die Produktions-Abhängigkeiten für das Backend
RUN cd backend && npm install --omit=dev

# Kopiere den Rest des Backend-Codes
COPY backend/ ./backend/

# --- Frontend-Assets und Icon-Quellordner kopieren ---

# ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
# +++ NEU / GEÄNDERT: Kopiere die Icon-Quellordner des Frontends ins Backend-Verzeichnis +++
# +++ Damit der Server zur Laufzeit darauf zugreifen kann, um die Icon-Listen zu erstellen. +++
# +++ Annahme: Dein Docker-Kontext (wo 'docker build' ausgeführt wird) ist das      +++
# +++ Hauptverzeichnis deines Projekts, das sowohl 'U-Need-A-Friend' als auch      +++
# +++ 'backend' als Unterordner enthält.                                            +++
# ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
COPY U-Need-A-Friend/src/assets/icons ./backend/assets_from_frontend/icons/

# Kopiere die gebaute Frontend-Anwendung (aus dem 'dist'-Ordner der frontend-builder Stage)
# in einen Unterordner von 'backend', von dem Express sie ausliefern wird.
COPY --from=frontend-builder /app/frontend/dist ./backend/public_frontend/


# --- Finale Konfiguration und Startbefehl ---

# Setze den Arbeitsordner auf das Backend-Verzeichnis für den CMD-Befehl
WORKDIR /app/backend

# Definiere den Port, den dein Backend-Server standardmäßig überwacht.
# Dein Hosting-Provider (z.B. Back4App) wird diesen Port wahrscheinlich dynamisch setzen oder mappen.
EXPOSE 3000

# Kommando zum Starten des Backend-Servers.
# Stelle sicher, dass in backend/package.json ein "start"-Skript definiert ist,
# z.B.: "scripts": { "start": "node server.js" } (oder index.js, je nachdem wie deine Hauptdatei heißt)
CMD [ "npm", "start" ]