import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './builder/App'
import { DialogProvider } from './builder/ui/DialogProvider'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DialogProvider><App /></DialogProvider>
  </StrictMode>,
)
