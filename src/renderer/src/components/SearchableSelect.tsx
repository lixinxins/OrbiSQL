import { useEffect, useRef, useState } from 'react'
import { CaretDown, Check, MagnifyingGlass } from '@phosphor-icons/react'

export interface SearchableOption {
  value: string
  label: string
  keywords?: string
}

interface SearchableSelectProps {
  value: string
  options: SearchableOption[]
  placeholder: string
  disabled?: boolean
  onChange: (value: string) => void
}

function SearchableSelect({ value, options, placeholder, disabled, onChange }: SearchableSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selected = options.find((option) => option.value === value)
  const normalizedSearch = search.trim().toLowerCase()
  const filteredOptions = options.filter((option) =>
    `${option.label} ${option.keywords ?? ''}`.toLowerCase().includes(normalizedSearch)
  )

  useEffect(() => {
    if (!open) return
    const close = (event: globalThis.PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div className={`searchable-select${open ? ' open' : ''}${disabled ? ' disabled' : ''}`} ref={rootRef}>
      <div className="searchable-select-input">
        {open && <MagnifyingGlass className="select-search-icon" />}
        <input
          disabled={disabled}
          value={open ? search : selected?.label ?? ''}
          placeholder={placeholder}
          readOnly={!open}
          onClick={() => {
            if (disabled) return
            setSearch('')
            setOpen(true)
          }}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
            if (event.key === 'Enter' && filteredOptions[0]) {
              event.preventDefault()
              onChange(filteredOptions[0].value)
              setOpen(false)
            }
          }}
        />
        <CaretDown className="select-caret" />
      </div>
      {open && (
        <div className="searchable-options">
          {filteredOptions.length > 0 ? filteredOptions.map((option) => (
            <button
              type="button"
              className={option.value === value ? 'selected' : ''}
              key={option.value}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check />}
            </button>
          )) : <div className="searchable-empty">没有匹配项</div>}
        </div>
      )}
    </div>
  )
}

export default SearchableSelect
