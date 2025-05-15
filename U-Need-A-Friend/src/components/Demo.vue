<template>
    <div class="menu">
      <h2>Game Settings</h2>
      <label>
        <input type="checkbox" v-model="settings.useNumbers" />
        Numbers
      </label>
      <label>
        <input type="checkbox" v-model="settings.useLetters" />
        Letters
      </label>
      <label>
        <input type="checkbox" v-model="settings.useSymbols" />
        Special Symbols
      </label>
      <label>
        <input type="checkbox" v-model="settings.timeLimitEnabled" />
        Time Limit (5 sec)
      </label>
      <div>
        Devices: {{ settings.deviceCount }}
        <button @click="addDevice">+</button>
        <button @click="removeDevice">-</button>
      </div>
      <button @click="startGame">Start Game</button>
    </div>
  
    <main class="empty-page" v-if="gameStarted">
      <div
        class="device"
        v-for="(device, index) in devices"
        :key="index"
      >
        <div class="display">
          <h1 class="display-text">
            <span v-if="index === sourceDevice">{{ currentTarget }}</span>
            <span v-else-if="index === targetDevice && blink">-</span>
          </h1>
        </div>
        <div class="buttons">
          <div
            class="button"
            v-for="item in device.buttons"
            :key="item"
            @click="handleButtonClick(index, item)"
          >
            {{ item }}
          </div>
        </div>
      </div>
    </main>
  </template>
  
  <script setup>
  import { reactive, ref, onMounted, onBeforeUnmount } from 'vue'
  
  const settings = reactive({
    useNumbers: true,
    useLetters: false,
    useSymbols: false,
    timeLimitEnabled: false,
    deviceCount: 6
  })
  
  const devices = reactive([])
  const allSymbols = {
    numbers: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    letters: ['A', 'B', 'C', 'D', 'E', 'F'],
    symbols: ['@', '#', '$', '&']
  }
  
  const gameStarted = ref(false)
  const sourceDevice = ref(null)
  const targetDevice = ref(null)
  const currentTarget = ref('')
  const blink = ref(true)
  const timeLimit = 5000 // 5 seconds
  let blinkInterval = null
  let timeoutTimer = null
  
  function buildPool() {
    let pool = []
    if (settings.useNumbers) pool = pool.concat(allSymbols.numbers)
    if (settings.useLetters) pool = pool.concat(allSymbols.letters)
    if (settings.useSymbols) pool = pool.concat(allSymbols.symbols)
    return pool
  }
  
  function setupDevices() {
    devices.length = 0
    for (let i = 0; i < settings.deviceCount; i++) {
      devices.push({
        buttons: []
      })
    }
  }
  
  function setUniqueButtons() {
    const pool = buildPool()
    devices.forEach(device => {
      const copy = [...pool]
      device.buttons = []
      for (let i = 0; i < 4; i++) {
        const idx = Math.floor(Math.random() * copy.length)
        device.buttons.push(copy.splice(idx, 1)[0])
      }
    })
  }
  
  function pickTargetValue() {
    currentTarget.value =
      devices[sourceDevice.value].buttons[
        Math.floor(Math.random() * devices[sourceDevice.value].buttons.length)
      ]
  }
  
  function startBlinking() {
    if (blinkInterval) clearInterval(blinkInterval)
    blinkInterval = setInterval(() => {
      blink.value = !blink.value
    }, 500)
  }
  
  function stopBlinking() {
    if (blinkInterval) clearInterval(blinkInterval)
  }
  
  function startTimer() {
    if (timeoutTimer) clearTimeout(timeoutTimer)
    if (settings.timeLimitEnabled) {
      timeoutTimer = setTimeout(() => {
        alert('⏰ Time’s up!')
        resetGame()
      }, timeLimit)
    }
  }
  
  function clearTimer() {
    if (timeoutTimer) clearTimeout(timeoutTimer)
  }
  
  function startGame() {
    gameStarted.value = true
    setupDevices()
    nextRound(-1)
  }
  function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
}

  function nextRound(prevSource) {
  const pool = buildPool()

  if (prevSource === -1) {
    sourceDevice.value = Math.floor(Math.random() * settings.deviceCount)
  } else {
    sourceDevice.value = prevSource
  }

  do {
    targetDevice.value = Math.floor(Math.random() * settings.deviceCount)
  } while (targetDevice.value === sourceDevice.value)

  // Pick a random target value
  currentTarget.value = pool[Math.floor(Math.random() * pool.length)]

  // Assign buttons
  devices.forEach((device, index) => {
    let copy = [...pool]
    if (index === targetDevice.value) {
      // Target → must include target value
      copy = copy.filter(v => v !== currentTarget.value)
      shuffleArray(copy)
      device.buttons = [
        currentTarget.value,
        ...copy.slice(0, 3)
      ]
      shuffleArray(device.buttons)
    } else {
      // Other devices → must NOT include target value
      copy = copy.filter(v => v !== currentTarget.value)
      shuffleArray(copy)
      device.buttons = copy.slice(0, 4)
    }
  })
}

  
  function handleButtonClick(deviceIndex, item) {
    if (deviceIndex !== targetDevice.value) return
  
    if (item === currentTarget.value) {
      clearTimer()
      stopBlinking()
      nextRound(targetDevice.value)
    }
  }
  
  function resetGame() {
    stopBlinking()
    clearTimer()
    gameStarted.value = false
  }
  
  function addDevice() {
    settings.deviceCount++
  }
  
  function removeDevice() {
    if (settings.deviceCount > 2) settings.deviceCount--
  }
  
  onMounted(startBlinking)
  onBeforeUnmount(() => {
    stopBlinking()
    clearTimer()
  })
  </script>
  
  <style scoped>
  .menu {
    padding: 20px;
    font-family: sans-serif;
  }
  .menu label {
    display: block;
    margin: 5px 0;
  }
  .menu button {
    margin: 5px;
  }
  
  .empty-page {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    justify-content: center;
    align-items: center;
    padding: 20px;
    font-family: sans-serif;
    text-align: center;
  }
  .device {
    background: #f0f0f0;
    padding: 20px;
    border-radius: 16px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 180px;
  }
  .display {
    width: 140px;
    height: 60px;
    background: #222;
    border-radius: 8px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .display-text {
    color: #f0f0f0;
    font-size: 24px;
  }
  .buttons {
    display: grid;
    grid-template-columns: repeat(2, 40px);
    grid-template-rows: repeat(2, 40px);
    gap: 6px;
  }
  .button {
    width: 40px;
    height: 40px;
    background: #4caf50;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.3s;
    user-select: none;
  }
  .button:hover {
    background: #45a049;
  }
  </style>
  