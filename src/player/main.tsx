import { createRoot } from 'react-dom/client'
import { PlayerApp } from './PlayerApp'
import '../styles/global.css'

createRoot(document.getElementById('root')!).render(<PlayerApp />)
