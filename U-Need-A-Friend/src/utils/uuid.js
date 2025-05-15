export function generateId() {
  return crypto.randomUUID() // works in modern browsers
}
