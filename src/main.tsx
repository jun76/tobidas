import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './builder/Workspace'
import { DialogProvider } from './builder/ui/DialogProvider'
import './styles/global.css'
import './builder/theme.css'
import './builder/themeState'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DialogProvider><App /></DialogProvider>
  </StrictMode>,
)
