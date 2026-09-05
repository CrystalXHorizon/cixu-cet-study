# Third-party data notices

## OpenEtymology CET wordbooks

Word lists, phonetics, Chinese definitions, and bilingual example sentences are adapted from the CET4 and CET6 wordbooks in [OpenEtymology](https://github.com/openetymology/OpenEtymology).

The public wordbook data is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Changes made for this project include parsing the EPUB files, normalizing fields, merging duplicate CET4/CET6 entries, and adding a small number of missing entries.

## FrequencyWords

Word ordering uses the English 2018 frequency list from [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords). Content is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## Free Dictionary API

Word-pronunciation buttons request available audio at runtime from the [Free Dictionary API](https://dictionaryapi.dev/). Audio files are not bundled with this project. Individual audio recordings can have their own source and license metadata; browser speech synthesis is used when an online recording is unavailable.

When the response identifies a Wikimedia Commons source, the app resolves the same recording through the Commons API and prefers its original `upload.wikimedia.org` URL, retaining the Dictionary API URL as a fallback. This changes the delivery path, not the recording's authorship or license. Source links and license metadata are retained in the pronunciation cache. For example, the US stressed pronunciation of “you” is [En-us-you.ogg](https://commons.wikimedia.org/wiki/File:En-us-you.ogg), with the source license reported as CC BY-SA 3.0. These externally streamed recordings are not relicensed under this repository's MIT or CC BY-SA 4.0 grants.
