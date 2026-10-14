# Deck and demo generators

Copies of the scripts that produced `web/index.html` and `web/media/omega-stewards-monad-demo.mp4`.
They were run from a working folder next to this repository (paths: `../Metropolis-SmartCiti`, and the private
worlds monorepo for the film posters), so they need their path constants edited before running from here.

- `build_monad_deck.py` (+ `deck_template.py`, `deck_sections*.py`): reads `deployments/monad-testnet.json`,
  `loop/console.json` and `loop/ledger.jsonl`, writes the deck.
- `build_demo_video.py` + `demo_script.json`: Chrome-headless screenshots of each deck section and of the ledger,
  narration from macOS `say`, assembled with `ffmpeg` (1920x1080 H.264/AAC).
