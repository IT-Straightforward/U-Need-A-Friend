<template>
  <img v-if="imageUrl" :src="imageUrl" alt="Game Icon" class="game-png-icon" />
  
  <span v-else-if="isLoading" class="icon-loading-placeholder">...</span>
  <span v-else class="icon-error-placeholder">?</span>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  iconName: {
    type: String,
    required: true
  },
  themeFolder: {
    type: String,
    required: true
  }
});

// Wir speichern jetzt eine Bild-URL (ein String) statt einer geladenen Komponente
const imageUrl = ref(null);
const isLoading = ref(false);

async function loadIcon() {
  if (!props.iconName || !props.themeFolder) {
    imageUrl.value = null;
    isLoading.value = false;
    return;
  }

  isLoading.value = true;
  imageUrl.value = null;

  try {
    // Dynamischer Import von PNGs. Vite gibt die korrekte, öffentliche URL zum Bild zurück.
    // Das ist die moderne Methode, um mit Assets umzugehen, die im Build-Prozess verarbeitet werden.
    const imageModule = await import(`../assets/icons/${props.themeFolder}/${props.iconName}.png`);
    imageUrl.value = imageModule.default;
  } catch (e) {
    console.error(`Icon nicht gefunden: src/assets/icons/${props.themeFolder}/${props.iconName}.png`, e);
    
    // Versuche den Fallback auf das 'default' Theme
    if (props.themeFolder !== 'default') {
      try {
        console.warn(`Versuche Fallback auf default Theme für Icon: ${props.iconName}`);
        const fallbackModule = await import(`../assets/icons/default/${props.iconName}.png`);
        imageUrl.value = fallbackModule.default;
      } catch (e2) {
        console.error(`Fallback Icon auch nicht gefunden: src/assets/icons/default/${props.iconName}.png`, e2);
        imageUrl.value = null;
      }
    } else {
      imageUrl.value = null;
    }
  } finally {
    isLoading.value = false;
  }
}

// Lade das Icon, wenn sich die Props ändern (oder beim ersten Mal)
watch(() => [props.iconName, props.themeFolder], loadIcon, { immediate: true });
</script>

<style scoped>

.game-png-icon {
  display: block;
  max-width: 2.5em;
  max-height: 2.5em;
  object-fit: contain;
}

.icon-loading-placeholder,
.icon-error-placeholder {
  display: inline-block;
  font-size: 2rem;
  line-height: 1;
}
</style>