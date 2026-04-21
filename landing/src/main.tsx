import { createRoot } from 'react-dom/client';
import { LandingApp } from './LandingApp';

const container = document.getElementById('landing');
if (!container) throw new Error('Missing #landing root element');

createRoot(container).render(<LandingApp />);
