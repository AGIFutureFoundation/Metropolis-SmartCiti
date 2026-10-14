#!/usr/bin/env python3
"""Monad Metropolis version of the "SmartCiti.X Agentic Worlds" deck.

    python3 build_monad_deck.py   -> agentic-worlds-monad.html (+ media/ copied next to it)

Onchain numbers are read from Metropolis-SmartCiti/deployments/monad-testnet.json and loop/.
World-network numbers are copied from the source deck (SmartCiti.X Agentic Worlds.md, built 2026-10-12).
The page body is in deck_template.py (CSS) and deck_sections.py (sections).
"""
import collections, html, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
TMP = os.path.dirname(HERE)
METRO = os.path.join(TMP, "Metropolis-SmartCiti")
FILM = os.path.join(TMP, "_wf_rebuild", "atlas", "film")
OUT = os.path.join(HERE, "agentic-worlds-monad.html")  # published copy: web/index.html (hero video = the demo)
EXP = "https://testnet.monadexplorer.com"
REPO = "https://github.com/AGIFutureFoundation/Metropolis-SmartCiti"
E = html.escape

dep = json.load(open(os.path.join(METRO, "deployments", "monad-testnet.json")))
con = json.load(open(os.path.join(METRO, "loop", "console.json")))
led = [json.loads(l) for l in open(os.path.join(METRO, "loop", "ledger.jsonl"))]
kinds = collections.Counter(e["kind"] for e in led)

MEDIA = {"film": "features-film-narrated.mp4", "poster": "posters/features-01-title.jpg",
         "worlds": "posters/features-02-worlds.jpg", "gov": "posters/features-03-governance.jpg"}
os.makedirs(os.path.join(HERE, "media"), exist_ok=True)
have = {}
for k, rel in MEDIA.items():
    src = os.path.join(FILM, rel)
    if os.path.exists(src):
        dst = os.path.join(HERE, "media", os.path.basename(rel))
        if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(src):
            shutil.copy2(src, dst)
        have[k] = "media/" + os.path.basename(rel)


def addr(a, full=False):
    label = a if full else a[:6] + "…" + a[-4:]
    return f'<a class="mono" href="{EXP}/address/{a}" target="_blank" rel="noopener">{E(label)}</a>'


def tx(h):
    return f'<a class="mono" href="{EXP}/tx/{h}" target="_blank" rel="noopener">{h[:10]}…</a>'


def img(k, cap):
    if k in have:
        return f'<figure><img src="{have[k]}" alt="{E(cap)}"><figcaption>{E(cap)}</figcaption></figure>'
    return f'<figure class="missing"><div class="ph">media missing: {E(cap)}</div></figure>'


if __name__ == "__main__":
    from deck_template import CSS
    from deck_sections import sections
    ctx = dict(dep=dep, con=con, led=led, kinds=kinds, have=have, addr=addr, tx=tx, img=img, E=E, EXP=EXP, REPO=REPO)
    page = ('<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
            '<title>Omega Stewards on Monad · SmartCiti.X Agentic Worlds</title>\n'
            f'<style>{CSS}</style></head><body>\n{sections(ctx)}\n</body></html>\n')
    open(OUT, "w", encoding="utf-8").write(page)
    print(f"wrote {OUT} ({len(page)} bytes); media: {sorted(have)}; missing: {sorted(set(MEDIA) - set(have))}")
