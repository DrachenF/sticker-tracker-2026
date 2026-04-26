let audioContext

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext

  if (!AudioContextClass) {
    return null
  }

  if (!audioContext) {
    audioContext = new AudioContextClass()
  }

  if (audioContext.state === 'suspended') {
    audioContext.resume()
  }

  return audioContext
}

function playToneSequence(notes) {
  const context = getAudioContext()

  if (!context) {
    return
  }

  const startTime = context.currentTime

  notes.forEach((note) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const noteStart = startTime + note.at
    const noteEnd = noteStart + note.duration

    oscillator.type = note.type || 'sine'
    oscillator.frequency.setValueAtTime(note.frequency, noteStart)

    gain.gain.setValueAtTime(0.0001, noteStart)
    gain.gain.exponentialRampToValueAtTime(note.volume, noteStart + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd)

    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(noteStart)
    oscillator.stop(noteEnd + 0.02)
  })
}

function playPageTurnSound() {
  const context = getAudioContext()

  if (!context) {
    return
  }

  const duration = 0.22
  const sampleRate = context.sampleRate
  const buffer = context.createBuffer(1, Math.floor(sampleRate * duration), sampleRate)
  const data = buffer.getChannelData(0)

  for (let i = 0; i < data.length; i += 1) {
    const progress = i / data.length
    const sweep = Math.sin(progress * Math.PI)
    data[i] = (Math.random() * 2 - 1) * sweep * 0.32
  }

  const source = context.createBufferSource()
  const highpass = context.createBiquadFilter()
  const lowpass = context.createBiquadFilter()
  const gain = context.createGain()
  const startTime = context.currentTime

  source.buffer = buffer
  source.playbackRate.setValueAtTime(1.05, startTime)
  source.playbackRate.exponentialRampToValueAtTime(0.72, startTime + duration)

  highpass.type = 'highpass'
  highpass.frequency.setValueAtTime(420, startTime)
  lowpass.type = 'lowpass'
  lowpass.frequency.setValueAtTime(2600, startTime)
  lowpass.frequency.exponentialRampToValueAtTime(1100, startTime + duration)

  gain.gain.setValueAtTime(0.0001, startTime)
  gain.gain.exponentialRampToValueAtTime(0.028, startTime + 0.025)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)

  source.connect(highpass)
  highpass.connect(lowpass)
  lowpass.connect(gain)
  gain.connect(context.destination)
  source.start(startTime)
  source.stop(startTime + duration + 0.02)
}

export function playStickerSound(type) {
  if (type === 'add') {
    playToneSequence([
      { frequency: 523.25, at: 0, duration: 0.08, volume: 0.045 },
      { frequency: 659.25, at: 0.07, duration: 0.08, volume: 0.045 },
      { frequency: 783.99, at: 0.14, duration: 0.12, volume: 0.04 },
    ])
    return
  }

  if (type === 'paste') {
    playToneSequence([
      { frequency: 523.25, at: 0, duration: 0.07, volume: 0.04, type: 'triangle' },
      { frequency: 659.25, at: 0.06, duration: 0.08, volume: 0.045, type: 'triangle' },
      { frequency: 783.99, at: 0.12, duration: 0.1, volume: 0.042, type: 'sine' },
      { frequency: 1046.5, at: 0.2, duration: 0.16, volume: 0.038, type: 'sine' },
    ])
    return
  }

  if (type === 'duplicate') {
    playToneSequence([
      { frequency: 392, at: 0, duration: 0.09, volume: 0.032, type: 'triangle' },
      { frequency: 329.63, at: 0.08, duration: 0.13, volume: 0.026, type: 'triangle' },
    ])
    return
  }

  if (type === 'close') {
    playToneSequence([
      { frequency: 220, at: 0, duration: 0.055, volume: 0.035, type: 'square' },
      { frequency: 164.81, at: 0.055, duration: 0.08, volume: 0.025, type: 'triangle' },
    ])
    return
  }

  if (type === 'page') {
    playPageTurnSound()
  }
}
