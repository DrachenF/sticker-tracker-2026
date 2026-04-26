import { useState } from 'react'
import StickerCard from './StickerCard'
import { getAccentColorForTeam } from '../utils/teamAccents'
import { getVisibleProgressWidth } from '../utils/progressDisplay'

function TeamSection({
  section,
  stickers,
  collection,
  onToggleOwned,
  onIncrementDuplicates,
  onDecrementDuplicates,
  defaultExpanded = false,
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const accentColor = getAccentColorForTeam(section.teamCode)
  const ownedCount = stickers.filter(
    (sticker) => collection[sticker.code]?.owned,
  ).length
  const percentage = stickers.length
    ? Math.round((ownedCount / stickers.length) * 100)
    : 0

  return (
    <section
      className="team-section"
      style={{ '--team-accent': accentColor }}
    >
      <button
        type="button"
        className="team-header"
        onClick={() => setIsExpanded((currentValue) => !currentValue)}
      >
        <div className="team-header-top">
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div
              style={{
                fontSize: '3rem',
                filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.18))',
                transform: 'rotate(-6deg) scale(1.1)',
              }}
            >
              {section.flag}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                alignItems: 'flex-start',
              }}
            >
              <div className="team-chip">
                <span>🏆 {section.shortLabel}</span>
              </div>
              <h3
                style={{
                  fontSize: '1.45rem',
                  fontWeight: 900,
                  margin: '2px 0 0',
                  lineHeight: 1.1,
                }}
              >
                {section.title}
              </h3>
              <p className="team-subtitle">{section.subtitle}</p>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              justifyContent: 'center',
            }}
          >
            <span
              className="team-progress"
              style={{
                fontSize: '1.5rem',
                color: 'var(--text-main)',
                letterSpacing: '-0.02em',
              }}
            >
              {ownedCount}{' '}
              <span
                style={{
                  fontSize: '0.9rem',
                  color: 'var(--text-secondary)',
                }}
              >
                / {stickers.length}
              </span>
            </span>
            <span
              style={{
                fontSize: '0.9rem',
                color: 'var(--team-accent, var(--blue))',
                fontWeight: 800,
              }}
            >
              {percentage}% {isExpanded ? '🔽' : '◀️'}
            </span>
          </div>
        </div>

        <div className="mini-progress-track" aria-hidden="true">
          <div
            className="mini-progress-bar"
            style={{
              width: getVisibleProgressWidth(percentage),
            }}
          />
        </div>
      </button>

      {isExpanded ? (
        <div className="team-content">
          {stickers.map((sticker) => (
            <StickerCard
              key={sticker.code}
              sticker={sticker}
              stickerState={collection[sticker.code]}
              accentColor={accentColor}
              onToggleOwned={onToggleOwned}
              onIncrementDuplicates={onIncrementDuplicates}
              onDecrementDuplicates={onDecrementDuplicates}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

export default TeamSection
