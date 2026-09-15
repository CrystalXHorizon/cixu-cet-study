import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import { VocabApp } from '@/components/vocab-app';
import '@/app/globals.css';

const root = document.getElementById('root');

if (!root) throw new Error('Missing application root');

const CloudAudioPreview = lazy(
  () => import('@/components/cloud-audio-preview'),
);
const audioPreview =
  new URLSearchParams(window.location.search).get('audio') === 'preview';

createRoot(root).render(
  audioPreview ? (
    <Suspense
      fallback={<output className="block p-8 text-base">正在打开试听…</output>}
    >
      <CloudAudioPreview />
    </Suspense>
  ) : (
    <VocabApp />
  ),
);
