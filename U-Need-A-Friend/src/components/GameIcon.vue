<template>
  <component :is="loadedIcon" v-if="loadedIcon" class="game-svg-icon" />
  <span v-else-if="isLoading" class="icon-loading-placeholder">...</span>
  <span v-else class="icon-error-placeholder">?</span> </template>

<script setup>
import { ref, watch, defineProps, onMounted } from 'vue';

const props = defineProps({
  iconName: { // Der Identifier vom Server, z.B. 'rocket'
    type: String,
    required: true
  },
  themeFolder: { // Der Name des Theme-Ordners, z.B. 'ocean' oder 'default'
    type: String,
    required: true
  }
});

const loadedIcon = ref(null);
const isLoading = ref(false);

async function loadIcon() {
  if (!props.iconName || !props.themeFolder) {
    loadedIcon.value = null;
    isLoading.value = false;
    return;
  }

  isLoading.value = true;
  loadedIcon.value = null; // Zurücksetzen, falls vorher ein anderes Icon geladen war

  try {
    // Dynamischer Import von SVGs. Vite behandelt das gut.
    // Der Pfad ist relativ zum aktuellen Verzeichnis (src/components/).
    // Passe den Pfad ggf. an deine Ordnerstruktur an, wenn GameIcon.vue woanders liegt.
    // Wichtig: Vite braucht einen relativ statischen Teil im Pfad für die Analyse.
    const iconModule = await import(`../assets/icons/${props.themeFolder}/${props.iconName}.svg?component`);
    loadedIcon.value = iconModule.default || iconModule;
  } catch (e) {
    console.error(`Icon nicht gefunden: src/assets/icons/${props.themeFolder}/${props.iconName}.svg`, e);
    // Versuche Fallback auf 'default' Theme, falls das aktuelle Theme nicht 'default' ist und ein Fehler auftrat
    if (props.themeFolder !== 'default') {
      try {
        console.warn(`Versuche Fallback auf default Theme für Icon: ${props.iconName}`);
        const fallbackModule = await import(`../assets/icons/default/${props.iconName}.svg?component`);
        loadedIcon.value = fallbackModule.default || fallbackModule;
      } catch (e2) {
        console.error(`Fallback Icon auch nicht gefunden: src/assets/icons/default/${props.iconName}.svg`, e2);
        loadedIcon.value = null; // Kein Icon gefunden
      }
    } else {
      loadedIcon.value = null; // Kein Icon gefunden (war schon default oder kein Fallback definiert)
    }
  } finally {
    isLoading.value = false;
  }
}

// Lade das Icon, wenn sich iconName oder themeFolder ändern oder bei der Initialisierung.
watch(() => [props.iconName, props.themeFolder], loadIcon, { immediate: true });
// onMounted(loadIcon); // wird durch immediate:true in watch abgedeckt

</script>

<style scoped>
.game-svg-icon {
  display: block; /* Block oder inline-block, um width/height sicher zu setzen */
      /* Versucht, die Breite des Elternelements (Button-Inhalt) zu füllen */
     /* Versucht, die Höhe des Elternelements (Button-Inhalt) zu füllen */

  /* Wichtig, falls das SVG ein anderes Seitenverhältnis als der Container hat: */
  /* Diese Eigenschaften sind für <img>, aber im SVG selbst wirkt preserveAspectRatio */
  /* Für das <svg> Element selbst ist es besser, auf viewBox und CSS width/height zu setzen */
  /* und sicherzustellen, dass die SVG-Pfade relativ zum viewBox sind. */

  /* Wenn das SVG interne width/height hat, können die diese Einstellungen überschreiben. */
  /* Stelle sicher, dass deine SVGs primär über viewBox skaliert werden. */

  max-width: 2.5em; /* Maximale Größe, z.B. 2.5-fache der SchFriftgröße des Buttons */
  max-height: 2.5em;/* Verhindert, dass das Icon zu riesig wird, wenn der Button sehr groß ist */
                     /* Passe diesen Wert an deine gewünschte Maximalgröße an. */
  margin: auto; /* Zentriert das Icon, wenn es kleiner als max-width/height ist */
}

.icon-loading-placeholder,
.icon-error-placeholder {
  /* ... deine Styles dafür ... */
  display: inline-block;
  width: 1.5em; /* Beispielgröße */
  height: 1.5em;
  text-align: center;
  line-height: 1.5em;
}
</style>