import { createContext, useContext, useState, type ReactNode } from 'react'
import type { SettingsRepository } from '@core/ports/settingsRepository'
import { createSettingsRepository } from './createSettingsRepository'

const SettingsRepositoryContext = createContext<SettingsRepository | null>(null)

// 没有 Provider 时的兜底：用一份单例，避免每次渲染都换一个新仓库导致设置丢失。
let fallbackRepository: SettingsRepository | null = null

function defaultSettingsRepository(): SettingsRepository {
  fallbackRepository ??= createSettingsRepository()
  return fallbackRepository
}

export interface SettingsRepositoryProviderProps {
  repository?: SettingsRepository | null
  children: ReactNode
}

export function SettingsRepositoryProvider({
  repository,
  children
}: SettingsRepositoryProviderProps): React.JSX.Element {
  const [fallback] = useState(createSettingsRepository)
  return (
    <SettingsRepositoryContext.Provider value={repository === undefined ? fallback : repository}>
      {children}
    </SettingsRepositoryContext.Provider>
  )
}

export function useSettingsRepository(): SettingsRepository {
  const repository = useContext(SettingsRepositoryContext)
  return repository ?? defaultSettingsRepository()
}
