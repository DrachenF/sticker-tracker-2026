import { forwardRef } from 'react'

function NavIcon({ id }) {
  const commonProps = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }

  switch (id) {
    case 'album':
      return (
        <svg {...commonProps}>
          <path d="M5 4.5h10.5a3 3 0 0 1 3 3V19.5H8a3 3 0 0 0-3 3z" />
          <path d="M8 4.5v18" />
          <path d="M11 8h5" />
          <path d="M11 12h5" />
        </svg>
      )
    case 'missing':
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="8" />
          <path d="M8.5 12h7" />
        </svg>
      )
    case 'duplicates':
      return (
        <svg {...commonProps}>
          <rect x="5" y="7" width="10" height="12" rx="2" />
          <path d="M9 5h8a2 2 0 0 1 2 2v10" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.8-1L14.5 3h-5L9 5.9a7 7 0 0 0-1.8 1l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.8 1L9.5 21h5l.5-2.9a7 7 0 0 0 1.8-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1.1Z" />
        </svg>
      )
    case 'home':
    default:
      return (
        <svg {...commonProps}>
          <path d="M4.5 10.5 12 4l7.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4.5 19z" />
          <path d="M9.5 20.5v-5h5v5" />
        </svg>
      )
  }
}

const BottomNav = forwardRef(function BottomNav(
  { tabs, activeTab, highlightedTabId, onChange },
  ref,
) {
  return (
    <nav ref={ref} className="bottom-nav" aria-label="Navegacion principal">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          data-tab-id={tab.id}
          className={`tab-button ${activeTab === tab.id ? 'is-active' : ''} ${
            highlightedTabId === tab.id ? 'is-highlighted-target' : ''
          }`}
          onClick={() => onChange(tab.id)}
        >
          <span className="tab-icon-shell">
            <NavIcon id={tab.id} />
          </span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  )
})

export default BottomNav
