import { getVisibleProgressWidth } from '../utils/progressDisplay'

function ProgressCard({ stats }) {
  return (
    <section className="progress-card">
      <div className="progress-card-top">
        <div>
          <p className="page-label">Mi coleccion base</p>
          <h2>
            {stats.owned} <span>/ {stats.total}</span>
          </h2>
        </div>
        <div className="progress-badge">{stats.percentage}%</div>
      </div>

      <div className="progress-visual">
        <div className="progress-track" aria-hidden="true">
          <div
            className="progress-bar"
            style={{
              width: getVisibleProgressWidth(stats.percentage),
            }}
          />
        </div>
      </div>
    </section>
  )
}

export default ProgressCard
