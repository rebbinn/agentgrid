import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRoot } from './AppRoot'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>
)
