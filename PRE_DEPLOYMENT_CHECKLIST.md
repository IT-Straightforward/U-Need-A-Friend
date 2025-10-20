# MemoryBreakout: Pre-Deployment Checklist

## 🎯 Still TODO Before Push to MemoryBreakout Repo

### 1. Directory Rename (Manual)

The directory `U-Need-A-Friend/` should be renamed to `MemoryBreakout/`:

```bash
# In your file explorer or terminal:
mv "U-Need-A-Friend" "MemoryBreakout"
```

Or via PowerShell:

```powershell
Rename-Item -Path "U-Need-A-Friend" -NewName "MemoryBreakout"
```

### 2. Verify Icon Folder Exists

Ensure that icons are in the correct location:

```
MemoryBreakout/src/assets/icons/studio/
```

All 9+ SVG/image files should be there for the game to work.

### 3. Update `.gitignore`

If not already present, ensure `.gitignore` includes:

```
node_modules/
dist/
.env
.env.local
.DS_Store
*.log
```

### 4. Git Setup for New Repo

```bash
# Clone or create the new repo at GitHub
git remote remove origin  # Remove old remote if exists
git remote add origin https://github.com/DenKedi/MemoryBreakout.git
git branch -M main
git push -u origin main
```

### 5. Backend: Heroku Setup (After Heroku Status Improves)

```bash
# Install Heroku CLI and login
heroku login
heroku create memory-breakout  # or your preferred name
heroku config:set NODE_ENV=production
git push heroku main
```

### 6. Frontend: Cloudflare Pages Setup

- Connect GitHub repo to Cloudflare Pages
- Build command: `npm --prefix MemoryBreakout run build`
- Build output: `MemoryBreakout/dist`
- Root directory: `/`
- Environment variables:
  - `VITE_BACKEND_URL`: (set to your Heroku backend URL once deployed)

### 7. Socket.IO CORS (Heroku)

Update `backend/server.js` if needed for production CORS:

```javascript
const io = new Server(server, {
  cors: {
    origin: ['https://memory-breakout.bleck.it'], // Add Cloudflare domain
    methods: ['GET', 'POST'],
  },
});
```

### 8. Test Multiplayer

Once deployed:

- Open `https://memory-breakout.bleck.it` in multiple browser tabs
- Verify they can join the same game via `/redirect`
- Test card flipping and match logic

## ✅ Already Complete

- ✅ `.github/copilot-instructions.md` updated
- ✅ `Dockerfile` removed
- ✅ `predefinedRooms.json` removed
- ✅ `roomDefinitionsStore.js` removed
- ✅ `router.js` simplified
- ✅ `socket.js` updated for Heroku URLs
- ✅ `package.json` paths updated to reference `MemoryBreakout/`
- ✅ `backend/server.js` icon path updated

## 📚 Documentation

- See `MIGRATION_NOTES.md` for complete migration details
- See `.github/copilot-instructions.md` for project-specific development guidance
