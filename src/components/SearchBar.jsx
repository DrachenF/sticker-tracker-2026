const filters = [
  { id: 'all', label: 'Todas' },
  { id: 'owned', label: 'Tengo' },
  { id: 'missing', label: 'Faltan' },
  { id: 'duplicates', label: 'Repetidas' },
]

function SearchBar({ searchValue, onSearchChange, activeFilter, onFilterChange }) {
  return (
    <section className="album-toolbar">
      <div className="search-field">
        <label className="visually-hidden" htmlFor="album-search">
          Buscar estampitas
        </label>
        <input
          id="album-search"
          className="search-input"
          type="search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Codigo, equipo, jugador o tipo"
        />
      </div>

      <div className="filters-row" role="tablist" aria-label="Filtros">
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={`filter-chip ${activeFilter === filter.id ? 'is-active' : ''}`}
            onClick={() => onFilterChange(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>
    </section>
  )
}

export default SearchBar
