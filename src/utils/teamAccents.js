const accentMap = {
  MEX: '#16A34A',
  USA: '#2563EB',
  CAN: '#DC2626',
  ARG: '#0EA5E9',
  BRA: '#16A34A',
  FRA: '#1D4ED8',
  GER: '#475569',
  ESP: '#F97316',
  ITA: '#2563EB',
  ENG: '#DC2626',
  JPN: '#E11D48',
  KOR: '#F97316',
  QAT: '#BE185D',
  MAR: '#B91C1C',
  SEN: '#16A34A',
}

export function getAccentColorForTeam(teamCode) {
  return accentMap[teamCode] || '#2563EB'
}
