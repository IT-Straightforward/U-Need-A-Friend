// frontend/src/stores/gameSessionStore.js

import { defineStore } from 'pinia'
import { ref } from 'vue'

// 'gameSession' ist die ID des Stores, sie muss eindeutig sein.
export const useGameSessionStore = defineStore('gameSession', () => {
  // State (Zustand)
  const currentThemeFolder = ref('default'); // Initialer/Fallback-Wert

  // Actions (Methoden, um den Zustand zu ändern)
  function setCurrentTheme(themeName) {
    if (themeName && typeof themeName === 'string') {
      currentThemeFolder.value = themeName;
      console.log('[Pinia Store] Current theme folder set to:', currentThemeFolder.value);
    } else {
      console.warn('[Pinia Store] Attempted to set invalid theme name:', themeName);
    }
  }
  function setCurrentThemeFolder(theme) {
    console.log(`[Pinia Store] Current theme folder set to: ${theme}`);
    currentThemeFolder.value = theme;
  }


  return {
    currentThemeFolder,
    setCurrentTheme,
    setCurrentThemeFolder
  }
})