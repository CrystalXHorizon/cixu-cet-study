# Third-party data notices

## OpenEtymology CET wordbooks

Word lists, phonetics, Chinese definitions, and bilingual example sentences are adapted from the CET4 and CET6 wordbooks in [OpenEtymology](https://github.com/openetymology/OpenEtymology).

The public wordbook data is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Changes made for this project include parsing the EPUB files, normalizing fields, merging duplicate CET4/CET6 entries, and adding a small number of missing entries.

## FrequencyWords

Word ordering uses the English 2018 frequency list from [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords). Content is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## Free Dictionary API

Word-pronunciation buttons first use an English browser voice explicitly reported as local (`localService: true`), without requesting online pronunciation data. If no local English voice is available, or local playback fails, they request recordings from the [Free Dictionary API](https://dictionaryapi.dev/). The interface explains that online pronunciation may take longer on slow networks. Audio files are not bundled with this project. Individual recordings retain their own source and license metadata. Sentence playback also prefers local English voices; browser-provided online voices are used only when no local English voice is available.

The app uses the audio URL returned by the Dictionary API directly; it no longer requests Wikimedia Commons as an intermediate step. Source links and license metadata returned by the API are retained in the pronunciation cache. These externally streamed recordings are not relicensed under this repository's MIT or CC BY-SA 4.0 grants.
