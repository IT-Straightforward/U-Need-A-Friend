# MemoryBreakout: AI Coding Agent Instructions

## Project Overview

Real-time multiplayer memory card game. Players cooperatively flip cards to find matches in "The Studio" theme. Built as a monorepo with Vue.js frontend and Socket.IO backend.

**Repository**: https://github.com/DenKedi/MemoryBreakout.git  
**Frontend**: Hosted on `memory-breakout.bleck.it` (Cloudflare)  
**Backend**: Hosted on Heroku (when available)

## Architecture

### Monorepo Structure

- **Root `/`**: Orchestrator with `npm run dev` using `concurrently` to start both client and server
- **`MemoryBreakout/`**: Vue 3 + Vite frontend (port 5173 in dev)
- **`backend/`**: Express + Socket.IO server (port 3000 in dev, Heroku in prod)

### Real-Time Communication Pattern

**Socket.IO bidirectional events** drive all game logic:

- Frontend: Global socket singleton at `MemoryBreakout/src/socket.js` (injected via `provide/inject`)
- Backend: Central event handlers in `backend/server.js` (lines 303-835)
- **Production URL**: Backend automatically connects to Heroku endpoint (set via `VITE_BACKEND_URL` env var)
- **Dev URL**: Connects to `http://localhost:3000`
- Key events: `joinGame`, `playerMadeSelection`, `turnBegan`, `turnResolve`, `gameInitialized`
- State lives on backend; frontend is mostly stateless except for UI optimizations

**Example flow**: Player clicks card → `socket.emit('playerMadeSelection')` → Backend validates → `io.to(roomId).emit('turnResolve')` → All clients update

### Single Theme: "The Studio"

Single hardcoded room simplifies architecture:

- **Theme ID**: `STUDIO`
- **Icons folder**: `MemoryBreakout/src/assets/icons/studio/`
- **Backend config**: `ROOM_TEMPLATE` in `backend/server.js` (no longer reads `predefinedRooms.json`)
- 9 icon symbols per game, randomly shuffled from `studio/` folder
- Backend auto-scans icon folder at startup

## Development Workflow

### Starting Development

```powershell
# From repository root
npm run dev  # Starts both frontend (Vite) and backend (nodemon) concurrently
```

Frontend: http://localhost:5173 | Backend: http://localhost:3000

### Project-Specific Commands

- `npm run dev:client` - Frontend only
- `npm run dev:server` - Backend only
- `npm run build` - Build frontend for production (outputs to `MemoryBreakout/dist`)

### Deployment

**Frontend**: Build & deploy to Cloudflare manually (outputs to `MemoryBreakout/dist`)  
**Backend**: Deployed to Heroku via Git push (configure via Heroku CLI)

## Key Conventions

### State Management

- **Pinia stores**:
  - `gameSessionStore.js`: Current theme folder (set to `"studio"` at app start)
- Backend is source of truth; frontend is mostly stateless

### Component Communication

- **Inject socket globally**: `const socket = inject('socket')` (set in `main.js`)
- Use Vue Router for navigation between game states: `/redirect` → `/waiting/:gameId` → `/game/:gameId`
- AdminPanel manages multiple concurrent game sessions via QR codes

### File Naming & Structure

- Vue components use PascalCase: `GameIcon.vue`, `WaitingRoom.vue`
- Backend uses camelCase functions: `setupNewGameBoard()`, `handlePlayerDisconnect()`
- German comments in code (legacy); use English for new code

### Icon Management

- Single "studio" theme with icons at `MemoryBreakout/src/assets/icons/studio/`
- Backend function `getSymbolPoolForTheme("studio")` reads filesystem at startup
- Frontend `GameIcon.vue` uses `:iconName` and `:themeFolder` props with dynamic imports

## Common Pitfalls

1. **Backend URL**: Production uses Heroku endpoint. Check `socket.js` for `VITE_BACKEND_URL` env var setup
2. **Theme Not Set**: Router guard MUST set theme before Game.vue mounts. Check `gameSessionStore.currentThemeFolder`
3. **Socket Event Timing**: Use `socket.once('connect')` in Redirect.vue pattern to avoid duplicate listeners
4. **Room ID Format**: GameIds are `STUDIO_{suffix}` (e.g., `STUDIO_1`)
