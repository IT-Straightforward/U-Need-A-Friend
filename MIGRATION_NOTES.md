# Migration to MemoryBreakout Repository

## Summary of Changes

This document tracks the migration from U-Need-A-Friend to MemoryBreakout repository at https://github.com/DenKedi/MemoryBreakout.git with separate Heroku backend and Cloudflare frontend deployments.

## ✅ Changes Completed

### 1. **Updated `.github/copilot-instructions.md`**

- Changed project name to "MemoryBreakout"
- Updated repository URL to `https://github.com/DenKedi/MemoryBreakout.git`
- Updated hosting info: Cloudflare frontend at `memory-breakout.bleck.it`, Heroku backend
- Removed Docker-specific deployment instructions
- Simplified theme documentation (single "studio" theme)
- Removed multi-room patterns
- Updated file paths from `U-Need-A-Friend/` to `MemoryBreakout/`

### 2. **Removed `Dockerfile`** ✂️

- No longer needed since frontend and backend are deployed separately
- Frontend: Vite build → Cloudflare
- Backend: Node.js → Heroku

### 3. **Updated `MemoryBreakout/src/socket.js`**

```javascript
// Now uses VITE_BACKEND_URL env var for production
const herokuBackendUrl =
  import.meta.env.VITE_BACKEND_URL || 'https://memory-breakout.herokuapp.com';
```

- Dev mode: `http://localhost:3000`
- Prod mode: Uses `VITE_BACKEND_URL` env var or falls back to Heroku URL
- Configure in Cloudflare build settings: `VITE_BACKEND_URL=<your-heroku-url>`

### 4. **Removed `backend/predefinedRooms.json`** ✂️

- No longer needed; only `ROOM_TEMPLATE` (STUDIO) is used
- Reduces clutter and maintenance

### 5. **Removed `MemoryBreakout/src/stores/roomDefinitionsStore.js`** ✂️

- Eliminated unnecessary store for multi-room system
- No more fetching room definitions from backend

### 6. **Simplified `MemoryBreakout/src/router.js`**

- Removed import of `roomDefinitionsStore`
- Router guard now always sets theme to `'studio'`
- Removed logic to dynamically load room definitions

### 7. **Updated root `package.json`**

```json
{
  "name": "memory-breakout",
  "description": "Multiplayer memory card game",
  "scripts": {
    "dev:client": "npm --prefix MemoryBreakout run dev", // Changed from U-Need-A-Friend
    "dev:server": "npm --prefix backend run dev"
  }
}
```

### 8. **Updated `backend/server.js`**

- Changed icon path from `U-Need-A-Friend` to `MemoryBreakout`
- Verified no references to `predefinedRooms.json`

## 📋 Next Steps for Deployment

### Backend (Heroku)

```bash
# From backend directory
npm install
git remote add heroku <your-heroku-git-url>
git push heroku main
```

- Set `PORT` env var if needed (default: 3000)
- Backend will auto-scan `MemoryBreakout/src/assets/icons/studio/` for icon files

### Frontend (Cloudflare)

```bash
# Build for production
npm run build

# Deploy MemoryBreakout/dist to Cloudflare Pages
# Configure build command: npm --prefix MemoryBreakout run build
# Configure build output: MemoryBreakout/dist
# Set env var: VITE_BACKEND_URL=<your-heroku-url>
```

## 🔧 Development

```bash
# From repository root
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:3000`

## 📝 Notes

- **Single Room**: App now hardcoded to "STUDIO" theme with 9 shuffled cards per game
- **Icons**: All located in `MemoryBreakout/src/assets/icons/studio/`
- **No Database**: Game state held in-memory on backend (`games` object in `server.js`)
- **German Comments**: Existing German comments in code; new code should use English
- **Testing**: No automated tests implemented; manual testing via multiple browser tabs

## 🚀 Important Configuration

Before deployment to Heroku, ensure the backend can find icons:

In **dev mode**: Backend reads from `MemoryBreakout/src/assets/icons/`  
In **prod mode** (Heroku): Backend reads from `backend/assets_from_frontend/icons/`

If deploying to Heroku without Docker, manually copy icon folder or adjust `ICONS_BASE_PATH` logic in `server.js`.
