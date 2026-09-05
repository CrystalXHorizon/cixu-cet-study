import { createRoot } from 'react-dom/client';

import { VocabApp } from '@/components/vocab-app';
import '@/app/globals.css';

const root = document.getElementById('root');

if (!root) throw new Error('Missing application root');

createRoot(root).render(<VocabApp />);
