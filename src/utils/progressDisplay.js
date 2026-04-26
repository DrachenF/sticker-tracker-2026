export function getVisibleProgressWidth(percentage) {
  if (percentage <= 0) {
    return '0%'
  }

  return `max(${percentage}%, 8px)`
}
