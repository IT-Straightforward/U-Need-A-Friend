# code/Dockerfile

# ----- Frontend Build Stage -----
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

# Kopiere package.json und package-lock.json für das Frontend
COPY U-Need-A-Friend/package.json U-Need-A-Friend/package-lock.json* ./

# Installiere Frontend-Abhängigkeiten
RUN npm install

# Kopiere den Rest des Frontend-Codes
COPY U-Need-A-Friend/ ./

# Baue die Frontend-Anwendung
RUN npm run build 
# Annahme: Das Ergebnis landet in /app/frontend/dist


# ----- Backend Setup Stage (Final Image) -----
FROM node:18-alpine

WORKDIR /app

# Kopiere package.json und package-lock.json für das Backend
COPY backend/package.json backend/package-lock.json* ./backend/

# Installiere Backend-Abhängigkeiten (nur Produktions-Abhängigkeiten)
RUN cd backend && npm install --omit=dev

# Kopiere den Rest des Backend-Codes
COPY backend/ ./backend/

# Kopiere die gebaute Frontend-Anwendung aus der vorherigen Stage
# Die statischen Dateien werden in einen Ordner gelegt, den Express dann ausliefern kann
COPY --from=frontend-builder /app/frontend/dist ./backend/public_frontend/

# Setze den Arbeitsordner auf das Backend-Verzeichnis für den CMD-Befehl
WORKDIR /app/backend

# Port, den dein Backend-Server überwacht (sollte process.env.PORT verwenden)
# Back4App wird diesen Port wahrscheinlich überschreiben oder mappen.
EXPOSE 3000 

# Kommando zum Starten des Backend-Servers
# Stellt sicher, dass in backend/package.json ein "start"-Skript definiert ist: "start": "node index.js"
CMD [ "npm", "start" ]