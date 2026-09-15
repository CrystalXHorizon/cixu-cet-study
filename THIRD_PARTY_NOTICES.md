# Third-party data notices

## Cloud-generated speech

The recordings in `public/audio/full/` and the 15 samples in
`public/audio/cloud-preview/` are synthetic speech generated
on GitHub Actions using [Kokoro](https://github.com/hexgrad/kokoro), `kokoro-js`
1.2.1 and the Apache-2.0 licensed Kokoro-82M model (voice `af_heart`). The speech
engine is a build-time tool and is not shipped to or run in visitors' browsers.
The accompanying manifest records the source workflow run, input sentences and
audio checksums. Sentence content is adapted from OpenEtymology under CC BY-SA
4.0 as described below; the corresponding recordings are distributed under
CC BY-SA 4.0 with attribution to OpenEtymology and 词序 — CrystalXHorizon.

## OpenEtymology CET wordbooks

Word lists, phonetics, Chinese definitions, and bilingual example sentences are adapted from the CET4 and CET6 wordbooks in [OpenEtymology](https://github.com/openetymology/OpenEtymology).

The public wordbook data is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Changes made for this project include parsing the EPUB files, normalizing fields, merging duplicate CET4/CET6 entries, and adding a small number of missing entries.

## FrequencyWords

Word ordering uses the English 2018 frequency list from [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords). Content is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## Historical Free Dictionary API integration

Earlier versions streamed recordings from the [Free Dictionary API](https://dictionaryapi.dev/).
The current player uses the cloud-generated library above. No Dictionary API
recordings are bundled or requested by the current player; the historical helper
retains source and license metadata and does not relicense external recordings.
