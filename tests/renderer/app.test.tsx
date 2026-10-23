import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../../src/renderer/src/App'
import { useProjectStore } from '../../src/renderer/src/state/project-store'
import { useUiStore } from '../../src/renderer/src/state/ui-store'

const pick = vi.fn()

beforeEach(() => {
  pick.mockReset()
  useProjectStore.setState({ projectPath: null, recentPaths: [] })
  useUiStore.setState({ sidebarOpen: true, toasts: [] })
  window.agentgrid = {
    app: { info: vi.fn().mockResolvedValue({ name: 'AgentGrid', version: '0.1.0', platform: 'win32' }) },
    project: { pick }
  }
})

describe('App shell', () => {
  it('asks for a project folder on first launch', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /layihə qovluğunu seçin/i })).toBeTruthy()
  })

  it('opens the picked folder and shows it in the header and the empty terminal state', async () => {
    pick.mockResolvedValue({ path: 'C:\\work\\shop' })
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /layihə qovluğu seç/i })[0]!)
    await waitFor(() => expect(screen.getByRole('heading', { name: /hələ terminal yoxdur/i })).toBeTruthy())
    expect(screen.getAllByText('shop').length).toBeGreaterThan(0)
    expect(screen.getByText(/layihə açıldı: shop/i)).toBeTruthy()
  })

  it('does nothing when the folder dialog is cancelled', async () => {
    pick.mockResolvedValue({ path: null })
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /layihə qovluğu seç/i })[0]!)
    await waitFor(() => expect(pick).toHaveBeenCalled())
    expect(useProjectStore.getState().projectPath).toBeNull()
  })

  it('shows an error toast when picking a folder fails', async () => {
    pick.mockRejectedValue(new Error('boom'))
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /layihə qovluğu seç/i })[0]!)
    await waitFor(() => expect(screen.getByText(/qovluq seçmək alınmadı/i)).toBeTruthy())
  })

  it('shows the app version from the main process in the status bar', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('AgentGrid 0.1.0')).toBeTruthy())
  })

  it('hides and shows the sidebar from the rail button', () => {
    render(<App />)
    const toggle = screen.getByRole('button', { name: /yan paneli/i })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByLabelText('Layihələr').hasAttribute('hidden')).toBe(true)
  })

  it('tells the user honestly that the terminal engine is not ready yet', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /claude \(yeni terminal\)/i }))
    expect(screen.getByText(/3-cü mərhələdə/i)).toBeTruthy()
  })
})
